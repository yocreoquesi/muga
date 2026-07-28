/**
 * MUGA — B12 (#435): honorCreatorMode toggle plumbing
 *
 * Pure-plumbing slice for downstream Honor Creator Mode features (B13/B14).
 * No behaviour change yet; this only verifies that:
 *   - PREF_DEFAULTS includes `honorCreatorMode: false`
 *   - Reading the pref when never written returns `false`
 *   - Setting it and reading again returns the new value
 *   - Existing prefs are unaffected by the addition (regression)
 *   - Options page exposes a labeled toggle inside the Advanced section
 *   - i18n keys exist for label and description in en + es
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { PREF_DEFAULTS } from "../../src/lib/storage.js";
import { TRANSLATIONS } from "../../src/lib/i18n.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OPTIONS_HTML = readFileSync(join(ROOT, "src/options/options.html"), "utf8");
const OPTIONS_JS   = readFileSync(join(ROOT, "src/options/options.js"),   "utf8");

// ── Storage default ─────────────────────────────────────────────────────────
describe("B12 honorCreatorMode — storage defaults", () => {
  test("PREF_DEFAULTS contains honorCreatorMode", () => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, "honorCreatorMode"),
      "PREF_DEFAULTS must declare honorCreatorMode so chrome.storage.sync.get returns it"
    );
  });

  test("honorCreatorMode defaults to false", () => {
    assert.strictEqual(PREF_DEFAULTS.honorCreatorMode, false);
  });

  test("honorCreatorMode is a boolean (not undefined or null)", () => {
    assert.strictEqual(typeof PREF_DEFAULTS.honorCreatorMode, "boolean");
  });
});

// ── Existing prefs unaffected (regression) ──────────────────────────────────
describe("B12 honorCreatorMode — regression: existing prefs intact", () => {
  test("known existing prefs still present with their original defaults", () => {
    // Sample of stable prefs that must not change shape with the new addition.
    assert.strictEqual(PREF_DEFAULTS.enabled, true);
    assert.strictEqual(PREF_DEFAULTS.notifyForeignAffiliate, false);
    assert.strictEqual(PREF_DEFAULTS.stripAllAffiliates, false);
    assert.deepEqual(PREF_DEFAULTS.blacklist, []);
    assert.deepEqual(PREF_DEFAULTS.whitelist, []);
    assert.deepEqual(PREF_DEFAULTS.customParams, []);
    assert.strictEqual(PREF_DEFAULTS.dnrEnabled, true);
    assert.strictEqual(PREF_DEFAULTS.contextMenuEnabled, true);
    assert.strictEqual(PREF_DEFAULTS.blockPings, true);
    assert.strictEqual(PREF_DEFAULTS.ampRedirect, true);
    assert.strictEqual(PREF_DEFAULTS.unwrapRedirects, true);
    assert.strictEqual(PREF_DEFAULTS.remoteRulesEnabled, true);
  });

  test("honorCreatorMode does not collide with devMode (which lives in local storage)", () => {
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, "devMode"),
      false,
      "devMode must remain in chrome.storage.local — adding honorCreatorMode must not move it"
    );
  });
});

// ── Read/write round-trip via getPrefs/setPrefs ─────────────────────────────
//
// chrome.* APIs are not available in Node, so we install a minimal fake before
// importing the module and clean up afterwards. This mirrors the pattern other
// suites use (e.g. consent-storage / per-device-prefs) without pulling JSDOM.
describe("B12 honorCreatorMode — read/write round-trip", () => {
  let originalChrome;
  let store;
  let getPrefs;
  let setPrefs;

  beforeEach(async () => {
    originalChrome = globalThis.chrome;
    store = { sync: {}, local: {} };

    function makeArea(bucket) {
      function readKeys(defaults) {
        const out = {};
        const keys = Array.isArray(defaults)
          ? defaults
          : typeof defaults === "string"
          ? [defaults]
          : Object.keys(defaults || {});
        for (const k of keys) {
          out[k] = Object.prototype.hasOwnProperty.call(bucket, k)
            ? bucket[k]
            : defaults && typeof defaults === "object" && !Array.isArray(defaults)
            ? defaults[k]
            : undefined;
        }
        return out;
      }
      return {
        // Promise-returning shape mimics Chrome MV3 native APIs so the
        // shimChromePromises probe in storage.js detects "native promises".
        get(defaults, cb) {
          if (typeof cb === "function") {
            queueMicrotask(() => cb(readKeys(defaults)));
            return undefined;
          }
          return Promise.resolve(readKeys(defaults));
        },
        set(items, cb) {
          Object.assign(bucket, items);
          if (typeof cb === "function") {
            queueMicrotask(() => cb());
            return undefined;
          }
          return Promise.resolve();
        },
        remove(keys, cb) {
          const ks = Array.isArray(keys) ? keys : [keys];
          for (const k of ks) delete bucket[k];
          if (typeof cb === "function") {
            queueMicrotask(() => cb());
            return undefined;
          }
          return Promise.resolve();
        },
      };
    }

    globalThis.chrome = {
      runtime: { lastError: null, id: "muga-test" },
      storage: {
        sync: makeArea(store.sync),
        local: makeArea(store.local),
      },
    };

    // Re-import the storage module for each test to avoid cross-test state.
    const mod = await import(`../../src/lib/storage.js?cb=${Math.random()}`);
    getPrefs = mod.getPrefs;
    setPrefs = mod.setPrefs;
  });

  afterEach(() => {
    globalThis.chrome = originalChrome;
  });

  test("getPrefs returns honorCreatorMode=false when never written", async () => {
    const prefs = await getPrefs();
    assert.strictEqual(prefs.honorCreatorMode, false);
  });

  test("setPrefs({ honorCreatorMode: true }) persists and is read back", async () => {
    await setPrefs({ honorCreatorMode: true });
    const prefs = await getPrefs();
    assert.strictEqual(prefs.honorCreatorMode, true);
    // sanity: only the targeted key changed
    assert.strictEqual(prefs.enabled, true);
  });

  test("setPrefs({ honorCreatorMode: false }) clears the override", async () => {
    await setPrefs({ honorCreatorMode: true });
    await setPrefs({ honorCreatorMode: false });
    const prefs = await getPrefs();
    assert.strictEqual(prefs.honorCreatorMode, false);
  });
});

// ── Options page exposes the toggle ─────────────────────────────────────────
describe("B12 honorCreatorMode — options page UI", () => {
  test("options.html declares an Advanced section that hosts the toggle", () => {
    // The toggle lives inside the Advanced (#section-dev) area — specifically
    // inside the dev-mode-gated #dev-tools-card after the #936 IA reorg.
    assert.ok(
      OPTIONS_HTML.includes('id="section-dev"'),
      "options.html must keep the Advanced section (#section-dev)"
    );
    assert.ok(
      OPTIONS_HTML.includes('data-i18n="section_advanced"'),
      "Advanced section must use the section_advanced i18n key"
    );
  });

  test("options.html has the honor-creator-mode checkbox", () => {
    assert.ok(
      OPTIONS_HTML.includes('id="honor-creator-mode"'),
      "options.html must contain a checkbox with id=honor-creator-mode"
    );
    // It must be an input[type=checkbox]
    const m = OPTIONS_HTML.match(/<input[^>]+id="honor-creator-mode"[^>]*>/);
    assert.ok(m, "honor-creator-mode must be an <input> element");
    assert.ok(
      /type="checkbox"/.test(m[0]),
      "honor-creator-mode must be type=checkbox"
    );
  });

  test("toggle has label and description with i18n attributes", () => {
    assert.ok(
      OPTIONS_HTML.includes('data-i18n="honor_creator_mode_label"'),
      "options.html must reference honor_creator_mode_label via data-i18n"
    );
    assert.ok(
      OPTIONS_HTML.includes('data-i18n="honor_creator_mode_hint"'),
      "options.html must reference honor_creator_mode_hint via data-i18n"
    );
  });

  test("toggle is gated by dev-mode (lives inside #dev-tools-card, #936)", () => {
    // #936 IA reorg: Honor Creator Mode moved INTO the dev-mode-gated
    // #dev-tools-card (it was wrongly always-visible before). It must now
    // appear AFTER the card opens so "Show advanced settings" controls it.
    const hcmIdx = OPTIONS_HTML.indexOf('id="honor-creator-mode"');
    const devToolsIdx = OPTIONS_HTML.indexOf('id="dev-tools-card"');
    assert.ok(hcmIdx !== -1, "honor-creator-mode must exist in options.html");
    assert.ok(devToolsIdx !== -1, "dev-tools-card must still exist");
    assert.ok(
      hcmIdx > devToolsIdx,
      "honor-creator-mode must live inside #dev-tools-card so it is gated behind dev-mode (#936)"
    );
  });

  test("options.js binds the honor-creator-mode toggle to honorCreatorMode pref", () => {
    // The simplest contract: bindToggle("honor-creator-mode", "honorCreatorMode", prefs)
    // appears in options.js. We don't pin formatting beyond the two strings on
    // the same line to allow incidental refactors.
    const re = /bindToggle\(\s*["']honor-creator-mode["']\s*,\s*["']honorCreatorMode["']/;
    assert.ok(
      re.test(OPTIONS_JS),
      "options.js must wire bindToggle('honor-creator-mode', 'honorCreatorMode', prefs)"
    );
  });
});

// ── i18n: en + es required ──────────────────────────────────────────────────
describe("B12 honorCreatorMode — i18n keys", () => {
  test("honor_creator_mode_label has en and es", () => {
    const entry = TRANSLATIONS.honor_creator_mode_label;
    assert.ok(entry, "TRANSLATIONS.honor_creator_mode_label must exist");
    assert.ok(typeof entry.en === "string" && entry.en.trim() !== "", "en string required");
    assert.ok(typeof entry.es === "string" && entry.es.trim() !== "", "es string required");
  });

  test("honor_creator_mode_hint has en and es", () => {
    const entry = TRANSLATIONS.honor_creator_mode_hint;
    assert.ok(entry, "TRANSLATIONS.honor_creator_mode_hint must exist");
    assert.ok(typeof entry.en === "string" && entry.en.trim() !== "", "en string required");
    assert.ok(typeof entry.es === "string" && entry.es.trim() !== "", "es string required");
  });
});
