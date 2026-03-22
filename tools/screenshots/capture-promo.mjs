/**
 * MUGA — Promo tile generator
 *
 * Renders tools/screenshots/promo-tile.html at exactly 1400×560 using Playwright
 * and saves the result to docs/assets/promo-marquee-1400x560.png.
 *
 * No extension build needed — this is pure HTML/CSS, no live extension required.
 *
 * Usage:
 *   npm run promo-tile
 *   node tools/screenshots/capture-promo.mjs
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath   = path.resolve(__dirname, 'promo-tile.html');
const outputPath = path.resolve(__dirname, '../../docs/assets/promo-marquee-1400x560.png');

const W = 1400;
const H = 560;

if (!fs.existsSync(htmlPath)) {
  console.error('❌  promo-tile.html not found at', htmlPath);
  process.exit(1);
}

console.log('🎨  Launching Chromium...');

const browser = await chromium.launch({ headless: true });
const page    = await browser.newPage();

await page.setViewportSize({ width: W, height: H });
await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });

// Give web fonts a moment to load (falls back to system fonts if offline)
await page.waitForTimeout(800);

await page.screenshot({
  path: outputPath,
  clip: { x: 0, y: 0, width: W, height: H },
});

await browser.close();

console.log(`✅  Promo tile saved → docs/assets/promo-marquee-1400x560.png  (${W}×${H})`);
