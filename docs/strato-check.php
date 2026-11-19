<?php
/*
 * Kuvert – Strato-Infrastruktur-Check
 *
 * 1. Diese Datei in den Ordner hochladen, in dem index.html liegt (Webspace-Explorer oder SFTP).
 * 2. Im Browser öffnen:  https://kuvert.net/strato-check.php
 * 3. Optional MySQL-Zugangsdaten eintragen und testen.
 * 4. Danach unten auf „Prüfskript löschen“ klicken (oder Datei per Hand löschen).
 *
 * Sicherheit: Das Skript funktioniert nur 2 Stunden nach dem Hochladen, speichert nichts
 * und zeigt keine Passwörter an.
 */
declare(strict_types=1);

const KV_CHECK_TTL = 7200;
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');

if (time() - (int)filemtime(__FILE__) > KV_CHECK_TTL) {
    http_response_code(410);
    exit('Abgelaufen. Bitte diese Datei löschen (oder neu hochladen, um erneut zu prüfen).');
}

if (($_POST['action'] ?? '') === 'delete') {
    kv_rrmdir(__DIR__ . '/_kvcheck');
    $ok = @unlink(__FILE__);
    exit($ok ? 'Prüfskript gelöscht. Du kannst diesen Tab schließen.' : 'Konnte die Datei nicht löschen – bitte per Hand entfernen.');
}

$results = [];
function add(string $group, string $name, string $status, string $detail, string $hint = ''): void
{
    global $results;
    $results[$group][] = compact('name', 'status', 'detail', 'hint');
}
function kv_rrmdir(string $dir): void
{
    if (!is_dir($dir)) return;
    foreach (array_diff(scandir($dir) ?: [], ['.', '..']) as $f) {
        $p = $dir . '/' . $f;
        is_dir($p) ? kv_rrmdir($p) : @unlink($p);
    }
    @rmdir($dir);
}
function kv_fetch(string $url, string $method = 'GET', ?string $body = null, array $headers = []): array
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 6,
            CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers, CURLOPT_FOLLOWLOCATION => false]);
        if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        $resp = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = $resp === false ? curl_error($ch) : '';
        curl_close($ch);
        return [$code, (string)$resp, $err];
    }
    $ctx = stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", $headers), 'content' => (string)$body, 'timeout' => 10, 'ignore_errors' => true]]);
    $resp = @file_get_contents($url, false, $ctx);
    $code = 0;
    foreach ($http_response_header ?? [] as $h) if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $code = (int)$m[1];
    return [$code, (string)$resp, $resp === false ? 'Anfrage fehlgeschlagen' : ''];
}
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');

/* ---------------- PHP ---------------- */
$v = PHP_VERSION;
add('PHP', 'PHP-Version', version_compare($v, '8.1.0', '>=') ? 'ok' : 'bad', $v,
    'Mindestens 8.1 nötig. Im Strato-Menü unter „Einstellungen“ → „PHP-Version“ umstellen.');
add('PHP', 'Server-Schnittstelle', 'info', PHP_SAPI . ' · ' . ($_SERVER['SERVER_SOFTWARE'] ?? '?'));
foreach ([
    ['pdo', true, 'Datenbank-Zugriff'], ['pdo_mysql', true, 'MySQL für Kuvert Pro'], ['openssl', true, 'Verschlüsselte Verbindungen (Polar, SMTP)'],
    ['json', true, 'API-Antworten'], ['hash', true, 'Prüfwerte'], ['curl', false, 'Lizenzprüfung bei Polar (Alternative: allow_url_fopen)'],
    ['pdo_sqlite', false, 'nur Alternative zu MySQL'],
] as [$ext, $required, $why]) {
    $has = extension_loaded($ext);
    add('PHP', "Erweiterung $ext", $has ? 'ok' : ($required ? 'bad' : 'warn'), $has ? 'vorhanden' : 'fehlt', $why);
}
if (!extension_loaded('curl')) {
    add('PHP', 'allow_url_fopen', ini_get('allow_url_fopen') ? 'ok' : 'bad', ini_get('allow_url_fopen') ? 'an' : 'aus', 'Ohne curl UND ohne allow_url_fopen kann der Server Polar nicht erreichen.');
}
try { random_bytes(16); add('PHP', 'Sichere Zufallszahlen', 'ok', 'random_bytes funktioniert'); }
catch (Throwable $e) { add('PHP', 'Sichere Zufallszahlen', 'bad', $e->getMessage()); }
add('PHP', 'Antwort vor Mailversand senden', function_exists('fastcgi_finish_request') || function_exists('litespeed_finish_request') ? 'ok' : 'warn',
    function_exists('fastcgi_finish_request') ? 'fastcgi_finish_request vorhanden' : 'nicht vorhanden',
    'Ohne das wartet der Empfänger beim Öffnen kurz, bis die Benachrichtigungs-Mail raus ist. Funktioniert trotzdem.');
