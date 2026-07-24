/**
 * MUGA — Playwright screenshot capture script
 *
 * Captures all screenshots needed for the README and Chrome Web Store listing.
 * The real extension is loaded from src/ so every screen shows live UI.
 *
 * Prerequisites:
 *   1. Extension source in src/ (no build step needed — vanilla JS)
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
 *   docs/assets/screenshot-ss4-onboarding.png      (README)
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
// Single source of truth for the ToS version the running code requires
// (src/lib/consent-version-manifest.js). Keeping this in sync with the seeded
// mugaConsent.consentVersion avoids a soft/hard re-onboard gate kicking in
// during capture (see getPrefs()'s ConsentPolicy check in src/lib/prefs.js).
import { REQUIRED_CONSENT_VERSION } from '../../src/lib/consent-version-manifest.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const distPath    = path.resolve(projectRoot, 'src');
const assetsPath  = path.resolve(projectRoot, 'docs/assets');
const mockDir     = __dirname; // HTML mock-ups live alongside this script

// ---------------------------------------------------------------------------
// Pre-flight checks
// ---------------------------------------------------------------------------

if (!fs.existsSync(distPath)) {
  console.error('');
  console.error('  src/ not found.');
  console.error('  Extension source directory missing.');
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
const _DIRTY_AMAZON_URL =
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
    '--disable-gpu',
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
  const onboardingUrl = `chrome-extension://${extId}/onboarding/onboarding.html`;

  // Complete onboarding to prevent redirect from options/popup to onboarding page.
  // Reuse existing extension page (auto-opened onboarding) if available.
  //
  // IMPORTANT (ADR-0001, #355): consent (onboardingDone/consentVersion/
  // consentDate) moved OUT of chrome.storage.sync into a single
  // chrome.storage.local["mugaConsent"] record (see src/lib/consent-storage.js).
  // options.js / popup.js read that record via getConsent(), not the legacy
  // sync fields. Seeding the OLD flat sync keys here (as this script used to)
  // no longer satisfies the consent gate, so every capture silently rendered
  // the onboarding redirect instead of the real options/popup page. Seed the
  // new shape instead. We deliberately do NOT also write the legacy sync
  // keys: sync-migration.js only copies sync -> local when local is empty,
  // and touching the legacy keys risks migration racing this seed.
  const extOrigin = `chrome-extension://${extId}`;
  let extPage = context.pages().find((p) => p.url().startsWith(extOrigin));
  if (!extPage) {
    extPage = await context.newPage();
    await extPage.goto(`${extOrigin}/onboarding/onboarding.html`);
  }
  await extPage.evaluate((requiredConsentVersion) => {
    return Promise.all([
      // Per-device consent record (chrome.storage.local, ADR-0001).
      new Promise((resolve) => {
        chrome.storage.local.set(
          {
            mugaConsent: {
              onboardingDone: true,
              consentVersion: requiredConsentVersion,
              consentDate: Date.now(),
            },
            // devMode unlocks the Advanced (Tier 2/3) card in options.html,
            // including the Cookie Consent Minimizer select.
            devMode: true,
            // Lifetime stats (popup.js reads chrome.storage.local["stats"]).
            // Populated so the popup shows real numbers instead of 0/0/0.
            stats: { urlsCleaned: 3482, junkRemoved: 12894, referralsSpotted: 231 },
            // Per-domain noise stats (src/lib/storage.js getDomainStats()).
            domainStats: {
              'amazon.es': { params: 4210, urls: 812 },
              'youtube.com': { params: 3190, urls: 640 },
              'booking.com': { params: 1780, urls: 210 },
            },
            // Attribution Ledger ring buffer (src/lib/attribution-ledger.js)
            // so the popup's "Recent activity" section is populated.
            attributionLedger: {
              capacity: 10,
              events: [
                { type: 'clean', url: 'https://www.amazon.es/dp/B09B8YWXDF' },
                { type: 'preserve-affiliate', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', network: 'youtube' },
                { type: 'inject-affiliate', url: 'https://www.booking.com/hotel/es/my-hotel.html', network: 'booking' },
              ],
            },
          },
          resolve,
        );
      }),
      // Behavioural prefs (chrome.storage.sync). Values already match
      // PREF_DEFAULTS except where noted; set explicitly so the capture is
      // stable even if a default changes later.
      new Promise((resolve) => {
        chrome.storage.sync.set(
          {
            injectOwnAffiliate: true,
            notifyForeignAffiliate: false,
            language: 'en',
            blacklist: ['facebook.com', 'twitter.com'],
            whitelist: ['amazon.es::tag::mkbhd-21'],
            userCustomRules: ['ref_src'],
          },
          resolve,
        );
      }),
    ]);
  }, REQUIRED_CONSENT_VERSION);
  // Close auto-opened onboarding tabs
  for (const p of context.pages()) {
    if (p.url().includes('/onboarding/')) {
      await p.close();
    }
  }

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

  // ss2: Extension popup — live capture of the real popup.html, seeded with
  // populated stats/ledger above (mirrors cws-ss1-popup-amazon below). The
  // old ss2-popup.html mock-up (stale stat labels/footer, no preview/ledger
  // markup) is no longer used for this capture — kept on disk only as a
  // still-referenced static background for the cws-ss4 toast composite.
  await capture(
    context,
    popupUrl,
    'screenshot-ss2-popup.png',
    'README: extension popup (live)',
  );

  // ss3: Options / Settings page — navigate to the real extension options page
  await capture(
    context,
    optionsUrl,
    'screenshot-ss3-options.png',
    'README: options/settings page',
  );

  // ss4: Onboarding / welcome page — live capture of the real onboarding page.
  // onboarding.html has no "already consented, redirect away" guard (it's the
  // page onboarding.js writes consent FROM, and re-onboard banners are its
  // own in-page state, not a redirect target), so it stays directly
  // navigable and capturable regardless of the consent seed above.
  await capture(
    context,
    onboardingUrl,
    'screenshot-ss4-onboarding.png',
    'README: onboarding/welcome page',
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
    // Inject a toast notification mirroring the REAL one built by
    // showAffiliateNotice() in src/content/cleaner.js: same copy (toast_title
    // / toast_tag_msg / toast_allow / toast_block / toast_dismiss strings),
    // same dark-toast layout. Native context menus/toasts can't be triggered
    // through Playwright against a real page in this harness, so this stays a
    // composed overlay, but the text is byte-for-byte the shipped English
    // copy (src/lib/locales/en.mjs) rather than invented placeholder copy.
    // The only invented visual is the brand mark, recolored to MUGA's actual
    // purple accent (--accent #6A2BCF / --accent-strong #5318B5) instead of
    // the previous off-brand navy/blue.
    await page.evaluate(() => {
      const toast = document.createElement('div');
      toast.id = 'muga-toast-preview';
      toast.innerHTML = `
        <div style="
          position: fixed;
          bottom: 28px;
          right: 28px;
          width: 320px;
          background: #1c1c1e;
          border: 0.5px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          box-shadow: 0 16px 48px rgba(0,0,0,0.7);
          padding: 14px 16px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: #f0f0f0;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          gap: 4px;
        ">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
            <div style="
              width:28px; height:28px;
              background: linear-gradient(160deg,#6A2BCF,#5318B5);
              border-radius:7px;
              display:flex; align-items:center; justify-content:center;
              font-size:13px; font-weight:800; color:#fff; flex-shrink:0;
            ">M</div>
            <div style="font-weight:500; font-size:12px; color:#aaa;">
              MUGA found someone else's affiliate tag
            </div>
          </div>
          <div style="font-size:12px; color:#ddd; margin-bottom:10px;">
            amazon.es has an affiliate tag that isn't ours: <code style="background:rgba(255,255,255,0.1); padding:1px 4px; border-radius:3px;">tag=youtuber-21</code>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button style="
              flex:1; padding:5px 8px; border-radius:6px;
              border:0.5px solid rgba(255,255,255,0.2);
              background:transparent; color:#f0f0f0; font-size:11px; cursor:pointer;
            ">Keep it</button>
            <button style="
              flex:1; padding:5px 8px; border-radius:6px;
              border:0.5px solid rgba(255,255,255,0.2);
              background:transparent; color:#f0f0f0; font-size:11px; cursor:pointer;
            ">Remove it</button>
          </div>
          <div style="margin-top:6px; font-size:10px; color:#666; text-align:right;">Dismiss</div>
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
    // Inject a context menu overlay that mirrors Chrome's real context menu
    // style with MUGA's two registered items highlighted — both
    // "muga-copy-clean" (contexts:["link"]) and "muga-copy-clean-selection"
    // (contexts:["selection"]), titles from src/background/service-worker.js
    // syncContextMenus()/src/lib/locales/en.mjs (ctx_copy_clean_link /
    // ctx_copy_clean_selection). Chrome only ever shows ONE of these at a
    // time (link vs. text-selection right-click are mutually exclusive), so
    // this composite intentionally shows both to document both capabilities
    // in a single asset — native menus can't be Playwright-captured at all.
    await page.evaluate(() => {
      const menu = document.createElement('div');
      menu.innerHTML = `
        <div style="
          position: fixed;
          top: 180px;
          left: 380px;
          width: 280px;
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
              background: #EFE6FB;
              color: #5318B5;
              font-weight: 600;
              display: flex;
              align-items: center;
              gap: 10px;
            ">
              <span style="
                display:inline-flex; align-items:center; justify-content:center;
                width:18px; height:18px;
                background: linear-gradient(160deg,#6A2BCF,#5318B5);
                border-radius:3px; font-size:9px; font-weight:800; color:#fff;
                flex-shrink:0;
              ">M</span>
              Copy clean link
            </div>
            <div style="
              padding: 7px 18px;
              background: #EFE6FB;
              color: #5318B5;
              font-weight: 600;
              display: flex;
              align-items: center;
              gap: 10px;
            ">
              <span style="
                display:inline-flex; align-items:center; justify-content:center;
                width:18px; height:18px;
                background: linear-gradient(160deg,#6A2BCF,#5318B5);
                border-radius:3px; font-size:9px; font-weight:800; color:#fff;
                flex-shrink:0;
              ">M</span>
              Copy clean links in selection
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
