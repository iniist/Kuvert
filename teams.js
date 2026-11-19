/* Kuvert Teams – Anfrageformular. Versand über den Server (api/index.php?a=inquiry),
   mailto nur als Notlösung, wenn der Server die Anfrage nicht annehmen kann. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const form = $("teamsForm"), note = $("tNote"), btn = $("tSubmit");
  if (!form) return;
  const API = new URL("api/index.php?a=inquiry", location.href.split("#")[0]).toString();
  const CONTACT = "info@iniist.com";

  function setNote(msg, kind) { note.textContent = msg || ""; note.className = "note" + (kind ? " " + kind : ""); }

  function values() {
    return {
      name: $("tName").value.trim(), company: $("tCompany").value.trim(), email: $("tEmail").value.trim(),
      size: $("tSize").value, message: $("tMessage").value.trim(), privacy: $("tPrivacy").checked, website: $("tWebsite").value,
    };
  }

  function mailtoLink(v) {
    const body = "Hallo,\n\nwir interessieren uns für Kuvert Teams.\n\nName: " + v.name + "\nUnternehmen: " + v.company +
      "\nE-Mail: " + v.email + "\nTeamgröße: " + v.size + "\n\n" + (v.message || "");
    return "mailto:" + CONTACT + "?subject=" + encodeURIComponent("Kuvert Teams – Anfrage von " + (v.company || "")) + "&body=" + encodeURIComponent(body);
  }

  function fallback(v, msg) {
    setNote(msg + " Du kannst die Anfrage stattdessen per E-Mail schicken: ", "err");
    const a = document.createElement("a");
    a.className = "link"; a.href = mailtoLink(v); a.textContent = "E-Mail öffnen →";
    note.appendChild(a);
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const v = values();
    const firstInvalid = [["tName", !v.name], ["tCompany", !v.company], ["tEmail", !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)], ["tSize", !v.size], ["tPrivacy", !v.privacy]]
      .find(([, bad]) => bad);
    if (firstInvalid) {
      const msgs = { tName: "Bitte deinen Namen angeben.", tCompany: "Bitte das Unternehmen angeben.", tEmail: "Bitte eine gültige E-Mail-Adresse angeben.",
                     tSize: "Bitte die Teamgröße wählen.", tPrivacy: "Bitte der Verarbeitung deiner Angaben zustimmen." };
      setNote(msgs[firstInvalid[0]], "err"); $(firstInvalid[0]).focus(); return;
    }
    btn.disabled = true; btn.textContent = "Wird gesendet …"; setNote("", "");
    try {
      const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
                                     body: JSON.stringify(v), credentials: "omit", cache: "no-store" });
      let data = null; try { data = await res.json(); } catch (e) {}
      if (res.ok) {
        form.hidden = true; $("tDoneMail").textContent = v.email; $("tDone").hidden = false;
        $("formCard").scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      const err = (data && data.error) || {};
      if (res.status >= 500 || err.fallback) fallback(v, "Das Formular ist gerade nicht erreichbar.");
      else setNote(err.message || "Die Anfrage konnte nicht gesendet werden.", "err");
    } catch (e) {
      fallback(v, "Der Server ist gerade nicht erreichbar.");
    } finally { btn.disabled = false; btn.textContent = "Anfrage senden"; }
  });
})();
