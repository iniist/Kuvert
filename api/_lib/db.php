<?php
/*
 * Datenbank: SQLite (lokal) oder MySQL/MariaDB (Strato). Tabellen werden automatisch angelegt.
 */
declare(strict_types=1);

const KV_SCHEMA_VERSION = 1;

function kv_db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $c = kv_config()['db'];
    $dsn = (string)$c['dsn'];
    if (str_starts_with($dsn, 'sqlite:')) {
        $file = substr($dsn, 7);
        $dir = dirname($file);
        if (!is_dir($dir)) {
            @mkdir($dir, 0700, true);
        }
    }
    $pdo = new PDO($dsn, $c['user'] ?? null, $c['pass'] ?? null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    if (kv_is_sqlite($pdo)) {
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA busy_timeout = 5000');
        $pdo->exec('PRAGMA foreign_keys = ON');
    } else {
        $pdo->exec("SET NAMES utf8mb4");
    }
    kv_ensure_schema($pdo);
    return $pdo;
}

function kv_is_sqlite(PDO $db): bool
{
    return $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
}

function kv_ensure_schema(PDO $db): void
{
    // Kleine Markierungsdatei spart die CREATE-Statements bei jedem Aufruf.
    $marker = dirname(__DIR__) . '/_data/.schema-v' . KV_SCHEMA_VERSION . '-' . substr(md5((string)kv_config()['db']['dsn']), 0, 8);
    if (!kv_is_sqlite($db) && is_file($marker)) {
        return;
    }
    if (kv_is_sqlite($db)) {
        $stmts = [
            'CREATE TABLE IF NOT EXISTS kv_messages (
                id TEXT PRIMARY KEY,
                ciphertext TEXT NULL,
                auth_hash TEXT NOT NULL,
                status_hash TEXT NOT NULL,
                has_password INTEGER NOT NULL DEFAULT 0,
                state TEXT NOT NULL,
                failed_attempts INTEGER NOT NULL DEFAULT 0,
                notify_email TEXT NULL,
                license_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                read_at INTEGER NULL,
                purge_at INTEGER NOT NULL
            )',
            'CREATE INDEX IF NOT EXISTS kv_messages_purge ON kv_messages (purge_at)',
            'CREATE INDEX IF NOT EXISTS kv_messages_expiry ON kv_messages (state, expires_at)',
            'CREATE TABLE IF NOT EXISTS kv_licenses (
                key_hash TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                status TEXT NOT NULL,
                display TEXT NOT NULL,
                label TEXT NULL,
                created_at INTEGER NOT NULL,
                checked_at INTEGER NULL,
                valid_until INTEGER NULL
            )',
            'CREATE TABLE IF NOT EXISTS kv_usage (
                license_hash TEXT NOT NULL,
                day TEXT NOT NULL,
                count INTEGER NOT NULL,
                PRIMARY KEY (license_hash, day)
            )',
            'CREATE TABLE IF NOT EXISTS kv_rate (
                bucket TEXT PRIMARY KEY,
                count INTEGER NOT NULL,
                reset_at INTEGER NOT NULL
            )',
        ];
    } else {
        $opts = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';
        $stmts = [
            "CREATE TABLE IF NOT EXISTS kv_messages (
                id VARCHAR(32) NOT NULL PRIMARY KEY,
                ciphertext MEDIUMTEXT NULL,
                auth_hash CHAR(64) NOT NULL,
                status_hash CHAR(64) NOT NULL,
                has_password TINYINT NOT NULL DEFAULT 0,
                state VARCHAR(12) NOT NULL,
                failed_attempts INT NOT NULL DEFAULT 0,
                notify_email VARCHAR(254) NULL,
                license_hash CHAR(64) NOT NULL,
                created_at INT UNSIGNED NOT NULL,
                expires_at INT UNSIGNED NOT NULL,
                read_at INT UNSIGNED NULL,
                purge_at INT UNSIGNED NOT NULL,
                KEY kv_messages_purge (purge_at),
                KEY kv_messages_expiry (state, expires_at)
            ) $opts",
            "CREATE TABLE IF NOT EXISTS kv_licenses (
                key_hash CHAR(64) NOT NULL PRIMARY KEY,
                provider VARCHAR(16) NOT NULL,
                status VARCHAR(16) NOT NULL,
                display VARCHAR(32) NOT NULL,
                label VARCHAR(120) NULL,
                created_at INT UNSIGNED NOT NULL,
                checked_at INT UNSIGNED NULL,
                valid_until INT UNSIGNED NULL
            ) $opts",
            "CREATE TABLE IF NOT EXISTS kv_usage (
                license_hash CHAR(64) NOT NULL,
                day CHAR(10) NOT NULL,
                count INT NOT NULL,
                PRIMARY KEY (license_hash, day)
            ) $opts",
            "CREATE TABLE IF NOT EXISTS kv_rate (
                bucket CHAR(64) NOT NULL PRIMARY KEY,
                count INT NOT NULL,
                reset_at INT UNSIGNED NOT NULL
            ) $opts",
        ];
    }
    foreach ($stmts as $sql) {
        $db->exec($sql);
    }
    if (!kv_is_sqlite($db)) {
        @file_put_contents($marker, (string)time());
    }
}

