// API-Test: echter Krypto-Ablauf (pro-crypto.js) gegen den laufenden PHP-Server.
// Aufruf über tests/run.sh (startet Server + legt Testlizenz an).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
await import(path.join(root, "pro-crypto.js"));
const C = globalThis.KuvertCrypto;

const BASE = process.env.KUVERT_BASE || "http://127.0.0.1:8099";
const LICENSE = process.env.KUVERT_LICENSE;
const API = BASE + "/api/index.php";

async function call(action, body, headers = {}) {
  const res = await fetch(API + "?a=" + action, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function create(text, pass, extra = {}) {
  const s = await C.seal(text, pass);
  const r = await call("create", {
    ciphertext: s.ciphertext, authHash: s.authHash, statusHash: s.statusHash,
    hasPassword: s.hasPassword, ttl: 3600, ...extra,
  }, { "X-Kuvert-License": LICENSE });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { ...s, id: r.data.id, res: r.data };
}

test("config ist öffentlich", async () => {
  const r = await call("config");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.ttlOptions));
});

test("API verrät die PHP-Version nicht", async () => {
  const res = await fetch(API + "?a=config");
  assert.equal(res.headers.get("x-powered-by"), null);
});

test("Lizenz: gültig und ungültig", async () => {
  assert.equal((await call("license", { key: LICENSE })).status, 200);
  const bad = await call("license", { key: "KUVERT-AAAAA-BBBBB-CCCCC-DDDDD" });
  assert.equal(bad.status, 403);
  assert.equal(bad.data.error.code, "license_invalid");
});

test("create ohne / mit falscher Lizenz wird abgelehnt", async () => {
  const s = await C.seal("x", "");
  const body = { ciphertext: s.ciphertext, authHash: s.authHash, statusHash: s.statusHash, ttl: 3600 };
  assert.equal((await call("create", body)).status, 402);
  assert.equal((await call("create", body, { "X-Kuvert-License": "KUVERT-NOPE1-NOPE2" })).status, 403);
});

test("ohne Passwort: einmal lesen, dann weg", async () => {
  const m = await create("Hallo Welt – äöü 🔐", "");
  const peek = await call("peek", { id: m.id });
  assert.deepEqual([peek.data.state, peek.data.hasPassword], ["waiting", false]);

  const k = await C.unlock(m.key, "");
  const r1 = await call("read", { id: m.id, token: k.token });
  assert.equal(r1.status, 200);
  assert.equal(await C.open(r1.data.ciphertext, k.encKey), "Hallo Welt – äöü 🔐");

  const r2 = await call("read", { id: m.id, token: k.token });
  assert.equal(r2.status, 410);
  assert.equal(r2.data.error.status.state, "read");

  const st = await call("status", { id: m.id, statusToken: m.statusToken });
  assert.equal(st.data.state, "read");
  assert.ok(st.data.readAt > 0);
});

test("mit Passwort: falsches Passwort gibt nichts heraus, richtiges schon", async () => {
  const m = await create("geheim", "kekse");
  const wrong = await C.unlock(m.key, "falsch");
  const w = await call("read", { id: m.id, token: wrong.token });
  assert.equal(w.status, 403);
  assert.equal(w.data.error.attemptsLeft, 4);
  assert.equal(w.data.ciphertext, undefined);

  const right = await C.unlock(m.key, "kekse");
  const r = await call("read", { id: m.id, token: right.token });
  assert.equal(r.status, 200);
  assert.equal(await C.open(r.data.ciphertext, right.encKey), "geheim");
});

test("5 falsche Passwörter vernichten die Nachricht", async () => {
  const m = await create("weg damit", "richtig", { notifyEmail: "absender@example.test" });
  const wrong = await C.unlock(m.key, "falsch");
  let last;
  for (let i = 0; i < 5; i++) last = await call("read", { id: m.id, token: wrong.token });
  assert.equal(last.status, 410);
  assert.equal(last.data.error.code, "destroyed");
  const right = await C.unlock(m.key, "richtig");
  assert.equal((await call("read", { id: m.id, token: right.token })).status, 410);
  assert.equal((await call("status", { id: m.id, statusToken: m.statusToken })).data.state, "destroyed");
});

