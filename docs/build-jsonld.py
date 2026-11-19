#!/usr/bin/env python3
"""
Erzeugt die strukturierten Daten (Schema.org, JSON-LD) für index.html und pro.html neu.
Die FAQ wird direkt aus den sichtbaren <details>-Fragen gelesen, damit beides nie auseinanderläuft.

Aufruf (nach Änderungen an FAQ, Preisen o. Ä.):  python3 docs/build-jsonld.py
"""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://kuvert.net"
ORG = {"@type": "Organization", "@id": f"{SITE}/#org", "name": "iniist", "url": f"{SITE}/",
       "logo": f"{SITE}/favicon.svg", "sameAs": ["https://github.com/iniist/Kuvert"]}
START, END = "<!-- ld+json:start -->", "<!-- ld+json:end -->"


def text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", fragment))).strip()


def faq(page: str) -> dict:
    items = re.findall(r'<details[^>]*><summary>(.*?)<span class="pm">.*?</summary>\s*<div class="ans">(.*?)</div></details>', page, re.S)
    return {"@type": "FAQPage", "@id": "#faq", "mainEntity": [
        {"@type": "Question", "name": text(q), "acceptedAnswer": {"@type": "Answer", "text": text(a)}} for q, a in items]}


def inject(path: Path, graph: list) -> None:
    page = path.read_text(encoding="utf-8")
    block = (f'{START}\n<script type="application/ld+json">\n'
             + json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False, indent=1)
             + f"\n</script>\n{END}")
    if START in page:
        page = re.sub(re.escape(START) + r".*?" + re.escape(END), lambda _: block, page, flags=re.S)
    else:
        page = page.replace("</head>", block + "\n</head>", 1)
    path.write_text(page, encoding="utf-8")


index = ROOT / "index.html"
inject(index, [
    ORG,
    {"@type": "WebSite", "@id": f"{SITE}/#website", "url": f"{SITE}/", "name": "Kuvert", "inLanguage": "de-DE", "publisher": {"@id": f"{SITE}/#org"}},
    {"@type": "WebApplication", "@id": f"{SITE}/#app", "name": "Kuvert", "url": f"{SITE}/", "inLanguage": "de-DE",
     "description": "Passwörter und vertrauliche Nachrichten sicher teilen: im Browser mit AES-256-GCM verschlüsselt, die Nachricht steckt nur im Link. Ohne Server, ohne Konto.",
     "applicationCategory": "SecurityApplication", "operatingSystem": "Alle (Webbrowser)",
     "browserRequirements": "Aktueller Browser mit Web Crypto API",
     "isAccessibleForFree": True, "license": "https://opensource.org/licenses/MIT",
     "offers": {"@type": "Offer", "price": "0", "priceCurrency": "EUR"},
     "featureList": ["Verschlüsselung im Browser (AES-256-GCM, PBKDF2)", "Nachricht steckt komplett im Link", "Kein Server, keine Datenbank, kein Konto",
                     "QR-Code", "Open Source"],
     "publisher": {"@id": f"{SITE}/#org"}, "sameAs": ["https://github.com/iniist/Kuvert"]},
    faq(index.read_text(encoding="utf-8")),
])

pro = ROOT / "pro.html"
inject(pro, [
    ORG,
    {"@type": "WebApplication", "@id": f"{SITE}/pro.html#app", "name": "Kuvert Pro", "url": f"{SITE}/pro.html", "inLanguage": "de-DE",
     "description": "Ende-zu-Ende verschlüsselte Einmal-Nachrichten, die sich nach dem ersten Öffnen selbst löschen. Mit Lesebestätigung, Ablaufdatum und Passwortschutz.",
     "applicationCategory": "SecurityApplication", "operatingSystem": "Alle (Webbrowser)",
     "offers": [
         {"@type": "Offer", "name": "Kuvert Pro monatlich", "price": "3.33", "priceCurrency": "EUR", "url": f"{SITE}/pro.html",
          "priceSpecification": {"@type": "UnitPriceSpecification", "price": "3.33", "priceCurrency": "EUR", "billingDuration": "P1M", "unitCode": "MON"}},
         {"@type": "Offer", "name": "Kuvert Pro jährlich", "price": "29.00", "priceCurrency": "EUR", "url": f"{SITE}/pro.html",
          "priceSpecification": {"@type": "UnitPriceSpecification", "price": "29.00", "priceCurrency": "EUR", "billingDuration": "P1Y", "unitCode": "ANN"}}],
     "featureList": ["Selbstzerstörung nach dem ersten Öffnen", "Lesebestätigung per Status-Link, Browser oder E-Mail", "Ende-zu-Ende-Verschlüsselung",
                     "Vernichtung nach 5 falschen Passwörtern", "Ablaufdatum 1 Stunde bis 30 Tage", "Bis 20.000 Zeichen", "Lizenz für bis zu 3 Geräte"],
     "isPartOf": {"@id": f"{SITE}/#website"}, "publisher": {"@id": f"{SITE}/#org"}},
    faq(pro.read_text(encoding="utf-8")),
])
print("JSON-LD aktualisiert: index.html, pro.html")
