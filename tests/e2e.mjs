// Browser-Test des kompletten Pro-Ablaufs (Absender → Empfänger → Status).
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
  page.on("console", (m) => { if (m.type() === "error" && !/status of (403|409|410)/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
};
const step = (s) => console.log("✓", s);

try {
  /* ---------- Absender ---------- */
  const sender = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await sender.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const sp = await sender.newPage(); watch(sp, "sender");
  await sp.goto(BASE + "/pro.html");
  await sp.waitForFunction(() => document.getElementById("buyLink").style.display !== "none");
  step("Pro-Seite lädt, Kauf-Link aus config sichtbar");

  await sp.fill("#secret", "Server-Passwort: hunter2");
  await sp.click("#sendBtn");
  await sp.waitForSelector("#formNote.err");
  assert.match(await sp.textContent("#formNote"), /Lizenzschlüssel/);
  step("ohne Lizenz: Hinweis statt Upload");

  await sp.fill("#licKey", "KUVERT-FALSCH-FALSCH");
  await sp.click("#licBtn");
  await sp.waitForSelector("#licNote.err");
  await sp.fill("#licKey", LICENSE);
  await sp.click("#licBtn");
  await sp.waitForSelector("#licActive", { state: "visible" });
  assert.ok(await sp.isVisible("#manageLink"), "Link zum Kundenportal sichtbar");
  step("Lizenz: falsch abgelehnt, richtig freigeschaltet");

  await sp.fill("#pass", "kekse");
  await sp.selectOption("#ttl", "86400");
  await sp.fill("#notifyEmail", "absender@example.test");
  await sp.screenshot({ path: path.join(OUT, "1-sender-compose.png"), fullPage: false });
  await sp.click("#sendBtn");
  await sp.waitForSelector("#result.show");
  const link = await sp.textContent("#outLink");
  const statusLink = await sp.textContent("#outStatus");
  assert.match(link, /\/pro\.html#p1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  assert.match(statusLink, /#s1\./);
  assert.equal(await sp.inputValue("#secret"), "", "Nachricht wird nach dem Hochladen geleert");
  assert.equal(await sp.evaluate(() => navigator.clipboard.readText()), link);
  assert.ok(await sp.isVisible("#sentSec"));
  await sp.screenshot({ path: path.join(OUT, "2-sender-result.png"), fullPage: false });
  step("versiegelt & hochgeladen, Link kopiert, Liste sichtbar");

  /* ---------- Empfänger ---------- */
  const rcv = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await rcv.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const rp = await rcv.newPage(); watch(rp, "recipient");
  await rp.goto(link);
  await rp.waitForSelector("#rPassBlock", { state: "visible" });
  assert.equal(await rp.textContent("#rTitle"), "Jemand hat dir ein Kuvert geschickt");
  await rp.screenshot({ path: path.join(OUT, "3-recipient-locked.png") });

  await rp.fill("#rPass", "falsch");
  await rp.click("#rOpen");
  await rp.waitForFunction(() => /Noch 4 Versuche/.test(document.getElementById("rNote").textContent));
  step("Empfänger: falsches Passwort → Noch 4 Versuche");

  await rp.fill("#rPass", "kekse");
  await rp.click("#rOpen");
  await rp.waitForSelector("#rRevealWrap", { state: "visible" });
  assert.equal(await rp.textContent("#rReveal"), "Server-Passwort: hunter2");
  assert.equal(new URL(rp.url()).hash, "", "Schlüssel wird aus der Adresszeile entfernt");
  await rp.screenshot({ path: path.join(OUT, "4-recipient-open.png") });
  step("Empfänger: geöffnet und entschlüsselt, Hash entfernt");

  const rp2 = await rcv.newPage(); watch(rp2, "recipient2");
  await rp2.goto(link);
  await rp2.waitForFunction(() => document.getElementById("rTitle").textContent === "Bereits geöffnet");
  assert.ok(await rp2.isVisible("#rWarn"));
  await rp2.screenshot({ path: path.join(OUT, "5-recipient-already.png") });
  step("zweites Öffnen: „Bereits geöffnet“ + Warnung");

  /* ---------- zurück beim Absender ---------- */
  await sp.click("#sentRefresh");
  await sp.waitForFunction(() => /Geöffnet am/.test(document.getElementById("sentList").textContent));
  await sp.waitForFunction(() => /Geöffnet am/.test(document.getElementById("liveText").textContent));
  step("Absender sieht „Geöffnet am …“ (Liste + Live-Status)");

  const stp = await sender.newPage(); watch(stp, "status");
  await stp.goto(statusLink);
  await stp.waitForFunction(() => document.getElementById("rTitle").textContent === "Bereits geöffnet");
  await stp.screenshot({ path: path.join(OUT, "6-status.png") });
  step("Status-Link zeigt Zustand");

  /* ---------- Zurückziehen ---------- */
  await sp.click("#newBtn");
  await sp.fill("#secret", "wird zurückgezogen");
  await sp.click("#sendBtn");
  await sp.waitForSelector("#result.show");
  const link2 = await sp.textContent("#outLink");
  sp.once("dialog", (d) => d.accept());
  await sp.click("#sentList .sent-row:first-child .acts button:nth-child(2)");
  await sp.waitForFunction(() => /zurückgezogen/.test(document.getElementById("sentList").textContent));
  const rp3 = await rcv.newPage(); watch(rp3, "recipient3");
  await rp3.goto(link2);
  await rp3.waitForFunction(() => document.getElementById("rTitle").textContent === "Zurückgezogen");
  step("Zurückziehen: Empfänger sieht „Zurückgezogen“");

  /* ---------- kostenlose Seite: versiegeln, öffnen ---------- */
  const fp = await sender.newPage(); watch(fp, "free");
  await fp.goto(BASE + "/index.html");
  const radius = await fp.evaluate(() => getComputedStyle(document.getElementById("tool")).borderTopLeftRadius);
  assert.equal(radius, "22px", "kuvert.css ist geladen");
  await fp.fill("#secret", "WLAN: Kekse123");
  await fp.fill("#pass", "geheim");
  await fp.waitForFunction(() => document.getElementById("blob").textContent.startsWith("1"));
  await fp.click("#qrBtn");
  await fp.waitForSelector("#qr.show");
  await fp.screenshot({ path: path.join(OUT, "7-free.png") });
  await fp.click("#copyBtn");
  await fp.waitForSelector("#copyBtn.done");
  const freeLink = await fp.evaluate(() => navigator.clipboard.readText());
  assert.match(freeLink, /\/index\.html#1[A-Za-z0-9_-]+$/);
  const fr = await rcv.newPage(); watch(fr, "free-recipient");
  await fr.goto(freeLink);
  await fr.waitForSelector("body.recipient");
  await fr.fill("#rPass", "falsch"); await fr.click("#rOpen");
  await fr.waitForSelector("#rNote.err");
  await fr.fill("#rPass", "geheim"); await fr.click("#rOpen");
  await fr.waitForSelector("#rReveal.shown");
  assert.equal(await fr.textContent("#rReveal"), "WLAN: Kekse123");
  step("kostenlos: versiegeln, kopieren, falsches/richtiges Passwort");

  const plainPage = await rcv.newPage(); watch(plainPage, "free-plain");
  await plainPage.goto(BASE + "/index.html#0" + Buffer.from("hallo welt").toString("base64url"));
  await plainPage.waitForSelector("#rReveal.shown");
  assert.equal(await plainPage.textContent("#rReveal"), "hallo welt");
  const anchor = await rcv.newPage(); watch(anchor, "anchor");
  await anchor.goto(BASE + "/index.html#faq");
  assert.equal(await anchor.evaluate(() => document.body.classList.contains("recipient")), false, "#faq ist kein Kuvert-Link");
  step("kostenlos: unverschlüsselter Link + Sprungmarken");

  /* ---------- Pro „Bald verfügbar“, wenn nicht freigeschaltet ---------- */
  const soonCtx = await browser.newContext();
  await soonCtx.route("**/api/index.php?a=config", async (route) => {
    const res = await route.fetch(); const json = await res.json();
    await route.fulfill({ response: res, json: { ...json, launched: false } });
  });
  const sp2 = await soonCtx.newPage(); watch(sp2, "soon");
  await sp2.goto(BASE + "/pro.html");
  await sp2.waitForFunction(() => document.getElementById("heroBadge").textContent === "Bald verfügbar");
  await sp2.waitForTimeout(300);
  assert.equal(await sp2.isVisible("#app"), false, "Pro-App versteckt");
  assert.ok(await sp2.isVisible("#heroSoon"));
  await sp2.screenshot({ path: path.join(OUT, "9-pro-soon.png") });
  await sp2.goto(BASE + "/pro.html?preview");
  await sp2.waitForSelector("#app", { state: "visible" });
  assert.equal(await sp2.textContent("#heroBadge"), "Vorschau");
  await sp2.goto(BASE + "/pro.html?preview&checkout_id=test123");
  await sp2.waitForFunction(() => /Danke für deinen Kauf/.test(document.getElementById("licNote").textContent));
  assert.ok(!new URL(sp2.url()).searchParams.has("checkout_id"), "checkout_id wird aus der Adresse entfernt");
  assert.ok(new URL(sp2.url()).searchParams.has("preview"));
  step("Pro: „Bald verfügbar“, mit ?preview testbar, Danke-Hinweis nach Kauf");

  /* ---------- Gerätebegrenzung im Browser (Polar-Nachbau, Schlüssel mit Limit 1) ---------- */
  const KEY1 = "KUVERT-LIMIT-0001";
  const devA = await browser.newContext(); const pa = await devA.newPage(); watch(pa, "gerät-a");
  await pa.goto(BASE + "/pro.html");
  await pa.fill("#licKey", KEY1); await pa.click("#licBtn");
  await pa.waitForSelector("#licActive", { state: "visible" });
  assert.match(await pa.evaluate(() => localStorage.getItem("kuvert-pro-activation") || ""), /^[0-9a-f-]{36}$/);
  await pa.fill("#secret", "von Gerät A"); await pa.click("#sendBtn");
  await pa.waitForSelector("#result.show");
  const devB = await browser.newContext(); const pb = await devB.newPage(); watch(pb, "gerät-b");
  await pb.goto(BASE + "/pro.html");
  await pb.fill("#licKey", KEY1); await pb.click("#licBtn");
  await pb.waitForFunction(() => /schon auf einem Gerät/.test(document.getElementById("licNote").textContent));
  assert.ok(await pb.isVisible("#licNote a.link"), "Link zum Kundenportal");
  await pb.screenshot({ path: path.join(OUT, "10-device-limit.png") });
  await pa.click("#licRemove");
  await pa.waitForSelector("#licForm", { state: "visible" });
  await pb.click("#licBtn");
  await pb.waitForSelector("#licActive", { state: "visible" });
  step("Gerätelimit: zweites Gerät abgelehnt, nach Freigabe auf Gerät A frei");

  /* ---------- Mobiles Menü und Preiskarten ---------- */
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ph = await phone.newPage(); watch(ph, "handy");
  await ph.goto(BASE + "/index.html");
  assert.equal(await ph.isVisible("#nav a.nl"), false, "Textlinks auf dem Handy versteckt");
  await ph.click(".menu-btn");
  await ph.waitForSelector("#mobileMenu", { state: "visible" });
  const items = await ph.$$eval("#mobileMenu a", (as) => as.map((a) => a.textContent));
  assert.deepEqual(items, ["So geht's", "Preise", "Pro", "FAQ", "Quelltext auf GitHub"]);
  await ph.screenshot({ path: path.join(OUT, "11-menu.png") });
  await ph.click("#mobileMenu a[href='#varianten']");
  await ph.waitForSelector("#mobileMenu", { state: "hidden" });
  assert.equal(await ph.$$eval(".plans .plan", (p) => p.length), 3);
  assert.match(await ph.textContent("#teams"), /Auf Anfrage/);
  assert.match(await ph.textContent(".plan.pro .price"), /inkl\. MwSt\./);
  assert.equal(await ph.$$eval(".pill-tag", (p) => p.length), 0, "kein „Neu“ mehr");
  await ph.keyboard.press("Escape");
  const dk = await sender.newPage(); watch(dk, "desktop-nav");
  await dk.goto(BASE + "/index.html");
  assert.equal(await dk.isVisible(".menu-btn"), false, "Menü-Knopf nur auf dem Handy");
  step("Handy-Menü, drei Preiskarten, MwSt.-Hinweis, kein „Neu“");

  const mob = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const mp = await mob.newPage(); watch(mp, "mobile");
  await mp.goto(BASE + "/pro.html");
  await mp.waitForTimeout(400);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, "kein horizontales Scrollen auf dem Handy (" + overflow + "px)");
  await mp.screenshot({ path: path.join(OUT, "8-mobile.png"), fullPage: true });
  step("mobil: kein horizontales Scrollen");

  assert.deepEqual(errors, [], "keine JS-Fehler");
  console.log("\nE2E: alles grün");
} catch (e) {
  console.error("E2E FEHLER:", e.message, errors);
  for (const ctx of browser.contexts()) for (const pg of ctx.pages()) { try { await pg.screenshot({ path: path.join(OUT, "fail-" + Math.random().toString(36).slice(2, 6) + ".png") }); console.error(" Seite:", pg.url(), await pg.evaluate(() => [document.readyState, document.body.className, (document.getElementById("rTitle")||{}).textContent, (document.getElementById("rNote")||{}).textContent, ["rPassBlock","rOpenBlock","rOnce"].map(i => { const e = document.getElementById(i); return e ? i + ":" + getComputedStyle(e).display + ":" + JSON.stringify(e.getBoundingClientRect()) : i; }), innerWidth, innerHeight, document.visibilityState])); } catch (_) {} }
  process.exitCode = 1;
} finally {
  await browser.close();
}