/**
 * Zählt einen Zähler hoch, der nach $window Sekunden zurückgesetzt wird. Gibt den neuen Stand zurück.
 */
function kv_bump(PDO $db, string $bucket, int $window): int
{
    $now = kv_now();
    $reset = $now + $window;
    if (kv_is_sqlite($db)) {
        $sql = 'INSERT INTO kv_rate (bucket, count, reset_at) VALUES (:b, 1, :r)
                ON CONFLICT(bucket) DO UPDATE SET
                  count = CASE WHEN kv_rate.reset_at < :n THEN 1 ELSE kv_rate.count + 1 END,
                  reset_at = CASE WHEN kv_rate.reset_at < :n2 THEN :r2 ELSE kv_rate.reset_at END';
    } else {
        // MySQL wertet die Zuweisungen von links nach rechts aus: count zuerst (liest altes reset_at).
        $sql = 'INSERT INTO kv_rate (bucket, count, reset_at) VALUES (:b, 1, :r)
                ON DUPLICATE KEY UPDATE
                  count = IF(reset_at < :n, 1, count + 1),
                  reset_at = IF(reset_at < :n2, :r2, reset_at)';
    }
    $st = $db->prepare($sql);
    $st->execute([':b' => $bucket, ':r' => $reset, ':n' => $now, ':n2' => $now, ':r2' => $reset]);
    $st = $db->prepare('SELECT count FROM kv_rate WHERE bucket = ?');
    $st->execute([$bucket]);
    return (int)$st->fetchColumn();
}

/** Begrenzung pro IP-Adresse (gehasht) und Aktion, Fenster 10 Minuten. */
function kv_rate_limit(PDO $db, string $action): void
{
    $limit = (int)(kv_config()['rate'][$action] ?? 0);
    if ($limit <= 0) {
        return;
    }
    $bucket = kv_hmac('rate', $action . '|' . kv_client_ip());
    $count = kv_bump($db, $bucket, 600);
    if ($count > $limit) {
        header('Retry-After: 600');
        throw new KvError(429, 'rate_limited', 'Zu viele Anfragen. Bitte in ein paar Minuten erneut versuchen.');
    }
}

/** Aufräumen: abgelaufene Inhalte löschen, alte Datensätze entfernen. Läuft bei ~jedem 10. Aufruf. */
function kv_maybe_maintain(PDO $db, bool $force = false): void
{
    if (!$force && random_int(1, 10) !== 1) {
        return;
    }
    kv_maintain($db);
}

function kv_maintain(PDO $db): void
{
    $now = kv_now();
    $st = $db->prepare("UPDATE kv_messages SET state = 'expired', ciphertext = NULL, notify_email = NULL
                        WHERE state = 'waiting' AND expires_at < ?");
    $st->execute([$now]);
    $db->prepare('DELETE FROM kv_messages WHERE purge_at < ?')->execute([$now]);
    $db->prepare('DELETE FROM kv_rate WHERE reset_at < ?')->execute([$now]);
    $db->prepare('DELETE FROM kv_usage WHERE day < ?')->execute([date('Y-m-d', $now - 3 * 86400)]);
}
