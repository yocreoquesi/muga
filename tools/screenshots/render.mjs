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
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFonts, isFontCacheComplete } from "./fetch-fonts.mjs";

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

/**
 * Jobs whose output filename contains `filter` (all of them when empty).
 * Exported so a `--filter` that matches nothing can be detected without
 * running the whole render pipeline (#1489).
 * @template {{ out: string }} T
 * @param {T[]} jobs
 * @param {string} f
 * @returns {T[]}
 */
export function matchingJobs(jobs, f) {
  if (!f) return jobs;
  return jobs.filter((j) => j.out.includes(f));
}

/**
 * Is `file` contained within the `here` directory? Uses path.relative so a
 * sibling folder that merely shares a name prefix with `here` (e.g. `here`
 * is "/a/b" and `file` is "/a/bEvil/x") cannot pass a plain startsWith
 * check (#1489).
 * @param {string} here - absolute directory root
 * @param {string} file - absolute candidate path
 * @returns {boolean}
 */
export function isContained(here, file) {
  const rel = path.relative(here, file);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };

// Tiny static server over this folder: stage.html imports ES modules, which need http.
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      const { pathname } = new URL(req.url, "http://x");
      // Chrome auto-requests this; a 404 here would otherwise surface as a
      // console error and trip the fail-fast template-error check below (#1489).
      if (pathname === "/favicon.ico") { res.writeHead(204).end(); return; }
      const file = path.join(HERE, decodeURIComponent(pathname));
      if (!isContained(HERE, file)) { res.writeHead(403).end(); return; }
      try {
        const buf = await readFile(file);
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
        res.end(buf);
      } catch {
        res.writeHead(404).end();
      }
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (srv.address()).port}` }));
  });
}

/**
 * Reject as soon as `page` throws or logs a console error, naming the
 * failing job. Raced against waitForFunction(__ready) so a broken template
 * fails immediately instead of sitting out the 30s default timeout (#1489).
 * @param {import("playwright").Page} page
 * @param {string} jobName
 * @returns {Promise<never>}
 */
function waitForPageError(page, jobName) {
  return new Promise((_resolve, reject) => {
    page.on("pageerror", (err) => reject(new Error(`template error in "${jobName}": ${err.message}`)));
    page.on("console", (msg) => {
      if (msg.type() === "error") reject(new Error(`template error in "${jobName}": ${msg.text()}`));
    });
  });
}

async function main() {
  const jobsToRun = matchingJobs(JOBS, filter);
  if (filter && jobsToRun.length === 0) {
    console.error(`no screenshot job matches --filter "${filter}"`);
    process.exitCode = 1;
    return;
  }

  // Cache is valid only when every expected font file is present, not just
  // fonts.css — a run interrupted mid-download must be detected (#1489).
  const fontsDir = path.join(HERE, "fonts");
  const existingFonts = existsSync(fontsDir) ? readdirSync(fontsDir) : [];
  if (!isFontCacheComplete(existingFonts)) {
    console.log("fetching fonts (cache missing or incomplete)...");
    await fetchFonts();
  }

  const { srv, base } = await serve();
  const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined });
  const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 800, height: 600 } });
  mkdirSync(OUT_DIR, { recursive: true });
  let n = 0;
  try {
    for (const j of jobsToRun) {
      const page = await ctx.newPage();
      const failFast = waitForPageError(page, j.out);
      const q = new URLSearchParams({ t: j.t, ...j.params });
      await page.goto(`${base}/stage.html?${q}`);
      try {
        await Promise.race([page.waitForFunction(() => /** @type {any} */ (window).__ready === true), failFast]);
      } catch (err) {
        // Re-thrown with the job name so a plain waitForFunction timeout
        // (e.g. a template that never sets __ready) is diagnosable too (#1489).
        throw new Error(`render failed for job "${j.out}": ${/** @type {Error} */ (err).message}`);
      }
      const { w, h } = await page.evaluate(() => /** @type {any} */ (window).__size);
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
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
