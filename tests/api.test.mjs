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
