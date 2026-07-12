/**
 * MUGA — Hover destination preview (#1028)
 *
 * Coverage:
 *   1. Behavioral: processUrl's decision surface that hover-preview.js relies
 *      on — a redirect-wrapper link (l.facebook.com/l.php?u=...) unwraps to a
 *      DIFFERENT host (the case the feature shows a tooltip for), while a
 *      plain UTM-decorated link cleans to the SAME host (the case the
 *      feature must show nothing for).
 *   2. Source guards on src/content/hover-preview.js: the PC-only gate, the
 *      prefs fetch, the site-exemption check, the delay/default wiring, the
 *      host-change decision, and the pref name it gates on.
 *   3. PREF_DEFAULTS carries the shipped defaults (hoverPreviewEnabled: true,
 *      hoverPreviewDelayMs: 2500).
 *
 * Content scripts cannot import ES modules (MV3/MV2), so hover-preview.js
 * itself cannot be executed under Node the way a module can — it is instead
 * verified via source-string inspection, the same pattern used by
 * tests/unit/options-surfaced-prefs.test.mjs and friends for other
 * browser-only files.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { processUrl } from "../../src/lib/cleaner.js";
import { PREF_DEFAULTS } from "../../src/lib/prefs.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "../..");

const HOVER_PREVIEW_SRC = readFileSync(
  join(ROOT, "src/content/hover-preview.js"),
  "utf8",
);

const PREFS = {
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  blacklist: [],
  whitelist: [],
};

// ---------------------------------------------------------------------------
// 1. Behavioral: the "does the host change?" decision the feature is built on
// ---------------------------------------------------------------------------

describe("hover-preview decision surface — processUrl host-change behavior", () => {
  test("a redirect-wrapper link (l.facebook.com/l.php?u=...) unwraps to a DIFFERENT host", () => {
    const dest = "https://merchant.example.com/p/42";
    const raw =
      "https://l.facebook.com/l.php?u=" +
      encodeURIComponent(dest) +
      "&h=AT0abc&__tn__=R";

    const { cleanUrl } = processUrl(raw, PREFS, [], undefined, undefined, "", [], []);
    assert.ok(cleanUrl, "expected processUrl to return a cleanUrl");

    const changed = new URL(cleanUrl).host !== new URL(raw).host;
    assert.equal(
      changed, true,
      "l.facebook.com/l.php?u=... must unwrap to a different host — this is the case " +
      "the hover preview tooltip shows",
    );
    assert.equal(new URL(cleanUrl).host, "merchant.example.com");
  });

  test("a plain UTM-decorated link cleans to the SAME host (tooltip must show NOTHING)", () => {
    const raw = "https://example.com/p?utm_source=x";
    const { cleanUrl } = processUrl(raw, PREFS, [], undefined, undefined, "", [], []);
    assert.ok(cleanUrl, "expected processUrl to return a cleanUrl");

    const changed = new URL(cleanUrl).host !== new URL(raw).host;
    assert.equal(
      changed, false,
      "a plain tracking-param link must clean to the SAME host — the hover preview " +
      "must not show a tooltip for this case",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Source guards — src/content/hover-preview.js
// ---------------------------------------------------------------------------

describe("hover-preview.js — source guards", () => {
  test("gates on matchMedia mouse-available capability (any-* so a mouse on a touch laptop counts)", () => {
    assert.match(
      HOVER_PREVIEW_SRC,
      /matchMedia\(\s*["']\(any-hover:\s*hover\)\s*and\s*\(any-pointer:\s*fine\)/,
      "must early-return unless matchMedia(\"(any-hover: hover) and (any-pointer: fine)\") matches — the primary-pointer variants wrongly exclude touchscreen laptops with a mouse",
    );
  });

  test("uses hoverPreviewDelayMs with a 2500ms default", () => {
    assert.ok(
      HOVER_PREVIEW_SRC.includes("hoverPreviewDelayMs"),
      "must reference prefs.hoverPreviewDelayMs",
    );
    assert.ok(
      /hoverPreviewDelayMs\)\s*\|\|\s*2500/.test(HOVER_PREVIEW_SRC),
      "must default the hold delay to 2500ms when hoverPreviewDelayMs is unset",
    );
  });

  test("fetches prefs via the getPrefs message", () => {
    assert.ok(
      /chrome\.runtime\.sendMessage\(\s*\{\s*type:\s*["']getPrefs["']/.test(HOVER_PREVIEW_SRC),
      "must fetch prefs via chrome.runtime.sendMessage({ type: \"getPrefs\" }, ...)",
    );
  });

  test("checks isSiteFullyExempt before showing the tooltip", () => {
    assert.ok(
      HOVER_PREVIEW_SRC.includes("isSiteFullyExempt"),
      "must gate on window.__mugaCleaner.isSiteFullyExempt(location.hostname, prefs)",
    );
  });

  test("only shows the tooltip when the destination host differs", () => {
    assert.ok(
      /\.host\s*!==\s*new URL\(/.test(HOVER_PREVIEW_SRC),
      "must compare new URL(cleanUrl).host !== new URL(href).host before showing anything",
    );
  });

  test("references hoverPreviewEnabled as the feature gate", () => {
    assert.ok(
      HOVER_PREVIEW_SRC.includes("hoverPreviewEnabled"),
      "must gate on prefs.hoverPreviewEnabled === false",
    );
  });

  test("resolves shorteners over the network when followShortenersEnabled is on (#1088)", () => {
    // When the local unwrap finds no host change, a generic shortener whose
    // destination needs a network round trip is resolved via RESOLVE_SHORTENER.
    // Regression guard for the whole hover-shortener path.
    assert.ok(
      HOVER_PREVIEW_SRC.includes("maybeResolveShortener"),
      "must fall through to maybeResolveShortener when the host is unchanged",
    );
    assert.ok(
      /_prefs\.followShortenersEnabled\s*!==\s*true/.test(HOVER_PREVIEW_SRC),
      "must gate the network resolution on followShortenersEnabled",
    );
    assert.ok(
      HOVER_PREVIEW_SRC.includes("isGenericShortener"),
      "must only resolve allowlisted generic shorteners",
    );
    assert.ok(
      /type:\s*["']RESOLVE_SHORTENER["']/.test(HOVER_PREVIEW_SRC),
      "must resolve via the RESOLVE_SHORTENER service-worker message",
    );
  });

  test("calls processUrl with the documented argument shape", () => {
    assert.ok(
      /__mugaCleaner\.processUrl\(\s*href,\s*_?prefs,\s*\[\],\s*undefined,\s*undefined,\s*["']["'],\s*\[\],\s*\[\]\s*\)/.test(
        HOVER_PREVIEW_SRC,
      ),
      "must call window.__mugaCleaner.processUrl(href, prefs, [], undefined, undefined, \"\", [], [])",
    );
  });

  test("does not mutate the anchor's href (no assignment or setAttribute write)", () => {
    assert.ok(
      !/anchor\.href\s*=(?!=)/.test(HOVER_PREVIEW_SRC),
      "hover preview must never assign anchor.href",
    );
    assert.ok(
      !/anchor\.setAttribute\(\s*["']href["']/.test(HOVER_PREVIEW_SRC),
      "hover preview must never call anchor.setAttribute(\"href\", ...)",
    );
  });

  test("never fetches anything over the network", () => {
    assert.ok(
      !/\bfetch\(/.test(HOVER_PREVIEW_SRC),
      "hover preview must be fully local — no fetch() calls",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Prefs defaults
// ---------------------------------------------------------------------------

describe("PREF_DEFAULTS — hover preview (#1028)", () => {
  test("hoverPreviewEnabled defaults to true", () => {
    assert.equal(PREF_DEFAULTS.hoverPreviewEnabled, true);
  });

  test("hoverPreviewDelayMs defaults to 2500", () => {
    assert.equal(PREF_DEFAULTS.hoverPreviewDelayMs, 2500);
  });
});