$post = ini_get('post_max_size');
add('PHP', 'post_max_size', 'info', (string)$post, 'Kuvert braucht max. ~120 KB pro Nachricht.');
add('PHP', 'memory_limit / max_execution_time', 'info', ini_get('memory_limit') . ' / ' . ini_get('max_execution_time') . ' s');
$disabled = array_filter(array_map('trim', explode(',', (string)ini_get('disable_functions'))));
$need = array_intersect($disabled, ['stream_socket_client', 'mail', 'curl_exec', 'random_bytes', 'hash_hmac']);
add('PHP', 'Gesperrte Funktionen', $need ? 'warn' : 'ok', $need ? 'gesperrt: ' . implode(', ', $need) : 'keine der benötigten gesperrt');

/* ---------------- Dateien & Ordner ---------------- */
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') || (($_SERVER['SERVER_PORT'] ?? '') == '443');
add('Webspace', 'HTTPS', $https ? 'ok' : 'warn', $https ? 'aktiv' : 'Seite wurde nicht über https aufgerufen', 'Verschlüsselung im Browser geht nur über https.');
add('Webspace', 'Ordner der Seite', 'info', __DIR__);
$ob = (string)ini_get('open_basedir');
add('Webspace', 'open_basedir', 'info', $ob !== '' ? $ob : '(keine Einschränkung)');
$parent = dirname(__DIR__);
$parentOk = @is_dir($parent) && @is_readable($parent);
$parentWritable = $parentOk && @is_writable($parent);
add('Webspace', 'Ordner darüber (für kuvert-config.php)', $parentOk ? 'ok' : 'warn',
    $parentOk ? ($parent . ($parentWritable ? ' · lesbar & beschreibbar' : ' · lesbar')) : 'nicht erreichbar',
    $parentOk ? 'Die Konfiguration kann außerhalb des Web-Ordners liegen (am sichersten).'
              : 'Dann die Konfiguration als api/config.php ablegen – sie ist per .htaccess geschützt.');

$testDir = __DIR__ . '/_kvcheck';
kv_rrmdir($testDir);
$canWrite = @mkdir($testDir, 0755) && @file_put_contents($testDir . '/w.txt', 'x') === 1;
add('Webspace', 'PHP darf Dateien anlegen', $canWrite ? 'ok' : 'bad', $canWrite ? 'ja' : 'nein',
    'Nötig für api/_data (Hilfsdateien). Rechte des Ordners prüfen.');

/* ---------------- .htaccess (genau wie in api/) ---------------- */
if ($canWrite) {
    $base = ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/') . '/_kvcheck';
    // a) Ordner komplett gesperrt (wie api/_lib, api/_data)
    mkdir($testDir . '/locked');
    file_put_contents($testDir . '/locked/.htaccess', "Require all denied\n");
    file_put_contents($testDir . '/locked/geheim.txt', 'GEHEIM');
    // b) nur index.php erlaubt (wie api/)
    mkdir($testDir . '/api');
    file_put_contents($testDir . '/api/.htaccess', "<FilesMatch \"^(?!index\\.php$).+$\">\n  Require all denied\n</FilesMatch>\n");
    file_put_contents($testDir . '/api/index.php', "<?php echo 'KV-OK';");
    file_put_contents($testDir . '/api/config.php', "<?php echo 'LEAK';");
    file_put_contents($testDir . '/api/config.sample.php', "<?php echo 'LEAK';");

    [$c1, $b1, $e1] = kv_fetch($base . '/locked/geheim.txt');
    [$c2, $b2, $e2] = kv_fetch($base . '/api/index.php');
    [$c3, $b3, $e3] = kv_fetch($base . '/api/config.php');
    [$c4, $b4, $e4] = kv_fetch($base . '/api/.htaccess');

    if ($c1 === 0 && $c2 === 0) {
        add('.htaccess', 'Selbsttest', 'warn', 'Server konnte sich selbst nicht aufrufen (' . $h($e1 ?: $e2) . ')',
            'Dann bitte per Hand im Browser prüfen: ' . $base . '/locked/geheim.txt muss „Forbidden“ zeigen. (Ordner _kvcheck bleibt dafür bis zum Löschen liegen.)');
    } else {
        add('.htaccess', 'Gesperrter Ordner (wie api/_lib)', $c1 === 403 ? 'ok' : 'bad', "HTTP $c1" . (str_contains($b1, 'GEHEIM') ? ' – Inhalt sichtbar!' : ''), 'Erwartet: 403');
        add('.htaccess', 'Öffentlicher Einstieg (api/index.php)', ($c2 === 200 && trim($b2) === 'KV-OK') ? 'ok' : 'bad', "HTTP $c2", 'Erwartet: 200 und PHP wird ausgeführt');
        add('.htaccess', 'Geschützte Datei (api/config.php)', $c3 === 403 ? 'ok' : 'bad', "HTTP $c3" . (str_contains($b3, 'LEAK') ? ' – erreichbar!' : ''), 'Erwartet: 403');
        add('.htaccess', '.htaccess selbst', $c4 === 403 ? 'ok' : 'warn', "HTTP $c4", 'Erwartet: 403');
    }
}

