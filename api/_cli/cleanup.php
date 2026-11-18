<?php
/*
 * Aufräumen (optional als Cronjob, z. B. stündlich):  php api/_cli/cleanup.php
 * Nicht zwingend nötig – die API räumt auch nebenbei bei Aufrufen auf.
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require dirname(__DIR__) . '/_lib/bootstrap.php';
kv_maintain(kv_db());
echo "OK\n";
