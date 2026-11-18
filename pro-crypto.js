/*
 * Kuvert Pro – Kryptografie (läuft komplett im Browser, Web Crypto API).
 *
 *   K      = 32 zufällige Bytes, stehen NUR im #-Fragment des Links
 *   ikm    = K                          (ohne Passwort)
 *          = K || PBKDF2(Passwort, salt=K, 600.000, SHA-256)   (mit Passwort)
 *   encKey = HKDF-SHA256(ikm, salt="kuvert-pro-v1", info="enc")  → AES-GCM-256
 *   token  = HKDF-SHA256(ikm, salt="kuvert-pro-v1", info="auth") → 32 Bytes
 *
 * Der Server bekommt beim Erstellen nur Chiffretext und SHA-256(token).
 * Zum Abholen muss der Empfänger das token vorlegen – das geht nur mit K (und ggf. Passwort).
 * So kann der Server falsche Passwörter ablehnen, OHNE den Inhalt herauszugeben,
 * und niemand kann den Chiffretext offline gegen Passwörter testen.
 */
(function (root) {
  "use strict";
  const enc = new TextEncoder(), dec = new TextDecoder();
  const SALT = enc.encode("kuvert-pro-v1");
  const AAD = enc.encode("kuvert-pro-v1");
  const subtle = () => {
    if (!(root.crypto && root.crypto.subtle)) throw new Error("subtle-unavailable");
    return root.crypto.subtle;
  };

  function b64u(bytes) {
    let bin = "";
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(s) {
    if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("bad-b64");
    let t = s.replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    const bin = atob(t);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  function hex(buf) {
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  function random(n) {
    return root.crypto.getRandomValues(new Uint8Array(n));
  }
  async function sha256hex(bytes) {
    return hex(await subtle().digest("SHA-256", bytes));
  }

  async function deriveKeys(K, pass) {
    const s = subtle();
    let ikm = K;
    if (pass) {
      const base = await s.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
      const P = new Uint8Array(await s.deriveBits({ name: "PBKDF2", salt: K, iterations: 600000, hash: "SHA-256" }, base, 256));
      ikm = new Uint8Array(64);
      ikm.set(K, 0);
      ikm.set(P, 32);
    }
    const hk = await s.importKey("raw", ikm, "HKDF", false, ["deriveKey", "deriveBits"]);
    const encKey = await s.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode("enc") },
      hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
    const token = new Uint8Array(await s.deriveBits({ name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode("auth") }, hk, 256));
    return { encKey, token };
  }

  /** Verschlüsselt text. Liefert alles, was Server und Link brauchen. */
  async function seal(text, pass) {
    const K = random(32);
    const { encKey, token } = await deriveKeys(K, pass || "");
    const iv = random(12);
    const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: AAD }, encKey, enc.encode(text)));
    const blob = new Uint8Array(12 + ct.length);
    blob.set(iv, 0);
    blob.set(ct, 12);
    const statusToken = random(32);
    return {
      key: b64u(K),
      ciphertext: b64u(blob),
      authHash: await sha256hex(token),
      statusToken: b64u(statusToken),
      statusHash: await sha256hex(statusToken),
      hasPassword: !!pass,
    };
  }

  /** Leitet aus Link-Schlüssel (+ Passwort) das Abhol-Token und den Entschlüsselungsschlüssel ab. */
  async function unlock(keyB64, pass) {
    const K = unb64u(keyB64);
    if (K.length !== 32) throw new Error("bad-key");
    const { encKey, token } = await deriveKeys(K, pass || "");
    return { encKey, token: b64u(token) };
  }

  async function open(ciphertextB64, encKey) {
    const raw = unb64u(ciphertextB64);
    const iv = raw.slice(0, 12), ct = raw.slice(12);
    const plain = await subtle().decrypt({ name: "AES-GCM", iv, additionalData: AAD }, encKey, ct);
    return dec.decode(plain);
  }

  /* Link-Formate (alles hinter # bleibt im Browser):
       Empfänger:  pro.html#p1.<id>.<K>
       Absender:   pro.html#s1.<id>.<statusToken>          */
  function parseFragment(hash) {
    const h = (hash || "").replace(/^#/, "");
    const m = /^(p1|s1)\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(h);
    if (!m) return null;
    return { kind: m[1] === "p1" ? "recipient" : "status", id: m[2], secret: m[3] };
  }

  root.KuvertCrypto = { seal, unlock, open, parseFragment, b64u, unb64u, sha256hex };
})(typeof window !== "undefined" ? window : globalThis);
