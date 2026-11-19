/* Kuvert – App (app.html): ein Werkzeug für Link-Kuverts (kostenlos) und Einmal-Kuverts (Pro).
   Bausteine: free-crypto.js (KuvertFree), pro-crypto.js (KuvertCrypto), pro-core.js (KuvertPro). */
(function () {
  "use strict";
  if (location.protocol === "http:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    location.replace("https://" + location.host + location.pathname + location.search + location.hash);
    return;
  }
  const F = window.KuvertFree, C = window.KuvertCrypto, P = window.KuvertPro;
  const $ = (id) => document.getElementById(id);
  const HOME = new URL("./", location.href.split("#")[0]).toString();       // Empfänger für Link-Kuverts
  const mqMobile = window.matchMedia("(max-width: 860px)");
  const canShare = typeof navigator.share === "function";

  let cfg = { launched: false, buyUrl: "", manageUrl: "", mail: false, maxMessageChars: 20000, ttlOptions: [3600, 86400, 604800, 2592000], defaultTtl: 86400 };
  let proAvailable = false, mode = "free", busy = false, current = null, lastLink = "", lastPw = "", lastPro = false;

  const IC_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const note = (msg, kind) => P.note($("formNote"), msg, kind);
  const licNote = (msg, kind) => P.note($("licNote"), msg, kind);

  /* ---------------- Modus ---------------- */
  function setMode(m, save) {
    mode = m === "pro" && proAvailable ? "pro" : "free";
    if (save) P.store.set(P.LS.mode, mode);
    document.querySelectorAll(".mode button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === mode)));
    const hasLic = !!P.license.key();
    const max = mode === "pro" ? cfg.maxMessageChars : F.MAX_CHARS;
    $("msg").maxLength = max;
    $("proOpts").hidden = !(mode === "pro" && hasLic);
    $("proLock").hidden = !(mode === "pro" && !hasLic);
    $("sealTxt").textContent = mode === "pro" ? "Versiegeln & hochladen" : "Versiegeln & Link erstellen";
    $("sealBtn").disabled = mode === "pro" && !hasLic;
    $("actionHint").textContent = mode === "pro" ? "Ende-zu-Ende verschlüsselt · löscht sich nach dem Lesen" : "Verschlüsselt, bevor etwas dein Gerät verlässt";
    $("pwHint").textContent = mode === "pro" ? "optional, zusätzlicher Schutz" : "empfohlen";
    renderPwNote(); renderCount(); note("", "");
  }
  function renderCount() {
    const n = $("msg").value.length, max = $("msg").maxLength;
    $("count").textContent = n.toLocaleString("de-DE") + " / " + max.toLocaleString("de-DE");
    $("count").style.color = n > max * 0.9 ? "var(--accent)" : "";
  }
  function renderPwNote() {
    const has = !!$("pw").value, el = $("pwNote");
    $("pwWrap").classList.toggle("on", has);
    if (mode === "pro") { el.textContent = has ? "Der Empfänger braucht zusätzlich dieses Passwort." : "Auch ohne Passwort: nur einmal lesbar, Ende-zu-Ende verschlüsselt."; el.className = "field-note ok"; }
    else { el.textContent = has ? "Verschlüsselt. Nur mit diesem Passwort lesbar." : "Ohne Passwort kann jeder mit dem Link mitlesen."; el.className = "field-note " + (has ? "ok" : "warn"); }
  }

  /* Passwort aus gut unterscheidbaren Zeichen, z. B. „k7qm-x4tp-9vzr“ (≈ 60 Bit) */
  function generatePassword() {
    const abc = "abcdefghjkmnpqrstuvwxyz23456789", out = [];
    const rnd = crypto.getRandomValues(new Uint32Array(12));
    for (let i = 0; i < 12; i++) out.push(abc[rnd[i] % abc.length]);
    return out.slice(0, 4).join("") + "-" + out.slice(4, 8).join("") + "-" + out.slice(8).join("");
  }

  /* ---------------- Lizenz ---------------- */
  function renderLicense() {
    const on = !!P.license.key();
    $("licOn").hidden = !on; $("licOff").hidden = on;
    $("licDisplay").textContent = P.license.display();
    $("licChip").classList.toggle("on", on);
    $("licChipText").textContent = on ? "Pro aktiv" : (proAvailable ? "Kostenlos" : "Kostenlos");
    $("licBox").hidden = !proAvailable;
    setMode(mode);
  }
  async function activate(key, quiet) {
    if (!quiet) { $("licBtn").disabled = true; licNote("Prüfe …", ""); }
    try {
      const r = await P.license.activate(key);
      if (!quiet) licNote(r.validUntil ? "Freigeschaltet, gültig bis " + P.fmt(r.validUntil) + "." : "Freigeschaltet. Einmal-Kuverts sind bereit.", "ok");
      if (!quiet) setMode("pro", true);
      renderLicense();
      return true;
    } catch (e) {
      renderLicense();
      if (e.code === "device_limit") {
        licNote(e.message, "err");
        if (e.data && e.data.manageUrl) {
          const a = document.createElement("a"); a.className = "link"; a.href = e.data.manageUrl; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Kundenportal öffnen →";
          $("licNote").append(" ", a);
        }
      } else if (e.status === 403) licNote(quiet ? "Dein gespeicherter Lizenzschlüssel gilt nicht mehr: " + e.message : e.message, "err");
      else if (!quiet) licNote(e.message, "err");
      return false;
    } finally { $("licBtn").disabled = false; }
  }
  function focusLicense() {
    $("licBox").scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => $("licKey").focus({ preventScroll: true }), 350);
  }

  /* ---------------- Versiegeln ---------------- */
  async function seal() {
    if (busy) return;
    const text = $("msg").value, pw = $("pw").value;
    if (!text.trim()) { note("Schreib zuerst eine Nachricht.", "err"); $("msg").focus(); return; }
    if (!F.SECURE) { note("Verschlüsselung im Browser nicht verfügbar. Bitte die Seite über https:// öffnen.", "err"); return; }
    busy = true; $("sealBtn").disabled = true; note("", "");
    try {
      if (mode === "free") {
        $("sealTxt").textContent = pw ? "Verschlüssele …" : "Erstelle Link …";
        const blob = await F.buildBlob(text, pw);
        if (pw && blob[0] !== "1") throw new Error("Verschlüsselung fehlgeschlagen.");
        current = null;
        showResult(HOME + "#" + blob, pw, false);
      } else {
        if (!P.license.key()) { focusLicense(); return; }
        const email = cfg.mail ? $("notifyEmail").value.trim() : "";
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { note("Diese E-Mail-Adresse sieht nicht gültig aus.", "err"); $("notifyEmail").focus(); return; }
        $("sealTxt").textContent = "Verschlüssele …";
        const sealed = await C.seal(text, pw);
        $("sealTxt").textContent = "Lade hoch …";
        const payload = { ciphertext: sealed.ciphertext, authHash: sealed.authHash, statusHash: sealed.statusHash,
                          hasPassword: sealed.hasPassword, ttl: Number($("ttl").value), notifyEmail: email };
        let res;
        try { res = await P.api("create", payload, P.license.key()); }
        catch (e) {
          if (e.code !== "activation_required" && e.code !== "activation_invalid") throw e;
          if (!(await activate(P.license.key(), true))) throw Object.assign(new Error($("licNote").textContent || e.message), { status: 403 });
          res = await P.api("create", payload, P.license.key());
        }
        current = { id: res.id, st: sealed.statusToken, c: res.createdAt, e: res.expiresAt, n: !!res.notify, s: "waiting" };
        P.sent.upsert(current);
        renderSent();
        showResult(P.PRO_PAGE + "#p1." + res.id + "." + sealed.key, pw, true);
      }
      $("msg").value = ""; $("pw").value = ""; renderCount(); renderPwNote();
    } catch (e) {
      if (e.status === 403 && /^license_/.test(e.code || "")) { P.license.forget(); renderLicense(); licNote(e.message, "err"); }
      note(e.message === "subtle-unavailable" ? "Verschlüsselung im Browser nicht verfügbar." : e.message, "err");
    } finally {
      busy = false; setMode(mode);
    }
  }

  function showResult(link, pw, isPro) {
    lastLink = link; lastPw = pw; lastPro = isPro;
    $("resultEmpty").hidden = true; $("resultFull").hidden = false;
    $("outLink").textContent = link;
    $("linkLen").textContent = link.length.toLocaleString("de-DE") + " Zeichen";
    $("resultTitle").textContent = isPro ? "Einmal-Kuvert bereit" : "Kuvert bereit";
    $("resultSub").textContent = isPro ? "Lässt sich genau einmal öffnen." : (pw ? "Mit Passwort verschlüsselt." : "Ohne Passwort – nur kodiert.");
    const seal = $("resultSeal"); seal.classList.remove("press"); void seal.offsetWidth; seal.classList.add("on", "press");
    $("pwRemind").hidden = !pw; $("pwShow").textContent = pw || "";
    $("proStatus").hidden = !isPro;
    if (isPro) renderLive({ state: "waiting", expiresAt: current.e });
    $("qr").classList.remove("show"); $("qrBtn").setAttribute("aria-expanded", "false");
    // Teilen ist auf Handys der Hauptweg, am Desktop das Kopieren.
    const shareFirst = canShare && mqMobile.matches;
    $("shareBtn").hidden = !canShare;
    $("newBtn").classList.toggle("wide", !canShare);
    $("shareBtn").className = "btn " + (shareFirst ? "btn-primary" : "btn-ghost");
    $("copyBtn").className = "btn " + (shareFirst ? "btn-ghost" : "btn-primary");
    $("copyBtn").querySelector("span").textContent = "Link kopieren";
    if (link.length > 1900) note("Sehr langer Link: Manche Apps kürzen ihn. Für lange Texte ist ein Einmal-Kuvert besser.", "err");
    openSheet();
    if (!mqMobile.matches) P.copy(link).then((ok) => { if (ok) { markCopied(); P.toast(pw ? "Link kopiert. Passwort separat schicken!" : "Link kopiert"); } });
  }
  function markCopied() {
    const b = $("copyBtn"); b.querySelector("span").textContent = "Kopiert"; b.classList.add("done");
    setTimeout(() => { b.classList.remove("done"); b.querySelector("span").textContent = "Link kopieren"; }, 1800);
  }
  function renderLive(st) {
    const d = P.describe(st);
    $("liveDot").className = "sdot " + d.cls; $("liveText").textContent = d.text;
  }
  function openSheet() { if (mqMobile.matches) { $("resultCard").classList.add("show"); $("sheetBackdrop").classList.add("show"); } }
  function closeSheet() { $("resultCard").classList.remove("show"); $("sheetBackdrop").classList.remove("show"); }
  function newKuvert() {
    closeSheet(); current = null; lastLink = ""; lastPw = "";
    $("resultFull").hidden = true; $("resultEmpty").hidden = false; note("", "");
    $("msg").focus();
  }

  /* ---------------- Deine Einmal-Kuverts ---------------- */
  function renderSent() {
    const list = P.sent.load(), box = $("sentList");
    $("sentSec").hidden = !list.length || !proAvailable;
    box.innerHTML = "";
    list.forEach((item) => {
      const d = P.describe({ state: item.s, expiresAt: item.e, readAt: item.r });
      const row = document.createElement("div"); row.className = "sent-row";
      const when = document.createElement("span"); when.className = "when"; when.textContent = P.fmt(item.c);
      const st = document.createElement("span"); st.className = "st";
      const dot = document.createElement("span"); dot.className = "sdot " + d.cls;
      const txt = document.createElement("span"); txt.textContent = d.text + (item.n && item.s === "waiting" ? " · Mail-Meldung an" : "");
      st.append(dot, txt);
      const acts = document.createElement("span"); acts.className = "acts";
      const mk = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "linkbtn"; b.textContent = label; b.addEventListener("click", fn); acts.appendChild(b); };
      mk("Status-Link", async () => { await P.copy(P.sent.statusLink(item)); P.toast("Status-Link kopiert"); });
      if (item.s === "waiting") mk("Zurückziehen", () => revoke(item));
      else mk("Entfernen", () => { P.sent.remove(item.id); renderSent(); });
      row.append(when, st, acts);
      box.appendChild(row);
    });
  }
  async function revoke(item) {
    if (!confirm("Dieses Kuvert zurückziehen? Der Link funktioniert danach nicht mehr.")) return;
    try { applyStatus(item.id, await P.api("revoke", { id: item.id, statusToken: item.st })); P.toast("Kuvert zurückgezogen"); }
    catch (e) { P.toast(e.message); }
  }
  function applyStatus(id, st) {
    const r = P.sent.apply(id, st);
    if (r.changed) P.announce(r.item);
    renderSent();
    if (current && current.id === id) renderLive(st);
  }
  let polling = false;
  async function pollAll() {
    if (polling || document.visibilityState !== "visible") return;
    polling = true;
    try {
      for (const item of P.sent.load().filter((x) => x.s === "waiting").slice(0, 10)) {
        try { applyStatus(item.id, await P.api("status", { id: item.id, statusToken: item.st })); }
        catch (e) { if (e.status === 403) applyStatus(item.id, { state: "unknown" }); }
      }
    } finally { polling = false; }
  }

  /* ---------------- Installieren (Startbildschirm) ---------------- */
  function initInstall() {
    const btn = $("installBtn");
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    if (standalone) return;
    let deferred = null;
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; btn.hidden = false; });
    window.addEventListener("appinstalled", () => { btn.hidden = true; P.toast("Kuvert ist installiert."); });
    const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (iOS) btn.hidden = false;
    btn.addEventListener("click", async () => {
      if (deferred) { deferred.prompt(); try { await deferred.userChoice; } catch (e) {} deferred = null; btn.hidden = true; return; }
      if (iOS) P.toast("In Safari: unten auf „Teilen“ tippen, dann „Zum Home-Bildschirm“.", 7000);
    });
  }

  /* ---------------- Start ---------------- */
  async function init() {
    initInstall();
    // Bedienelemente
    document.querySelectorAll(".mode button").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.mode === "pro" && !proAvailable) { P.toast("Kuvert Pro ist gerade nicht verfügbar."); return; }
      setMode(b.dataset.mode, true); $("msg").focus();
    }));
    $("msg").addEventListener("input", () => { renderCount(); if ($("formNote").classList.contains("err")) note("", ""); });
    $("msg").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); seal(); } });
    $("pw").addEventListener("input", renderPwNote);
    $("pwGen").addEventListener("click", () => { $("pw").value = generatePassword(); renderPwNote(); $("pw").select(); P.toast("Sicheres Passwort erzeugt"); });
    $("sealBtn").addEventListener("click", seal);
    $("copyBtn").addEventListener("click", async () => { if (await P.copy(lastLink)) { markCopied(); P.toast(lastPw ? "Link kopiert. Passwort separat schicken!" : "Link kopiert"); } });
    $("shareBtn").addEventListener("click", async () => {
      const text = lastPro
        ? "Ich habe dir ein Einmal-Kuvert geschickt. Es lässt sich nur einmal öffnen" + (lastPw ? ", das Passwort bekommst du separat." : ".")
        : (lastPw ? "Ich habe dir ein verschlüsseltes Kuvert geschickt. Das Passwort bekommst du separat." : "Ich habe dir ein Kuvert geschickt.");
      try { await navigator.share({ title: "Kuvert", text, url: lastLink }); }
      catch (e) { if (e && e.name !== "AbortError") { if (await P.copy(lastLink)) P.toast("Link kopiert"); } }
    });
    $("qrBtn").addEventListener("click", () => {
      const show = !$("qr").classList.contains("show");
      $("qr").classList.toggle("show", show); $("qrBtn").setAttribute("aria-expanded", String(show));
      if (show) P.renderQR($("qrCanvas"), lastLink);
    });
    $("qrDownload").addEventListener("click", () => {
      try { const a = document.createElement("a"); a.href = $("qrCanvas").toDataURL("image/png"); a.download = "kuvert-qr.png"; document.body.appendChild(a); a.click(); a.remove(); } catch (e) {}
    });
    $("pwCopy").addEventListener("click", async () => { if (await P.copy(lastPw)) P.toast("Passwort kopiert"); });
    $("copyStatus").addEventListener("click", async () => { if (current && await P.copy(P.sent.statusLink(current))) P.toast("Status-Link kopiert"); });
    $("newBtn").addEventListener("click", newKuvert);
    $("sheetClose").addEventListener("click", closeSheet);
    $("sheetBackdrop").addEventListener("click", closeSheet);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
    $("lockKey").addEventListener("click", focusLicense);
    $("licForm").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const k = $("licKey").value.trim();
      if (!k) { licNote("Bitte einen Lizenzschlüssel eingeben.", "err"); return; }
      activate(k, false).then((ok) => { if (ok) $("licKey").value = ""; });
    });
    $("licRemove").addEventListener("click", async () => {
      const freed = await P.license.release(); licNote("", ""); setMode("free", true); renderLicense();
      if (freed) P.toast("Gerät freigegeben. Du kannst den Schlüssel jetzt woanders nutzen.");
    });
    const nb = $("browserNotify");
    nb.checked = P.store.get(P.LS.notify) === "1" && "Notification" in window && Notification.permission === "granted";
    nb.addEventListener("change", async () => {
      if (!nb.checked) { P.store.set(P.LS.notify, "0"); return; }
      if (!("Notification" in window)) { nb.checked = false; P.toast("Dein Browser unterstützt keine Benachrichtigungen."); return; }
      const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (p !== "granted") { nb.checked = false; P.store.set(P.LS.notify, "0"); P.toast("Benachrichtigungen wurden im Browser blockiert."); return; }
      P.store.set(P.LS.notify, "1");
    });
    $("sentRefresh").addEventListener("click", () => pollAll().then(() => P.toast("Aktualisiert")));

    // Startzustand sofort (ohne auf den Server zu warten)
    const params = new URLSearchParams(location.search);
    const wanted = params.get("mode") || P.store.get(P.LS.mode) || (P.license.key() ? "pro" : "free");
    renderLicense(); setMode("free"); renderCount();

    // Server-Einstellungen für Pro
    try {
      cfg = Object.assign(cfg, await P.api("config"));
      proAvailable = !!(cfg.launched || params.has("preview"));
    } catch (e) { proAvailable = false; }
    const proBtn = document.querySelector('.mode button[data-mode="pro"]');
    proBtn.querySelector(".sub").textContent = proAvailable ? "Danach gelöscht, du erfährst, wann" : "Gerade nicht verfügbar";
    const sel = $("ttl"); sel.innerHTML = "";
    cfg.ttlOptions.forEach((s) => { const o = document.createElement("option"); o.value = String(s); o.textContent = P.ttlLabel(s); if (s === cfg.defaultTtl) o.selected = true; sel.appendChild(o); });
    $("mailWrap").hidden = !cfg.mail;
    if (cfg.buyUrl) { $("buyLink").href = cfg.buyUrl; $("lockBuy").href = cfg.buyUrl; }
    if (cfg.manageUrl) { $("manageLink").href = cfg.manageUrl; $("manageLink").hidden = false; }
    renderLicense(); setMode(wanted); renderSent();

    // Rückkehr vom Kauf: bedanken und zum Schlüsselfeld führen
    if (params.has("checkout_id")) {
      try { params.delete("checkout_id"); history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : "")); } catch (e) {}
      if (!P.license.key()) { licNote("Danke für deinen Kauf! Deinen Lizenzschlüssel findest du in der Bestätigungs-E-Mail. Gib ihn hier ein.", "ok"); setMode("pro"); focusLicense(); }
      else P.toast("Danke für deinen Kauf!");
    }
    if (proAvailable && P.license.key()) activate(P.license.key(), true);
    if (proAvailable) {
      pollAll(); setInterval(pollAll, 15000);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pollAll(); });
    }
    if (!mqMobile.matches) $("msg").focus();
  }
  /* Versiegeln-Leiste über der Bildschirmtastatur halten. Android/Chrome: interactive-widget=resizes-content
     im Viewport-Meta. iOS/Safari verschiebt nur den sichtbaren Bereich: Abstand per visualViewport ausgleichen. */
  (function keepAboveKeyboard() {
    const vv = window.visualViewport; if (!vv) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty("--kb", kb + "px");
      const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      document.body.classList.toggle("kb-open", kb > 80 || (typing && mqMobile.matches && vv.height < window.screen.height * 0.7));
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(update); };
    vv.addEventListener("resize", queue); vv.addEventListener("scroll", queue);
    document.addEventListener("focusin", queue); document.addEventListener("focusout", () => setTimeout(queue, 50));
    update();
  })();
  init();
})();
