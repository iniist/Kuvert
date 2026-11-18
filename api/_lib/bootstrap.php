<?php
/*
 * Kuvert Pro – gemeinsame Grundlagen: Konfiguration, Fehler, JSON, Datenbank, Hilfsfunktionen.
 *
 * Sicherheitsmodell in einem Satz: Der Server sieht nur Chiffretext und Hashes.
 * Der Schlüssel steht im #-Fragment des Links und erreicht den Server nie.
 */
declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/license.php';
require_once __DIR__ . '/mail.php';
require_once __DIR__ . '/handlers.php';

final class KvError extends Exception
{
    public int $http;
    public string $kvCode;
    /** @var array<string,mixed> */
    public array $extra;

    /** @param array<string,mixed> $extra */
    public function __construct(int $http, string $code, string $message, array $extra = [])
    {
        parent::__construct($message);
        $this->http = $http;
        $this->kvCode = $code;
        $this->extra = $extra;
    }
}

/** @return array<string,mixed> */
function kv_defaults(): array
{
    return [
        'secret'   => '',
        'site_url' => 'https://kuvert.net',
        'timezone' => 'Europe/Berlin',
        'db' => [
            'dsn'  => 'sqlite:' . dirname(__DIR__) . '/_data/kuvert.sqlite',
            'user' => null,
            'pass' => null,
        ],
        'license' => [
            'provider'      => 'local',
            'cache_seconds' => 86400,      // so lange gilt eine erfolgreiche Online-Prüfung
            'grace_seconds' => 259200,     // so lange darf der Anbieter ausfallen (3 Tage)
            'polar' => [
                'organization_id' => '',
                'benefit_id'      => '',
                'sandbox'         => false,
            ],
        ],
        'buy_url'     => '',
        'manage_url'  => '',
        'pro_launched' => false,   // erst auf true, wenn Verkauf (Polar) bereit ist
        'price_label' => '',
        'mail' => [
            'enabled'   => false,
            'transport' => 'smtp',
            'from'      => '',
            'from_name' => 'Kuvert',
            'smtp' => ['host' => '', 'port' => 465, 'secure' => 'ssl', 'user' => '', 'pass' => ''],
        ],
        'limits' => [
            'max_message_chars'         => 20000,
            'ttl_options'               => [3600, 86400, 604800, 2592000],
            'default_ttl'               => 86400,
            'max_attempts'              => 5,
            'daily_creates_per_license' => 200,
            'status_retention'          => 604800,  // wie lange "gelesen am …" abrufbar bleibt
        ],
        'rate' => [   // Anfragen pro IP und 10 Minuten
            'license' => 20,
            'create'  => 60,
            'peek'    => 120,
            'read'    => 30,
            'status'  => 300,
        ],
        'trust_proxy_header' => '',  // z. B. 'HTTP_X_FORWARDED_FOR', nur wenn ein vertrauenswürdiger Proxy davor sitzt
    ];
}

/** @return array<string,mixed> */
function kv_config(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }
    $candidates = [];
    $env = getenv('KUVERT_CONFIG');
    if (is_string($env) && $env !== '') {
        $candidates[] = $env;
    }
    $candidates[] = dirname(__DIR__, 3) . '/kuvert-config.php';
    $candidates[] = dirname(__DIR__) . '/config.php';

    foreach ($candidates as $path) {
        if (is_file($path)) {
            $loaded = require $path;
            if (!is_array($loaded)) {
                break;
            }
            $merged = array_replace_recursive(kv_defaults(), $loaded);
            // Listen nicht mischen, sondern ersetzen.
            if (isset($loaded['limits']['ttl_options']) && is_array($loaded['limits']['ttl_options'])) {
                $merged['limits']['ttl_options'] = array_values(array_map('intval', $loaded['limits']['ttl_options']));
            }
            if (!is_string($merged['secret']) || strlen($merged['secret']) < 32 || str_starts_with($merged['secret'], 'HIER-')) {
                throw new KvError(500, 'not_configured', 'Server ist nicht fertig eingerichtet (secret fehlt).');
            }
            date_default_timezone_set((string)$merged['timezone']);
            $cfg = $merged;
            return $cfg;
        }
    }
    throw new KvError(500, 'not_configured', 'Server ist nicht eingerichtet (config.php fehlt).');
}

/* ---------------- encoding helpers ---------------- */

function kv_b64url(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function kv_b64url_decode(string $s): ?string
{
    if ($s === '' || !preg_match('/^[A-Za-z0-9_-]+$/', $s)) {
        return null;
    }
    $out = base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true);
    return $out === false ? null : $out;
}

