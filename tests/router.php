<?php
// Lokaler Testserver: bildet die Rewrite-Regel /app → app.html aus der .htaccess nach.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/app') {
    header('Content-Type: text/html; charset=UTF-8');
    readfile(__DIR__ . '/../app.html');
    return true;
}
return false;
