/* Kuvert – Service Worker für die installierte App.
   Bewusst zurückhaltend: Seiten kommen immer frisch aus dem Netz. Nur wenn kein Netz da ist,
   wird die zuletzt geladene App-Seite gezeigt (Link-Kuverts funktionieren dann trotzdem).
   CSS/JS übernimmt der normale Browser-Cache (versioniert per ?v=…). Die API wird nie angefasst. */
const CACHE = "kuvert-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;           // nur Seitenaufrufe
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && (url.pathname === "/app" || url.pathname === "/app.html")) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("/app", copy));
      }
      return res;
    }).catch(() => caches.match("/app").then((r) => r || new Response("Offline – bitte später erneut versuchen.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })))
  );
});
