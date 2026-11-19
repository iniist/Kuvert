#!/usr/bin/env python3
"""
Hängt beim Deployment an alle CSS/JS-Verweise in den HTML-Seiten eine Versionsnummer an
(?v=<Inhalts-Hash>). So bekommen Browser neue Dateien sofort, unveränderte bleiben lange im Cache.
Läuft nur in der Kopie für den Upload (GitHub Actions), das Repo bleibt unverändert.
"""
import hashlib
import re
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
assets = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()[:10] for p in list(root.glob("*.css")) + list(root.glob("*.js"))}
pattern = re.compile(r'((?:href|src)=")((?:\./|/)?)([\w.-]+\.(?:css|js))(?:\?v=[0-9a-f]+)?(")')
missing = []
for page in sorted(root.glob("*.html")):
    text = page.read_text(encoding="utf-8")

    def repl(m):
        name = m.group(3)
        if name not in assets:
            missing.append(f"{page.name}: {name}")
            return m.group(0)
        return f"{m.group(1)}{m.group(2)}{name}?v={assets[name]}{m.group(4)}"

    new = pattern.sub(repl, text)
    if new != text:
        page.write_text(new, encoding="utf-8")
        print(f"{page.name}: versioniert")
if missing:
    print("FEHLER – unbekannte Dateien:", *missing, sep="\n  ")
    sys.exit(1)
# Kontrolle: kein lokaler CSS/JS-Verweis ohne Version
for page in root.glob("*.html"):
    for m in re.finditer(r'(?:href|src)="(?:\./|/)?[\w.-]+\.(?:css|js)"', page.read_text(encoding="utf-8")):
        print(f"FEHLER – ohne Version: {page.name}: {m.group(0)}")
        sys.exit(1)
