/* Kuvert Pro – Pro-Seite (pro.html): Erklärung & Kauf, Empfänger-Ansicht (#p1…) und Status-Ansicht (#s1…).
   Geschrieben wird in der App (app.html). Gemeinsame Logik: pro-core.js (KuvertPro). */
(function () {
  "use strict";

  if (location.protocol === "http:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    location.replace("https://" + location.host + location.pathname + location.search + location.hash);
    return;
  }

  // Rückkehr vom Polar-Checkout → direkt in die App zur Schlüsseleingabe
  if (/[?&]checkout_id=/.test(location.search)) {
    location.replace(new URL("app", location.href).toString().split("?")[0] + location.search);
    return;
  }

  const C = window.KuvertCrypto, P = window.KuvertPro;
  const $ = (id) => document.getElementById(id);
  const { fmt, api, copy, toast, note } = P;

  /* ---------------- Erklärseite: Kauf-Knopf, Preis, Status ---------------- */
  async function initMarketing() {
    let cfg = {};
    try { cfg = await api("config"); } catch (e) { cfg = { launched: false }; }
    const live = !!(cfg.launched || new URLSearchParams(location.search).has("preview"));
    $("heroSoon").hidden = live;
    $("heroLive").hidden = !live;
    $("heroBadge").textContent = live ? "Jetzt verfügbar" : "Bald verfügbar";
    $("heroBadge").classList.toggle("ok", live);
    if (!live) return;
    if (cfg.priceLabel) $("planPrice").textContent = cfg.priceLabel;
    if (P.license.key()) {
      $("planBuy").textContent = "Zur App"; $("planBuy").href = "./app?mode=pro";
      $("planApp").hidden = true;
    } else if (cfg.buyUrl) {
      $("planBuy").href = cfg.buyUrl;
    }
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
      if (!P.sent.load().some((x) => x.id === id) && st.state !== "unknown") {
        P.sent.upsert({ id, st: token, c: st.createdAt, e: st.expiresAt, r: st.readAt, n: !!st.notify, s: st.state });
      } else { const r = P.sent.apply(id, st); if (r.changed) P.announce(r.item); }
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


  /* ---------------- Start ---------------- */
  const frag = C.parseFragment(location.hash);
  if (frag && frag.kind === "recipient") initRecipient(frag.id, frag.secret);
  else if (frag && frag.kind === "status") initStatus(frag.id, frag.secret);
  else initMarketing();
})();
