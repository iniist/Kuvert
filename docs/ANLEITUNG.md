# Kuvert – Anleitung: Deployment & Polar

Teil A: GitHub lädt die Seite automatisch zu Strato hoch.
Teil B: Polar einrichten, um Pro-Lizenzen zu verkaufen.
Teil C: Pro auf Strato einschalten.

---

## Teil 0 – Vorab prüfen, ob Strato alles kann

1. Im Strato-Menü nachsehen (siehe Liste unten).
2. `docs/strato-check.php` herunterladen und **ohne SFTP** über den **Webspace-Explorer** im Strato-Menü
   in denselben Ordner hochladen, in dem `index.html` liegt.
3. `https://kuvert.net/strato-check.php` öffnen und optional die MySQL-Daten eintragen.
4. Ergebnis (Screenshot) an Claude schicken und dann auf **„Prüfskript löschen“** klicken.
   Das Skript sperrt sich nach 2 Stunden ohnehin selbst.

Im Strato-Menü nachsehen:
- **Paketname** (z. B. „Hosting Basic/Plus/Pro“).
- **SFTP & SSH**: Kann ich einen SFTP-Zugang anlegen? Gibt es auch „SFTP + SSH“?
- **Datenbanken**: Wie viele MySQL-Datenbanken sind enthalten, und sind noch welche frei?
- **PHP-Version** einstellbar auf 8.1 oder neuer?
- **E-Mail**: Kann ich ein Postfach wie `kuvert@kuvert.net` anlegen?
- **Cronjobs** (optional, nicht zwingend nötig).

## Teil A – Automatisches Deployment GitHub → Strato

Das Prinzip: Bei jedem Push auf `main` startet GitHub den Workflow `.github/workflows/deploy.yml`.
Der führt die API-Tests aus und lädt bei Erfolg alle Dateien per **SFTP** zu Strato hoch.
Gelöscht wird auf dem Server nie etwas. `config.php`, Datenbank und Logs dort bleiben unangetastet.
Nicht hochgeladen werden `tests/`, `docs/`, `.github/` und `README.md`.

### A1. SFTP-Zugang bei Strato anlegen

1. Auf strato.de oben rechts **Login** → im Kunden-Login anmelden.
2. Dein Paket wählen → **Datenbanken und Webspace** → **SFTP & SSH**.
3. **Neuen Zugang anlegen**:
   - Typ: **SFTP** reicht. „SFTP + SSH“ nimmst du, wenn du später auch Befehle auf dem Server ausführen willst
     (z. B. `php -q api/_cli/license.php create` im Ordner `kuvert-net`).
   - Passwort: ein neues, langes Passwort, nur für GitHub. Notieren.
   - Startverzeichnis: `/`, also das Hauptverzeichnis des Webspace.
4. Notiere dir aus der Übersicht:
   - **Server/Host**: entweder `ssh.strato.de` (ältere Pakete) oder ein persönlicher Name wie
     `50xxxxxx03.ssh.w2.strato.hosting` (neuere Pakete)
   - **Benutzername**: z. B. `su15xxx9`, bei älteren Paketen die Domain ohne `www.` (z. B. `kuvert.net`)

### A2. Zielordner herausfinden

