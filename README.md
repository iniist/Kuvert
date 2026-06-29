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

- Schriften (Sora, Inter, IBM Plex Mono) liegen lokal in `fonts/` (via [Fontsource](https://fontsource.org/)).
- Die QR-Bibliothek ([qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)) liegt lokal als `qrcode.js`.

Du kannst das selbst prüfen: Öffne den Netzwerk-Tab deines Browsers und beobachte beim Tippen und Versiegeln — es geht keine einzige Anfrage hinaus.

## Dateien

```
index.html     Die komplette App (HTML, CSS, JS in einer Datei)
qrcode.js      QR-Code-Bibliothek (lokal, MIT-Lizenz, von kazuhikoarase)
fonts.css      @font-face-Definitionen für die lokalen Schriften
fonts/         8 woff2-Dateien (latin, genutzte Gewichte)
```

## Deployen

**Netlify (am einfachsten):** Diesen Ordner (oder das Zip) auf [app.netlify.com/drop](https://app.netlify.com/drop) ziehen. Fertig.

**Per Git/CI:** Ordner als Repo pushen und in Netlify verbinden. Es ist eine statische Seite ohne Build-Schritt — kein `netlify.toml` nötig.

Die Seite nimmt automatisch die Domain, auf der sie läuft (`location.origin`), als Basis für erzeugte Links. Eine eigene Domain funktioniert also ohne Code-Änderung.

## Technik

- Vanilla HTML/CSS/JavaScript, kein Build, keine Frameworks.
- Web Crypto API (AES-GCM, PBKDF2).
- qrcode-generator für QR-Codes (Canvas).
- Fontsource für selbst gehostete Schriften.

## Lizenz

MIT — siehe [LICENSE](./LICENSE).
`qrcode.js` steht ebenfalls unter MIT (© Kazuhiko Arase).