/* ---------------- Netzwerk ---------------- */
[$pc, $pb, $pe] = kv_fetch('https://api.polar.sh/v1/customer-portal/license-keys/validate', 'POST',
    json_encode(['key' => 'KUVERT-CHECK', 'organization_id' => '00000000-0000-0000-0000-000000000000']),
    ['Content-Type: application/json', 'Accept: application/json']);
add('Netzwerk', 'Ausgehend zu Polar (Lizenzprüfung)', $pc > 0 ? 'ok' : 'bad', $pc > 0 ? "erreichbar (HTTP $pc – bei Testdaten erwartet)" : 'nicht erreichbar: ' . $h($pe),
    'Ohne ausgehende Verbindung funktionieren nur selbst erzeugte Lizenzschlüssel.');

$ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'peer_name' => 'smtp.strato.de']]);
$fp = @stream_socket_client('ssl://smtp.strato.de:465', $errno, $errstr, 8, STREAM_CLIENT_CONNECT, $ctx);
if ($fp) {
    stream_set_timeout($fp, 8);
    $banner = trim((string)fgets($fp, 512));
    fwrite($fp, "QUIT\r\n");
    fclose($fp);
    add('Netzwerk', 'SMTP smtp.strato.de:465 (Mail-Meldungen)', str_starts_with($banner, '220') ? 'ok' : 'warn', $h(substr($banner, 0, 80)));
} else {
    add('Netzwerk', 'SMTP smtp.strato.de:465 (Mail-Meldungen)', 'warn', 'keine Verbindung: ' . $h("$errstr ($errno)"),
        'Alternative: Transport „mail“ (PHP mail()) in der Konfiguration.');
}
add('Netzwerk', 'PHP mail()', function_exists('mail') && !in_array('mail', $disabled, true) ? 'ok' : 'warn', function_exists('mail') ? 'vorhanden (nicht getestet)' : 'nicht vorhanden');

