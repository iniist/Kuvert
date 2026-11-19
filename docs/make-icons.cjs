// Erzeugt die App-Symbole (icons/) für Startbildschirm und Manifest. Aufruf: node docs/make-icons.cjs
const { chromium } = require("playwright");
const path = require("path");
const SEAL = require('fs').readFileSync(path.join(__dirname, '..', 'logo.svg'), 'utf8');
const page = (size, radius, inner) => `<html><body style="margin:0;background:transparent">
  <div style="width:${size}px;height:${size}px;border-radius:${radius}px;display:grid;place-items:center;
    background:radial-gradient(circle at 50% 35%,#1d1e22,#0b0b0d)">
    <div style="width:${inner}px;height:${inner}px">${SEAL.replace("<svg ", '<svg width="100%" height="100%" ')}</div>
  </div></body></html>`;
(async () => {
  const b = await chromium.launch();
  const out = path.join(__dirname, "..", "icons");
  for (const [name, size, radius, inner] of [
    ["icon-192.png", 192, 42, 150], ["icon-512.png", 512, 112, 400],
    ["icon-maskable-512.png", 512, 0, 300],          // Vollfläche, Motiv in der sicheren Mitte
    ["apple-touch-icon.png", 180, 0, 136],           // iOS rundet selbst ab
  ]) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(page(size, radius, inner));
    await p.screenshot({ path: path.join(out, name), omitBackground: true });
    await p.close();
  }
  await b.close();
  console.log("Icons erzeugt in icons/");
})();