test("Status-Link braucht das richtige Token; Zurückziehen funktioniert", async () => {
  const m = await create("zurück", "");
  const other = (await C.seal("y", "")).statusToken;
  assert.equal((await call("status", { id: m.id, statusToken: other })).status, 403);
  const rv = await call("revoke", { id: m.id, statusToken: m.statusToken });
  assert.equal(rv.data.state, "revoked");
  const k = await C.unlock(m.key, "");
  assert.equal((await call("read", { id: m.id, token: k.token })).status, 410);
});

test("gleichzeitiges Lesen: nur einer bekommt den Inhalt", async () => {
  const m = await create("nur einmal", "");
  const k = await C.unlock(m.key, "");
  const results = await Promise.all(Array.from({ length: 6 }, () => call("read", { id: m.id, token: k.token })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
});

test("E-Mail-Meldung wird verschickt und Adresse danach gelöscht", async () => {
  const m = await create("mit mail", "", { notifyEmail: "absender@example.test" });
  assert.equal(m.res.notify, true);
  const k = await C.unlock(m.key, "");
  assert.equal((await call("read", { id: m.id, token: k.token })).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  const log = readFileSync(path.join(root, "api/_data/mail.log"), "utf8");
  assert.match(log, /Dein Kuvert wurde geöffnet/);
  assert.match(log, new RegExp(m.id.slice(0, 6)));
  assert.doesNotMatch(log, /mit mail/);  // nie der Inhalt
  const st = await call("status", { id: m.id, statusToken: m.statusToken });
  assert.equal(st.data.notify, false);
});

test("Eingaben werden geprüft", async () => {
  const s = await C.seal("x", "");
  const base = { ciphertext: s.ciphertext, authHash: s.authHash, statusHash: s.statusHash, ttl: 3600 };
  const H = { "X-Kuvert-License": LICENSE };
  assert.equal((await call("create", { ...base, ttl: 99 }, H)).status, 400);
  assert.equal((await call("create", { ...base, authHash: "nope" }, H)).status, 400);
  assert.equal((await call("create", { ...base, notifyEmail: "kein-at" }, H)).status, 400);
  assert.equal((await call("peek", { id: "../../etc/passwd" })).status, 400);
  assert.equal((await call("peek", { id: "AAAAAAAAAAAAAAAAAAAAAA" })).data.state, "unknown");
  assert.equal((await call("nope")).status, 404);
  const big = "A".repeat(200000);
  assert.equal((await call("create", { ...base, ciphertext: big }, H)).status, 413);
});

/* ---------------- Gerätebegrenzung (Polar-Nachbau in tests/polar-mock.php) ---------------- */
const activate = (key, label = "Testgerät") => call("license", { key, label });
async function createWith(key, activationId) {
  const s = await C.seal("geräte-test", "");
  const headers = { "X-Kuvert-License": key };
  if (activationId) headers["X-Kuvert-Activation"] = activationId;
  return call("create", { ciphertext: s.ciphertext, authHash: s.authHash, statusHash: s.statusHash, ttl: 3600 }, headers);
}

test("Gerätelimit 3: drei Geräte ok, viertes abgelehnt, nach Freigabe wieder frei", async () => {
  const key = "KUVERT-LIMIT-0003";
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const r = await activate(key, "Gerät " + i);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.match(r.data.activationId, /^[0-9a-f-]{36}$/);
    ids.push(r.data.activationId);
  }
  const fourth = await activate(key, "Gerät 4");
  assert.equal(fourth.status, 409);
  assert.equal(fourth.data.error.code, "device_limit");
  assert.equal(fourth.data.error.limit, 3);

  // Bekanntes Gerät: prüfen statt neu aktivieren
  const again = await call("license", { key, activationId: ids[0] });
  assert.equal(again.status, 200);
  assert.equal(again.data.activationId, ids[0]);

  // Versenden mit Gerät klappt, ohne Gerät nicht
  assert.equal((await createWith(key, ids[1])).status, 200);
  const without = await createWith(key, null);
  assert.equal(without.status, 403);
  assert.equal(without.data.error.code, "activation_required");

  // Ein Gerät freigeben → viertes Gerät passt jetzt
  assert.equal((await call("deactivate", { key, activationId: ids[2] })).status, 200);
  assert.equal((await activate(key, "Gerät 4")).status, 200);
  // Das freigegebene Gerät gilt nicht mehr
  const gone = await createWith(key, ids[2]);
  assert.equal(gone.status, 403);
  assert.equal(gone.data.error.code, "activation_invalid");
});

test("Schlüssel ohne Gerätelimit funktioniert ohne Aktivierung", async () => {
  const r = await activate("KUVERT-NOLIM-0000");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.activationId, null);
  assert.equal((await createWith("KUVERT-NOLIM-0000", null)).status, 200);
});

test("Fremder Benefit und unbekannte Schlüssel werden abgelehnt", async () => {
  const other = await activate("KUVERT-OTHER-BENE");
  assert.equal(other.status, 403);
  assert.equal(other.data.error.code, "license_invalid");
  const unknown = await activate("KUVERT-GIBTS-NICHT");
  assert.equal(unknown.status, 403);
  // Der fremde Schlüssel darf dabei keinen Gerätplatz belegt haben
  const st = JSON.parse(readFileSync(path.join(root, "tests/.tmp/polar-state.json"), "utf8"));
  assert.equal(Object.keys(st["KUVERT-OTHER-BENE"] || {}).length, 0);
});

test("Ungültige Geräte-ID wird abgewiesen", async () => {
  assert.equal((await call("license", { key: "KUVERT-LIMIT-0003", activationId: "nope" })).status, 400);
  const r = await call("license", { key: "KUVERT-LIMIT-0003", activationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, "activation_invalid");
});

/* ---------------- Team-Anfragen (teams.html) ---------------- */
test("Team-Anfrage wird per Mail verschickt, mit Reply-To", async () => {
  const r = await call("inquiry", { name: "Anna Test", company: "Firma XY GmbH", email: "anna@firma.test", size: "6–20 Personen",
                                    message: "Wir wollen Kuvert für Kundenzugänge nutzen.", privacy: true, website: "" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await new Promise((res) => setTimeout(res, 300));
  const log = readFileSync(path.join(root, "api/_data/mail.log"), "utf8");
  assert.match(log, /Kuvert Teams – Anfrage von Firma XY GmbH/);
  assert.match(log, /Reply-To: anna@firma\.test/);
  assert.match(log, /Teamgröße: +6–20 Personen/);
});

test("Team-Anfrage: Pflichtfelder, Einwilligung und Spam-Schutz", async () => {
  const ok = { name: "A", company: "B", email: "a@b.test", size: "2–5 Personen", privacy: true };
  assert.equal((await call("inquiry", { ...ok, email: "kaputt" })).status, 400);
  assert.equal((await call("inquiry", { ...ok, company: "" })).status, 400);
  assert.equal((await call("inquiry", { ...ok, privacy: false })).data.error.code, "privacy_required");
  // Honigtopf ausgefüllt → antwortet „ok“, verschickt aber nichts
  const before = readFileSync(path.join(root, "api/_data/mail.log"), "utf8").length;
  assert.equal((await call("inquiry", { ...ok, company: "SPAMBOT", website: "http://spam.example" })).status, 200);
  const after = readFileSync(path.join(root, "api/_data/mail.log"), "utf8");
  assert.equal(after.length, before);
  assert.doesNotMatch(after, /SPAMBOT/);
});
