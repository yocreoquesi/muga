/**
 * MUGA — Screenshot capture script
 * Generates 1280×800 PNG store screenshots using Windows Chrome headless (via WSL interop).
 * Run: node tools/screenshots/capture.mjs
 * Output: tools/screenshots/out/
 *
 * Requires: Chrome installed at the default Windows path.
 * Chrome runs on the Windows host; WSL paths are translated automatically.
 */

import { execSync, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

const CHROME = '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';

if (!fs.existsSync(CHROME)) {
  console.error('Chrome not found at:', CHROME);
  console.error('Install Chrome on Windows or update the CHROME path in this script.');
  process.exit(1);
}

function toWinPath(linuxPath) {
  return execSync(`wslpath -w "${linuxPath}"`).toString().trim();
}

const pages = [
  { file: 'ss1-before-after.html', out: 'screenshot-1-before-after.png',  title: 'Before / After URL cleaning' },
  { file: 'ss2-popup.html',        out: 'screenshot-2-popup.png',          title: 'Extension popup' },
  { file: 'ss3-options.html',      out: 'screenshot-3-options.png',        title: 'Settings page' },
  { file: 'ss4-onboarding.html',   out: 'screenshot-4-onboarding.png',     title: 'Onboarding / consent screen' },
];

for (const { file, out, title } of pages) {
  const srcPath = toWinPath(path.join(__dirname, file));
  const outPath = toWinPath(path.join(outDir, out));
  try {
    execFileSync(CHROME, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--window-size=1280,800',
      `--screenshot=${outPath}`,
      `file:///${srcPath}`,
    ], { timeout: 15000 });
    console.log(`✓  ${title} → ${out}`);
  } catch (e) {
    console.error(`✗  ${title}: ${e.message}`);
  }
}

console.log(`\nAll screenshots saved to tools/screenshots/out/`);