1. Im Strato-Menü → **Domains** → `kuvert.net` → **Einstellungen**/**Umleitung/Ziel**.
2. Dort steht, auf welchen **Ordner im Webspace** die Domain zeigt, z. B. `/kuvert` oder `/`.
3. Gegenprobe mit einem SFTP-Programm (z. B. FileZilla, Protokoll SFTP, Port 22) mit den Daten aus A1:
   Im Zielordner liegen die heutigen `index.html`, `impressum.html` usw.
4. Den Pfad **relativ zum Startverzeichnis** notieren, z. B. `kuvert` (ohne führenden Slash) oder `.` für das Hauptverzeichnis.

### A3. Secrets in GitHub eintragen

1. GitHub → Repository `iniist/Kuvert` → **Settings** → **Secrets and variables** → **Actions**.
2. **New repository secret**, viermal:

| Name | Wert |
|---|---|
| `STRATO_SFTP_HOST` | Host aus A1, z. B. `ssh.strato.de` |
| `STRATO_SFTP_USER` | Benutzername aus A1 |
| `STRATO_SFTP_PASSWORD` | Passwort aus A1 |
| `STRATO_TARGET_DIR` | Zielordner aus A2, z. B. `kuvert` |

3. Optional, aber empfohlen: **Settings** → **Environments** → `production` (entsteht beim ersten Lauf automatisch)
   → **Required reviewers** → dich selbst eintragen. Dann wartet jedes Deployment auf deinen Klick.

### A4. Erster Lauf

1. Den Pull Request mit Kuvert Pro nach `main` mergen. Das löst das erste Deployment aus.
   Alternativ: **Actions** → **Deploy zu Strato** → **Run workflow**.
2. Unter **Actions** zuschauen: Erst läuft `test`, dann `deploy`. Grüner Haken = fertig.
3. https://kuvert.net im Browser neu laden. Oben rechts erscheint jetzt der **Pro**-Knopf.

**Wenn es rot wird:**
- `Secrets fehlen`: Name in A3 vertippt (Groß-/Kleinschreibung beachten).
- `Login failed` / `530`: Benutzer, Passwort oder Host falsch.
- `No such file or directory`: `STRATO_TARGET_DIR` stimmt nicht. Mit FileZilla prüfen, was nach dem Login zu sehen ist.

Ab jetzt gilt: **Push auf `main` = live.** Arbeite deshalb auf eigenen Branches und merge erst, wenn alles passt.

---

## Teil B – Polar einrichten

Polar ist der Verkäufer (Merchant of Record). Bezahlung, Rechnungen, Abo-Verwaltung und die
Mails an Käufer laufen komplett über Polar. Du musst dafür keine eigene Oberfläche bauen.

**Empfehlung:** Erst alles in der **Sandbox** (Testmodus mit Testzahlungen) durchspielen, dann live.
Sandbox und Live sind getrennte Welten mit eigenen IDs. Die Schritte sind identisch.

### B1. Konto & Organisation

1. Auf https://sandbox.polar.sh (Test) bzw. https://polar.sh (live) registrieren.
2. Eine **Organisation** anlegen, z. B. Name „Kuvert“, Slug `kuvert`.
   Der Slug steckt später in den Links (`polar.sh/kuvert/...`).
   Nutzt du Polar auch für dein anderes Projekt, kannst du dieselbe Organisation verwenden. Dann ist
   Schritt B3 (`benefit_id`) Pflicht, damit Kuvert nur Kuvert-Schlüssel akzeptiert.
3. **Settings** → **General**: Die **Organization ID** (UUID) kopieren und als `organization_id` notieren.
4. Live: In den Einstellungen die **Auszahlungen** (Payout-Konto/Stripe) einrichten und die
   Konto-Prüfung von Polar abschließen. Erst danach kannst du echte Zahlungen annehmen.

### B2. Lizenzschlüssel-Benefit

1. **Benefits** → **+ New Benefit** → Typ **License Keys**.
2. Einstellungen:
   - Beschreibung: „Kuvert Pro Lizenzschlüssel“
   - **Prefix**: `KUVERT` (optional, sieht schöner aus)
   - **Expiration**: leer lassen. Bei Abos endet der Schlüssel automatisch mit dem Abo.
     Bei einmaligem Kauf kannst du hier z. B. „1 Jahr“ setzen, wenn er nicht ewig gelten soll.
   - **Limit Activations**: **an, 3**. Das ist die Gerätebegrenzung: Ein Schlüssel läuft auf höchstens 3 Browsern.
     Falls angeboten, auch erlauben, dass Kunden Geräte im Kundenportal selbst freigeben.
   - **Limit Usage**: aus.
3. Speichern. Die **Benefit-ID** (UUID) aus der Benefit-Detailseite bzw. der Adresszeile kopieren → `benefit_id`.

### B3. Produkt

1. **Products** → **+ New Product**.
2. Name „Kuvert Pro“, kurze Beschreibung, Bild optional.
3. **Preis** wählen:
   - *Einmalig* (z. B. 19 €) oder
   - *Abo* monatlich/jährlich (z. B. 2 €/Monat oder 19 €/Jahr). Beides geht, Kuvert kommt mit beidem klar.
4. Unter **Benefits** den Benefit aus B2 hinzufügen. Speichern.

### B4. Checkout-Link

1. Beim Produkt → **Checkout Links** → **Create** (bzw. **Share**).
2. **Success URL**: `https://kuvert.net/pro.html`
3. Link kopieren → `buy_url`.

### B5. Kundenportal (Kündigen, Rechnungen, Schlüssel)

- Adresse: `https://polar.sh/<dein-slug>/portal` (Sandbox: `https://sandbox.polar.sh/<dein-slug>/portal`) → `manage_url`.
- Kunden melden sich dort mit ihrer Kauf-E-Mail und einem Einmalcode an. Dort können sie:
  das **Abo kündigen**, Zahlungsmethode ändern, Rechnungen laden, den **Lizenzschlüssel sehen** und
  einen geleakten Schlüssel neu erzeugen.
- Polar verschickt Kaufbestätigung, Verlängerungshinweise und Zahlungsprobleme automatisch per Mail,
  jeweils mit Link zum Portal.

### B6. Was bei einer Kündigung passiert

1. Kunde kündigt im Portal → das Abo läuft bis zum Ende der bezahlten Periode weiter.
2. Am Periodenende entzieht Polar den Lizenzschlüssel automatisch.
3. Kuvert fragt Polar spätestens nach **24 Stunden** erneut, merkt den entzogenen Schlüssel und
   lehnt ihn ab. Auf der Pro-Seite erscheint „Dein gespeicherter Lizenzschlüssel gilt nicht mehr“.
4. Schon verschickte Kuverts bleiben öffnen- und lesbar, denn Empfänger brauchen keine Lizenz.

Du musst dafür nichts tun, keine Mails schreiben und keine Webhooks einrichten.

### B7. Testkauf (Sandbox)

1. Konfiguration (Teil C) mit den **Sandbox**-Werten und `'sandbox' => true` füllen.
2. Auf `pro.html` → „Lizenz kaufen“ → mit der Testkarte `4242 4242 4242 4242`, beliebiges Datum in der Zukunft, beliebige Prüfziffer bezahlen.
3. Den Schlüssel aus der Bestätigungsmail bzw. dem Portal auf `pro.html` eingeben → „Pro aktiv“.
4. Im Sandbox-Dashboard das Abo kündigen bzw. widerrufen → spätestens nach 24 h lehnt Kuvert den Schlüssel ab.
5. Passt alles: Schritte B1–B5 auf polar.sh (live) wiederholen und die Live-Werte eintragen, `'sandbox' => false`.

---

## Teil C – Pro auf Strato einschalten

1. **Datenbank**: Strato-Menü → **Datenbanken und Webspace** → **Datenbanken verwalten** → neue MySQL-Datenbank.
   Host, Datenbankname, Benutzer und Passwort notieren.
2. **Konfiguration**: `api/config.sample.php` lokal kopieren, ausfüllen und per SFTP hochladen,
   am besten als `kuvert-config.php` **in den Ordner über** dem Zielordner (dann ist sie nicht aus dem Web erreichbar).
   Liegt die Seite direkt im Hauptverzeichnis, stattdessen als `api/config.php` hochladen.
   Die Datei kommt nie ins Git, das Deployment überschreibt sie nicht.

```php
'secret'   => '…',   // openssl rand -hex 32  – einmal setzen, nie ändern
'db'       => ['dsn' => 'mysql:host=…;dbname=…;charset=utf8mb4', 'user' => '…', 'pass' => '…'],
'license'  => ['provider' => 'polar', 'polar' => [
    'organization_id' => '…', 'benefit_id' => '…', 'sandbox' => true,
]],
'buy_url'     => 'https://…',             // aus B4
'price_label' => '19 € pro Jahr',
'manage_url'  => 'https://polar.sh/kuvert/portal',
'pro_launched' => false,  // erst auf true, wenn alles getestet ist (vorher: pro.html?preview)
'mail' => ['enabled' => true, 'transport' => 'smtp', 'from' => 'kuvert@kuvert.net',
           'smtp' => ['host' => 'smtp.strato.de', 'port' => 465, 'secure' => 'ssl',
                      'user' => 'kuvert@kuvert.net', 'pass' => '…']],
```

3. **E-Mail** (für „Dein Kuvert wurde geöffnet“): Im Strato-Menü ein Postfach `kuvert@kuvert.net` anlegen
   und dessen Passwort oben eintragen.
4. **PHP-Version**: Strato-Menü → Einstellungen → PHP-Version auf **8.1 oder neuer** stellen.
5. **Prüfen**:
   - `https://kuvert.net/api/index.php?a=config` → JSON (u. a. `"mail":true`)
   - `https://kuvert.net/api/config.php` → **403**
   - `https://kuvert.net/pro.html?preview` → Testkauf wie in B7, Kuvert an dich selbst schicken, öffnen, Mail kommt an.
6. **Live schalten**: `'pro_launched' => true` setzen und `'sandbox' => false` (mit Live-Werten von Polar).
   Ab dann zeigt `pro.html` für alle die App statt „Bald verfügbar“. Auf der Startseite den Hinweis „bald“ entferne ich dann im Code.

---

## Teil D – Pro starten (nach der Freigabe durch Polar)

1. In Polar prüfen, dass der Hinweis „test mode“ verschwunden ist (Konto verifiziert, Auszahlungskonto hinterlegt).
2. Aufräumen in Polar:
   - Testprodukt „Kuvert Pro Test“ und dessen Checkout-Link **archivieren**.
   - Rabattcode `KUVERTTEST` deaktivieren oder auf 0 verbleibende Einlösungen setzen.
   - Den beim Test erzeugten Lizenzschlüssel kannst du für dich behalten; nicht weitergeben (er läuft nie ab).
3. In Polar beim Benefit „Kuvert Pro Lizenzschlüssel“ **Limit Activations = 3** einschalten (Gerätebegrenzung).
4. Den vorbereiteten Pull Request „Pro starten“ **mergen** (Entwurf vorher mit „Ready for review“ freigeben).
   Er bringt die Gerätebegrenzung und entfernt die „bald“-Hinweise auf der Startseite. Das Deployment läuft
   automatisch; unter Actions auf den grünen Haken warten (ca. 1 Minute).
5. Erst danach in `htdocs/kuvert-config.php`: `'pro_launched' => true` setzen und hochladen.
   Ab sofort zeigt `pro.html` die App für alle (ohne `?preview`).
6. Kurz prüfen: kuvert.net (kein „bald“ mehr), kuvert.net/pro.html (App sichtbar, „Jetzt verfügbar“).

