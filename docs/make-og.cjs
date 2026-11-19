// Erzeugt og-image.png aus docs/og-template.html (benötigt Playwright).
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await p.goto("file://" + path.join(__dirname, "og-template.html"));
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(__dirname, "..", "og-image.png") });
  await b.close();
  console.log("og-image.png geschrieben");
})();
