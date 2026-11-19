<?php
/*
 * Lizenzprüfung.
 *  - Lokale Schlüssel: selbst erzeugt per  php api/_cli/license.php create  (funktionieren immer)
 *  - Polar (polar.sh): Online-Prüfung, Ergebnis wird zwischengespeichert
 *
 * In der Datenbank liegt nie der Schlüssel selbst, nur ein HMAC davon.
 */
declare(strict_types=1);

function kv_license_normalize(string $key): string
{
    $key = trim($key);
    if ($key === '' || strlen($key) > 128 || !preg_match('/^[A-Za-z0-9_-]{8,128}$/', $key)) {
        throw new KvError(403, 'license_invalid', 'Dieser Lizenzschlüssel ist ungültig.');
    }
    return $key;
}

function kv_license_display(string $key): string
{
    return '••••' . substr($key, -4);
}

/*
 * Gerätebegrenzung (Polar „Activation limit“):
 *  - Jeder Browser wird beim Freischalten bei Polar als Gerät aktiviert und bekommt eine activation_id.
 *  - Danach weist er sich mit Schlüssel + activation_id aus. Ist das Limit erreicht, gibt es 409 device_limit.
 *  - Schlüssel ohne Limit (z. B. ältere oder Test-Schlüssel) funktionieren ohne Aktivierung.
 * Zwischenspeicher (kv_licenses):
 *  - Zeile für den Schlüssel:          status active | activation_required | invalid
 *  - Zeile für Schlüssel + Gerät:      status active | invalid
 */

const KV_ERR_INVALID = 'Dieser Lizenzschlüssel ist ungültig.';

/** @return array<string,mixed>|null */
function kv_license_row(PDO $db, string $hash): ?array
{
    $st = $db->prepare('SELECT * FROM kv_licenses WHERE key_hash = ?');
    $st->execute([$hash]);
    return $st->fetch() ?: null;
}

function kv_license_cache(PDO $db, string $hash, string $display, string $status, ?int $validUntil): void
{
    $now = kv_now();
    if (kv_license_row($db, $hash)) {
        $db->prepare('UPDATE kv_licenses SET status = ?, checked_at = ?, valid_until = ? WHERE key_hash = ?')
           ->execute([$status, $now, $validUntil, $hash]);
    } else {
        $db->prepare('INSERT INTO kv_licenses (key_hash, provider, status, display, created_at, checked_at, valid_until) VALUES (?, ?, ?, ?, ?, ?, ?)')
           ->execute([$hash, 'polar', $status, $display, $now, $now, $validUntil]);
    }
}

function kv_activation_hash(string $key, string $activationId): string
{
    return kv_hmac('license', $key . '#' . $activationId);
}

function kv_activation_id(?string $id): ?string
{
    if ($id === null || $id === '') {
        return null;
    }
    if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $id)) {
        throw new KvError(400, 'bad_request', 'Ungültige Anfrage.');
    }
    return strtolower($id);
}

/**
 * Prüft einen Lizenzschlüssel (bei Polar-Schlüsseln mit Gerätelimit zusammen mit der activation_id).
 * Wirft KvError, wenn er nicht gilt.
 * @return array{hash:string, display:string, provider:string, valid_until:?int}
 */