/* ---------------- MySQL (optional) ---------------- */
$db = ['host' => trim($_POST['host'] ?? ''), 'name' => trim($_POST['name'] ?? ''), 'user' => trim($_POST['user'] ?? ''), 'pass' => (string)($_POST['pass'] ?? '')];
if (($_POST['action'] ?? '') === 'mysql' && $db['host'] !== '') {
    try {
        $pdo = new PDO("mysql:host={$db['host']};dbname={$db['name']};charset=utf8mb4", $db['user'], $db['pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 6]);
        add('MySQL', 'Verbindung', 'ok', 'Server ' . $h($pdo->getAttribute(PDO::ATTR_SERVER_VERSION)));
        $pdo->exec('CREATE TABLE IF NOT EXISTS kv_check_tmp (bucket CHAR(64) NOT NULL PRIMARY KEY, count INT NOT NULL, txt MEDIUMTEXT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin');
        add('MySQL', 'Tabelle anlegen (InnoDB, utf8mb4)', 'ok', 'ja');
        $st = $pdo->prepare('INSERT INTO kv_check_tmp (bucket, count, txt) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE count = count + 1');
        $st->execute(['a', str_repeat('x', 110000)]);
        $st->execute(['a', 'y']);
        $n = (int)$pdo->query("SELECT count FROM kv_check_tmp WHERE bucket = 'a'")->fetchColumn();
        add('MySQL', 'Schreiben / Upsert / 110 KB Text', $n === 2 ? 'ok' : 'bad', $n === 2 ? 'funktioniert' : "unerwartet: $n");
        $pdo->exec('DROP TABLE kv_check_tmp');
        add('MySQL', 'Aufräumen', 'ok', 'Testtabelle gelöscht');
    } catch (Throwable $e) {
        add('MySQL', 'Verbindung / Rechte', 'bad', $h($e->getMessage()), 'Host, Datenbankname, Benutzer und Passwort aus dem Strato-Menü prüfen.');
    }
}

/* ---------------- Ausgabe ---------------- */
$score = ['ok' => 0, 'warn' => 0, 'bad' => 0];
foreach ($results as $rows) foreach ($rows as $r) if (isset($score[$r['status']])) $score[$r['status']]++;
$icon = ['ok' => '✅', 'warn' => '⚠️', 'bad' => '❌', 'info' => 'ℹ️'];
$left = KV_CHECK_TTL - (time() - (int)filemtime(__FILE__));
?><!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Kuvert – Strato-Check</title>
<style>
  body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#0b0c0e;color:#e8e9eb;margin:0;padding:24px}
  main{max-width:900px;margin:0 auto}
  h1{font-size:26px;margin:0 0 4px} h2{font-size:17px;margin:28px 0 8px;color:#ff8a5c}
  .sum{display:flex;gap:14px;margin:14px 0 6px;font-weight:600}
  table{width:100%;border-collapse:collapse;background:#131418;border:1px solid #24262c;border-radius:10px;overflow:hidden}
  td{padding:9px 12px;border-top:1px solid #24262c;vertical-align:top} tr:first-child td{border-top:0}
  td:first-child{width:28px} td.n{width:38%;font-weight:550} small{display:block;color:#8b9098;margin-top:2px}
  form{background:#131418;border:1px solid #24262c;border-radius:10px;padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:10px}
  input{font:inherit;padding:9px 11px;border-radius:8px;border:1px solid #33363d;background:#0b0c0e;color:#e8e9eb}
  button{font:inherit;font-weight:600;padding:10px 16px;border-radius:8px;border:0;background:#ff7a4f;color:#1b0a04;cursor:pointer}
  .del{background:#2a2c31;color:#e8e9eb;margin-top:24px} .muted{color:#8b9098;font-size:13.5px}
  code{background:#1d1f24;padding:1px 6px;border-radius:5px}
</style></head><body><main>
<h1>Kuvert – Strato-Check</h1>
<div class="muted">Geprüft am <?= date('d.m.Y H:i') ?> · Skript läuft noch <?= (int)ceil($left / 60) ?> Minuten, danach ist es gesperrt.</div>
<div class="sum"><span>✅ <?= $score['ok'] ?> ok</span><span>⚠️ <?= $score['warn'] ?> Hinweise</span><span>❌ <?= $score['bad'] ?> Probleme</span></div>
<?php foreach ($results as $group => $rows): ?>
  <h2><?= $h($group) ?></h2>
  <table><?php foreach ($rows as $r): ?>
    <tr><td><?= $icon[$r['status']] ?></td><td class="n"><?= $h($r['name']) ?></td>
      <td><?= $r['detail'] ?><?php if ($r['hint'] !== '' && $r['status'] !== 'ok'): ?><small><?= $h($r['hint']) ?></small><?php endif; ?></td></tr>
  <?php endforeach; ?></table>
<?php endforeach; ?>

<h2>MySQL testen (optional)</h2>
<p class="muted">Daten aus dem Strato-Menü → „Datenbanken und Webspace“ → „Datenbanken verwalten“. Sie werden nur für diesen Test benutzt und nicht gespeichert.</p>
<form method="post">
  <input type="hidden" name="action" value="mysql">
  <input name="host" placeholder="Host, z. B. rdbms.strato.de" value="<?= $h($db['host']) ?>" required>
  <input name="name" placeholder="Datenbankname, z. B. DB1234567" value="<?= $h($db['name']) ?>" required>
  <input name="user" placeholder="Benutzer, z. B. U1234567" value="<?= $h($db['user']) ?>" required autocomplete="off">
  <input name="pass" type="password" placeholder="Passwort" required autocomplete="off">
  <button type="submit">MySQL prüfen</button>
</form>

<form method="post" onsubmit="return confirm('Prüfskript jetzt löschen?')" style="display:block;background:none;border:0;padding:0">
  <input type="hidden" name="action" value="delete">
  <button class="del" type="submit">Prüfskript löschen</button>
</form>
<p class="muted">Bitte nach dem Prüfen löschen. Kopier mir einfach die Seite (oder einen Screenshot) in den Chat.</p>
</main></body></html>
<?php
// Selbsttest-Dateien wieder entfernen (außer der Selbsttest war nicht möglich).
if (!isset($results['.htaccess']) || ($results['.htaccess'][0]['name'] ?? '') !== 'Selbsttest') {
    kv_rrmdir($testDir);
}
