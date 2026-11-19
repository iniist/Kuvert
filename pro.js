/* Kuvert Pro – Oberfläche: Lizenz, Versiegeln & Hochladen, Empfänger, Status. */
(function () {
  "use strict";

  if (location.protocol === "http:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    location.replace("https://" + location.host + location.pathname + location.search + location.hash);
    return;
  }

  const C = window.KuvertCrypto;
  const PAGE = location.origin + location.pathname;          // …/pro.html
  const API = new URL("api/index.php", PAGE).toString();
  const $ = (id) => document.getElementById(id);

  /* ---------------- small helpers ---------------- */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const LS_LICENSE = "kuvert-pro-license", LS_LICENSE_DISPLAY = "kuvert-pro-license-display",
        LS_SENT = "kuvert-pro-sent", LS_NOTIFY = "kuvert-pro-browser-notify";

  function fmt(ts) {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " Uhr";
  }
  function ttlLabel(s) {
    const map = { 3600: "1 Stunde", 86400: "1 Tag", 604800: "7 Tagen", 2592000: "30 Tagen" };
    if (map[s]) return map[s];
    if (s % 86400 === 0) return (s / 86400) + " Tagen";
    if (s % 3600 === 0) return (s / 3600) + " Stunden";
    return Math.round(s / 60) + " Minuten";
  }
  function nowSec() { return Math.floor(Date.now() / 1000); }

  async function api(action, body, license) {
    const opts = { method: body ? "POST" : "GET", headers: { Accept: "application/json" }, cache: "no-store", credentials: "omit" };
    if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    if (license) opts.headers["X-Kuvert-License"] = license;
    let res, data = null;
    try {
      res = await fetch(API + "?a=" + encodeURIComponent(action), opts);
    } catch (e) {
      const err = new Error("Der Server ist gerade nicht erreichbar. Bitte prüfe deine Verbindung.");
      err.code = "network"; err.status = 0; throw err;
    }
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const info = (data && data.error) || {};
      const err = new Error(info.message || ("Fehler " + res.status));
      err.code = info.code || "http_" + res.status; err.status = res.status; err.data = info; throw err;
    }
    return data || {};
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch (_) {}
      document.body.removeChild(ta); return ok;
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  }

  function note(el, msg, kind) { el.textContent = msg || ""; el.className = el.className.replace(/\s*\b(ok|err)\b/g, "") + (kind ? " " + kind : ""); }

  function renderQR(canvas, link) {
    if (typeof window.qrcode === "undefined") { canvas.style.display = "none"; return false; }
    let qr = null;
    for (let type = 1; type <= 40; type++) {
      try { qr = window.qrcode(type, "M"); qr.addData(link); qr.make(); break; }
      catch (e) { qr = null; if (String(e).indexOf("overflow") === -1) break; }
    }
    if (!qr) { canvas.style.display = "none"; return false; }
    const count = qr.getModuleCount(), margin = 2, cell = 6, size = (count + margin * 2) * cell;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ecebe6"; ctx.fillRect(0, 0, size, size); ctx.fillStyle = "#0d0e10";
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    canvas.style.display = "block"; return true;
  }

  /* Zustände für Menschen */
  function describe(st) {
    switch (st.state) {
      case "waiting":   return { cls: "waiting", text: "Wartet auf Öffnen · verfällt " + fmt(st.expiresAt) };
      case "read":      return { cls: "read", text: "Geöffnet am " + fmt(st.readAt) };
      case "expired":   return { cls: "", text: "Abgelaufen, ungelesen gelöscht" };
      case "revoked":   return { cls: "", text: "Von dir zurückgezogen" };
      case "destroyed": return { cls: "bad", text: "Vernichtet nach falschen Passwörtern" + (st.readAt ? " · " + fmt(st.readAt) : "") };
      default:          return { cls: "", text: "Nicht mehr auf dem Server" };
    }
  }
  const FINAL = { read: 1, expired: 1, revoked: 1, destroyed: 1, unknown: 1 };

  /* ---------------- sent list (nur in diesem Browser) ---------------- */
  function loadSent() {
    try { const a = JSON.parse(store.get(LS_SENT) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function saveSent(list) {
    const cutoff = nowSec() - 7 * 86400;
    const kept = list.filter((x) => !(FINAL[x.s] && (x.r || x.e) < cutoff)).slice(0, 50);
    store.set(LS_SENT, JSON.stringify(kept));
    return kept;
  }
  function upsertSent(item) {
    const list = loadSent().filter((x) => x.id !== item.id);
    list.unshift(item);
    return saveSent(list);
  }
  function statusLink(item) { return PAGE + "#s1." + item.id + "." + item.st; }

  function renderSent() {
    const list = loadSent(), box = $("sentList"), sec = $("sentSec");
    sec.style.display = list.length ? "" : "none";
    box.innerHTML = "";
    list.forEach((item) => {
      const d = describe({ state: item.s, expiresAt: item.e, readAt: item.r });
      const row = document.createElement("div"); row.className = "sent-row";
      const when = document.createElement("span"); when.className = "when"; when.textContent = fmt(item.c);
      const st = document.createElement("span"); st.className = "st";
      const dot = document.createElement("span"); dot.className = "sdot " + d.cls;
      const txt = document.createElement("span"); txt.textContent = d.text + (item.n && item.s === "waiting" ? " · Mail-Meldung an" : "");
      st.append(dot, txt);
      const acts = document.createElement("span"); acts.className = "acts";
      const mk = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "linkbtn"; b.textContent = label; b.addEventListener("click", fn); acts.appendChild(b); };
      mk("Status-Link", async () => { await copy(statusLink(item)); toast("Status-Link kopiert"); });
      if (item.s === "waiting") mk("Zurückziehen", () => revoke(item));
      else mk("Entfernen", () => { saveSent(loadSent().filter((x) => x.id !== item.id)); renderSent(); });
      row.append(when, st, acts);
      box.appendChild(row);
    });
  }

  async function revoke(item) {
    if (!confirm("Dieses Kuvert zurückziehen? Der Link funktioniert danach nicht mehr.")) return;
    try {
      const st = await api("revoke", { id: item.id, statusToken: item.st });
      applyStatus(item.id, st);
      toast("Kuvert zurückgezogen");
    } catch (e) { toast(e.message); }
  }

  /* Statusänderung übernehmen, Meldungen auslösen */
  function applyStatus(id, st) {
    const list = loadSent();
    const item = list.find((x) => x.id === id);
    if (!item) return;
    const before = item.s;
    item.s = st.state || "unknown";
    if (st.readAt) item.r = st.readAt;
    if (st.expiresAt) item.e = st.expiresAt;
    saveSent(list);
    if (before === "waiting" && item.s !== "waiting") announce(item);
    renderSent();
    if (current && current.id === id) renderLive(st);
  }

  function announce(item) {
    const msg = item.s === "read" ? "Dein Kuvert wurde geöffnet · " + fmt(item.r)
      : item.s === "destroyed" ? "Dein Kuvert wurde nach falschen Passwörtern vernichtet"
      : item.s === "expired" ? "Ein Kuvert ist ungelesen abgelaufen" : null;
    if (!msg) return;
    toast(msg);
    if (store.get(LS_NOTIFY) === "1" && "Notification" in window && Notification.permission === "granted") {
      try { new Notification("Kuvert Pro", { body: msg, tag: "kuvert-" + item.id }); } catch (e) {}
    }
  }

  let polling = false;
  async function pollAll() {
    if (polling || document.visibilityState !== "visible") return;
    polling = true;
    try {
      const waiting = loadSent().filter((x) => x.s === "waiting").slice(0, 10);
      for (const item of waiting) {
        try { applyStatus(item.id, await api("status", { id: item.id, statusToken: item.st })); }
        catch (e) { if (e.status === 403) applyStatus(item.id, { state: "unknown" }); }
      }
    } finally { polling = false; }
  }

  /* ---------------- sender ---------------- */
  let cfg = { buyUrl: "", priceLabel: "", mail: false, maxMessageChars: 20000, ttlOptions: [3600, 86400, 604800, 2592000], defaultTtl: 86400, maxAttempts: 5 };
  let serverOk = true, sending = false, current = null;

  function renderTtl() {
    const sel = $("ttl"), prev = Number(sel.value) || cfg.defaultTtl;
    sel.innerHTML = "";
    cfg.ttlOptions.forEach((s) => {
      const o = document.createElement("option"); o.value = String(s); o.textContent = ttlLabel(s);
      if (s === prev) o.selected = true; sel.appendChild(o);
    });
  }
  function renderCount() {
    const n = $("secret").value.length;
    $("charcount").textContent = n.toLocaleString("de-DE") + " / " + cfg.maxMessageChars.toLocaleString("de-DE");
  }

  function license() { return store.get(LS_LICENSE) || ""; }
  function renderLicense() {
    const on = !!license();
    $("lic").classList.toggle("on", on);
    $("licForm").style.display = on ? "none" : "";
    $("licActive").style.display = on ? "flex" : "none";
    $("licDisplay").textContent = store.get(LS_LICENSE_DISPLAY) || "";
  }

  async function activate(key, quiet) {
    const btn = $("licBtn");
    if (!quiet) { btn.disabled = true; note($("licNote"), "Prüfe…", ""); }
    try {
      const r = await api("license", { key });
      store.set(LS_LICENSE, key); store.set(LS_LICENSE_DISPLAY, r.display || "");
      if (!quiet) note($("licNote"), r.validUntil ? "Freigeschaltet, gültig bis " + fmt(r.validUntil) + "." : "Freigeschaltet. Viel Spaß mit Pro!", "ok");
      renderLicense();
      return true;
    } catch (e) {
      if (e.status === 403) {
        store.del(LS_LICENSE); store.del(LS_LICENSE_DISPLAY); renderLicense();
        note($("licNote"), quiet ? "Dein gespeicherter Lizenzschlüssel gilt nicht mehr: " + e.message : e.message, "err");
      } else if (!quiet) {
        note($("licNote"), e.message, "err");
      }
      return false;
    } finally { btn.disabled = false; }
  }

  function setSending(on, label) {
    sending = on;
    $("sendBtn").disabled = on;
    $("sendTxt").textContent = label || "Versiegeln & Link erstellen";
  }

  async function send() {
    if (sending) return;
    const text = $("secret").value, pass = $("pass").value, form = $("formNote");
    if (!text.trim()) { note(form, "Schreib zuerst eine Nachricht.", "err"); $("secret").focus(); return; }
    if (text.length > cfg.maxMessageChars) { note(form, "Die Nachricht ist zu lang.", "err"); return; }
    if (!license()) {
      note(form, "Bitte zuerst oben deinen Pro-Lizenzschlüssel eingeben.", "err");
      $("licKey").focus(); $("lic").scrollIntoView({ behavior: "smooth", block: "center" }); return;
    }
    const email = cfg.mail ? $("notifyEmail").value.trim() : "";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { note(form, "Diese E-Mail-Adresse sieht nicht gültig aus.", "err"); $("notifyEmail").focus(); return; }
    if (!(window.crypto && window.crypto.subtle)) { note(form, "Verschlüsselung im Browser nicht verfügbar. Bitte die Seite über https:// öffnen.", "err"); return; }

    note(form, "", "");
    setSending(true, pass ? "Verschlüssele (Passwort)…" : "Verschlüssele…");
    try {
      const sealed = await C.seal(text, pass);
      setSending(true, "Lade hoch…");
      const res = await api("create", {
        ciphertext: sealed.ciphertext, authHash: sealed.authHash, statusHash: sealed.statusHash,
        hasPassword: sealed.hasPassword, ttl: Number($("ttl").value), notifyEmail: email,
      }, license());
      const item = { id: res.id, st: sealed.statusToken, c: res.createdAt, e: res.expiresAt, n: !!res.notify, s: "waiting" };
      upsertSent(item);
      current = item;
      showResult(item, PAGE + "#p1." + res.id + "." + sealed.key, sealed.hasPassword);
      $("secret").value = ""; $("pass").value = ""; renderCount();
      renderSent();
    } catch (e) {
      if (e.status === 403 && /^license_/.test(e.code || "")) {
        store.del(LS_LICENSE); store.del(LS_LICENSE_DISPLAY); renderLicense();
        note($("licNote"), e.message, "err");
      }
      note(form, e.message === "subtle-unavailable" ? "Verschlüsselung im Browser nicht verfügbar." : e.message, "err");
    } finally { setSending(false); }
  }

  function showResult(item, link, hasPassword) {
    const wax = $("wax");
    wax.classList.add("on"); wax.classList.remove("press"); void wax.offsetWidth; wax.classList.add("press");
    $("sealState").textContent = "Versiegelt"; $("sealState").classList.add("sealed");
    $("sealSub").textContent = (hasPassword ? "Mit Passwort geschützt. " : "") + "Liegt verschlüsselt bereit und funktioniert genau einmal.";
    $("outLink").textContent = link;
    $("outStatus").textContent = statusLink(item);
    $("result").classList.add("show");
    $("result").dataset.link = link;
    const hasQr = renderQR($("qrCanvas"), link);
    $("qrDownload").style.display = hasQr ? "" : "none";
    renderLive({ state: "waiting", expiresAt: item.e });
    copy(link).then((ok) => { if (ok) toast("Link kopiert. Jetzt verschicken!"); });
  }

  function renderLive(st) {
    const d = describe(st);
    $("liveDot").className = "sdot " + d.cls;
    $("liveText").textContent = d.text;
  }

  function resetCompose() {
    current = null;
    $("result").classList.remove("show");
    $("wax").classList.remove("on", "press");
    $("sealState").textContent = "Noch leer"; $("sealState").classList.remove("sealed");
    $("sealSub").textContent = "Schreib eine Nachricht und erstelle den Link. Er funktioniert genau einmal.";
    $("secret").focus();
  }

  async function initSender() {
    renderTtl(); renderCount(); renderLicense(); renderSent();
    const nb = $("browserNotify");
    nb.checked = store.get(LS_NOTIFY) === "1" && "Notification" in window && Notification.permission === "granted";

    $("secret").addEventListener("input", renderCount);
    $("sendBtn").addEventListener("click", send);
    $("licForm").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const k = $("licKey").value.trim();
      if (!k) { note($("licNote"), "Bitte einen Lizenzschlüssel eingeben.", "err"); return; }
      activate(k, false).then((ok) => { if (ok) $("licKey").value = ""; });
    });
    $("licRemove").addEventListener("click", () => {
      store.del(LS_LICENSE); store.del(LS_LICENSE_DISPLAY); renderLicense(); note($("licNote"), "", "");
    });
    nb.addEventListener("change", async () => {
      if (!nb.checked) { store.set(LS_NOTIFY, "0"); return; }
      if (!("Notification" in window)) { nb.checked = false; toast("Dein Browser unterstützt keine Benachrichtigungen."); return; }
      const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (p !== "granted") { nb.checked = false; store.set(LS_NOTIFY, "0"); toast("Benachrichtigungen wurden im Browser blockiert."); return; }
      store.set(LS_NOTIFY, "1");
    });
    $("copyLink").addEventListener("click", async () => { if (await copy($("result").dataset.link || "")) toast("Link kopiert"); });
    $("copyStatus").addEventListener("click", async () => { if (await copy($("outStatus").textContent)) toast("Status-Link kopiert"); });
    $("newBtn").addEventListener("click", resetCompose);
    $("sentRefresh").addEventListener("click", () => pollAll().then(() => toast("Aktualisiert")));
    $("qrDownload").addEventListener("click", () => {
      try { const a = document.createElement("a"); a.href = $("qrCanvas").toDataURL("image/png"); a.download = "kuvert-pro-qr.png"; document.body.appendChild(a); a.click(); a.remove(); } catch (e) {}
    });
    $("planBuy").addEventListener("click", (ev) => {
      if (cfg.buyUrl && !license()) return; // normaler Link zum Shop
      ev.preventDefault(); $("lic").scrollIntoView({ behavior: "smooth", block: "center" }); if (!license()) setTimeout(() => $("licKey").focus(), 400);
    });

    try {
      cfg = Object.assign(cfg, await api("config"));
      serverOk = true;
    } catch (e) {
      serverOk = false;
      note($("formNote"), "Der Pro-Server antwortet gerade nicht (" + e.message + ").", "err");
    }
    // Pro erst zeigen, wenn es auf dem Server freigeschaltet ist (oder ?preview zum Testen).
    const preview = new URLSearchParams(location.search).has("preview");
    const live = serverOk && (cfg.launched || preview);
    $("app").hidden = !live;
    $("heroSoon").hidden = live;
    $("heroLive").hidden = !live;
    $("heroBadge").textContent = !live ? "Bald verfügbar" : (cfg.launched ? "Jetzt verfügbar" : "Vorschau");
    $("heroBadge").classList.toggle("ok", live);
    if (!live) { note($("formNote"), "", ""); return; }

    $("secret").maxLength = cfg.maxMessageChars;
    renderTtl(); renderCount();
    $("mailWrap").style.display = cfg.mail ? "" : "none";
    if (cfg.buyUrl) {
      $("buyLink").href = cfg.buyUrl; $("buyLink").style.display = ""; $("buyLink").removeAttribute("target");
      if (!license()) { $("planBuy").href = cfg.buyUrl; $("planBuy").textContent = "Pro kaufen"; }
    }
    if (cfg.priceLabel) $("planPrice").textContent = cfg.priceLabel;
    if (cfg.manageUrl) { $("manageLink").href = cfg.manageUrl; $("manageLink").style.display = ""; }

    // Rückkehr vom Polar-Checkout: kurz bedanken und zum Schlüsselfeld führen.
    const params = new URLSearchParams(location.search);
    if (params.has("checkout_id")) {
      try { params.delete("checkout_id"); history.replaceState(null, "", location.pathname + (params.toString() ? "?" + params : "")); } catch (e) {}
      if (!license()) {
        note($("licNote"), "Danke für deinen Kauf! Deinen Lizenzschlüssel findest du in der Bestätigungs-E-Mail von Polar. Gib ihn hier ein.", "ok");
        setTimeout(() => { $("lic").scrollIntoView({ behavior: "smooth", block: "center" }); $("licKey").focus({ preventScroll: true }); }, 300);
      } else {
        toast("Danke für deinen Kauf!");
      }
    }

    if (serverOk && license()) activate(license(), true);   // still prüfen, ob die Lizenz noch gilt
    pollAll();
    setInterval(pollAll, 15000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pollAll(); });
  }

  /* ---------------- recipient & status card ---------------- */
  const R = {
    eyebrow: $("rEyebrow"), wax: $("rWax"), title: $("rTitle"), sub: $("rSub"), once: $("rOnce"),
    passBlock: $("rPassBlock"), pass: $("rPass"), open: $("rOpen"), openBlock: $("rOpenBlock"), openNoPass: $("rOpenNoPass"),
    revealWrap: $("rRevealWrap"), reveal: $("rReveal"), note: $("rNote"), meta: $("rMeta"), warn: $("rWarn"),
    after: $("rAfter"), copy: $("rCopy"), foot: $("rFootText"),
  };
  function cardHide() {
    [R.once, R.passBlock, R.openBlock, R.revealWrap, R.warn].forEach((e) => (e.style.display = "none"));
    R.after.style.display = "none"; R.meta.textContent = "";
  }
  function cardGone(st, forSender) {
    cardHide();
    R.wax.classList.remove("open"); R.wax.classList.add("gone");
    const t = {
      read: ["Bereits geöffnet", "Dieses Kuvert wurde am " + fmt(st.readAt) + " geöffnet und danach gelöscht."],
      expired: ["Abgelaufen", "Dieses Kuvert wurde nicht rechtzeitig geöffnet und ist gelöscht."],
      revoked: ["Zurückgezogen", forSender ? "Du hast dieses Kuvert zurückgezogen." : "Der Absender hat dieses Kuvert zurückgezogen."],
      destroyed: ["Vernichtet", "Nach zu vielen falschen Passwörtern wurde dieses Kuvert zur Sicherheit gelöscht."],
    }[st.state] || ["Nicht gefunden", "Dieses Kuvert gibt es nicht (mehr). Vielleicht ist der Link unvollständig, oder es wurde vor über einer Woche geöffnet."];
    R.title.textContent = t[0]; R.sub.textContent = t[1];
    if (st.state === "read" && !forSender) {
      R.warn.style.display = "";
      R.warn.textContent = "Warst du das nicht? Dann hat jemand anderes den Link zuerst benutzt. Sag dem Absender Bescheid, damit er das Geheimnis (z. B. ein Passwort) ändert.";
    }
    if (st.state === "read" && forSender) R.wax.classList.replace("gone", "open");
  }

  async function initRecipient(id, key) {
    document.body.classList.add("recipient");
    let st;
    try { st = await api("peek", { id }); }
    catch (e) { R.title.textContent = "Server nicht erreichbar"; R.sub.textContent = e.message; return; }
    if (st.state !== "waiting") { cardGone(st, false); return; }

    cardHide();
    R.title.textContent = "Jemand hat dir ein Kuvert geschickt";
    R.once.style.display = "";
    R.sub.textContent = st.hasPassword
      ? "Gib das Passwort ein. Nach dem Öffnen wird die Nachricht vom Server gelöscht."
      : "Nach dem Öffnen wird die Nachricht vom Server gelöscht. Öffne sie erst, wenn du sie in Ruhe lesen oder kopieren kannst.";
    R.meta.textContent = "Verfällt ungelesen am " + fmt(st.expiresAt);
    if (st.hasPassword) { R.passBlock.style.display = ""; setTimeout(() => R.pass.focus(), 200); }
    else R.openBlock.style.display = "";

    let busy = false;
    const go = async () => {
      if (busy) return;
      if (st.hasPassword && !R.pass.value) { note(R.note, "Bitte das Passwort eingeben.", "err"); R.pass.focus(); return; }
      busy = true;
      const btn = st.hasPassword ? R.open : R.openNoPass, label = btn.textContent;
      btn.disabled = true; btn.textContent = "Öffne…"; note(R.note, "", "");
      try {
        const k = await C.unlock(key, st.hasPassword ? R.pass.value : "");
        const res = await api("read", { id, token: k.token });
        let text;
        try { text = await C.open(res.ciphertext, k.encKey); }
        catch (e) { throw Object.assign(new Error("Die Nachricht konnte nicht entschlüsselt werden. Der Link ist beschädigt."), { status: -1 }); }
        try { history.replaceState(null, "", location.pathname); } catch (e) {}  // Schlüssel aus der Adresszeile entfernen
        cardHide();
        R.wax.classList.add("open");
        R.title.textContent = "Geöffnet";
        R.sub.textContent = "Die Nachricht wurde soeben vom Server gelöscht. Kopiere sie jetzt, wenn du sie brauchst. Nach dem Schließen dieser Seite ist sie weg.";
        R.revealWrap.style.display = ""; R.reveal.textContent = text;
        R.after.style.display = "flex";
        R.copy.onclick = async () => { if (await copy(text)) toast("Inhalt kopiert"); };
      } catch (e) {
        if (e.status === 410) { cardGone((e.data && e.data.status) || { state: "unknown" }, false); if (e.code === "destroyed") note(R.note, e.message, "err"); }
        else { note(R.note, e.message, "err"); if (e.code === "wrong_password") { R.pass.value = ""; R.pass.focus(); } }
      } finally { busy = false; btn.disabled = false; btn.textContent = label; }
    };
    R.open.addEventListener("click", go);
    R.pass.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    R.openNoPass.addEventListener("click", go);
  }

  async function initStatus(id, token) {
    document.body.classList.add("statusmode");
    R.eyebrow.textContent = "Status deines Kuverts";
    R.foot.textContent = "Dieser Status-Link zeigt nur den Zustand. Den Inhalt kann er nicht öffnen.";
    let revokeBound = false;
    const load = async () => {
      let st;
      try { st = await api("status", { id, statusToken: token }); }
      catch (e) { R.title.textContent = e.status === 403 ? "Ungültiger Status-Link" : "Server nicht erreichbar"; R.sub.textContent = e.message; return; }
      if (!loadSent().some((x) => x.id === id) && st.state !== "unknown") {
        upsertSent({ id, st: token, c: st.createdAt, e: st.expiresAt, r: st.readAt, n: !!st.notify, s: st.state });
      } else applyStatus(id, st);
      if (st.state === "waiting") {
        cardHide();
        R.wax.classList.remove("gone", "open");
        R.title.textContent = "Wartet auf Öffnen";
        R.sub.textContent = "Dein Kuvert liegt verschlüsselt bereit. Diese Seite aktualisiert sich von selbst.";
        R.meta.textContent = "Erstellt " + fmt(st.createdAt) + " · verfällt " + fmt(st.expiresAt)
          + (st.failedAttempts ? " · " + st.failedAttempts + " falsche(s) Passwort(e)" : "")
          + (st.notify ? " · E-Mail-Meldung aktiv" : "");
        R.openBlock.style.display = ""; R.openNoPass.textContent = "Kuvert zurückziehen";
        R.openNoPass.classList.remove("btn-primary");
        if (!revokeBound) {
          revokeBound = true;
          R.openNoPass.addEventListener("click", async () => {
            if (!confirm("Dieses Kuvert zurückziehen? Der Link funktioniert danach nicht mehr.")) return;
            try { await api("revoke", { id, statusToken: token }); load(); } catch (e) { note(R.note, e.message, "err"); }
          });
        }
        return true;
      }
      cardGone(st, true);
      if (st.state !== "unknown") R.meta.textContent = "Erstellt " + fmt(st.createdAt);
      return false;
    };
    const again = await load();
    if (again) {
      const timer = setInterval(async () => { if (document.visibilityState === "visible" && !(await load())) clearInterval(timer); }, 15000);
    }
  }

  /* ---------------- start ---------------- */
  const frag = C.parseFragment(location.hash);
  if (frag && frag.kind === "recipient") initRecipient(frag.id, frag.secret);
  else if (frag && frag.kind === "status") initStatus(frag.id, frag.secret);
  else initSender();
})();