function kv_license_check(PDO $db, string $rawKey, ?string $activationId = null): array
{
    $key = kv_license_normalize($rawKey);
    $activationId = kv_activation_id($activationId);
    $hash = kv_hmac('license', $key);
    $display = kv_license_display($key);
    $now = kv_now();
    $cfg = kv_config()['license'];
    $ok = static fn (?int $until, string $provider = 'polar'): array =>
        ['hash' => $hash, 'display' => $display, 'provider' => $provider, 'valid_until' => $until];

    $row = kv_license_row($db, $hash);
    if ($row && $row['provider'] === 'local') {
        if ($row['status'] !== 'active') {
            throw new KvError(403, 'license_revoked', 'Dieser Lizenzschlüssel wurde deaktiviert.');
        }
        if ($row['valid_until'] !== null && (int)$row['valid_until'] < $now) {
            throw new KvError(403, 'license_expired', 'Dieser Lizenzschlüssel ist abgelaufen.');
        }
        return $ok($row['valid_until'] !== null ? (int)$row['valid_until'] : null, 'local');
    }
    if ((string)$cfg['provider'] !== 'polar') {
        throw new KvError(403, 'license_invalid', KV_ERR_INVALID);
    }

    // Mit Gerät: Schlüssel + activation_id prüfen.
    if ($activationId !== null) {
        $ahash = kv_activation_hash($key, $activationId);
        $arow = kv_license_row($db, $ahash);
        if ($arow && kv_cache_fresh($arow, (int)$cfg['cache_seconds'])) {
            if ($arow['status'] === 'active' && ($arow['valid_until'] === null || (int)$arow['valid_until'] >= $now)) {
                return $ok($arow['valid_until'] !== null ? (int)$arow['valid_until'] : null);
            }
            throw new KvError(403, 'activation_invalid', 'Dieses Gerät ist für den Schlüssel nicht mehr freigeschaltet.');
        }
        try {
            $v = kv_polar_validate($key, $cfg['polar'], $activationId);
        } catch (RuntimeException $e) {
            return kv_license_grace($arow, $cfg, $e, $ok);
        }
        kv_license_cache($db, $ahash, $display, $v['valid'] ? 'active' : 'invalid', $v['valid_until']);
        if ($v['valid']) {
            return $ok($v['valid_until']);
        }
        // Gerät ungültig – liegt es am Gerät oder am Schlüssel?
        try {
            $k = kv_polar_validate($key, $cfg['polar'], null);
        } catch (RuntimeException $e) {
            throw new KvError(503, 'license_unavailable', 'Die Lizenz kann gerade nicht geprüft werden. Bitte später erneut versuchen.');
        }
        if ($k['valid']) {
            throw new KvError(403, 'activation_invalid', 'Dieses Gerät ist für den Schlüssel nicht mehr freigeschaltet.');
        }
        throw new KvError(403, 'license_invalid', KV_ERR_INVALID);
    }

    // Ohne Gerät: nur erlaubt, wenn der Schlüssel kein Gerätelimit hat.
    if ($row && kv_cache_fresh($row, (int)$cfg['cache_seconds'])) {
        return kv_license_from_status($row, $ok);
    }
    try {
        $v = kv_polar_validate($key, $cfg['polar'], null);
    } catch (RuntimeException $e) {
        return kv_license_grace($row, $cfg, $e, $ok);
    }
    $status = !$v['valid'] ? 'invalid' : ($v['limit'] !== null ? 'activation_required' : 'active');
    kv_license_cache($db, $hash, $display, $status, $v['valid_until']);
    return kv_license_from_status(['status' => $status, 'valid_until' => $v['valid_until']], $ok);
}

/** @param array<string,mixed> $row */
function kv_cache_fresh(array $row, int $seconds): bool
{
    return $row['checked_at'] !== null && (int)$row['checked_at'] > kv_now() - $seconds;
}

/** @param array<string,mixed> $row */
function kv_license_from_status(array $row, callable $ok): array
{
    $until = $row['valid_until'] !== null ? (int)$row['valid_until'] : null;
    if ($row['status'] === 'activation_required') {
        throw new KvError(403, 'activation_required', 'Bitte den Lizenzschlüssel auf diesem Gerät neu freischalten.');
    }
    if ($row['status'] !== 'active') {
        throw new KvError(403, 'license_invalid', KV_ERR_INVALID);
    }
    if ($until !== null && $until < kv_now()) {
        throw new KvError(403, 'license_expired', 'Dieser Lizenzschlüssel ist abgelaufen.');
    }
    return $ok($until);
}

/**
 * Polar nicht erreichbar: zuletzt gültige Schlüssel/Geräte eine Weile weiter akzeptieren.
 * @param array<string,mixed>|null $row
 * @param array<string,mixed> $cfg
 */
function kv_license_grace(?array $row, array $cfg, Throwable $e, callable $ok): array
{
    error_log('[kuvert] polar: ' . $e->getMessage());
    if ($row && $row['status'] === 'active' && $row['checked_at'] !== null
        && (int)$row['checked_at'] > kv_now() - (int)$cfg['grace_seconds']) {
        return $ok($row['valid_until'] !== null ? (int)$row['valid_until'] : null);
    }
    throw new KvError(503, 'license_unavailable', 'Die Lizenz kann gerade nicht geprüft werden. Bitte später erneut versuchen.');
}

/**
 * Schaltet einen Schlüssel auf diesem Gerät frei.
 * @return array{display:string, valid_until:?int, activation_id:?string}
 */
