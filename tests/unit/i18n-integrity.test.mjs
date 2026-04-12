/**
 * MUGA — i18n Integrity Tests
 *
 * Ensures required translation keys exist (EN + ES) and that HTML
 * data-i18n fallback text stays in sync with TRANSLATIONS EN values.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { TRANSLATIONS } from "../../src/lib/i18n.js";

describe("Regression: i18n keys exist for share/confirm buttons", () => {
  const requiredKeys = ["share_copied", "share_btn", "confirm_cancel", "confirm_ok"];
  for (const key of requiredKeys) {
    test(`i18n key "${key}" exists with en and es`, () => {
      assert.ok(TRANSLATIONS[key], `Missing i18n key: ${key}`);
      assert.ok(TRANSLATIONS[key].en, `Missing EN translation for: ${key}`);
      assert.ok(TRANSLATIONS[key].es, `Missing ES translation for: ${key}`);
    });
  }
});

// ---------------------------------------------------------------------------
// HTML fallback text must match i18n EN translations
// ---------------------------------------------------------------------------
const __healthDir = dirname(fileURLToPath(import.meta.url));

describe("i18n fallback sync — HTML data-i18n text matches i18n.js EN", () => {
  const htmlFiles = [
    join(__healthDir, "../../src/options/options.html"),
    join(__healthDir, "../../src/onboarding/onboarding.html"),
    join(__healthDir, "../../src/popup/popup.html"),
  ];

  for (const file of htmlFiles) {
    const html = readFileSync(file, "utf8");
    const fname = file.split("/").pop();
    const re = /data-i18n="([^"]+)">([^<]+)<\//g;
    const decodeHtml = s => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
    let match;
    while ((match = re.exec(html)) !== null) {
      const [, key, fallback] = match;
      if (!TRANSLATIONS[key]) continue;
      const en = TRANSLATIONS[key].en;
      if (!en) continue;
      test(`${fname}: "${key}" fallback matches EN`, () => {
        assert.equal(decodeHtml(fallback.trim()), en.trim(),
          `${fname} fallback for "${key}" doesn't match i18n.js EN.\n  HTML: "${fallback.trim()}"\n  i18n: "${en.trim()}"`);
      });
    }
  }
});
