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
  page.on("console", (m) => { if (m.type() === "error" && !/status of (403|410)/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
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

  /* ---------- kostenlose Seite unverändert funktionsfähig ---------- */
  const fp = await sender.newPage(); watch(fp, "free");
  await fp.goto(BASE + "/index.html");
  await fp.fill("#secret", "hallo");
  await fp.waitForFunction(() => document.getElementById("blob").textContent.startsWith("0"));
  const bg = await fp.evaluate(() => getComputedStyle(document.querySelector(".tool")).borderTopStyle);
  assert.equal(bg, "solid", "kuvert.css ist geladen");
  await fp.screenshot({ path: path.join(OUT, "7-free.png") });
  step("kostenlose Seite funktioniert mit ausgelagertem CSS");

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
  process.exitCode = 1;
} finally {
  await browser.close();
}