function kv_license_activate(PDO $db, string $rawKey, string $label): array
{
    $key = kv_license_normalize($rawKey);
    $hash = kv_hmac('license', $key);
    $display = kv_license_display($key);
    $cfg = kv_config()['license'];

    $row = kv_license_row($db, $hash);
    if (($row && $row['provider'] === 'local') || (string)$cfg['provider'] !== 'polar') {
        $lic = kv_license_check($db, $key);   // lokale Schlüssel kennen keine Geräte
        return ['display' => $lic['display'], 'valid_until' => $lic['valid_until'], 'activation_id' => null];
    }

    try {
        $act = kv_polar_activate($key, $cfg['polar'], $label);
        if ($act['status'] === 'ok') {
            $v = kv_polar_validate($key, $cfg['polar'], $act['id']);   // Benefit, Status, Ablauf prüfen
            if (!$v['valid']) {
                kv_polar_deactivate($key, $cfg['polar'], $act['id']);
                throw new KvError(403, 'license_invalid', KV_ERR_INVALID);
            }
            kv_license_cache($db, kv_activation_hash($key, $act['id']), $display, 'active', $v['valid_until']);
            return ['display' => $display, 'valid_until' => $v['valid_until'], 'activation_id' => $act['id']];
        }
        // 403/404: Limit erreicht, Schlüssel ohne Gerätelimit oder ungültig – das klärt /validate.
        $v = kv_polar_validate($key, $cfg['polar'], null);
    } catch (RuntimeException $e) {
        error_log('[kuvert] polar: ' . $e->getMessage());
        throw new KvError(503, 'license_unavailable', 'Die Lizenz kann gerade nicht geprüft werden. Bitte später erneut versuchen.');
    }
    if (!$v['valid']) {
        kv_license_cache($db, $hash, $display, 'invalid', $v['valid_until']);
        throw new KvError(403, 'license_invalid', KV_ERR_INVALID);
    }
    if ($v['limit'] === null) {
        kv_license_cache($db, $hash, $display, 'active', $v['valid_until']);
        return ['display' => $display, 'valid_until' => $v['valid_until'], 'activation_id' => null];
    }
    kv_license_cache($db, $hash, $display, 'activation_required', $v['valid_until']);
    $manage = (string)kv_config()['manage_url'];
    $geraete = $v['limit'] === 1 ? 'einem Gerät' : "{$v['limit']} Geräten";
    throw new KvError(409, 'device_limit',
        "Dieser Schlüssel ist schon auf {$geraete} freigeschaltet. Entferne ihn auf einem anderen Gerät"
        . ($manage !== '' ? ' oder gib im Kundenportal ein Gerät frei.' : '.'),
        ['limit' => $v['limit'], 'manageUrl' => $manage]);
}

/** Gibt das Gerät wieder frei (z. B. „Schlüssel von diesem Gerät entfernen“). */
function kv_license_deactivate(PDO $db, string $rawKey, ?string $activationId): void
{
    $key = kv_license_normalize($rawKey);
    $activationId = kv_activation_id($activationId);
    if ($activationId === null || (string)kv_config()['license']['provider'] !== 'polar') {
        return;
    }
    $db->prepare('DELETE FROM kv_licenses WHERE key_hash = ?')->execute([kv_activation_hash($key, $activationId)]);
    try {
        kv_polar_deactivate($key, kv_config()['license']['polar'], $activationId);
    } catch (RuntimeException $e) {
        error_log('[kuvert] polar deactivate: ' . $e->getMessage());
    }
}

/** Gerätename für Polar: kurz und nur einfache Zeichen. */
function kv_device_label(string $label): string
{
    $label = trim((string)preg_replace('/[^A-Za-z0-9 ._,:()\/-]+/', '', $label));
    return $label !== '' ? substr($label, 0, 80) : 'Browser';
}

/** @param array<string,mixed> $polar */
function kv_polar_base(array $polar): string
{
    if (!empty($polar['api_base'])) {
        return rtrim((string)$polar['api_base'], '/');   // nur für Tests
    }
    return !empty($polar['sandbox']) ? 'https://sandbox-api.polar.sh' : 'https://api.polar.sh';
}

/** @param array<string,mixed> $polar */
function kv_polar_org(array $polar): string
{
    $org = (string)($polar['organization_id'] ?? '');
    if ($org === '') {
        throw new RuntimeException('polar.organization_id is not configured');
    }
    return $org;
}

/**
 * @param array<string,mixed> $polar
 * @return array{valid:bool, valid_until:?int, limit:?int}
 */
