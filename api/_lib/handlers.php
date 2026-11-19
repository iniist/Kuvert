<?php
/*
 * API-Aktionen. Aufruf: api/index.php?a=<aktion>
 *
 *   GET  config   öffentliche Einstellungen für die Pro-Seite
 *   POST license  {key}                                        Lizenz prüfen
 *   POST create   {ciphertext, authHash, statusHash, hasPassword, ttl, notifyEmail?}  + Header X-Kuvert-License
 *   POST peek     {id}                                         Zustand für Empfänger (ohne zu öffnen)
 *   POST read     {id, token}                                  einmal abholen → danach gelöscht
 *   POST status   {id, statusToken}                            Zustand für Absender
 *   POST revoke   {id, statusToken}                            Absender zieht ungelesene Nachricht zurück
 *
 * Zustände einer Nachricht: waiting → read | expired | revoked | destroyed
 */
declare(strict_types=1);

/** @return array<string, array{0:string, 1:callable}> */
function kv_routes(): array
{
    return [
        'config'  => ['GET',  'kv_action_config'],
        'license' => ['POST', 'kv_action_license'],
        'create'  => ['POST', 'kv_action_create'],
        'peek'    => ['POST', 'kv_action_peek'],
        'read'    => ['POST', 'kv_action_read'],
        'status'  => ['POST', 'kv_action_status'],
        'revoke'  => ['POST', 'kv_action_revoke'],
    ];
}

/** @return array<string,mixed> */
function kv_action_config(PDO $db, array &$deferred): array
{
    $c = kv_config();
    return [
        'version'         => 1,
        'launched'        => (bool)$c['pro_launched'],
        'buyUrl'          => (string)$c['buy_url'],
        'manageUrl'       => (string)$c['manage_url'],
        'priceLabel'      => (string)$c['price_label'],
        'mail'            => kv_mail_enabled(),
        'maxMessageChars' => (int)$c['limits']['max_message_chars'],
        'ttlOptions'      => array_values(array_map('intval', $c['limits']['ttl_options'])),
        'defaultTtl'      => (int)$c['limits']['default_ttl'],
        'maxAttempts'     => (int)$c['limits']['max_attempts'],
    ];
}

/** @return array<string,mixed> */
function kv_action_license(PDO $db, array &$deferred): array
{
    kv_rate_limit($db, 'license');
    $body = kv_body(2048);
    $lic = kv_license_check($db, kv_str($body, 'key', 256));
    return ['valid' => true, 'display' => $lic['display'], 'validUntil' => $lic['valid_until']];
}

