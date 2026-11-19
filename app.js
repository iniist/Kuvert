/* Kuvert (kostenlos) – alles passiert im Browser, der Inhalt lebt nur im #-Fragment des Links.
   Linkformat (unverändert, damit alte Links weiter funktionieren):
     #0<base64url(text)>                         ohne Passwort (nur kodiert)
     #1<base64url(salt16 | iv12 | AES-GCM)>      mit Passwort (PBKDF2-SHA256, 600.000 Runden) */
(function () {
  "use strict";

  // Web Crypto gibt es nur in einem sicheren Kontext (https oder localhost).
  if (location.protocol === "http:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    location.replace("https://" + location.host + location.pathname + location.search + location.hash);
    return;
  }
  const SECURE = !!(window.crypto && window.crypto.subtle);
  const $ = (id) => document.getElementById(id);

  /* ---------------- Krypto ---------------- */
  const enc = new TextEncoder(), dec = new TextDecoder();
  function bytesToB64url(bytes) { let bin = ""; bytes.forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
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
  const BASE = location.origin + location.pathname + "#";

  /* ---------------- Hilfen ---------------- */
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (_) {}
      ta.remove(); return ok;
    }
  }
  let toastT = null;
  function toast(msg) { const t = $("toast"); if (!t) return; t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600); }

  const IC_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const IC_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 13.5a4 4 0 0 0 6 0l2.5-2.5a4 4 0 1 0-5.7-5.7l-1.3 1.3"/><path d="M14.5 10.5a4 4 0 0 0-6 0L6 13a4 4 0 1 0 5.7 5.7l1.3-1.3"/></svg>';
  const IC_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

  /* ---------------- Absender ---------------- */
  const el = {
    secret: $("secret"), pass: $("pass"), blob: $("blob"), counter: $("counter"), out: $("out"), outLink: $("outLink"),
    seal: $("seal"), chip: $("stateChip"), stateTxt: $("stateTxt"), passWrap: $("passWrap"), passNote: $("passNote"), charHint: $("charHint"),
    qr: $("qr"), qrBtn: $("qrBtn"), qrCanvas: $("qrCanvas"), qrDownload: $("qrDownload"), qrNote: $("qrNote"),
    copyBtn: $("copyBtn"), copyIc: $("copyIc"), copyTxt: $("copyTxt"), caption: $("linkCaption"),
  };
  let currentBlob = "0", prevSealed = null, t = null, runId = 0, busy = false;

  function caption(msg) { el.caption.textContent = msg || ""; el.caption.hidden = !msg; }

  function renderQR(link) {
    if (typeof window.qrcode === "undefined") { el.qrNote.textContent = "QR-Bibliothek nicht geladen."; el.qrDownload.hidden = true; return; }
    let qr = null;
    for (let type = 1; type <= 40; type++) {
      try { qr = window.qrcode(type, "L"); qr.addData(link); qr.make(); break; }
      catch (e) { qr = null; if (String(e).indexOf("overflow") === -1) break; }
    }
    if (!qr) { el.qrCanvas.style.visibility = "hidden"; el.qrDownload.hidden = true; el.qrNote.textContent = "Link zu lang für einen QR-Code. Nutz den Link direkt."; return; }
    const count = qr.getModuleCount(), margin = 2, cell = 6, size = (count + margin * 2) * cell;
    const cv = el.qrCanvas; cv.width = size; cv.height = size;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, size, size); ctx.fillStyle = "#0a0a0c";
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    cv.style.visibility = "visible"; el.qrDownload.hidden = false; el.qrNote.textContent = "Scannen führt direkt zur Nachricht.";
  }

  /* Sofortiges Feedback ohne Verschlüsselung (Siegel, Hinweise, Button) */
  function refreshControls() {
    const sealed = !!el.pass.value;
    el.seal.classList.toggle("on", sealed); el.chip.classList.toggle("on", sealed); el.passWrap.classList.toggle("on", sealed);
    el.stateTxt.textContent = sealed ? "Versiegelt" : "Offen";
    el.passNote.textContent = sealed ? "Verschlüsselt. Nur mit diesem Passwort lesbar." : "Ohne Passwort kann jeder mit dem Link mitlesen.";
    el.passNote.className = "field-note " + (sealed ? "ok" : "warn");
    if (sealed && prevSealed === false) { el.seal.classList.remove("press"); void el.seal.offsetWidth; el.seal.classList.add("press"); }
    if (!busy && !el.copyBtn.classList.contains("done")) {
      el.copyIc.innerHTML = sealed ? IC_LOCK : IC_LINK;
      el.copyTxt.textContent = sealed ? "Versiegeln & kopieren" : "Link kopieren";
    }
    const n = el.secret.value.length;
    el.charHint.textContent = n + " / 900";
    el.out.classList.toggle("has", n > 0);
    prevSealed = sealed;
  }

  function schedule() { refreshControls(); if (t) clearTimeout(t); t = setTimeout(update, 220); }

  /* Baut den (ggf. verschlüsselten) Link. currentBlob ist die einzige Quelle für Vorschau, QR und Kopieren. */
  async function update() {
    const myRun = ++runId, sealWanted = !!el.pass.value;
    let blob;
    try { blob = await buildBlob(el.secret.value, el.pass.value); }
    catch (e) {
      if (myRun !== runId) return;
      if (sealWanted) { currentBlob = null; el.blob.textContent = "—"; el.counter.textContent = ""; caption("Verschlüsselung nicht verfügbar. Bitte die Seite über https:// öffnen."); }
      return;
    }
    if (myRun !== runId) return;
    currentBlob = blob;
    el.blob.textContent = blob;
    el.blob.classList.remove("flash"); void el.blob.offsetWidth; el.blob.classList.add("flash");
    const link = BASE + blob, total = link.length;
    el.counter.textContent = total.toLocaleString("de-DE") + " Zeichen";
    el.counter.classList.toggle("warn", total > 1600);
    el.outLink.classList.toggle("fade", el.outLink.scrollHeight > el.outLink.clientHeight + 2);
    caption(total > 1900 ? "Sehr lang: Manche Apps kürzen so lange Links. Kürze die Nachricht, wenn möglich." : "");
    if (el.qr.classList.contains("show")) renderQR(link);
  }

  el.secret.addEventListener("input", schedule);
  el.pass.addEventListener("input", schedule);

  el.copyBtn.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    const sealWanted = !!el.pass.value;
    if (sealWanted) el.copyTxt.textContent = "Versiegle …";
    if (t) { clearTimeout(t); t = null; }
    try { await update(); } catch (e) {}
    // Sicherheit: Mit Passwort wird nie ein unverschlüsselter Link kopiert.
    if (sealWanted && (!currentBlob || currentBlob.charAt(0) !== "1")) {
      el.copyTxt.textContent = "Nur über https://";
      caption("Verschlüsselung nicht verfügbar. Öffne die Seite über https://, dann klappt das Versiegeln.");
      setTimeout(() => { busy = false; refreshControls(); }, 2600);
      return;
    }
    if (!el.secret.value) { toast("Schreib zuerst eine Nachricht."); el.secret.focus(); busy = false; refreshControls(); return; }
    const ok = await copyText(BASE + currentBlob);
    el.copyIc.innerHTML = IC_CHECK; el.copyTxt.textContent = ok ? "Kopiert" : "Bitte manuell kopieren"; el.copyBtn.classList.add("done");
    if (ok) toast(sealWanted ? "Versiegelt und kopiert. Passwort separat schicken!" : "Link kopiert");
    setTimeout(() => { el.copyBtn.classList.remove("done"); busy = false; refreshControls(); }, 1700);
  });

  el.qrBtn.addEventListener("click", () => {
    const show = !el.qr.classList.contains("show");
    el.qr.classList.toggle("show", show); el.qrBtn.setAttribute("aria-expanded", String(show));
    if (show && currentBlob) renderQR(BASE + currentBlob);
  });
  el.qrDownload.addEventListener("click", () => {
    try { const a = document.createElement("a"); a.href = el.qrCanvas.toDataURL("image/png"); a.download = "kuvert-qr.png"; document.body.appendChild(a); a.click(); a.remove(); } catch (e) {}
  });
  $("exampleBtn").addEventListener("click", () => {
    el.secret.value = "Der Adler landet um 18 Uhr. Bring die Kekse. Wenn jemand fragt: Du weißt von nichts.";
    el.pass.value = "kekse"; schedule(); el.secret.focus();
  });

  /* ---------------- Empfänger ---------------- */
  const R = {
    seal: $("rSeal"), title: $("rTitle"), sub: $("rSub"), passBlock: $("rPassBlock"), pass: $("rPass"), open: $("rOpen"),
    reveal: $("rReveal"), note: $("rNote"), after: $("rAfter"), copy: $("rCopy"),
  };
  const REDACTED = '<div class="redacted"><span></span><span></span><span></span></div>';
  let rText = "";

  function recipientShow(text, encrypted) {
    rText = text;
    R.passBlock.style.display = "none";
    R.seal.classList.remove("on"); R.seal.classList.add("open", "press");
    R.title.textContent = "Geöffnet";
    R.sub.textContent = encrypted ? "Entschlüsselt in deinem Browser. Der Inhalt kam komplett aus dem Link." : "Diese Nachricht war nicht verschlüsselt. Der Inhalt kam komplett aus dem Link.";
    R.note.textContent = ""; R.note.className = "note";
    R.reveal.className = "reveal shown"; R.reveal.textContent = text; R.after.style.display = "flex";
  }
  function recipientFail(msg) {
    R.reveal.className = "reveal"; R.reveal.innerHTML = REDACTED;
    R.note.textContent = msg; R.note.className = "note err";
  }
  async function recipientTryDecrypt(hash) {
    if (!SECURE) { recipientFail("Zum Entschlüsseln bitte die Seite über https:// öffnen."); return; }
    if (!R.pass.value) { recipientFail("Bitte das Passwort eingeben."); R.pass.focus(); return; }
    R.open.disabled = true; R.open.textContent = "Öffne …";
    try { const res = await readBlob(hash, R.pass.value); recipientShow(res.text, true); }
    catch (e) { recipientFail("Falsches Passwort. Bitte erneut versuchen."); R.pass.select(); }
    finally { R.open.disabled = false; R.open.textContent = "Öffnen"; }
  }
  R.copy.addEventListener("click", async () => { if (await copyText(rText)) toast("Inhalt kopiert"); });
  $("createOwn").addEventListener("click", (ev) => {
    ev.preventDefault();
    document.body.classList.remove("recipient");
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    el.secret.value = ""; el.pass.value = ""; schedule();
    window.scrollTo({ top: 0 }); el.secret.focus();
  });

  function initRecipient(hash) {
    document.body.classList.add("recipient");
    const flag = hash[0];
    if (flag === "0") {
      readBlob(hash, "").then((res) => recipientShow(res.text, false)).catch(() => {
        R.passBlock.style.display = "none"; R.title.textContent = "Ungültiger Link"; R.sub.textContent = "Dieser Link ist unvollständig oder beschädigt.";
      });
    } else if (flag === "1") {
      R.open.addEventListener("click", () => recipientTryDecrypt(hash));
      R.pass.addEventListener("keydown", (e) => { if (e.key === "Enter") recipientTryDecrypt(hash); });
      setTimeout(() => R.pass.focus(), 150);
    }
  }

  /* ---------------- Start ---------------- */
  $("linkBase").textContent = BASE;
  // Kuvert-Links beginnen mit 0 oder 1; alles andere (#faq, #so …) sind normale Sprungmarken.
  const hash = location.hash.slice(1);
  if (/^[01]/.test(hash)) initRecipient(hash);
  else { refreshControls(); update(); }
  // Wird ein Kuvert-Link in diesem Tab geöffnet, neu laden statt alten Zustand zu zeigen.
  window.addEventListener("hashchange", () => { if (/^#[01]/.test(location.hash)) location.reload(); });
})();
