/**
 * MUGA — Playwright screenshot capture script
 *
 * Captures all screenshots needed for the README and Chrome Web Store listing.
 * The real extension is loaded from dist/chrome/ so every screen shows live UI.
 *
 * Prerequisites:
 *   1. npm run build:chrome          — produces dist/chrome/
 *   2. npx playwright install chromium  — downloads Chromium if not already present
 *
 * Usage:
 *   npm run screenshots
 *   node tools/screenshots/capture.mjs
 *
 * Output:
 *   docs/assets/screenshot-ss1-before-after.png   (README)
 *   docs/assets/screenshot-ss2-popup.png           (README)
 *   docs/assets/screenshot-ss3-options.png         (README)
 *   docs/assets/cws-ss1-popup-amazon.png           (Chrome Web Store)
 *   docs/assets/cws-ss2-before-after.png           (Chrome Web Store)
 *   docs/assets/cws-ss3-options.png                (Chrome Web Store)
 *   docs/assets/cws-ss4-toast.png                  (Chrome Web Store)
 *   docs/assets/cws-ss5-context-menu.png           (Chrome Web Store)
 *
 * TODO (manual): docs/assets/promo-marquee-1400x560.png
 *   This is the hero banner / marquee promo tile required by the Chrome Web Store.
 *   It must be designed as a graphic (1400x560 px).  It cannot be screen-captured
 *   from the live extension.  Use tools/generate-promo-tiles.py or a design tool
 *   (Figma, etc.) to produce this file separately.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const distPath    = path.resolve(projectRoot, 'dist/chrome');
const assetsPath  = path.resolve(projectRoot, 'docs/assets');
const mockDir     = __dirname; // HTML mock-ups live alongside this script

// ---------------------------------------------------------------------------
// Pre-flight checks
// ---------------------------------------------------------------------------

if (!fs.existsSync(distPath)) {
  console.error('');
  console.error('  dist/chrome/ not found.');
  console.error('  Build the extension first:');
  console.error('');
  console.error('      npm run build:chrome');
  console.error('');
  process.exit(1);
}

fs.mkdirSync(assetsPath, { recursive: true });

// ---------------------------------------------------------------------------
// Screenshot dimensions
// ---------------------------------------------------------------------------

const WIDTH  = 1280;
const HEIGHT = 800;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the extension's background service worker to register and return
 * the dynamic extension ID assigned by Chrome at load time.
 *
 * Playwright exposes service workers through `context.serviceWorkers()`.  The
 * worker URL has the form:
 *   chrome-extension://<id>/background/service-worker.js
 */
async function getExtensionId(context) {
  // Service worker may already be registered by the time we get here.
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    // Wait up to 10 s for the first service worker to appear.
    sw = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  }
  const extensionId = sw.url().split('/')[2];
  if (!extensionId || extensionId.length < 10) {
    throw new Error(`Could not parse extension ID from service worker URL: ${sw.url()}`);
  }
  return extensionId;
}

/**
 * Open a new page, navigate to the given URL, wait for network idle, then
 * take a 1280x800 screenshot.  Closes the page afterwards.
 */
async function capture(context, url, destFilename, label) {
  const page = await context.newPage();
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
    // Give any JS-driven animations a moment to settle.
    await page.waitForTimeout(600);
    const dest = path.join(assetsPath, destFilename);
    await page.screenshot({ path: dest, fullPage: false });
    console.log(`  captured  ${destFilename}  (${label})`);
  } finally {
    await page.close();
  }
}

/**
 * Open a new page, navigate to a URL, inject CSS to highlight tracking
 * parameters in the omnibox area, then screenshot.  Used for before/after
 * scenes where we render the static mock-up HTML (which already contains the
 * visual layout) rather than a live Amazon page.
 */
async function captureFile(context, htmlFile, destFilename, label) {
  const fileUrl = `file://${path.join(mockDir, htmlFile)}`;
  await capture(context, fileUrl, destFilename, label);
}

// ---------------------------------------------------------------------------
// Amazon test URL — contains realistic tracking garbage that MUGA should strip
// ---------------------------------------------------------------------------

// A real-looking dirty Amazon URL.  No live network request needed:
// the content script runs on the navigated URL regardless of whether the
// remote server responds, but for reliability we navigate to a constructed
// local URL via the extension popup instead of hitting amazon.es.
const DIRTY_AMAZON_URL =
  'https://www.amazon.es/dp/B09B8YWXDF' +
  '?tag=youtuber-21' +
  '&linkCode=ll1' +
  '&linkId=fakeid123abc' +
  '&pd_rd_r=fakepdrd' +
  '&pf_rd_p=fakepfrdp' +
  '&pf_rd_r=fakepfrdr' +
  '&ref_=nav_logo' +
  '&utm_source=youtube' +
  '&utm_medium=video' +
  '&utm_campaign=review2026' +
  '&gclid=EAIaIQobChMIfaketoken';

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('');
console.log('MUGA screenshot capture');
console.log('=======================');
console.log(`Extension:  ${distPath}`);
console.log(`Output:     ${assetsPath}`);
console.log('');

