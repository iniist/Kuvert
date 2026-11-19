<?php
/*
 * Nachbau der Polar-Endpunkte für Lizenzschlüssel (nur für Tests).
 *   POST /v1/customer-portal/license-keys/{validate|activate|deactivate}
 * Zustand liegt in tests/.tmp/polar-state.json.
 */
declare(strict_types=1);
const ORG = '11111111-1111-4111-8111-111111111111';
const BENEFIT = '22222222-2222-4222-8222-222222222222';
$keys = [
    'KUVERT-LIMIT-0003' => ['limit' => 3, 'benefit' => BENEFIT],
    'KUVERT-LIMIT-0001' => ['limit' => 1, 'benefit' => BENEFIT],
    'KUVERT-NOLIM-0000' => ['limit' => null, 'benefit' => BENEFIT],
    'KUVERT-OTHER-BENE' => ['limit' => 3, 'benefit' => '33333333-3333-4333-8333-333333333333'],
];
$file = __DIR__ . '/.tmp/polar-state.json';
$state = is_file($file) ? json_decode((string)file_get_contents($file), true) : [];
$state = is_array($state) ? $state : [];
$out = function (int $code, $body = null) {
    http_response_code($code);
    header('Content-Type: application/json');
    if ($body !== null) echo json_encode($body);
    exit;
};
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$in = json_decode((string)file_get_contents('php://input'), true) ?: [];
$key = (string)($in['key'] ?? '');
if (($in['organization_id'] ?? '') !== ORG || !isset($keys[$key])) {
    $out(404, ['error' => 'ResourceNotFound', 'detail' => 'License key not found']);
}
$k = $keys[$key];
$acts = $state[$key] ?? [];
$lk = ['id' => 'lk-' . md5($key), 'key' => $key, 'status' => 'granted', 'benefit_id' => $k['benefit'],
       'limit_activations' => $k['limit'], 'expires_at' => null];

switch (basename($path)) {
    case 'validate':
        if (!empty($in['activation_id']) && !isset($acts[$in['activation_id']])) {
            $out(404, ['error' => 'ResourceNotFound', 'detail' => 'Activation not found']);
        }
        $out(200, $lk + ['activation' => !empty($in['activation_id']) ? ['id' => $in['activation_id']] : null]);
    case 'activate':
        if ($k['limit'] === null) $out(403, ['error' => 'NotPermitted', 'detail' => 'License key does not support activations']);
        if (count($acts) >= $k['limit']) $out(403, ['error' => 'NotPermitted', 'detail' => "License key only allows {$k['limit']} activations."]);
        $id = sprintf('%08x-%04x-4%03x-8%03x-%012x', random_int(0, 0xffffffff), random_int(0, 0xffff), random_int(0, 0xfff), random_int(0, 0xfff), random_int(0, 0xffffffffffff));
        $acts[$id] = (string)($in['label'] ?? '');
        $state[$key] = $acts;
        file_put_contents($file, json_encode($state));
        $out(200, ['id' => $id, 'license_key_id' => $lk['id'], 'label' => $acts[$id], 'meta' => [], 'license_key' => $lk]);
    case 'deactivate':
        if (!isset($acts[$in['activation_id'] ?? ''])) $out(404, ['error' => 'ResourceNotFound']);
        unset($acts[$in['activation_id']]);
        $state[$key] = $acts;
        file_put_contents($file, json_encode($state));
        $out(204);
}
$out(404, ['error' => 'not found']);
