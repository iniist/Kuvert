// Erzeugt die App-Symbole (icons/) für Startbildschirm und Manifest. Aufruf: node docs/make-icons.cjs
const { chromium } = require("playwright");
const path = require("path");
const ENV = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1b0a04" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m3.5 7 8.5 6.2L20.5 7"/></svg>';
const page = (size, radius, inner) => `<html><body style="margin:0;background:transparent">
  <div style="width:${size}px;height:${size}px;border-radius:${radius}px;display:grid;place-items:center;
    background:linear-gradient(145deg,#ff9670,#e2562e)">
    <div style="width:${inner}px;height:${inner}px">${ENV.replace("<svg ", '<svg width="100%" height="100%" ')}</div>
  </div></body></html>`;
(async () => {
  const b = await chromium.launch();
  const out = path.join(__dirname, "..", "icons");
  for (const [name, size, radius, inner] of [
    ["icon-192.png", 192, 42, 120], ["icon-512.png", 512, 112, 320],
    ["icon-maskable-512.png", 512, 0, 250],          // Vollfläche, Motiv in der sicheren Mitte
    ["apple-touch-icon.png", 180, 0, 110],           // iOS rundet selbst ab
  ]) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(page(size, radius, inner));
    await p.screenshot({ path: path.join(out, name), omitBackground: true });
    await p.close();
  }
  await b.close();
  console.log("Icons erzeugt in icons/");
})();
