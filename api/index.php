<?php
/* Kuvert Pro – einziger öffentlich erreichbarer Einstiegspunkt der API. */
declare(strict_types=1);
header_remove('X-Powered-By');   // PHP-Version nicht preisgeben
require __DIR__ . '/_lib/bootstrap.php';
kv_run();
