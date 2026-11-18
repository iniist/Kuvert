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

/**
 * Prüft einen Lizenzschlüssel. Wirft KvError, wenn er nicht gilt.
 * @return array{hash:string, display:string, provider:string, valid_until:?int}
 */
function kv_license_check(PDO $db, string $rawKey): array
{
    $key = kv_license_normalize($rawKey);
    $hash = kv_hmac('license', $key);
    $now = kv_now();
    $cfg = kv_config()['license'];

    $st = $db->prepare('SELECT * FROM kv_licenses WHERE key_hash = ?');
    $st->execute([$hash]);
    $row = $st->fetch() ?: null;

    $result = static function (array $r) use ($hash): array {
        return [
            'hash'        => $hash,
            'display'     => (string)$r['display'],
            'provider'    => (string)$r['provider'],
            'valid_until' => $r['valid_until'] !== null ? (int)$r['valid_until'] : null,
        ];
    };

    if ($row && $row['provider'] === 'local') {
        if ($row['status'] !== 'active') {
            throw new KvError(403, 'license_revoked', 'Dieser Lizenzschlüssel wurde deaktiviert.');
        }
        if ($row['valid_until'] !== null && (int)$row['valid_until'] < $now) {
            throw new KvError(403, 'license_expired', 'Dieser Lizenzschlüssel ist abgelaufen.');
        }
        return $result($row);
    }

    $provider = (string)$cfg['provider'];
    if ($provider !== 'polar') {
        throw new KvError(403, 'license_invalid', 'Dieser Lizenzschlüssel ist ungültig.');
    }

    // Frisch geprüfter Polar-Schlüssel aus dem Zwischenspeicher?
    $fresh = $row && $row['checked_at'] !== null && (int)$row['checked_at'] > $now - (int)$cfg['cache_seconds'];
    if ($row && $fresh) {
        if ($row['status'] !== 'active') {
            throw new KvError(403, 'license_invalid', 'Dieser Lizenzschlüssel ist ungültig.');
        }
        if ($row['valid_until'] !== null && (int)$row['valid_until'] < $now) {
            throw new KvError(403, 'license_expired', 'Dieser Lizenzschlüssel ist abgelaufen.');
        }
        return $result($row);
    }

    try {
        $verdict = kv_polar_validate($key, $cfg['polar']);
    } catch (RuntimeException $e) {
        error_log('[kuvert] polar: ' . $e->getMessage());
        // Anbieter nicht erreichbar: zuletzt gültige Schlüssel eine Weile weiter akzeptieren.
        if ($row && $row['status'] === 'active' && $row['checked_at'] !== null
            && (int)$row['checked_at'] > $now - (int)$cfg['grace_seconds']) {
            return $result($row);
        }
        throw new KvError(503, 'license_unavailable', 'Die Lizenz kann gerade nicht geprüft werden. Bitte später erneut versuchen.');
    }

    $status = $verdict['valid'] ? 'active' : 'invalid';
    if ($row) {
        $st = $db->prepare('UPDATE kv_licenses SET status = ?, checked_at = ?, valid_until = ? WHERE key_hash = ?');
        $st->execute([$status, $now, $verdict['valid_until'], $hash]);
    } else {
        $st = $db->prepare('INSERT INTO kv_licenses (key_hash, provider, status, display, created_at, checked_at, valid_until) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $st->execute([$hash, 'polar', $status, kv_license_display($key), $now, $now, $verdict['valid_until']]);
    }

    if (!$verdict['valid']) {
        throw new KvError(403, 'license_invalid', 'Dieser Lizenzschlüssel ist ungültig.');
    }
    return ['hash' => $hash, 'display' => kv_license_display($key), 'provider' => 'polar', 'valid_until' => $verdict['valid_until']];
}

/**
 * @param array<string,mixed> $polar
 * @return array{valid:bool, valid_until:?int}
 */
function kv_polar_validate(string $key, array $polar): array
{
    $org = (string)($polar['organization_id'] ?? '');
    if ($org === '') {
        throw new RuntimeException('polar.organization_id is not configured');
    }
    $base = !empty($polar['sandbox']) ? 'https://sandbox-api.polar.sh' : 'https://api.polar.sh';
    [$status, $json] = kv_http_post_json($base . '/v1/customer-portal/license-keys/validate', [
        'key'             => $key,
        'organization_id' => $org,
    ]);
    if ($status === 404 || $status === 422) {
        return ['valid' => false, 'valid_until' => null];
    }
    if ($status !== 200 || !is_array($json)) {
        throw new RuntimeException('unexpected status ' . $status);
    }
    if (($json['status'] ?? '') !== 'granted') {
        return ['valid' => false, 'valid_until' => null];
    }
    $benefit = (string)($polar['benefit_id'] ?? '');
    if ($benefit !== '' && ($json['benefit_id'] ?? '') !== $benefit) {
        return ['valid' => false, 'valid_until' => null];
    }
    $until = null;
    if (!empty($json['expires_at'])) {
        $ts = strtotime((string)$json['expires_at']);
        if ($ts !== false) {
            if ($ts < kv_now()) {
                return ['valid' => false, 'valid_until' => $ts];
            }
            $until = $ts;
        }
    }
    return ['valid' => true, 'valid_until' => $until];
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
