// SEO/GEO-Checks: Titel, Beschreibungen, Canonicals, strukturierte Daten, robots/sitemap/llms.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(path.join(root, f), "utf8");
const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const PAGES = { "index.html": "https://kuvert.net/", "pro.html": "https://kuvert.net/pro.html",
                "app.html": "https://kuvert.net/app", "teams.html": "https://kuvert.net/teams.html", "nutzungsbedingungen.html": "https://kuvert.net/nutzungsbedingungen.html", "impressum.html": "https://kuvert.net/impressum.html", "datenschutz.html": "https://kuvert.net/datenschutz.html" };

for (const [file, url] of Object.entries(PAGES)) {
  test(`${file}: Titel, Beschreibung, Canonical`, () => {
    const s = read(file);
    const title = s.match(/<title>([^<]+)<\/title>/)[1];
    assert.ok(title.length >= 15 && title.length <= 70, `Titel ${title.length} Zeichen`);
    const desc = s.match(/<meta name="description" content="([^"]+)"/)[1];
    assert.ok(desc.length >= 50 && desc.length <= 170, `Beschreibung ${desc.length} Zeichen`);
    assert.match(s, new RegExp(`<link rel="canonical" href="${url.replace(/[.]/g, "\\.")}">`));
    assert.equal((s.match(/<h1[\s>]/g) || []).length >= 1, true);
  });
}

for (const file of ["index.html", "pro.html"]) {
  test(`${file}: JSON-LD gültig und FAQ deckungsgleich mit der Seite`, () => {
    const s = read(file);
    const blocks = [...s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.equal(blocks.length, 1);
    const ld = JSON.parse(blocks[0][1]);
    const faq = ld["@graph"].find((g) => g["@type"] === "FAQPage");
    const visible = [...s.matchAll(/<summary>([\s\S]*?)<span class="pm">/g)].map((m) => strip(m[1]));
    assert.deepEqual(faq.mainEntity.map((q) => q.name), visible, "FAQ geändert? → python3 docs/build-jsonld.py");
    assert.ok(ld["@graph"].some((g) => g["@type"] === "WebApplication" && g.offers));
  });
}

test("robots.txt, sitemap.xml, llms.txt", () => {
  const robots = read("robots.txt");
  assert.match(robots, /Sitemap: https:\/\/kuvert\.net\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/api\//);
  assert.doesNotMatch(robots, /Disallow: \/\s*$/m, "nichts komplett sperren");
  const sitemap = read("sitemap.xml");
  for (const url of Object.values(PAGES)) assert.ok(sitemap.includes(`<loc>${url}</loc>`), url);
  const llms = read("llms.txt");
  assert.match(llms, /^# Kuvert/);
  assert.ok(llms.includes("https://kuvert.net/pro.html"));
  assert.ok(existsSync(path.join(root, "404.html")));
});

test("Web-App-Manifest und Icons", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.start_url, "/app");
  assert.equal(m.display, "standalone");
  for (const icon of m.icons) assert.ok(existsSync(path.join(root, icon.src.replace(/^\//, ""))), icon.src);
  assert.ok(m.icons.some((i) => i.purpose === "maskable"));
  for (const file of Object.keys(PAGES)) assert.match(read(file), /<link rel="manifest" href="\/manifest\.webmanifest">/, file);
  assert.ok(existsSync(path.join(root, "sw.js")));
});