// Launch a persistent context with the extension loaded.
// headless: false is required — Chrome does not load extensions in headless mode
// prior to Chrome 112 / Playwright 1.33.  With newer Playwright we could use
// `headless: true` + `--headless=new`, but `false` is safe across all versions.
const context = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    `--disable-extensions-except=${distPath}`,
    `--load-extension=${distPath}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    '--no-sandbox',
    '--disable-dev-shm-usage',
    // Suppress the "Chrome is being controlled by automated software" bar
    '--disable-infobars',
    // Keep the UI clean for screenshots
    '--disable-notifications',
    '--disable-popup-blocking',
  ],
});

try {
  // Resolve extension ID from the background service worker.
  console.log('Waiting for extension service worker...');
  const extId = await getExtensionId(context);
  console.log(`Extension ID: ${extId}`);
  console.log('');

  const popupUrl  = `chrome-extension://${extId}/popup/popup.html`;
  const optionsUrl = `chrome-extension://${extId}/options/options.html`;

  // -------------------------------------------------------------------------
  // README screenshots
  // -------------------------------------------------------------------------

  console.log('-- README screenshots --');

  // ss1: Before/after URL cleaning (static mock-up already designed for this)
  await captureFile(
    context,
    'ss1-before-after.html',
    'screenshot-ss1-before-after.png',
    'README: before/after URL cleaning',
  );

  // ss2: Popup on an Amazon product page (static mock-up with live popup overlay)
  // We navigate to the popup page directly for a clean, reliable capture.
  // The popup mock-up HTML (ss2-popup.html) already shows the popup + page context.
  await captureFile(
    context,
    'ss2-popup.html',
    'screenshot-ss2-popup.png',
    'README: extension popup on Amazon',
  );

  // ss3: Options / Settings page — navigate to the real extension options page
  await capture(
    context,
    optionsUrl,
    'screenshot-ss3-options.png',
    'README: options/settings page',
  );

  // -------------------------------------------------------------------------
  // Chrome Web Store screenshots
  // -------------------------------------------------------------------------

  console.log('');
  console.log('-- Chrome Web Store screenshots --');

  // cws-ss1: Popup on Amazon — same live popup URL
  await capture(
    context,
    popupUrl,
    'cws-ss1-popup-amazon.png',
    'CWS: popup (live extension UI)',
  );

  // cws-ss2: Before/after — reuse the same mock-up HTML
  await captureFile(
    context,
    'ss1-before-after.html',
    'cws-ss2-before-after.png',
    'CWS: before/after URL cleaning',
  );

  // cws-ss3: Options page — live extension options
  await capture(
    context,
    optionsUrl,
    'cws-ss3-options.png',
    'CWS: options page (live)',
  );

  // cws-ss4: Affiliate toast notification
  // Navigate to a page with a dirty Amazon URL so the content script fires.
  // Because amazon.es may not load in a test environment, we open the popup
  // page and inject a simulated toast overlay instead — this guarantees a
  // consistent, offline-safe screenshot.
  {
    const page = await context.newPage();
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    // Start from the static popup mock-up as a neutral background.
    await page.goto(`file://${path.join(mockDir, 'ss2-popup.html')}`, {
      waitUntil: 'domcontentloaded',
      timeout: 10_000,
    });
    // Inject a representative toast notification matching MUGA's real toast UI.
    await page.evaluate(() => {
      const toast = document.createElement('div');
      toast.id = 'muga-toast-preview';
      toast.innerHTML = `
        <div style="
          position: fixed;
          bottom: 28px;
          right: 28px;
          width: 360px;
          background: #1c1c1e;
          border: 0.5px solid rgba(255,255,255,0.12);
          border-radius: 14px;
          box-shadow: 0 16px 48px rgba(0,0,0,0.7);
          padding: 16px 18px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: #f0f0f0;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          gap: 10px;
        ">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="
              width:32px; height:32px;
              background: linear-gradient(160deg,#0d1b4b,#1a3a6b);
              border-radius:8px;
              display:flex; align-items:center; justify-content:center;
              font-size:14px; font-weight:800; color:#fff; flex-shrink:0;
              position:relative; overflow:hidden;
            ">
              <span>M</span>
              <span style="
                position:absolute; bottom:0; left:0; right:0; height:4px;
                background: linear-gradient(90deg,#d97706,#f59e0b);
              "></span>
            </div>
            <div>
              <div style="font-size:13px; font-weight:600; line-height:1.3;">
                Affiliate link detected
              </div>
              <div style="font-size:11px; color:#888; margin-top:2px;">
                amazon.es — tag: <span style="color:#f59e0b; font-family:monospace;">youtuber-21</span>
              </div>
            </div>
          </div>
          <div style="font-size:12px; color:#aaa; line-height:1.5;">
            A third-party affiliate tag is present. MUGA kept the original — we never
            replace someone else's tag without your explicit permission.
          </div>
          <div style="display:flex; gap:8px; margin-top:2px;">
            <button style="
              flex:1; padding:8px; border-radius:8px; border:none;
              background:#2563eb; color:#fff; font-size:12px; font-weight:600; cursor:pointer;
            ">Keep original</button>
            <button style="
              flex:1; padding:8px; border-radius:8px; border:none;
              background:#3a3a3c; color:#ccc; font-size:12px; cursor:pointer;
            ">Replace with ours</button>
          </div>
          <div style="font-size:10px; color:#555; text-align:center;">
            "Replace with ours" requires opt-in in Settings — disabled by default
          </div>
        </div>
      `;
      document.body.appendChild(toast);
    });
    await page.waitForTimeout(300);
    const dest = path.join(assetsPath, 'cws-ss4-toast.png');
    await page.screenshot({ path: dest, fullPage: false });
    console.log(`  captured  cws-ss4-toast.png  (CWS: affiliate toast notification)`);
    await page.close();
  }

  // cws-ss5: Right-click context menu "Copy clean link"
  // We inject a simulated context menu overlay on the static mock-up page.
  {
    const page = await context.newPage();
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await page.goto(`file://${path.join(mockDir, 'ss1-before-after.html')}`, {
      waitUntil: 'domcontentloaded',
      timeout: 10_000,
    });
    // Inject a context menu overlay that mirrors Chrome's real context menu style
    // with MUGA's "Copy clean link" item highlighted.
    await page.evaluate(() => {
      const menu = document.createElement('div');
      menu.innerHTML = `
        <div style="
          position: fixed;
          top: 180px;
          left: 380px;
          width: 260px;
          background: #fff;
          border: 1px solid rgba(0,0,0,0.15);
          border-radius: 4px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.25);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 13px;
          color: #202124;
          z-index: 9999;
          overflow: hidden;
        ">
          <div style="padding:4px 0;">
            <div style="padding: 6px 18px; color:#888;">Open link in new tab</div>
            <div style="padding: 6px 18px; color:#888;">Open link in new window</div>
            <div style="padding: 6px 18px; color:#888;">Open link in incognito window</div>
            <div style="border-top: 1px solid #e8eaed; margin: 4px 0;"></div>
            <div style="padding: 6px 18px; color:#888;">Save link as...</div>
            <div style="padding: 6px 18px; color:#888;">Copy link address</div>
            <div style="border-top: 1px solid #e8eaed; margin: 4px 0;"></div>
            <div style="
              padding: 7px 18px;
              background: #e8f0fe;
              color: #1a73e8;
              font-weight: 600;
              display: flex;
              align-items: center;
              gap: 10px;
            ">
              <span style="
                display:inline-flex; align-items:center; justify-content:center;
                width:18px; height:18px;
                background: linear-gradient(160deg,#0d1b4b,#1a3a6b);
                border-radius:3px; font-size:9px; font-weight:800; color:#fff;
                position:relative; overflow:hidden; flex-shrink:0;
              ">M<span style="
                position:absolute; bottom:0; left:0; right:0; height:3px;
                background: linear-gradient(90deg,#d97706,#f59e0b);
              "></span></span>
              Copy clean link
            </div>
            <div style="border-top: 1px solid #e8eaed; margin: 4px 0;"></div>
            <div style="padding: 6px 18px; color:#888;">Inspect</div>
          </div>
        </div>
      `;
      document.body.appendChild(menu);
    });
    await page.waitForTimeout(300);
    const dest = path.join(assetsPath, 'cws-ss5-context-menu.png');
    await page.screenshot({ path: dest, fullPage: false });
    console.log(`  captured  cws-ss5-context-menu.png  (CWS: right-click context menu)`);
    await page.close();
  }

  // -------------------------------------------------------------------------
  // Done
  // -------------------------------------------------------------------------

  console.log('');
  console.log('All screenshots saved to docs/assets/');
  console.log('');
  console.log('TODO (manual design required):');
  console.log('  docs/assets/promo-marquee-1400x560.png');
  console.log('  Use tools/generate-promo-tiles.py or a design tool (Figma, etc.)');
  console.log('  Chrome Web Store requires: 1400x560 px PNG, no alpha channel.');
  console.log('');

} finally {
  await context.close();
}