function kv_polar_validate(string $key, array $polar, ?string $activationId): array
{
    $payload = ['key' => $key, 'organization_id' => kv_polar_org($polar)];
    if ($activationId !== null) {
        $payload['activation_id'] = $activationId;
    }
    [$status, $json] = kv_http_post_json(kv_polar_base($polar) . '/v1/customer-portal/license-keys/validate', $payload);
    $no = ['valid' => false, 'valid_until' => null, 'limit' => null];
    if ($status === 404 || $status === 422) {
        return $no;
    }
    if ($status !== 200 || !is_array($json)) {
        throw new RuntimeException('unexpected status ' . $status);
    }
    if (($json['status'] ?? '') !== 'granted') {
        return $no;
    }
    $benefit = (string)($polar['benefit_id'] ?? '');
    if ($benefit !== '' && ($json['benefit_id'] ?? '') !== $benefit) {
        return $no;
    }
    $until = null;
    if (!empty($json['expires_at'])) {
        $ts = strtotime((string)$json['expires_at']);
        if ($ts !== false) {
            if ($ts < kv_now()) {
                return ['valid' => false, 'valid_until' => $ts, 'limit' => null];
            }
            $until = $ts;
        }
    }
    $limit = isset($json['limit_activations']) && $json['limit_activations'] !== null ? (int)$json['limit_activations'] : null;
    return ['valid' => true, 'valid_until' => $until, 'limit' => $limit];
}

/**
 * @param array<string,mixed> $polar
 * @return array{status:string, id:?string}
 */
function kv_polar_activate(string $key, array $polar, string $label): array
{
    [$status, $json] = kv_http_post_json(kv_polar_base($polar) . '/v1/customer-portal/license-keys/activate', [
        'key'             => $key,
        'organization_id' => kv_polar_org($polar),
        'label'           => kv_device_label($label),
    ]);
    if ($status === 200 && is_array($json) && !empty($json['id'])) {
        return ['status' => 'ok', 'id' => strtolower((string)$json['id'])];
    }
    if (in_array($status, [403, 404, 422], true)) {
        return ['status' => 'rejected', 'id' => null];
    }
    throw new RuntimeException('activate: unexpected status ' . $status);
}

/** @param array<string,mixed> $polar */
function kv_polar_deactivate(string $key, array $polar, string $activationId): void
{
    [$status] = kv_http_post_json(kv_polar_base($polar) . '/v1/customer-portal/license-keys/deactivate', [
        'key'             => $key,
        'organization_id' => kv_polar_org($polar),
        'activation_id'   => $activationId,
    ]);
    if (!in_array($status, [204, 200, 404], true)) {
        throw new RuntimeException('deactivate: unexpected status ' . $status);
    }
}

/**
 * @param array<string,mixed> $payload
 * @return array{0:int, 1:mixed}
 */
function kv_http_post_json(string $url, array $payload, int $timeout = 8): array
{
    $body = json_encode($payload);
    $headers = ['Content-Type: application/json', 'Accept: application/json', 'User-Agent: Kuvert-Pro/1'];
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        $resp = curl_exec($ch);
        if ($resp === false) {
            $err = curl_error($ch);
            curl_close($ch);
            throw new RuntimeException('http: ' . $err);
        }
        $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
    } else {
        $ctx = stream_context_create(['http' => [
            'method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $body,
            'timeout' => $timeout, 'ignore_errors' => true,
        ]]);
        $resp = @file_get_contents($url, false, $ctx);
        if ($resp === false) {
            throw new RuntimeException('http: request failed');
        }
        $status = 0;
        foreach ($http_response_header ?? [] as $h) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) {
                $status = (int)$m[1];
            }
        }
    }
    return [$status, json_decode((string)$resp, true)];
}

/** Erzeugt einen neuen lokalen Lizenzschlüssel und speichert ihn (gehasht). */
function kv_license_create_local(PDO $db, ?string $label, ?int $validUntil): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $groups = [];
    for ($g = 0; $g < 4; $g++) {
        $s = '';
        for ($i = 0; $i < 5; $i++) {
            $s .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        $groups[] = $s;
    }
    $key = 'KUVERT-' . implode('-', $groups);
    $st = $db->prepare('INSERT INTO kv_licenses (key_hash, provider, status, display, label, created_at, checked_at, valid_until)
                        VALUES (?, ?, ?, ?, ?, ?, NULL, ?)');
    $st->execute([kv_hmac('license', $key), 'local', 'active', kv_license_display($key), $label, kv_now(), $validUntil]);
    return $key;
}
