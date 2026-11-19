// Browser-Test: App (kostenlos + Pro), Pro-Seite, Empfänger, Status, Gerätelimit, Startseite, Teams, Handy.
// Aufruf über tests/run.sh. Screenshots landen in tests/.tmp/.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.KUVERT_BASE || "http://127.0.0.1:8099";
const LICENSE = process.env.KUVERT_LICENSE;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp");

const browser = await chromium.launch();
const errors = [];
const watch = (page, name) => {
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (400|403|409|410)/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
};
const step = (s) => console.log("✓", s);
const perms = async (ctx) => ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });

try {
  /* ================= App: kostenloses Link-Kuvert ================= */
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await perms(desk);
  const ap = await desk.newPage(); watch(ap, "app");
  await ap.goto(BASE + "/app");
  await ap.waitForFunction(() => document.querySelector('.mode button[data-mode="free"]').getAttribute("aria-checked") === "true");
  assert.ok(await ap.isVisible("#resultEmpty"), "leerer Ergebnisbereich am Desktop");
  assert.equal(await ap.$$eval(".app-foot a[href='./impressum.html'], .app-foot a[href='./datenschutz.html']", (l) => l.length), 2, "Impressum/Datenschutz erreichbar");
  await ap.click("#sealBtn");
  await ap.waitForSelector("#formNote.err");
  await ap.fill("#msg", "WLAN: Kekse123");
  await ap.click("#pwGen");
  const pw = await ap.inputValue("#pw");
  assert.match(pw, /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/, "erzeugtes Passwort");
  await ap.screenshot({ path: path.join(OUT, "a1-app-free.png") });
  await ap.click("#sealBtn");
  await ap.waitForSelector("#resultFull", { state: "visible" });
  const freeLink = await ap.textContent("#outLink");
  assert.match(freeLink, /^http:\/\/127\.0\.0\.1:\d+\/#1[A-Za-z0-9_-]+$/);
  assert.equal(await ap.evaluate(() => navigator.clipboard.readText()), freeLink, "Link automatisch kopiert");
  assert.equal(await ap.textContent("#pwShow"), pw, "Passwort-Erinnerung");
  assert.equal(await ap.inputValue("#msg"), "", "Nachricht geleert");
  await ap.click("#qrBtn"); await ap.waitForSelector("#qr.show");
  await ap.screenshot({ path: path.join(OUT, "a2-app-free-result.png") });
  const rcv = await browser.newContext({ viewport: { width: 390, height: 844 } }); await perms(rcv);
  const fr = await rcv.newPage(); watch(fr, "free-recipient");
  await fr.goto(freeLink);
  await fr.fill("#rPass", pw); await fr.click("#rOpen");
  await fr.waitForSelector("#rReveal.shown");
  assert.equal(await fr.textContent("#rReveal"), "WLAN: Kekse123");
  step("App kostenlos: Passwort erzeugen, versiegeln, kopieren, QR, Empfänger entschlüsselt");

  /* ================= App: Pro ohne / mit Lizenz ================= */
  await ap.click('.mode button[data-mode="pro"]');
  await ap.waitForSelector("#proLock", { state: "visible" });
  assert.equal(await ap.isDisabled("#sealBtn"), true, "ohne Lizenz kein Versiegeln");
  await ap.click("#lockKey");
  await ap.fill("#licKey", "KUVERT-FALSCH-FALSCH"); await ap.click("#licBtn");
  await ap.waitForSelector("#licNote.err");
  await ap.fill("#licKey", LICENSE); await ap.click("#licBtn");
  await ap.waitForSelector("#licOn", { state: "visible" });
  await ap.waitForSelector("#proOpts", { state: "visible" });
  assert.match(await ap.textContent("#licChipText"), /Pro aktiv/);
  assert.ok(await ap.isVisible("#manageLink"), "Link zum Kundenportal");
  step("App Pro: Sperre ohne Lizenz, falscher Schlüssel abgelehnt, richtiger freigeschaltet");

  await ap.click("#newBtn");
  await ap.fill("#msg", "Server-Passwort: hunter2");
  await ap.fill("#pw", "kekse");
  await ap.selectOption("#ttl", "86400");
  await ap.fill("#notifyEmail", "absender@example.test");
  await ap.click("#sealBtn");
  await ap.waitForFunction(() => /Einmal-Kuvert bereit/.test(document.getElementById("resultTitle").textContent));
  const link = await ap.textContent("#outLink");
  assert.match(link, /\/pro\.html#p1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  assert.ok(await ap.isVisible("#proStatus"));
  assert.ok(await ap.isVisible("#sentSec"), "Liste „Deine Einmal-Kuverts“");
  await ap.screenshot({ path: path.join(OUT, "a3-app-pro-result.png"), fullPage: true });
  step("App Pro: Einmal-Kuvert hochgeladen, Live-Status und Liste sichtbar");

  /* ================= Empfänger (Pro) ================= */
  const rp = await rcv.newPage(); watch(rp, "recipient");
  await rp.goto(link);
  await rp.waitForSelector("#rPassBlock", { state: "visible" });
  await rp.fill("#rPass", "falsch"); await rp.click("#rOpen");
  await rp.waitForFunction(() => /Noch 4 Versuche/.test(document.getElementById("rNote").textContent));
  await rp.fill("#rPass", "kekse"); await rp.click("#rOpen");
  await rp.waitForSelector("#rRevealWrap", { state: "visible" });
  assert.equal(await rp.textContent("#rReveal"), "Server-Passwort: hunter2");
  assert.equal(new URL(rp.url()).hash, "", "Schlüssel aus der Adresszeile entfernt");
  await rp.screenshot({ path: path.join(OUT, "a4-recipient-open.png") });
  const rp2 = await rcv.newPage(); watch(rp2, "recipient2");
  await rp2.goto(link);
  await rp2.waitForFunction(() => document.getElementById("rTitle").textContent === "Bereits geöffnet");
  step("Empfänger: falsches Passwort, öffnen, zweites Öffnen „Bereits geöffnet“");

  await ap.click("#sentRefresh");
  await ap.waitForFunction(() => /Geöffnet am/.test(document.getElementById("liveText").textContent));
  await ap.waitForFunction(() => /Geöffnet am/.test(document.getElementById("sentList").textContent));
  await ap.click("#copyStatus");
  const statusLink = await ap.evaluate(() => navigator.clipboard.readText());
  const stp = await desk.newPage(); watch(stp, "status");
  await stp.goto(statusLink);
  await stp.waitForFunction(() => document.getElementById("rTitle").textContent === "Bereits geöffnet");
  step("Absender: „Geöffnet am …“ in App und Status-Link");

  await ap.click("#newBtn");
  await ap.fill("#msg", "wird zurückgezogen");
  await ap.click("#sealBtn");
  await ap.waitForFunction((old) => { const o = document.getElementById("outLink").textContent; return !document.getElementById("resultFull").hidden && o && o !== old; }, link);
  const link2 = await ap.textContent("#outLink");
  ap.once("dialog", (d) => d.accept());
  await ap.click("#sentList .sent-row:first-child .acts button:nth-child(2)");
  await ap.waitForFunction(() => /zurückgezogen/.test(document.getElementById("sentList").textContent));
  const rp3 = await rcv.newPage(); watch(rp3, "recipient3");
  await rp3.goto(link2);
  await rp3.waitForFunction(() => document.getElementById("rTitle").textContent === "Zurückgezogen");
  step("Zurückziehen: Empfänger sieht „Zurückgezogen“");

  /* ================= App auf dem Handy ================= */
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); await perms(phone);
  const mp = await phone.newPage(); watch(mp, "app-handy");
  await mp.goto(BASE + "/app");
  const bar = await mp.$eval(".app-actions", (el) => { const r = el.getBoundingClientRect(); return { bottom: Math.round(r.bottom), pos: getComputedStyle(el).position }; });
  assert.equal(bar.pos, "fixed"); assert.ok(bar.bottom >= 840, "Aktionsleiste unten am Daumen");
  assert.equal(await mp.isVisible("#resultCard"), false, "Ergebnis erst nach dem Versiegeln");
  await mp.screenshot({ path: path.join(OUT, "a5-app-mobile.png") });
  await mp.fill("#msg", "Handy-Test"); await mp.click("#sealBtn");
  await mp.waitForSelector("#resultCard.show");
  await mp.screenshot({ path: path.join(OUT, "a6-app-mobile-sheet.png") });
  await mp.click("#sheetClose");
  await mp.waitForSelector("#resultCard", { state: "hidden" });
  assert.ok((await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, "kein Querscrollen");
  step("App Handy: Aktionsleiste unten, Ergebnis als Blatt, schließbar");

  /* ================= Pro-Seite (Erklärung & Kauf) ================= */
  const pp = await desk.newPage(); watch(pp, "pro");
  await pp.goto(BASE + "/pro.html");
  await pp.waitForFunction(() => document.getElementById("heroBadge").textContent === "Jetzt verfügbar");
  assert.equal(await pp.$("#app"), null, "kein Werkzeug mehr auf der Pro-Seite");
  assert.equal(await pp.textContent("#planBuy"), "Zur App", "mit Lizenz führt der Knopf in die App");
  const anon = await browser.newContext(); const pp2 = await anon.newPage(); watch(pp2, "pro-anon");
  await pp2.goto(BASE + "/pro.html");
  await pp2.waitForFunction(() => document.getElementById("planBuy").href.includes("example.test/kaufen"));
  await pp2.goto(BASE + "/pro.html?checkout_id=test123");
  await pp2.waitForURL(/\/app\?/);
  await pp2.waitForFunction(() => /Danke für deinen Kauf/.test(document.getElementById("licNote").textContent));
  assert.ok(!new URL(pp2.url()).searchParams.has("checkout_id"));
  step("Pro-Seite: Kauf-Link, „Zur App“ mit Lizenz, Rückkehr vom Kauf landet in der App");

  const soon = await browser.newContext();
  await soon.route("**/api/index.php?a=config", async (route) => {
    const res = await route.fetch(); const json = await res.json();
    await route.fulfill({ response: res, json: { ...json, launched: false } });
  });
  const sp = await soon.newPage(); watch(sp, "soon");
  await sp.goto(BASE + "/pro.html");
  await sp.waitForFunction(() => document.getElementById("heroBadge").textContent === "Bald verfügbar");
  assert.ok(await sp.isVisible("#heroSoon"));
  await sp.goto(BASE + "/app");
  await sp.waitForFunction(() => /nicht verfügbar/.test(document.querySelector('.mode button[data-mode="pro"]').textContent));
  assert.equal(await sp.isVisible("#licBox"), false);
  step("Ohne Freischaltung: Pro-Seite „Bald verfügbar“, App nur kostenlos");

  /* ================= Gerätelimit (Polar-Nachbau, Limit 1) ================= */
  const KEY1 = "KUVERT-LIMIT-0001";
  const devA = await browser.newContext(); const pa = await devA.newPage(); watch(pa, "gerät-a");
  await pa.goto(BASE + "/app?mode=pro");
  await pa.fill("#licKey", KEY1); await pa.click("#licBtn");
  await pa.waitForSelector("#licOn", { state: "visible" });
  await pa.fill("#msg", "von Gerät A"); await pa.click("#sealBtn");
  await pa.waitForFunction(() => /Einmal-Kuvert bereit/.test(document.getElementById("resultTitle").textContent));
  const devB = await browser.newContext(); const pb = await devB.newPage(); watch(pb, "gerät-b");
  await pb.goto(BASE + "/app?mode=pro");
  await pb.fill("#licKey", KEY1); await pb.click("#licBtn");
  await pb.waitForFunction(() => /schon auf einem Gerät/.test(document.getElementById("licNote").textContent));
  assert.ok(await pb.isVisible("#licNote a.link"), "Link zum Kundenportal");
  await pa.click("#licRemove");
  await pa.waitForSelector("#licOff", { state: "visible" });
  await pb.click("#licBtn");
  await pb.waitForSelector("#licOn", { state: "visible" });
  step("Gerätelimit: zweites Gerät abgelehnt, nach Freigabe auf Gerät A frei");

  /* ================= Startseite ================= */
  const hp = await desk.newPage(); watch(hp, "start");
  await hp.goto(BASE + "/index.html");
  assert.equal(await hp.getAttribute(".nav-cta", "href"), "./app");
  await hp.fill("#secret", "hallo"); await hp.fill("#pass", "geheim");
  await hp.waitForFunction(() => document.getElementById("blob").textContent.startsWith("1"));
  const plain = await rcv.newPage(); watch(plain, "start-plain");
  await plain.goto(BASE + "/index.html#0" + Buffer.from("hallo welt").toString("base64url"));
  await plain.waitForSelector("#rReveal.shown");
  assert.equal(await plain.textContent("#rReveal"), "hallo welt");
  const anchor = await rcv.newPage(); watch(anchor, "anker");
  await anchor.goto(BASE + "/index.html#faq");
  assert.equal(await anchor.evaluate(() => document.body.classList.contains("recipient")), false);
  step("Startseite: Werkzeug, alte Links (#0/#1), Sprungmarken, Knopf zur App");

  const ph = await phone.newPage(); watch(ph, "start-handy");
  await ph.goto(BASE + "/index.html");
  assert.ok(await ph.isVisible(".nav-cta"), "„Schreiben“ auch auf dem Handy sichtbar");
  await ph.click(".menu-btn");
  await ph.waitForSelector("#mobileMenu", { state: "visible" });
  assert.deepEqual(await ph.$$eval("#mobileMenu a", (as) => as.map((a) => a.textContent)), ["So geht's", "Preise", "Pro", "FAQ", "Quelltext auf GitHub"]);
  assert.ok(!(await ph.isVisible("#themeToggle")), "Farbschema-Knopf auf dem Handy nur im Menü");
  const themeBefore = await ph.getAttribute("html", "data-theme");
  await ph.click("#mobileMenu .menu-theme");
  assert.notEqual(await ph.getAttribute("html", "data-theme"), themeBefore, "Umschalter im Menü wechselt das Farbschema");
  assert.ok(await ph.isVisible("#mobileMenu"), "Menü bleibt beim Umschalten offen");
  await ph.screenshot({ path: path.join(OUT, "a7-menu.png") });
  await ph.click("#mobileMenu a[href='#varianten']");
  await ph.waitForSelector("#mobileMenu", { state: "hidden" });
  assert.equal(await ph.$$eval(".plans .plan", (p) => p.length), 3);
  step("Startseite Handy: Menü mit Farbschema-Umschalter, Schreiben-Knopf, drei Preiskarten");

  /* ================= Teams ================= */
  const tp = await rcv.newPage(); watch(tp, "teams");
  await tp.goto(BASE + "/teams.html");
  await tp.fill("#tName", "Max Muster"); await tp.fill("#tCompany", "Muster AG");
  await tp.fill("#tEmail", "max@muster.test"); await tp.selectOption("#tSize", { index: 2 });
  await tp.click("#tSubmit");
  await tp.waitForFunction(() => /zustimmen/.test(document.getElementById("tNote").textContent));
  await tp.check("#tPrivacy"); await tp.click("#tSubmit");
  await tp.waitForSelector("#tDone", { state: "visible" });
  step("Teams: Formular prüft, sendet, zeigt Danke");

  assert.deepEqual(errors, [], "keine JS-Fehler");
  console.log("\nE2E: alles grün");
} catch (e) {
  console.error("E2E FEHLER:", e.message, errors);
  for (const ctx of browser.contexts()) for (const pg of ctx.pages()) {
    try { await pg.screenshot({ path: path.join(OUT, "fail-" + Math.random().toString(36).slice(2, 6) + ".png") }); console.error(" Seite:", pg.url()); } catch (_) {}
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
