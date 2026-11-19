# Kuvert

Quelltext: https://github.com/iniist/Kuvert

**Tippen. Versiegeln. Teilen.**
Verschicke Geheimnisse, die nur im Link leben — verschlüsselt im Browser, ohne Server, ohne Konto, ohne Datenbank.

Kuvert ist eine einzelne statische HTML-Seite. Es gibt nichts, was gehackt werden könnte, weil nichts gespeichert wird.

---

## Was es macht

Du tippst eine vertrauliche Nachricht (z. B. ein Passwort), vergibst optional ein Passwort und teilst den erzeugten Link oder QR-Code. Die Empfängerin öffnet den Link, gibt das Passwort ein und sieht die Nachricht. Niemand speichert irgendetwas auf einem Server.

## Wie es funktioniert

Der gesamte Inhalt steckt hinter dem `#` (Fragment) im Link. Dieser Teil der URL wird vom Browser **nie an den Server gesendet** — er bleibt rein lokal. Die Seite liest ihn beim Laden aus und baut daraus die Nachricht zurück.

- **Ohne Passwort:** Der Text wird nur Base64-kodiert (URL-sicher). Das ist *nicht geheim* — jeder mit dem Link kann mitlesen. Es macht den Inhalt nur unleserlich auf den ersten Blick.
- **Mit Passwort:** Der Text wird im Browser per **AES-GCM (256 Bit)** verschlüsselt. Der Schlüssel wird per **PBKDF2 (SHA-256, 600.000 Iterationen)** aus dem Passwort abgeleitet. Salt (16 Byte) und IV (12 Byte) werden zufällig erzeugt und dem Chiffretext vorangestellt. Ohne das richtige Passwort ist die Nachricht nicht lesbar — auch nicht für den Absender.

Alles passiert über die native [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) des Browsers. Keine externen Krypto-Bibliotheken.

## Sicherheitsmodell (ehrlich)

**Was geschützt ist:** Mit Passwort kann niemand die Nachricht lesen, der nur den Link hat — weder ein Netzwerk-Mitleser noch der Hosting-Anbieter, weil der `#`-Teil nie übertragen wird.

**Was du wissen solltest:**

- **Keine automatische Selbstzerstörung.** Ohne Server gibt es kein „nach einmal Lesen weg". Der Link funktioniert, solange er existiert. Lösch ihn dort, wo du ihn geteilt hast, wenn er erledigt ist. Der Vorteil: Es liegt nichts herum, das gestohlen werden könnte.
- **Teile das Passwort über einen anderen Kanal** als den Link. Liegen Link und Passwort im selben Chat, ist der Schutz hinfällig.
- **Ohne Passwort ist nichts geheim**, nur kodiert.
- **Länge:** Ein Link fasst nur wenige tausend Zeichen — ideal für Passwörter und kurze Notizen, nicht für Dateien. Verschlüsselung vergrößert den Link (Salt + IV + Prüfsumme).
- Die Sicherheit hängt an der Stärke des gewählten Passworts.

## Keine externen Anfragen

Die Seite lädt **nichts** von Drittanbietern:

