<?php
/*
 * Kuvert Pro – Server-Konfiguration
 *
 * Kopiere diese Datei nach  api/config.php  ODER (sicherer) eine Ebene ÜBER
 * den Web-Ordner als  kuvert-config.php  und trage deine Werte ein.
 * Gesucht wird in dieser Reihenfolge:
 *   1. Pfad aus der Umgebungsvariable KUVERT_CONFIG
 *   2. <Ordner über der Website>/kuvert-config.php
 *   3. api/config.php
 *
 * Nicht gesetzte Werte fallen auf die Standardwerte in api/_lib/bootstrap.php zurück.
 */
return [

    // Lange Zufallszeichenkette (mind. 32 Zeichen). Wird für Hashes von
    // Lizenzschlüsseln und IP-Adressen genutzt. Einmal setzen, nie wieder ändern
    // (sonst sind alle gespeicherten Lizenzen ungültig).
    // Erzeugen z. B. mit:  php -r 'echo bin2hex(random_bytes(32)), "\n";'
    'secret' => 'HIER-EINE-LANGE-ZUFALLSZEICHENKETTE-EINTRAGEN',

    // Öffentliche Adresse der Seite (ohne abschließenden Slash).
    'site_url' => 'https://kuvert.net',

    // Datenbank.
    // Strato: MySQL-Datenbank im Kundenmenü anlegen und die Daten hier eintragen.
    //   'dsn'  => 'mysql:host=rdbms.strato.de;dbname=DBxxxxxxx;charset=utf8mb4',
    //   'user' => 'Uxxxxxxx',
    //   'pass' => '…',
    // Ohne Angabe wird eine SQLite-Datei in api/_data/ verwendet (gut für lokal).
    'db' => [
        // 'dsn'  => 'mysql:host=rdbms.strato.de;dbname=DBxxxxxxx;charset=utf8mb4',
        // 'user' => 'Uxxxxxxx',
        // 'pass' => '',
    ],

    // Lizenzen.
    // 'local'  = nur selbst erzeugte Schlüssel (php api/_cli/license.php create)
    // 'polar'  = Verkauf über polar.sh (Merchant of Record, kümmert sich um USt.)
    //            Selbst erzeugte Schlüssel funktionieren zusätzlich immer.
    'license' => [
        'provider' => 'local',
        'polar' => [
            'organization_id' => '',   // UUID deiner Polar-Organisation
            'benefit_id'      => '',   // optional: nur Schlüssel dieses "License Key"-Benefits akzeptieren
            'sandbox'         => false,
        ],
    ],

    // Kauf-Link, der auf der Pro-Seite angezeigt wird (leer = kein Button).
    'buy_url'     => '',
    'price_label' => '',   // z. B. '19 € einmalig'

    // Kundenportal (Abo kündigen, Rechnungen, Schlüssel ansehen). Bei Polar:
    // 'https://polar.sh/<dein-org-slug>/portal'  (leer = kein Link)
    'manage_url'  => '',

    // Pro öffentlich anbieten? Solange false, zeigt pro.html „Bald verfügbar“.
    // Zum Testen vorher trotzdem nutzbar über:  https://kuvert.net/pro.html?preview
    'pro_launched' => false,

    // E-Mail-Benachrichtigung „Dein Kuvert wurde geöffnet“.
    // transport: 'smtp' (empfohlen, Strato: smtp.strato.de:465 ssl),
    //            'mail' (PHP mail()), 'log' (schreibt nur in api/_data/mail.log – zum Testen)
    'mail' => [
        'enabled'   => false,
        'transport' => 'smtp',
        'from'      => 'kuvert@kuvert.net',
        'from_name' => 'Kuvert',
        'smtp' => [
            'host'   => 'smtp.strato.de',
            'port'   => 465,
            'secure' => 'ssl',          // 'ssl' (Port 465) oder 'tls' (STARTTLS, Port 587)
            'user'   => 'kuvert@kuvert.net',
            'pass'   => '',
        ],
    ],

    // Grenzen (optional anpassen).
    // 'limits' => [
    //     'max_message_chars'         => 20000,
    //     'ttl_options'               => [3600, 86400, 604800, 2592000],
    //     'default_ttl'               => 86400,
    //     'max_attempts'              => 5,
    //     'daily_creates_per_license' => 200,
    //     'status_retention'          => 604800,
    // ],
];
