#!/usr/bin/env bash
# Startet einen lokalen PHP-Server mit Test-Konfiguration und führt API- und Browser-Tests aus.
#   bash tests/run.sh            # alles
#   bash tests/run.sh api        # nur API
# Gegen MySQL/MariaDB statt SQLite:
#   KUVERT_TEST_DSN='mysql:host=127.0.0.1;dbname=kuvert_test;charset=utf8mb4' KUVERT_TEST_USER=kv KUVERT_TEST_PASS=… bash tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
TMP=$ROOT/tests/.tmp
PORT=${PORT:-8099}
mkdir -p "$TMP"
rm -f "$TMP"/test.sqlite* "$ROOT/api/_data/mail.log"

cat > "$TMP/config.php" <<PHP
<?php
return [
  'secret'   => str_repeat('t', 40),
  'site_url' => 'http://127.0.0.1:$PORT',
  'db'       => getenv('KUVERT_TEST_DSN')
                  ? ['dsn' => getenv('KUVERT_TEST_DSN'), 'user' => getenv('KUVERT_TEST_USER'), 'pass' => getenv('KUVERT_TEST_PASS')]
                  : ['dsn' => 'sqlite:' . __DIR__ . '/test.sqlite'],
  'mail'     => ['enabled' => true, 'transport' => 'log', 'from' => 'kuvert@example.test'],
  'buy_url'  => 'https://example.test/kaufen',
  'price_label' => '19 € einmalig',
  'rate'     => ['license' => 1000, 'create' => 1000, 'peek' => 1000, 'read' => 1000, 'status' => 1000],
];
PHP
export KUVERT_CONFIG="$TMP/config.php"

KEY=$(php api/_cli/license.php create --label=test 2>/dev/null)
php -S 127.0.0.1:$PORT -t "$ROOT" > "$TMP/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf "http://127.0.0.1:$PORT/api/index.php?a=config" >/dev/null && break; sleep 0.2; done

export KUVERT_BASE="http://127.0.0.1:$PORT" KUVERT_LICENSE="$KEY"
node --test tests/api.test.mjs
if [ "${1:-all}" != "api" ]; then
  node tests/e2e.mjs
fi
