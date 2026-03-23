/**
 * MUGA — Screenshot capture from static mock-ups (no extension required)
 *
 * Captures all screenshots from the pre-designed HTML mock-ups.
 * Works in headless mode without loading the extension — ideal for CI/WSL.
 *
 * Usage:  node tools/screenshots/capture-mockups.mjs
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const assetsPath  = path.resolve(projectRoot, 'docs/assets');
const mockDir     = __dirname;

fs.mkdirSync(assetsPath, { recursive: true });

const WIDTH  = 1280;
const HEIGHT = 800;

async function capture(page, htmlFile, destFilename, label) {
  const fileUrl = `file://${path.join(mockDir, htmlFile)}`;
  await page.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 });
  await page.waitForTimeout(400);
  const dest = path.join(assetsPath, destFilename);
  await page.screenshot({ path: dest, fullPage: false });
  console.log(`  captured  ${destFilename}  (${label})`);
}

console.log('');
console.log('MUGA screenshot capture (mock-ups only)');
console.log('========================================');
console.log(`Output: ${assetsPath}`);
console.log('');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
const page = await context.newPage();

try {
  // README screenshots
  console.log('-- README screenshots --');
  await capture(page, 'ss1-before-after.html', 'screenshot-ss1-before-after.png', 'README: before/after');
  await capture(page, 'ss2-popup.html', 'screenshot-ss2-popup.png', 'README: popup');
  await capture(page, 'ss3-options.html', 'screenshot-ss3-options.png', 'README: options');

  // Chrome Web Store screenshots
  console.log('');
  console.log('-- Chrome Web Store screenshots --');
  await capture(page, 'ss2-popup.html', 'cws-ss1-popup-amazon.png', 'CWS: popup');
  await capture(page, 'ss1-before-after.html', 'cws-ss2-before-after.png', 'CWS: before/after');
  await capture(page, 'ss3-options.html', 'cws-ss3-options.png', 'CWS: options');

  // cws-ss4: Toast notification
  await page.goto(`file://${path.join(mockDir, 'ss2-popup.html')}`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
  await page.evaluate(() => {
    const toast = document.createElement('div');
    toast.innerHTML = `
      <div style="
        position:fixed; bottom:28px; right:28px; width:360px;
        background:#1c1c1e; border:0.5px solid rgba(255,255,255,0.12);
        border-radius:14px; box-shadow:0 16px 48px rgba(0,0,0,0.7);
        padding:16px 18px;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        color:#f0f0f0; z-index:9999; display:flex; flex-direction:column; gap:10px;
      ">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:32px;height:32px;background:linear-gradient(160deg,#0d1b4b,#1a3a6b);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#fff;flex-shrink:0;position:relative;overflow:hidden;">
            <span>M</span>
            <span style="position:absolute;bottom:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#d97706,#f59e0b);"></span>
          </div>
          <div>
            <div style="font-size:13px;font-weight:600;line-height:1.3;">Affiliate link detected</div>
            <div style="font-size:11px;color:#888;margin-top:2px;">amazon.es — tag: <span style="color:#f59e0b;font-family:monospace;">youtuber-21</span></div>
          </div>
        </div>
        <div style="font-size:12px;color:#aaa;line-height:1.5;">
          A third-party affiliate tag is present. MUGA kept the original — we never replace someone else's tag without your explicit permission.
        </div>
        <div style="display:flex;gap:8px;margin-top:2px;">
          <button style="flex:1;padding:8px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Keep original</button>
          <button style="flex:1;padding:8px;border-radius:8px;border:none;background:#3a3a3c;color:#ccc;font-size:12px;cursor:pointer;">Replace with ours</button>
        </div>
        <div style="font-size:10px;color:#555;text-align:center;">
          "Replace with ours" requires opt-in in Settings — disabled by default
        </div>
      </div>`;
    document.body.appendChild(toast);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(assetsPath, 'cws-ss4-toast.png'), fullPage: false });
  console.log('  captured  cws-ss4-toast.png  (CWS: toast notification)');

  // cws-ss5: Context menu
  await page.goto(`file://${path.join(mockDir, 'ss1-before-after.html')}`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
  await page.evaluate(() => {
    const menu = document.createElement('div');
    menu.innerHTML = `
      <div style="
        position:fixed; top:180px; left:380px; width:260px;
        background:#fff; border:1px solid rgba(0,0,0,0.15);
        border-radius:4px; box-shadow:0 4px 16px rgba(0,0,0,0.25);
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        font-size:13px; color:#202124; z-index:9999; overflow:hidden;
      ">
        <div style="padding:4px 0;">
          <div style="padding:6px 18px;color:#888;">Open link in new tab</div>
          <div style="padding:6px 18px;color:#888;">Open link in new window</div>
          <div style="padding:6px 18px;color:#888;">Open link in incognito window</div>
          <div style="border-top:1px solid #e8eaed;margin:4px 0;"></div>
          <div style="padding:6px 18px;color:#888;">Save link as...</div>
          <div style="padding:6px 18px;color:#888;">Copy link address</div>
          <div style="border-top:1px solid #e8eaed;margin:4px 0;"></div>
          <div style="padding:7px 18px;background:#e8f0fe;color:#1a73e8;font-weight:600;display:flex;align-items:center;gap:10px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;background:linear-gradient(160deg,#0d1b4b,#1a3a6b);border-radius:3px;font-size:9px;font-weight:800;color:#fff;position:relative;overflow:hidden;flex-shrink:0;">M<span style="position:absolute;bottom:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#d97706,#f59e0b);"></span></span>
            Copy clean link
          </div>
          <div style="border-top:1px solid #e8eaed;margin:4px 0;"></div>
          <div style="padding:6px 18px;color:#888;">Inspect</div>
        </div>
      </div>`;
    document.body.appendChild(menu);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(assetsPath, 'cws-ss5-context-menu.png'), fullPage: false });
  console.log('  captured  cws-ss5-context-menu.png  (CWS: context menu)');

  console.log('');
  console.log('All screenshots saved to docs/assets/');
  console.log('');
} finally {
  await browser.close();
}
