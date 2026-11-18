<?php
/*
 * Lokale Lizenzschlüssel verwalten (nur über die Kommandozeile / SSH).
 *
 *   php api/_cli/license.php create [--label="Name"] [--days=365]
 *   php api/_cli/license.php list
 *   php api/_cli/license.php revoke <SCHLÜSSEL>
 *   php api/_cli/license.php activate <SCHLÜSSEL>
 *
 * Ohne SSH-Zugang (Strato-Basispakete): den Schlüssel lokal erzeugen geht nicht,
 * weil er in der Server-Datenbank liegen muss. Dann Polar als Anbieter nutzen
 * oder diese Datei kurzzeitig über einen Strato-Cronjob ausführen lassen.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require dirname(__DIR__) . '/_lib/bootstrap.php';

$args = array_slice($argv, 1);
$cmd = array_shift($args) ?? 'help';
$opts = [];
$pos = [];
foreach ($args as $a) {
    if (preg_match('/^--([a-z]+)=(.*)$/', $a, $m)) {
        $opts[$m[1]] = $m[2];
    } else {
        $pos[] = $a;
    }
}

try {
    $db = kv_db();
    switch ($cmd) {
        case 'create':
            $until = isset($opts['days']) ? kv_now() + 86400 * max(1, (int)$opts['days']) : null;
            $key = kv_license_create_local($db, $opts['label'] ?? null, $until);
            echo $key, "\n";
            fwrite(STDERR, $until ? 'gültig bis ' . date('d.m.Y', $until) . "\n" : "unbegrenzt gültig\n");
            break;
        case 'list':
            $rows = $db->query('SELECT provider, status, display, label, created_at, valid_until FROM kv_licenses ORDER BY created_at')->fetchAll();
            foreach ($rows as $r) {
                printf("%-6s %-8s %-10s %-20s erstellt %s%s\n", $r['provider'], $r['status'], $r['display'], (string)$r['label'],
                    date('d.m.Y', (int)$r['created_at']), $r['valid_until'] ? ' · bis ' . date('d.m.Y', (int)$r['valid_until']) : '');
            }
            echo count($rows), " Lizenz(en)\n";
            break;
        case 'revoke':
        case 'activate':
            if (!isset($pos[0])) {
                throw new RuntimeException('Schlüssel fehlt.');
            }
            $st = $db->prepare('UPDATE kv_licenses SET status = ? WHERE key_hash = ?');
            $st->execute([$cmd === 'revoke' ? 'revoked' : 'active', kv_hmac('license', trim($pos[0]))]);
            echo $st->rowCount() ? "OK\n" : "Nicht gefunden.\n";
            break;
        default:
            echo "Befehle: create [--label=…] [--days=…] | list | revoke <KEY> | activate <KEY>\n";
    }
} catch (Throwable $e) {
    fwrite(STDERR, 'Fehler: ' . $e->getMessage() . "\n");
    exit(1);
}