- Schriften (Geist, Geist Mono, Instrument Serif, OFL-Lizenz) liegen lokal in `fonts/` (via [Fontsource](https://fontsource.org/)).
- Die QR-Bibliothek ([qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)) liegt lokal als `qrcode.js`.

Du kannst das selbst prüfen: Öffne den Netzwerk-Tab deines Browsers und beobachte beim Tippen und Versiegeln — es geht keine einzige Anfrage hinaus.

## Dateien

```
index.html        Kostenlose App (komplett ohne Server)
app.js            Logik der kostenlosen App (Verschlüsseln, Link, QR, Empfänger)
site.js           Gemeinsam: Farbschema, Navigation, Einblenden
kuvert.css        Design-System für alle Seiten
fonts.css, fonts/ Lokale Schriften (Geist, Geist Mono, Instrument Serif)
qrcode.js         QR-Code-Bibliothek (lokal, MIT-Lizenz, von kazuhikoarase)
favicon.svg, og-image.png

pro.html          Kuvert Pro – Seite (zeigt „Bald verfügbar“, bis pro_launched = true)
pro.js            Kuvert Pro – Logik (Lizenz, Versenden, Empfangen, Status)
pro-crypto.js     Kuvert Pro – Verschlüsselung (Web Crypto)
api/              Kuvert Pro – PHP-Backend (nur api/index.php ist öffentlich)

docs/             Anleitung + Vorlage für og-image.png (wird nicht hochgeladen)
tests/            API- und Browser-Tests (wird nicht hochgeladen)
```

---

## Kuvert Pro

Die kostenpflichtige Variante mit **Selbstzerstörung nach dem Lesen** und **Lesebestätigung**.
Die kostenlose Version bleibt unverändert serverlos.

### Wie es funktioniert

1. Der Browser erzeugt einen zufälligen 256-Bit-Schlüssel `K` und verschlüsselt die Nachricht (AES-GCM).
   Mit Passwort fließt zusätzlich `PBKDF2(Passwort, 600.000 Runden)` in den Schlüssel ein.
2. Hochgeladen werden nur der **Chiffretext** und `SHA-256(token)`. `token` wird per HKDF aus demselben
   Material abgeleitet wie der Schlüssel.
3. Der Link sieht so aus: `https://kuvert.net/pro.html#p1.<id>.<K>`. `K` steht hinter dem `#` und erreicht den Server nie.
4. Beim Öffnen leitet der Empfänger-Browser aus `K` (+ Passwort) das `token` ab und legt es vor.
   Nur wenn es stimmt, gibt der Server den Chiffretext **genau einmal** heraus und löscht ihn im selben Schritt
   (atomares `UPDATE … WHERE state = 'waiting'`).
5. Ein falsches Passwort lehnt der Server ab, **ohne** den Chiffretext herauszugeben. Offline-Raten ist damit unmöglich.
   Nach 5 Fehlversuchen wird die Nachricht vernichtet.
6. Der Absender bekommt einen **Status-Link** (`#s1.<id>.<statusToken>`) und optional eine **E-Mail**,
   sobald geöffnet wurde. Solange die Pro-Seite offen ist, gibt es zusätzlich eine Browser-Benachrichtigung.
7. Wer das Kuvert zuerst öffnet, gewinnt. Der eigentliche Empfänger sieht dann „Bereits geöffnet“, ein Abfangen fällt also auf.

Der Server speichert: Chiffretext, Hashes, Zeiten, Fehlversuche, optional die E-Mail-Adresse und einen HMAC des
Lizenzschlüssels. Chiffretext und E-Mail werden beim Öffnen, Ablauf oder Zurückziehen sofort gelöscht, der Rest
nach spätestens 7 weiteren Tagen.

### Pro freischalten

Solange in der Server-Konfiguration `pro_launched` nicht `true` ist (oder gar keine Konfiguration existiert),
zeigt `pro.html` „Bald verfügbar“. Zum Testen vorher: `https://kuvert.net/pro.html?preview`.

### Lizenzen

- **Eigene Schlüssel** (immer verfügbar): `php -q api/_cli/license.php create --label="Name" [--days=365]` (per SSH im Ordner `kuvert-net`; Strato nutzt php-cgi, daher `-q`)
  (auch `list`, `revoke <KEY>`, `activate <KEY>`). Braucht SSH-Zugang zum Webspace.
- **Verkauf über [Polar](https://polar.sh)** (`license.provider = 'polar'`): Polar tritt als Verkäufer auf
  (Merchant of Record) und kümmert sich um Umsatzsteuer und Rechnungen. Im Polar-Dashboard ein Produkt mit
  dem Benefit „License Keys“ anlegen und `organization_id` (und optional `benefit_id`) in die Konfiguration
  eintragen. Der Server prüft Schlüssel online und speichert das Ergebnis 24 Stunden zwischen. Fällt Polar aus,
  gelten bekannte Schlüssel 3 Tage weiter.
  *(Lemon Squeezy wurde bewusst nicht genommen: Der Dienst nimmt keine Neukunden mehr an und wird im März 2027 eingestellt.)*

### Einrichtung auf Strato

1. **Datenbank:** Im Strato-Kundenmenü eine MySQL-Datenbank anlegen (Host, DB-Name, Benutzer, Passwort notieren).
2. **Konfiguration:** `api/config.sample.php` kopieren und ausfüllen:
   - am besten als `kuvert-config.php` **eine Ebene über** dem Ordner, auf den die Domain zeigt (nicht per Web erreichbar),
   - alternativ als `api/config.php` (durch `.htaccess` geschützt).
   - `secret` setzen: `openssl rand -hex 32` (geht auf jedem Mac/Linux)
3. **E-Mail (optional):** Ein Postfach wie `kuvert@kuvert.net` anlegen und SMTP-Daten eintragen
   (`smtp.strato.de`, Port 465, `ssl`). Danach `mail.enabled = true`.
4. **Hochladen:** alles außer `tests/` (und ohne `.git`). Die Tabellen werden beim ersten Aufruf automatisch angelegt.
5. **Prüfen:**
   - `https://kuvert.net/api/index.php?a=config` muss JSON liefern.
   - `https://kuvert.net/api/config.php` und `https://kuvert.net/api/_lib/bootstrap.php` müssen **403** liefern.
6. **PHP-Version:** 8.1 oder neuer (im Strato-Menü einstellbar). Benötigt werden PDO (mysql), openssl und curl.
7. Optional einen Cronjob für `php -q api/_cli/cleanup.php` einrichten. Das ist nicht nötig, weil die API nebenbei aufräumt.

### Lokal entwickeln & testen

```bash
bash tests/run.sh          # startet PHP-Server mit SQLite, API-Tests (node:test) + Browser-Test (Playwright)
bash tests/run.sh api      # nur API-Tests
# gegen MySQL/MariaDB:
KUVERT_TEST_DSN='mysql:host=localhost;dbname=kuvert_test;charset=utf8mb4' KUVERT_TEST_USER=… KUVERT_TEST_PASS=… bash tests/run.sh
```

## Deployen

Bei jedem Push auf `main` testet GitHub Actions die API und lädt die Seite per SFTP zu Strato hoch
(`.github/workflows/deploy.yml`, ohne `tests/`, `docs/`, README). Auf dem Server wird nichts gelöscht.
Einrichtung Schritt für Schritt: **[docs/ANLEITUNG.md](docs/ANLEITUNG.md)** (Deployment, Polar, Pro auf Strato).

Die Seite nimmt automatisch die Domain, auf der sie läuft (`location.origin`), als Basis für erzeugte Links.

## Technik

- Vanilla HTML/CSS/JavaScript, kein Build, keine Frameworks.
- Web Crypto API (AES-GCM, PBKDF2, HKDF).
- Pro: PHP 8.1+, PDO (MySQL/MariaDB oder SQLite), keine Abhängigkeiten, kein Composer.
- qrcode-generator für QR-Codes (Canvas).
- Fontsource für selbst gehostete Schriften.

## Lizenz

MIT — siehe [LICENSE](./LICENSE).
`qrcode.js` steht ebenfalls unter MIT (© Kazuhiko Arase).
