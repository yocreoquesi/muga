/**
 * MUGA: render the store and social images in docs/assets/.
 *
 * Ported from the MUGA brand kit render sources. Each image is a template in
 * templates.js, rendered by stage.html in headless Chrome and screenshotted
 * at its exact store size. No extension build is involved: the popup, settings
 * page, context menu and chat are faithful HTML replicas in components.js.
 *
 * Usage:
 *   npm run screenshots              every image below
 *   npm run promo-tile               only the two promo tiles
 *   node tools/screenshots/render.mjs <filter>   outputs whose name contains <filter>
 *
 * Fonts are downloaded once into tools/screenshots/fonts/ (gitignored) by
 * fetch-fonts.mjs, so renders after the first never hit the network.
 * Uses system Chrome when present (override with MUGA_CHROME), otherwise the
 * Playwright Chromium.
 */
import { chromium } from "playwright";
import http from "node:http";
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFonts } from "./fetch-fonts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, "../../docs/assets");
const CHROME = process.env.MUGA_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const filter = process.argv[2] || "";

// ── Manifest: template, params, output file ──────────────
const STEMS = ["clean-links", "copy-and-share", "where-links-go", "this-page-popup", "settings"];
const JOBS = [];
STEMS.forEach((stem, i) => {
  const n = i + 1;
  JOBS.push({ t: `ss${n}`, params: { browser: "chrome" }, out: `store-${n}-${stem}-1280x800.png` });
  JOBS.push({ t: `ss${n}`, params: { browser: "firefox" }, out: `firefox-store-${n}-${stem}-1280x800.png` });
});
JOBS.push({ t: "promo-small", params: {}, out: "promo-small-440x280.png" });
JOBS.push({ t: "marquee", params: {}, out: "promo-marquee-1400x560.png" });
JOBS.push({ t: "og", params: { lang: "en" }, out: "og-1200x630.png" });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };

// Tiny static server over this folder: stage.html imports ES modules, which need http.
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      const file = path.join(HERE, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!file.startsWith(HERE)) { res.writeHead(403).end(); return; }
      try {
        const buf = await readFile(file);
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
        res.end(buf);
      } catch {
        res.writeHead(404).end();
      }
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

if (!existsSync(path.join(HERE, "fonts", "fonts.css"))) {
  console.log("fetching fonts (first run)...");
  await fetchFonts();
}

const { srv, base } = await serve();
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined });
const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 800, height: 600 } });
mkdirSync(OUT_DIR, { recursive: true });
let n = 0;
try {
  for (const j of JOBS) {
    if (filter && !j.out.includes(filter)) continue;
    const page = await ctx.newPage();
    const q = new URLSearchParams({ t: j.t, ...j.params });
    await page.goto(`${base}/stage.html?${q}`);
    await page.waitForFunction(() => window.__ready === true);
    const { w, h } = await page.evaluate(() => window.__size);
    await page.setViewportSize({ width: w, height: h });
    await page.locator("#stage").screenshot({ path: path.join(OUT_DIR, j.out) });
    await page.close();
    console.log(`  rendered  docs/assets/${j.out}  (${w}x${h})`);
    n++;
  }
} finally {
  await browser.close();
  srv.close();
}
console.log(`rendered ${n} images`);