/** @return array<string,mixed> */
function kv_action_create(PDO $db, array &$deferred): array
{
    kv_rate_limit($db, 'create');
    $c = kv_config();
    $maxCt = kv_max_ciphertext_len();
    $body = kv_body($maxCt + 4096);

    $licKey = (string)($_SERVER['HTTP_X_KUVERT_LICENSE'] ?? '');
    if ($licKey === '') {
        throw new KvError(402, 'license_required', 'Für Kuvert Pro wird ein Lizenzschlüssel benötigt.');
    }
    $lic = kv_license_check($db, $licKey);

    $ct = kv_str($body, 'ciphertext', $maxCt);
    $bin = kv_b64url_decode($ct);
    if ($bin === null || strlen($bin) < 12 + 16 + 1) {
        throw new KvError(400, 'bad_ciphertext', 'Ungültige Nachricht.');
    }
    $authHash = kv_hex64(kv_str($body, 'authHash', 64));
    $statusHash = kv_hex64(kv_str($body, 'statusHash', 64));
    $hasPassword = !empty($body['hasPassword']) ? 1 : 0;

    $ttl = (int)($body['ttl'] ?? $c['limits']['default_ttl']);
    if (!in_array($ttl, array_map('intval', $c['limits']['ttl_options']), true)) {
        throw new KvError(400, 'bad_ttl', 'Ungültige Gültigkeitsdauer.');
    }

    $email = trim(kv_str($body, 'notifyEmail', 254));
    if ($email !== '') {
        if (!kv_mail_enabled()) {
            throw new KvError(400, 'mail_disabled', 'E-Mail-Benachrichtigungen sind auf diesem Server nicht eingerichtet.');
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new KvError(400, 'bad_email', 'Diese E-Mail-Adresse sieht nicht gültig aus.');
        }
    }

    $quota = (int)$c['limits']['daily_creates_per_license'];
    if ($quota > 0) {
        $used = kv_bump($db, kv_hmac('quota', $lic['hash'] . '|' . date('Y-m-d')), 86400 + 3600);
        if ($used > $quota) {
            throw new KvError(429, 'quota_exceeded', "Tageslimit erreicht ({$quota} Kuverts pro Tag).");
        }
    }

    $now = kv_now();
    $id = kv_b64url(random_bytes(16));
    $expires = $now + $ttl;
    $st = $db->prepare('INSERT INTO kv_messages
        (id, ciphertext, auth_hash, status_hash, has_password, state, failed_attempts, notify_email, license_hash, created_at, expires_at, read_at, purge_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, ?)');
    $st->execute([
        $id, $ct, $authHash, $statusHash, $hasPassword, 'waiting',
        $email !== '' ? $email : null, $lic['hash'], $now, $expires,
        $expires + (int)$c['limits']['status_retention'],
    ]);

    return ['id' => $id, 'createdAt' => $now, 'expiresAt' => $expires, 'notify' => $email !== ''];
}

/** @return array<string,mixed>|null */
function kv_load(PDO $db, string $id): ?array
{
    $st = $db->prepare('SELECT * FROM kv_messages WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        return null;
    }
    if ($row['state'] === 'waiting' && (int)$row['expires_at'] < kv_now()) {
        $db->prepare("UPDATE kv_messages SET state = 'expired', ciphertext = NULL, notify_email = NULL WHERE id = ? AND state = 'waiting'")
           ->execute([$id]);
        $row['state'] = 'expired';
        $row['ciphertext'] = null;
        $row['notify_email'] = null;
    }
    return $row;
}

/** @param array<string,mixed>|null $row @return array<string,mixed> */
function kv_public_state(?array $row): array
{
    if (!$row) {
        return ['state' => 'unknown'];
    }
    $out = [
        'state'       => (string)$row['state'],
        'hasPassword' => (bool)(int)$row['has_password'],
        'expiresAt'   => (int)$row['expires_at'],
    ];
    if ($row['read_at'] !== null) {
        $out['readAt'] = (int)$row['read_at'];
    }
    return $out;
}

/** @return array<string,mixed> */
function kv_action_peek(PDO $db, array &$deferred): array
{
    kv_rate_limit($db, 'peek');
    $body = kv_body(1024);
    $id = kv_message_id(kv_str($body, 'id', 64));
    return kv_public_state(kv_load($db, $id));
}

/** @return array<string,mixed> */
function kv_action_read(PDO $db, array &$deferred): array
{
    kv_rate_limit($db, 'read');
    $body = kv_body(1024);
    $id = kv_message_id(kv_str($body, 'id', 64));
    $tokenHash = kv_token_hash(kv_str($body, 'token', 64));

    $row = kv_load($db, $id);
    if (!$row || $row['state'] !== 'waiting' || $row['ciphertext'] === null) {
        throw new KvError(410, 'gone', 'Diese Nachricht ist nicht mehr verfügbar.', ['status' => kv_public_state($row)]);
    }

    $now = kv_now();
    $email = (string)($row['notify_email'] ?? '');

    if (!hash_equals((string)$row['auth_hash'], $tokenHash)) {
        $max = (int)kv_config()['limits']['max_attempts'];
        $db->prepare("UPDATE kv_messages SET failed_attempts = failed_attempts + 1 WHERE id = ? AND state = 'waiting'")->execute([$id]);
        $st = $db->prepare('SELECT failed_attempts FROM kv_messages WHERE id = ?');
        $st->execute([$id]);
        $failed = (int)$st->fetchColumn();
        $left = max(0, $max - $failed);
        if ($left === 0) {
            $upd = $db->prepare("UPDATE kv_messages SET state = 'destroyed', ciphertext = NULL, notify_email = NULL, read_at = ?, purge_at = ?
                                 WHERE id = ? AND state = 'waiting'");
            $upd->execute([$now, $now + (int)kv_config()['limits']['status_retention'], $id]);
            if ($upd->rowCount() === 1 && $email !== '') {
                $deferred[] = static fn () => kv_notify_event($email, 'destroyed', $id, $now);
            }
            throw new KvError(410, 'destroyed', 'Zu viele falsche Passwörter – die Nachricht wurde zur Sicherheit vernichtet.', ['status' => ['state' => 'destroyed']]);
        }
        $msg = (int)$row['has_password'] === 1
            ? "Falsches Passwort. Noch {$left} " . ($left === 1 ? 'Versuch' : 'Versuche') . ', dann wird die Nachricht vernichtet.'
            : 'Dieser Link ist beschädigt.';
        throw new KvError(403, 'wrong_password', $msg, ['attemptsLeft' => $left]);
    }

    // Genau ein Leser gewinnt: nur wer die Zeile von "waiting" auf "read" umstellt, bekommt den Inhalt.
    $ciphertext = (string)$row['ciphertext'];
    $upd = $db->prepare("UPDATE kv_messages SET state = 'read', ciphertext = NULL, notify_email = NULL, read_at = ?, purge_at = ?
                         WHERE id = ? AND state = 'waiting' AND ciphertext IS NOT NULL");
    $upd->execute([$now, $now + (int)kv_config()['limits']['status_retention'], $id]);
    if ($upd->rowCount() !== 1) {
        throw new KvError(410, 'gone', 'Diese Nachricht ist nicht mehr verfügbar.', ['status' => kv_public_state(kv_load($db, $id))]);
    }
    if ($email !== '') {
        $deferred[] = static fn () => kv_notify_event($email, 'read', $id, $now);
    }
    return ['ciphertext' => $ciphertext, 'readAt' => $now];
}

/** @return array<string,mixed> */
function kv_sender_row(PDO $db): array
{
    $body = kv_body(1024);
    $id = kv_message_id(kv_str($body, 'id', 64));
    $hash = kv_token_hash(kv_str($body, 'statusToken', 64));
    $row = kv_load($db, $id);
    if (!$row) {
        return ['id' => $id, 'row' => null];
    }
    if (!hash_equals((string)$row['status_hash'], $hash)) {
        throw new KvError(403, 'forbidden', 'Dieser Status-Link ist ungültig.');
    }
    return ['id' => $id, 'row' => $row];
}

/** @param array<string,mixed> $row @return array<string,mixed> */
function kv_sender_state(array $row): array
{
    return array_merge(kv_public_state($row), [
        'createdAt'      => (int)$row['created_at'],
        'failedAttempts' => (int)$row['failed_attempts'],
        'notify'         => $row['notify_email'] !== null,
    ]);
}

/** @return array<string,mixed> */
function kv_action_status(PDO $db, array &$deferred): array
{
    kv_rate_limit($db, 'status');
    $r = kv_sender_row($db);
    return $r['row'] ? kv_sender_state($r['row']) : ['state' => 'unknown'];
}

/** @return array<string,mixed> */
function kv_action_revoke(PDO $db, array &$deferred): array
{
    kv_rate_limit($db, 'status');
    $r = kv_sender_row($db);
    if (!$r['row']) {
        return ['state' => 'unknown'];
    }
    $db->prepare("UPDATE kv_messages SET state = 'revoked', ciphertext = NULL, notify_email = NULL WHERE id = ? AND state = 'waiting'")
       ->execute([$r['id']]);
    return kv_sender_state(kv_load($db, $r['id']) ?? $r['row']);
}
