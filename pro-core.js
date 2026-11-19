/* Kuvert Pro – gemeinsame Logik für app.js (App) und pro.js (Pro-Seite, Empfänger, Status).
   Server-API, Lizenz/Gerät, „Deine Kuverts“ (nur in diesem Browser), Formatierung, QR. */
(function (root) {
  "use strict";
  const PRO_PAGE = new URL("pro.html", location.href.split("#")[0]).toString();   // Empfänger- und Status-Links
  const API = new URL("api/index.php", location.href.split("#")[0]).toString();

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const LS = { license: "kuvert-pro-license", display: "kuvert-pro-license-display", activation: "kuvert-pro-activation",
               sent: "kuvert-pro-sent", notify: "kuvert-pro-browser-notify", mode: "kuvert-app-mode" };

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
  const nowSec = () => Math.floor(Date.now() / 1000);

  async function api(action, body, withLicense) {
    const opts = { method: body ? "POST" : "GET", headers: { Accept: "application/json" }, cache: "no-store", credentials: "omit" };
    if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    if (withLicense) {
      opts.headers["X-Kuvert-License"] = withLicense;
      const act = store.get(LS.activation);
      if (act) opts.headers["X-Kuvert-Activation"] = act;
    }
    let res, data = null;
    try { res = await fetch(API + "?a=" + encodeURIComponent(action), opts); }
    catch (e) { throw Object.assign(new Error("Der Server ist gerade nicht erreichbar. Bitte prüfe deine Verbindung."), { code: "network", status: 0 }); }
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const info = (data && data.error) || {};
      throw Object.assign(new Error(info.message || ("Fehler " + res.status)), { code: info.code || "http_" + res.status, status: res.status, data: info });
    }
    return data || {};
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch (_) {}
      ta.remove(); return ok;
    }
  }
  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById("toast"); if (!t) return;
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  }
  function note(el, msg, kind) { el.textContent = msg || ""; el.className = el.className.replace(/\s*\b(ok|err)\b/g, "") + (kind ? " " + kind : ""); }

  function renderQR(canvas, link) {
    if (typeof root.qrcode === "undefined") { canvas.style.display = "none"; return false; }
    let qr = null;
    for (let type = 1; type <= 40; type++) {
      try { qr = root.qrcode(type, "M"); qr.addData(link); qr.make(); break; }
      catch (e) { qr = null; if (String(e).indexOf("overflow") === -1) break; }
    }
    if (!qr) { canvas.style.display = "none"; return false; }
    const count = qr.getModuleCount(), margin = 2, cell = 6, size = (count + margin * 2) * cell;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, size, size); ctx.fillStyle = "#0a0a0c";
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    canvas.style.display = "block"; return true;
  }

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

  /* ---------------- „Deine Kuverts“ (nur in diesem Browser, ohne Inhalte) ---------------- */
  const sent = {
    load() { try { const a = JSON.parse(store.get(LS.sent) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } },
    save(list) {
      const cutoff = nowSec() - 7 * 86400;
      const kept = list.filter((x) => !(FINAL[x.s] && (x.r || x.e) < cutoff)).slice(0, 50);
      store.set(LS.sent, JSON.stringify(kept));
      return kept;
    },
    upsert(item) { const list = sent.load().filter((x) => x.id !== item.id); list.unshift(item); return sent.save(list); },
    remove(id) { return sent.save(sent.load().filter((x) => x.id !== id)); },
    statusLink(item) { return PRO_PAGE + "#s1." + item.id + "." + item.st; },
    /* Übernimmt einen Status vom Server. Gibt {item, changed} zurück (changed = war „waiting“ und ist es nicht mehr). */
    apply(id, st) {
      const list = sent.load();
      const item = list.find((x) => x.id === id);
      if (!item) return { item: null, changed: false };
      const before = item.s;
      item.s = st.state || "unknown";
      if (st.readAt) item.r = st.readAt;
      if (st.expiresAt) item.e = st.expiresAt;
      sent.save(list);
      return { item, changed: before === "waiting" && item.s !== "waiting" };
    },
  };

  function announce(item) {
    const msg = item.s === "read" ? "Dein Kuvert wurde geöffnet · " + fmt(item.r)
      : item.s === "destroyed" ? "Dein Kuvert wurde nach falschen Passwörtern vernichtet"
      : item.s === "expired" ? "Ein Kuvert ist ungelesen abgelaufen" : null;
    if (!msg) return;
    toast(msg);
    if (store.get(LS.notify) === "1" && "Notification" in root && Notification.permission === "granted") {
      try { new Notification("Kuvert Pro", { body: msg, tag: "kuvert-" + item.id }); } catch (e) {}
    }
  }

  /* ---------------- Lizenz & Gerät ---------------- */
  function deviceLabel() {
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
    const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
    return browser + (os ? " auf " + os : "") + " (" + new Date().toLocaleDateString("de-DE") + ")";
  }
  const license = {
    key() { return store.get(LS.license) || ""; },
    display() { return store.get(LS.display) || ""; },
    forget() { store.del(LS.license); store.del(LS.display); store.del(LS.activation); },
    /* Schaltet den Schlüssel auf diesem Gerät frei bzw. prüft ein bekanntes Gerät. Wirft bei Fehlern
       (code: license_invalid | device_limit | network | …). Max. 3 Geräte pro Schlüssel zählt Polar. */
    async activate(key, retried) {
      const known = key === license.key() ? store.get(LS.activation) : null;
      try {
        const r = await api("license", known ? { key, activationId: known } : { key, label: deviceLabel() });
        store.set(LS.license, key); store.set(LS.display, r.display || "");
        if (r.activationId) store.set(LS.activation, r.activationId); else store.del(LS.activation);
        return r;
      } catch (e) {
        if ((e.code === "activation_invalid" || e.code === "activation_required") && !retried) {
          store.del(LS.activation);              // z. B. im Kundenportal freigegeben → neu anmelden
          return license.activate(key, true);
        }
        if (e.code === "device_limit" || e.status === 403) license.forget();
        throw e;
      }
    },
    async release() {
      const key = license.key(), act = store.get(LS.activation);
      license.forget();
      if (key && act) { try { await api("deactivate", { key, activationId: act }); return true; } catch (e) {} }
      return false;
    },
  };

  root.KuvertPro = { PRO_PAGE, store, LS, fmt, ttlLabel, nowSec, api, copy, toast, note, renderQR, describe, FINAL, sent, announce, license };
})(typeof window !== "undefined" ? window : globalThis);
