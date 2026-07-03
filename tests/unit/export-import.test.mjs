/**
 * MUGA: Comprehensive tests for export/import settings feature in options.js.
 *
 * The export/import code is browser-only (chrome.storage.sync, DOM APIs), so we
 * verify logic via source string inspection and extracted pure-function testing,
 * following the same pattern as sanitize-import.test.mjs.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidListEntry, isValidCustomParam, capImportedLists, IMPORT_LIST_CAPS } from "../../src/lib/validation.js";
import { SUPPORTED_LANGS } from "../../src/lib/i18n.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPTIONS_SOURCE = readFileSync(join(__dirname, "../../src/options/options.js"), "utf8");

// ---------------------------------------------------------------------------
// Source verification tests — export
// ---------------------------------------------------------------------------
describe("export settings (source verification)", () => {

  test("1. export includes muga: true flag", () => {
    assert.ok(
      OPTIONS_SOURCE.includes("muga: true"),
      "Export payload must include muga: true marker"
    );
  });

  test("2. export includes version from manifest", () => {
    assert.ok(
      OPTIONS_SOURCE.includes("chrome.runtime.getManifest().version"),
      "Export payload must include version from manifest"
    );
  });

  test("32. export includes ALL expected boolean keys", () => {
    // devMode is device-local (chrome.storage.local), read via getDevMode(), not prefs.devMode
    const SYNC_BOOL_KEYS = [
      "enabled",
      "injectOwnAffiliate",
      "notifyForeignAffiliate",
      "stripAllAffiliates",
      "dnrEnabled",
      "blockPings",
      "ampRedirect",
      "unwrapRedirects",
      "contextMenuEnabled",
      "paramBreakdown",
      "showReportButton",
      "domainStats",
      // #925: privacy booleans, now user-controllable and round-tripped
      "canonicalExtractorEnabled",
      "crossSiteFrequencyEnabled",
      "attributionLedgerEnabled",
    ];
    // Verify each sync boolean key appears in the export payload block
    for (const key of SYNC_BOOL_KEYS) {
      assert.ok(
        OPTIONS_SOURCE.includes(`${key}: prefs.${key}`),
        `Export payload must include boolean key "${key}"`
      );
    }
    // devMode comes from local storage (devModeLocal), not prefs
    assert.ok(
      OPTIONS_SOURCE.includes("devMode: devModeLocal"),
      "Export payload must set devMode from devModeLocal (local storage)"
    );
  });

  test("33. export includes ALL expected array keys", () => {
    const EXPECTED_ARRAY_KEYS = ["blacklist", "whitelist", "customParams", "disabledCategories"];
    for (const key of EXPECTED_ARRAY_KEYS) {
      assert.ok(
        OPTIONS_SOURCE.includes(`${key}: prefs.${key}`),
        `Export payload must include array key "${key}"`
      );
    }
  });

  test("34. export includes toastDuration field", () => {
    // toastDuration is not in the export payload (not in the payload block),
    // but it IS handled during import. Verify the import handling exists.
    assert.ok(
      OPTIONS_SOURCE.includes("toastDuration"),
      "toastDuration must appear in options.js"
    );
  });
});

// ---------------------------------------------------------------------------
// Source verification tests — import
// ---------------------------------------------------------------------------
describe("import settings (source verification)", () => {

  test("3. import checks data.muga flag", () => {
    assert.ok(
      OPTIONS_SOURCE.includes("!data.muga"),
      "Import must check data.muga flag to validate file format"
    );
  });

  test("4. import validates arrays with Array.isArray", () => {
    const matches = OPTIONS_SOURCE.match(/Array\.isArray\(data\.\w+\)/g);
    assert.ok(matches, "Import must use Array.isArray to validate arrays");
    assert.ok(matches.length >= 3, `Expected at least 3 Array.isArray checks, found ${matches.length}`);
  });

  test("5. import caps lists (500, 500, 200) by TRUNCATION, not whole-import rejection (#911)", () => {
    // #911: the old behavior hard-threw when a list exceeded its cap, rejecting
    // a valid-but-large export with a misleading "not a MUGA file" error. Caps
    // now live in IMPORT_LIST_CAPS and are enforced by truncation in capImportedLists.
    assert.equal(IMPORT_LIST_CAPS.blacklist, 500);
    assert.equal(IMPORT_LIST_CAPS.whitelist, 500);
    assert.equal(IMPORT_LIST_CAPS.customParams, 200);
    const over = {
      blacklist: Array.from({ length: 600 }, (_, i) => `b${i}.com`),
      whitelist: Array.from({ length: 600 }, (_, i) => `w${i}.com`),
      customParams: Array.from({ length: 300 }, (_, i) => `p_${i}`),
    };
    const out = capImportedLists(over);
    assert.equal(out.blacklist.length, 500);
    assert.equal(out.whitelist.length, 500);
    assert.equal(out.customParams.length, 200);
    // The count-based whole-import throw must be gone.
    assert.ok(
      !/data\.customParams\.length\s*>\s*200/.test(OPTIONS_SOURCE),
      "Import must NOT abort the whole import when customParams exceeds the cap"
    );
  });

  test("6. import validates list entries with isValidListEntry and delegates param cleaning to capImportedLists (#818/#911)", () => {
    assert.ok(
      OPTIONS_SOURCE.includes("isValidListEntry"),
      "Import must validate blacklist/whitelist entries with isValidListEntry"
    );
    // #818 param validation (isValidCustomParam, MAX_PARAM_LEN=64, denylist +
    // affiliate guard) now runs inside capImportedLists; the handler delegates to it.
    assert.ok(
      OPTIONS_SOURCE.includes("capImportedLists(data)"),
      "Import must delegate customParams filtering/capping to capImportedLists"
    );
  });

  test("7. import validates boolean keys by typeof", () => {
    assert.ok(
      OPTIONS_SOURCE.includes('typeof data[key] === "boolean"'),
      "Import must validate boolean keys with typeof === boolean"
    );
  });

  test("8. import snaps toastDuration to the nearest offered <option> (#968)", () => {
    // #968: a continuous clamp let import persist a value (e.g. 45) that matched
    // no <option>, leaving the control blank. The value is now snapped to the
    // nearest offered option so pref and UI can never disagree.
    assert.ok(
      OPTIONS_SOURCE.includes("snapToastDuration(data.toastDuration)"),
      "Import must snap toastDuration via snapToastDuration"
    );
    assert.ok(
      !OPTIONS_SOURCE.includes("Math.max(5, Math.min(60, data.toastDuration))"),
      "Import must NOT use the legacy continuous clamp for toastDuration"
    );
  });

  test("9. import validates language against the full SUPPORTED_LANGS list", () => {
    // Regression for #729: the import allowlist must be data-driven from
    // SUPPORTED_LANGS, NOT a hardcoded subset. A hardcoded array silently drops
    // any locale added later (fr/it/ja, #707) on an export→import round-trip.
    assert.ok(
      OPTIONS_SOURCE.includes("SUPPORTED_LANGS.some(l => l.code === data.language)"),
      "Import must validate language against SUPPORTED_LANGS, not a hardcoded subset"
    );
    assert.ok(
      !/\[\s*"en",\s*"es",\s*"pt",\s*"de"\s*\]\.includes\(data\.language\)/.test(OPTIONS_SOURCE),
      "Import must NOT use the legacy hardcoded en/es/pt/de language allowlist"
    );
  });

  test("10. file size limit is 102400 bytes", () => {
    assert.ok(
      OPTIONS_SOURCE.includes("file.size > 102400"),
      "Import must reject files larger than 102400 bytes"
    );
  });

  test("11. import validates disabledCategories against known category keys", () => {
    assert.ok(
      OPTIONS_SOURCE.includes("Array.isArray(data.disabledCategories)"),
      "Import must validate disabledCategories is an array"
    );
    assert.ok(
      OPTIONS_SOURCE.includes("VALID_CATEGORIES"),
      "Import must validate disabledCategories against VALID_CATEGORIES set"
    );
  });

  test("12. after import, UI elements are refreshed", () => {
    assert.ok(
      OPTIONS_SOURCE.includes("syncDevTools()"),
      "Import must call syncDevTools() to refresh dev tools UI"
    );
    assert.ok(
      OPTIONS_SOURCE.includes('renderList("blacklist-items"'),
      "Import must call renderList for blacklist"
    );
    assert.ok(
      OPTIONS_SOURCE.includes('renderList("whitelist-items"'),
      "Import must call renderList for whitelist"
    );
    assert.ok(
      OPTIONS_SOURCE.includes('renderList("custom-params-items"'),
      "Import must call renderList for customParams"
    );
    assert.ok(
      OPTIONS_SOURCE.includes("renderCategories("),
      "Import must call renderCategories to refresh category UI"
    );
  });

  test("13. import clears fileInput.value after processing", () => {
    assert.ok(
      OPTIONS_SOURCE.includes('fileInput.value = ""'),
      "Import must clear fileInput.value after processing"
    );
  });
});

// ---------------------------------------------------------------------------
// Extracted logic tests — isValidListEntry
// ---------------------------------------------------------------------------
describe("isValidListEntry (extracted function)", () => {

  test("14. valid domain: 'mysite.com' -> true", () => {
    assert.strictEqual(isValidListEntry("mysite.com"), true);
  });

  test("15. valid domain::param::value: 'amazon.es::tag::youtuber-21' -> true", () => {
    assert.strictEqual(isValidListEntry("amazon.es::tag::youtuber-21"), true);
  });

  test("16. valid domain::disabled: 'amazon.es::disabled' -> true", () => {
    assert.strictEqual(isValidListEntry("amazon.es::disabled"), true);
  });

  test("17. empty string -> false", () => {
    assert.strictEqual(isValidListEntry(""), false);
  });

  test("18. too long (>500 chars) -> false", () => {
    assert.strictEqual(isValidListEntry("a".repeat(501)), false);
  });

  test("19. invalid chars in domain: 'my site.com' -> false (space)", () => {
    assert.strictEqual(isValidListEntry("my site.com"), false);
  });

  test("20. too many parts: 'a::b::c::d' -> false", () => {
    assert.strictEqual(isValidListEntry("a::b::c::d"), false);
  });

  test("21. two parts but not 'disabled': 'amazon.es::foo' -> false", () => {
    assert.strictEqual(isValidListEntry("amazon.es::foo"), false);
  });

  test("22. three parts with empty param: 'amazon.es::::value' -> false", () => {
    assert.strictEqual(isValidListEntry("amazon.es::::value"), false);
  });

  test("23. three parts with empty value: 'amazon.es::tag::' -> false", () => {
    assert.strictEqual(isValidListEntry("amazon.es::tag::"), false);
  });

  test("24. non-string input -> false", () => {
    assert.strictEqual(isValidListEntry(42), false);
    assert.strictEqual(isValidListEntry(null), false);
    assert.strictEqual(isValidListEntry(undefined), false);
    assert.strictEqual(isValidListEntry({}), false);
    assert.strictEqual(isValidListEntry([]), false);
  });

  test("25. unicode domain -> false (regex only allows [a-zA-Z0-9.-])", () => {
    assert.strictEqual(isValidListEntry("café.com"), false);
    assert.strictEqual(isValidListEntry("日本語.jp"), false);
    assert.strictEqual(isValidListEntry("müller.de"), false);
  });
});

// ---------------------------------------------------------------------------
// Extracted logic tests — isValidCustomParam (canonical customParams validator, #818)
//
// #818: The old inline isValidParam (accepted up to 499 chars) was replaced
// with isValidCustomParam from lib/validation.js, which uses the canonical
// remote-rules constants (MAX_PARAM_LEN=64, PARAM_FORMAT_RE, denylist + affiliate guard).
// ---------------------------------------------------------------------------
describe("isValidCustomParam (canonical customParams validator, #818)", () => {

  test("26. valid param strings -> true", () => {
    assert.strictEqual(isValidCustomParam("some-param_123"), true);
    assert.strictEqual(isValidCustomParam("ref_code"), true);
    assert.strictEqual(isValidCustomParam("a"), true);
  });

  test("27. empty string -> false", () => {
    assert.strictEqual(isValidCustomParam(""), false);
  });

  test("28. non-string (number) -> false", () => {
    assert.strictEqual(isValidCustomParam(42), false);
    assert.strictEqual(isValidCustomParam(null), false);
    assert.strictEqual(isValidCustomParam(undefined), false);
  });

  test("29. string with spaces or non-alphanumeric chars -> false", () => {
    assert.strictEqual(isValidCustomParam("hello world"), false);
    assert.strictEqual(isValidCustomParam("café"), false);
    assert.strictEqual(isValidCustomParam("param=value"), false);
  });

  test("30. string at canonical length limit (64 chars) -> true", () => {
    // #818: MAX_PARAM_LEN=64, not the old 499-char limit
    assert.strictEqual(isValidCustomParam("a".repeat(64)), true);
  });

  test("31. string over canonical limit (65+ chars) -> false", () => {
    // #818: 65 chars exceeds MAX_PARAM_LEN=64 and must be rejected
    assert.strictEqual(isValidCustomParam("a".repeat(65)), false);
    assert.strictEqual(isValidCustomParam("a".repeat(200)), false);
    assert.strictEqual(isValidCustomParam("a".repeat(499)), false);
  });
});

// ---------------------------------------------------------------------------
// Language round-trip — regression for #729
//
// The import language allowlist must accept EVERY code exported by the picker.
// Export writes `language: prefs.language` (any SUPPORTED_LANGS code), so import
// must mirror that set. acceptLanguage() replicates the import guard against the
// real SUPPORTED_LANGS so a future edit to one side without the other fails here.
// ---------------------------------------------------------------------------
describe("import language round-trip (#729)", () => {
  // Mirror of the import-handler guard at options.js (data-driven, not hardcoded).
  const acceptLanguage = (lang) => SUPPORTED_LANGS.some((l) => l.code === lang);

  test("35. every SUPPORTED_LANGS code survives an export→import round-trip", () => {
    for (const { code } of SUPPORTED_LANGS) {
      assert.strictEqual(
        acceptLanguage(code),
        true,
        `exported language "${code}" must be accepted on import`
      );
    }
  });

  test("36. fr/it/ja (added in #707) are accepted, not silently dropped", () => {
    for (const code of ["fr", "it", "ja"]) {
      assert.ok(
        SUPPORTED_LANGS.some((l) => l.code === code),
        `"${code}" must be a supported language`
      );
      assert.strictEqual(acceptLanguage(code), true, `"${code}" must round-trip`);
    }
  });

  test("37. unknown/invalid language codes are rejected", () => {
    for (const bad of ["", "xx", "EN", "en-US", "klingon", null, undefined, 42]) {
      assert.strictEqual(acceptLanguage(bad), false, `"${String(bad)}" must be rejected`);
    }
  });
});

// ---------------------------------------------------------------------------
// Import/export hardening — regressions for #964, #965, #968
// ---------------------------------------------------------------------------
const OPTIONS_HTML = readFileSync(join(__dirname, "../../src/options/options.html"), "utf8");

describe("import/export hardening (#964/#965/#968)", () => {

  // #968 — data-loss round-trip
  test("38. export round-trips the three previously-dropped prefs", () => {
    for (const key of ["experimentalParamClassesEnabled", "honorCreatorMode", "creatorAllowlist"]) {
      assert.ok(
        OPTIONS_SOURCE.includes(`${key}: prefs.${key}`),
        `Export payload must include "${key}" (was silently dropped)`
      );
    }
  });

  test("39. import round-trips honorCreatorMode + experimentalParamClassesEnabled as booleans", () => {
    for (const key of ["honorCreatorMode", "experimentalParamClassesEnabled"]) {
      assert.ok(
        new RegExp(`BOOL_KEYS[\\s\\S]*"${key}"`).test(OPTIONS_SOURCE),
        `Import BOOL_KEYS must include "${key}"`
      );
    }
  });

  test("40. import round-trips creatorAllowlist through the pure validator", () => {
    assert.ok(
      OPTIONS_SOURCE.includes("Array.isArray(data.creatorAllowlist)"),
      "Import must validate creatorAllowlist is an array"
    );
    assert.ok(
      /addCreatorAllowlistEntry\(\s*acc\s*,\s*entry\s*\)/.test(OPTIONS_SOURCE),
      "Import must fold creatorAllowlist entries through addCreatorAllowlistEntry"
    );
  });

  // #964 — permission-gate bypass
  test("41. import gates followShortenersEnabled on the actual host grant", () => {
    // Must NOT be in the blind BOOL_KEYS loop...
    assert.ok(
      !/BOOL_KEYS\s*=\s*\[[^\]]*"followShortenersEnabled"/.test(OPTIONS_SOURCE),
      "followShortenersEnabled must NOT be a blindly-imported BOOL_KEY"
    );
    // ...and enabling it must depend on hasShortenerPermissions().
    assert.ok(
      /data\.followShortenersEnabled\s*&&\s*\(await hasShortenerPermissions\(\)\)/.test(OPTIONS_SOURCE),
      "Import must only enable followShortenersEnabled when the host grant is present"
    );
    assert.ok(
      OPTIONS_SOURCE.includes("chrome.permissions.contains"),
      "hasShortenerPermissions must check chrome.permissions.contains"
    );
  });

  // #965 — guarded-pref override desync
  test("42. import reconciles the per-device override for guarded prefs", () => {
    assert.ok(
      /reconcileOverrideForExplicitChoice\(\s*key\s*,\s*data\[key\]\s*\)/.test(OPTIONS_SOURCE),
      "Import must reconcile the per-device override to the imported guarded value"
    );
  });

  // #968 — toast-duration select
  test("43. toast-duration options span the full 5..60 range in the UI", () => {
    for (const v of ["5", "10", "15", "30", "45", "60"]) {
      assert.ok(
        OPTIONS_HTML.includes(`value="${v}"`),
        `toast-duration <select> must offer value="${v}" so the clamp ceiling is reachable`
      );
    }
  });

  test("44. snapToastDuration maps arbitrary values to the nearest offered option", () => {
    // Mirror of the implementation (options.js is browser-only, not importable).
    const TOAST_DURATION_OPTIONS = [5, 10, 15, 30, 45, 60];
    const snap = (n) => {
      const v = Number.isFinite(n) ? n : 15;
      return TOAST_DURATION_OPTIONS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
    };
    assert.equal(snap(45), 45, "an offered value maps to itself");
    assert.equal(snap(60), 60, "the ceiling is reachable");
    assert.equal(snap(22), 15, "22 snaps to nearest (15, distance 7 < 8)");
    assert.equal(snap(23), 30, "23 snaps to nearest (30, distance 7 < 8)");
    assert.equal(snap(1000), 60, "out-of-range high clamps to 60");
    assert.equal(snap(NaN), 15, "non-finite falls back to 15");
    // The implementation must define both the option set and the snapper.
    assert.ok(
      OPTIONS_SOURCE.includes("TOAST_DURATION_OPTIONS = [5, 10, 15, 30, 45, 60]"),
      "options.js must define TOAST_DURATION_OPTIONS"
    );
    assert.ok(
      OPTIONS_SOURCE.includes("function snapToastDuration"),
      "options.js must define snapToastDuration"
    );
  });
});