function kv_now(): int
{
    return time();
}

/** Keyed hash, damit eine geleakte Datenbank keine Lizenzschlüssel oder IPs verrät. */
function kv_hmac(string $purpose, string $value): string
{
    return hash_hmac('sha256', $purpose . "\0" . $value, (string)kv_config()['secret']);
}

function kv_client_ip(): string
{
    $hdr = (string)(kv_config()['trust_proxy_header'] ?? '');
    if ($hdr !== '' && !empty($_SERVER[$hdr])) {
        $parts = explode(',', (string)$_SERVER[$hdr]);
        return trim($parts[0]);
    }
    return (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

/* ---------------- request / response ---------------- */

/** @param array<string,mixed> $data */
function kv_json(int $status, array $data): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/** @return array<string,mixed> */
function kv_body(int $maxBytes): array
{
    $len = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($len > $maxBytes) {
        throw new KvError(413, 'too_large', 'Die Nachricht ist zu groß.');
    }
    $raw = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
    if ($raw === false || $raw === '') {
        return [];
    }
    if (strlen($raw) > $maxBytes) {
        throw new KvError(413, 'too_large', 'Die Nachricht ist zu groß.');
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        throw new KvError(400, 'bad_request', 'Ungültige Anfrage.');
    }
    return $data;
}

/** @param array<string,mixed> $body */
function kv_str(array $body, string $key, int $maxLen = 4096): string
{
    $v = $body[$key] ?? '';
    if (!is_string($v) || strlen($v) > $maxLen) {
        throw new KvError(400, 'bad_request', 'Ungültige Anfrage.');
    }
    return $v;
}

function kv_message_id(string $id): string
{
    if (!preg_match('/^[A-Za-z0-9_-]{22}$/', $id)) {
        throw new KvError(400, 'bad_id', 'Ungültiger Link.');
    }
    return $id;
}

/** Erwartet ein 32-Byte-Token in base64url und gibt dessen SHA-256 (hex) zurück. */
function kv_token_hash(string $token): string
{
    $bin = kv_b64url_decode($token);
    if ($bin === null || strlen($bin) !== 32) {
        throw new KvError(400, 'bad_token', 'Ungültiger Link.');
    }
    return hash('sha256', $bin);
}

function kv_hex64(string $v): string
{
    if (!preg_match('/^[0-9a-f]{64}$/', $v)) {
        throw new KvError(400, 'bad_request', 'Ungültige Anfrage.');
    }
    return $v;
}

/** Größte zulässige Länge des base64url-Chiffretexts (IV + Text + GCM-Tag). */
function kv_max_ciphertext_len(): int
{
    $chars = (int)kv_config()['limits']['max_message_chars'];
    $bytes = $chars * 4 + 12 + 16;
    return (int)ceil($bytes / 3) * 4;
}

/** Sendet die Antwort an den Browser und arbeitet danach weiter (z. B. Mailversand). */
function kv_finish_request(): void
{
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
        return;
    }
    if (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
        return;
    }
    @ob_end_flush();
    @flush();
}

/* ---------------- entry point ---------------- */

function kv_run(): void
{
    $action = (string)($_GET['a'] ?? '');
    $method = (string)($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $deferred = [];
    try {
        $routes = kv_routes();
        if (!isset($routes[$action])) {
            throw new KvError(404, 'not_found', 'Unbekannte Aktion.');
        }
        [$allowed, $fn] = $routes[$action];
        if ($method !== $allowed) {
            header('Allow: ' . $allowed);
            throw new KvError(405, 'method_not_allowed', 'Methode nicht erlaubt.');
        }
        kv_config();
        $db = kv_db();
        kv_maybe_maintain($db);
        $result = $fn($db, $deferred);
        kv_json(200, $result);
    } catch (KvError $e) {
        if ($e->kvCode === 'not_configured' && $action === 'config') {
            // Noch nicht eingerichtet: Pro-Seite zeigt einfach „Bald verfügbar“.
            kv_json(200, ['version' => 1, 'launched' => false, 'configured' => false]);
            return;
        }
        kv_json($e->http, ['error' => array_merge(['code' => $e->kvCode, 'message' => $e->getMessage()], $e->extra)]);
    } catch (Throwable $e) {
        error_log('[kuvert] ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        kv_json(500, ['error' => ['code' => 'server_error', 'message' => 'Interner Fehler. Bitte später erneut versuchen.']]);
    }

    if ($deferred) {
        kv_finish_request();
        foreach ($deferred as $job) {
            try {
                $job();
            } catch (Throwable $e) {
                error_log('[kuvert] deferred: ' . $e->getMessage());
            }
        }
    }
}
