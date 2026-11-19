/* Kuvert – gemeinsame Seitenlogik: Farbschema, Navigation, Einblenden beim Scrollen. */
(function () {
  "use strict";
  var root = document.documentElement;
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  var btn = document.getElementById("themeToggle");
  var menuTheme = null;   // Umschalter unten im mobilen Menü
  function sync() {
    var dark = root.getAttribute("data-theme") === "dark";
    if (btn) { btn.innerHTML = dark ? SUN : MOON; btn.setAttribute("aria-label", dark ? "Helles Farbschema" : "Dunkles Farbschema"); }
    if (menuTheme) {
      menuTheme.setAttribute("aria-checked", String(dark));
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#09090b" : "#f6f5f2");
  }
  function toggleTheme() {
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("kuvert-theme", next); } catch (e) {}
    sync();
  }
  sync();
  if (btn) btn.addEventListener("click", toggleTheme);

  /* Mobiles Menü: übernimmt die Links aus der Navigation, sichtbar unter 720 px */
  var navLinks = document.querySelector(".nav-links");
  var navBar = document.getElementById("nav");
  if (navLinks && navBar) {
    var links = Array.prototype.slice.call(navLinks.querySelectorAll("a.nl, a.icon-btn[href]"));
    if (links.length) {
      var menu = document.createElement("div");
      menu.className = "mobile-menu"; menu.id = "mobileMenu"; menu.hidden = true;
      links.forEach(function (a) {
        var item = document.createElement("a");
        item.href = a.getAttribute("href");
        if (a.target) { item.target = a.target; item.rel = a.rel; }
        var label = (a.textContent || "").replace(/\s+/g, " ").trim() || a.getAttribute("aria-label") || "";
        item.textContent = /GitHub/i.test(a.getAttribute("aria-label") || "") ? "Quelltext auf GitHub" : label;
        menu.appendChild(item);
      });
      if (btn) {
        menuTheme = document.createElement("button");
        menuTheme.type = "button"; menuTheme.className = "menu-theme"; menuTheme.setAttribute("role", "switch");
        menuTheme.setAttribute("aria-label", "Dunkles Design");
        menuTheme.innerHTML = '<span class="mt-icon" aria-hidden="true">' + MOON + '</span><span class="mt-label">Dunkles Design</span><span class="mt-switch" aria-hidden="true"><span></span></span>';
        menuTheme.addEventListener("click", function (e) { e.stopPropagation(); toggleTheme(); });
        menu.appendChild(menuTheme);
        document.body.classList.add("has-menu-theme");
        sync();
      }
      navBar.appendChild(menu);
      var MENU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
      var CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      var mb = document.createElement("button");
      mb.type = "button"; mb.className = "icon-btn menu-btn"; mb.innerHTML = MENU;
      mb.setAttribute("aria-label", "Menü öffnen"); mb.setAttribute("aria-expanded", "false"); mb.setAttribute("aria-controls", "mobileMenu");
      navLinks.appendChild(mb);
      var setOpen = function (open) {
        menu.hidden = !open; mb.innerHTML = open ? CLOSE : MENU;
        mb.setAttribute("aria-expanded", String(open)); mb.setAttribute("aria-label", open ? "Menü schließen" : "Menü öffnen");
      };
      mb.addEventListener("click", function (e) { e.stopPropagation(); setOpen(menu.hidden); });
      menu.addEventListener("click", function (e) { if (e.target.closest("a")) setOpen(false); });
      document.addEventListener("click", function (e) { if (!menu.hidden && !navBar.contains(e.target)) setOpen(false); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) { setOpen(false); mb.focus(); } });
      window.addEventListener("resize", function () { if (window.innerWidth > 720 && !menu.hidden) setOpen(false); });
    }
  }

  // Service Worker (installierbare App, Offline-Fallback für /app)
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
  }

  var nav = document.getElementById("nav");
  if (nav) {
    var onScroll = function () { nav.classList.toggle("scrolled", window.scrollY > 8); };
    window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
  }

  var items = document.querySelectorAll(".reveal-up");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    items.forEach(function (el, i) { el.style.transitionDelay = (i % 3) * 70 + "ms"; io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add("in"); });
  }
})();
