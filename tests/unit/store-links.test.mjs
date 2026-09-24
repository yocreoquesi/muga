/**
 * MUGA — Unit tests for src/lib/store-links.js (#1387)
 *
 * Every "Rate MUGA" entry point used to hardcode
 * "https://chromewebstore.google.com/detail/muga/" — a URL with no extension
 * ID. Chrome Web Store resolves that shape to its store HOME page instead of
 * MUGA's own listing, so every Chrome user clicking "Rate MUGA" landed on the
 * wrong page.
 *
 * The fix centralizes both store URLs in src/lib/store-links.js (reusing
 * isFirefox() from browser-detect.js rather than re-detecting) and updates
 * all 4 call sites (popup footer, popup rating nudge, Settings footer,
 * Settings dev-tools rating-nudge preview) to import getRateUrl() from it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { CHROME_STORE_RATE_URL, FIREFOX_STORE_RATE_URL, getRateUrl } from "../../src/lib/store-links.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

const EXTENSION_ID = "pjdpeamhcjdhfijpmgamjdoplbnbajoh";
const OLD_BROKEN_URL = "https://chromewebstore.google.com/detail/muga/";

describe("store-links.js — CHROME_STORE_RATE_URL", () => {
  test("contains the real 32-character extension ID (#1387)", () => {
    assert.equal(EXTENSION_ID.length, 32, "sanity: the extension ID itself is 32 chars");
    assert.ok(
      CHROME_STORE_RATE_URL.includes(EXTENSION_ID),
      `CHROME_STORE_RATE_URL must contain the real extension ID, got: ${CHROME_STORE_RATE_URL}`
    );
  });

  test("is not the old ID-less URL that resolves to the store home page", () => {
    assert.notEqual(CHROME_STORE_RATE_URL, OLD_BROKEN_URL);
    assert.ok(!CHROME_STORE_RATE_URL.endsWith("/detail/muga/"));
  });
});

describe("store-links.js — getRateUrl()", () => {
  test("returns the Chrome URL in a Node.js test environment (no browser global)", () => {
    assert.equal(getRateUrl(), CHROME_STORE_RATE_URL);
  });

  test("returns the Firefox URL when isFirefox() signals Firefox", () => {
    globalThis.browser = {};
    try {
      assert.equal(getRateUrl(), FIREFOX_STORE_RATE_URL);
    } finally {
      delete globalThis.browser;
    }
  });
});

describe("store-links.js — reuses isFirefox() instead of re-detecting", () => {
  const source = readFileSync(join(root, "src/lib/store-links.js"), "utf8");

  test("imports isFirefox from browser-detect.js", () => {
    assert.match(source, /import\s*\{\s*isFirefox\s*\}\s*from\s*"\.\/browser-detect\.js"/);
  });

  test("does not reimplement navigator.userAgent-based Firefox detection", () => {
    assert.ok(!source.includes("navigator.userAgent"));
  });
});

// ---------------------------------------------------------------------------
// The 4 confirmed call sites must import from the shared module, and the old
// broken URL must not exist anywhere else in src/ (grep-based regression
// guard: the issue's own suggested fix requires the extension ID).
// ---------------------------------------------------------------------------

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listJsFiles(full));
    } else if (entry.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

describe("store-links.js — no other src/ file hardcodes the old broken URL", () => {
  const srcRoot = join(root, "src");
  const files = listJsFiles(srcRoot).filter(
    (f) => f !== join(root, "src/lib/store-links.js")
  );

  test("no file under src/ contains the literal old URL", () => {
    const offenders = [];
    for (const file of files) {
      const contents = readFileSync(file, "utf8");
      if (contents.includes(OLD_BROKEN_URL)) offenders.push(file);
    }
    assert.deepEqual(offenders, [], `Old broken URL still hardcoded in: ${offenders.join(", ")}`);
  });
});

describe("store-links.js — call sites use the shared module", () => {
  const popupSource = readFileSync(join(root, "src/popup/popup.js"), "utf8");
  const optionsSource = readFileSync(join(root, "src/options/options.js"), "utf8");

  test("popup.js imports getRateUrl from lib/store-links.js", () => {
    assert.match(popupSource, /import\s*\{\s*getRateUrl\s*\}\s*from\s*"\.\.\/lib\/store-links\.js"/);
  });

  test("options.js imports getRateUrl from lib/store-links.js", () => {
    assert.match(optionsSource, /import\s*\{\s*getRateUrl\s*\}\s*from\s*"\.\.\/lib\/store-links\.js"/);
  });
});
