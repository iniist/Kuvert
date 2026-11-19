/* Kuvert (kostenlos) – Verschlüsselung im Browser. Der Inhalt lebt nur im #-Fragment des Links.
   Linkformat (unverändert, damit alte Links weiter funktionieren):
     #0<base64url(text)>                         ohne Passwort (nur kodiert)
     #1<base64url(salt16 | iv12 | AES-GCM)>      mit Passwort (PBKDF2-SHA256, 600.000 Runden)
   Genutzt von home.js (Startseite) und app.js (App). */
(function (root) {
  "use strict";
  const enc = new TextEncoder(), dec = new TextDecoder();
  const SECURE = !!(root.crypto && root.crypto.subtle);

  function bytesToB64url(bytes) { let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function b64urlToBytes(b64) { let s = b64.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); }

  async function deriveKey(pass, salt) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function buildBlob(message, pass) {
    if (!pass) return "0" + bytesToB64url(enc.encode(message));
    if (!SECURE) throw new Error("subtle-unavailable");
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(message)));
    const out = new Uint8Array(28 + cipher.length); out.set(salt, 0); out.set(iv, 16); out.set(cipher, 28);
    return "1" + bytesToB64url(out);
  }
  async function readBlob(blob, pass) {
    const flag = blob[0], body = blob.slice(1);
    if (flag === "0") return { encrypted: false, text: dec.decode(b64urlToBytes(body)) };
    if (flag === "1") {
      const raw = b64urlToBytes(body), salt = raw.slice(0, 16), iv = raw.slice(16, 28), cipher = raw.slice(28);
      const key = await deriveKey(pass || "", salt);
      return { encrypted: true, text: dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher)) };
    }
    throw new Error("unknown");
  }
  root.KuvertFree = { buildBlob, readBlob, SECURE, MAX_CHARS: 900 };
})(typeof window !== "undefined" ? window : globalThis);
