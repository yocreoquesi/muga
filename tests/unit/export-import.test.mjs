/**
 * MUGA: Comprehensive tests for the Settings export/import feature.
 *
 * The core export/import logic (buildExportPayload/planImport) was extracted
 * from options.js into the pure module src/lib/settings-schema.js (single
 * source of truth). These tests exercise ACTUAL behavior against that
 * module rather than inspecting options.js source text. A few pieces of
 * behavior (file-size gate, DOM refresh, fileInput reset) remain inline in
 * options.js because they are DOM/chrome-bound; those specific assertions
 * still read OPTIONS_SOURCE.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidListEntry, isValidCustomParam, capImportedLists, IMPORT_LIST_CAPS } from "../../src/lib/validation.js";
import { SUPPORTED_LANGS } from "../../src/lib/i18n.js";
import {
  SETTINGS_SCHEMA_VERSION,
  buildExportPayload,
  planImport,
  snapToastDuration,
  TOAST_DURATION_OPTIONS,
} from "../../src/lib/settings-schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPTIONS_SOURCE = readFileSync(join(__dirname, "../../src/options/options.js"), "utf8");
const SETTINGS_SCHEMA_SOURCE = readFileSync(join(__dirname, "../../src/lib/settings-schema.js"), "utf8");

// A minimal valid import payload, reused as a base by several tests below.
function validImportData(overrides = {}) {
  return {
    muga: true,
    blacklist: [],
    whitelist: [],
    customParams: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Export behavior — buildExportPayload
// ---------------------------------------------------------------------------
describe("export settings (buildExportPayload behavior)", () => {

  test("1. export includes muga: true flag", () => {
    const payload = buildExportPayload({}, { devMode: false, appVersion: "1.0.0" });
    assert.strictEqual(payload.muga, true);
  });

  test("2. export includes version from manifest and schemaVersion", () => {
    const payload = buildExportPayload({}, { devMode: false, appVersion: "3.4.5" });
    assert.strictEqual(payload.version, "3.4.5");
    assert.strictEqual(payload.schemaVersion, SETTINGS_SCHEMA_VERSION);
  });

  test("32. export includes ALL expected boolean keys", () => {
    const SYNC_BOOL_KEYS = [
      "enabled",
      "notifyForeignAffiliate",
      "stripAllAffiliates",
      "dnrEnabled",
      "activeDefenseEnabled",
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
    const prefs = Object.fromEntries(SYNC_BOOL_KEYS.map((k) => [k, true]));
    const payload = buildExportPayload(prefs, { devMode: true, appVersion: "1.0.0" });
    for (const key of SYNC_BOOL_KEYS) {
      assert.strictEqual(payload[key], true, `Export payload must include boolean key "${key}"`);
    }
    // devMode comes from local storage (devModeLocal param), not prefs
    assert.strictEqual(payload.devMode, true, "Export payload must set devMode from the devMode param (local storage)");
  });

  test("33. export includes ALL expected array keys", () => {
    const EXPECTED_ARRAY_KEYS = ["blacklist", "whitelist", "customParams", "disabledCategories"];
    const prefs = Object.fromEntries(EXPECTED_ARRAY_KEYS.map((k) => [k, [k]]));
    const payload = buildExportPayload(prefs, { devMode: false, appVersion: "1.0.0" });
    for (const key of EXPECTED_ARRAY_KEYS) {
      assert.deepStrictEqual(payload[key], [key], `Export payload must include array key "${key}"`);
    }
  });

  test("34. export includes toastDuration field", () => {
    const payload = buildExportPayload({ toastDuration: 30 }, { devMode: false, appVersion: "1.0.0" });
    assert.strictEqual(payload.toastDuration, 30);
  });

  test("export payload stays flat (no nested 'settings' key)", () => {
    const payload = buildExportPayload({ enabled: true }, { devMode: false, appVersion: "1.0.0" });
    assert.strictEqual(payload.settings, undefined, "export payload must not nest fields under a 'settings' key");
    assert.strictEqual(typeof payload.enabled, "boolean");
  });
});

// ---------------------------------------------------------------------------
// Import behavior — planImport
// ---------------------------------------------------------------------------
describe("import settings (planImport behavior)", () => {

  test("3. import checks data.muga flag", () => {
    assert.deepStrictEqual(planImport(validImportData({ muga: false })), { ok: false });
    assert.deepStrictEqual(planImport(validImportData({ muga: undefined })), { ok: false });
  });

  test("4. import validates arrays with Array.isArray", () => {
    assert.deepStrictEqual(planImport(validImportData({ blacklist: "not-an-array" })), { ok: false });
    assert.deepStrictEqual(planImport(validImportData({ whitelist: null })), { ok: false });
    assert.deepStrictEqual(planImport(validImportData({ customParams: {} })), { ok: false });
  });

  test("5. import caps lists (500, 500, 200) by TRUNCATION, not whole-import rejection (#911)", () => {
    assert.equal(IMPORT_LIST_CAPS.blacklist, 500);
    assert.equal(IMPORT_LIST_CAPS.whitelist, 500);
    assert.equal(IMPORT_LIST_CAPS.customParams, 200);
    const plan = planImport(validImportData({
      blacklist: Array.from({ length: 600 }, (_, i) => `b${i}.com`),
      whitelist: Array.from({ length: 600 }, (_, i) => `w${i}.com`),
      customParams: Array.from({ length: 300 }, (_, i) => `p_${i}`),
    }));
    assert.equal(plan.ok, true);
    assert.equal(plan.toSave.blacklist.length, 500);
    assert.equal(plan.toSave.whitelist.length, 500);
    assert.equal(plan.toSave.customParams.length, 200);
    assert.ok(plan.skipped > 0, "over-cap entries must be reported as skipped");
  });

  test("6. import validates list entries with isValidListEntry and delegates param cleaning to capImportedLists (#818/#911)", () => {
    // A malformed blacklist ENTRY (not just an oversized list) signals a
    // corrupt/foreign file and must abort the whole import.
    assert.deepStrictEqual(planImport(validImportData({ blacklist: ["ok.com", "bad entry with spaces"] })), { ok: false });
    // customParams filtering/capping is delegated to capImportedLists, not
    // reimplemented — cross-check plan output against calling it directly.
    const data = validImportData({ customParams: ["ref_code", "q", "promo_id"] });
    const plan = planImport(data);
    const direct = capImportedLists(data);
    assert.deepStrictEqual(plan.toSave.customParams, direct.customParams);
  });

  test("6b. legacy backup with a ::disabled entry imports cleanly, folding it into the allowlist (#1053)", () => {
    // Before #1053, `example.com::disabled` was a valid blacklist entry. It is
    // now invalid, and a single invalid entry aborts the whole import — so a
    // pre-#1053 backup would fail entirely. migrate() must fold the domain-only
    // ::disabled marker into a bare whitelist entry (mirroring the runtime
    // migration migratePerSiteDisableToAllowlist) so the exemption survives.
    const plan = planImport(validImportData({
      blacklist: ["amazon.es::tag::x", "example.com::disabled"],
      whitelist: ["foo.com"],
    }));
    assert.equal(plan.ok, true, "a legacy ::disabled backup must not abort the whole import");
    assert.ok(plan.toSave.whitelist.includes("example.com"), "the ::disabled domain must be folded into the allowlist");
    assert.ok(plan.toSave.whitelist.includes("foo.com"), "existing allowlist entries must be preserved");
    assert.ok(!plan.toSave.blacklist.includes("example.com::disabled"), "the removed ::disabled syntax must not survive into the blacklist");
    assert.ok(plan.toSave.blacklist.includes("amazon.es::tag::x"), "param-scoped affiliate-protection entries must be preserved");
  });

  test("6c. ::disabled fold dedups against an existing allowlist entry (#1053)", () => {
    const plan = planImport(validImportData({
      blacklist: ["example.com::disabled"],
      whitelist: ["example.com"],
    }));
    assert.equal(plan.ok, true);
    assert.deepStrictEqual(
      plan.toSave.whitelist.filter((d) => d === "example.com"),
      ["example.com"],
      "a domain already allowlisted must not be duplicated by the fold",
    );
  });

  test("7. import validates boolean keys by typeof", () => {
    const plan = planImport(validImportData({ enabled: "true", notifyForeignAffiliate: true, dnrEnabled: 1 }));
    assert.equal(plan.ok, true);
    assert.strictEqual(plan.toSave.enabled, undefined, "non-boolean typed value must not be imported");
    assert.strictEqual(plan.toSave.notifyForeignAffiliate, true);
    assert.strictEqual(plan.toSave.dnrEnabled, undefined, "non-boolean typed value must not be imported");
  });

  test("8. import snaps toastDuration to the nearest offered <option> (#968)", () => {
    const plan = planImport(validImportData({ toastDuration: 22 }));
    assert.equal(plan.ok, true);
    assert.strictEqual(plan.toSave.toastDuration, snapToastDuration(22));
    assert.strictEqual(plan.toSave.toastDuration, 15, "22 must snap to 15 (distance 7 < 8)");
  });

  test("9. import validates language against the full SUPPORTED_LANGS list", () => {
    for (const { code } of SUPPORTED_LANGS) {
      const plan = planImport(validImportData({ language: code }));
      assert.strictEqual(plan.toSave.language, code, `language "${code}" must round-trip`);
    }
    const rejected = planImport(validImportData({ language: "klingon" }));
    assert.strictEqual(rejected.toSave.language, undefined, "unsupported language must not be imported");
  });

  test("10. file size limit is 102400 bytes", () => {
    // This gate is DOM/File-bound and stays inline in options.js.
    assert.ok(
      OPTIONS_SOURCE.includes("file.size > 102400"),
      "Import must reject files larger than 102400 bytes"
    );
  });

  test("11. import validates disabledCategories against known category keys", () => {
    const valid = planImport(validImportData({ disabledCategories: ["utm", "ads"] }));
    assert.deepStrictEqual(valid.toSave.disabledCategories, ["utm", "ads"]);
    const invalid = planImport(validImportData({ disabledCategories: ["utm", "not-a-category"] }));
    assert.strictEqual(invalid.toSave.disabledCategories, undefined, "an unknown category must reject the whole array");
  });

  test("12. after import, UI elements are refreshed", () => {
    // DOM refresh wiring stays inline in options.js.
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

  test("legacy file with no schemaVersion still imports exactly as today", () => {
    const legacy = validImportData({ enabled: true, toastDuration: 45 });
    assert.strictEqual(legacy.schemaVersion, undefined);
    const plan = planImport(legacy);
    assert.equal(plan.ok, true);
    assert.strictEqual(plan.toSave.enabled, true);
    assert.strictEqual(plan.toSave.toastDuration, 45);
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

  test("16. domain::disabled (legacy per-site-pause syntax, removed): 'amazon.es::disabled' -> false", () => {
    assert.strictEqual(isValidListEntry("amazon.es::disabled"), false);
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
// must mirror that set. This now exercises the real planImport() against the
// real SUPPORTED_LANGS so a future edit to one side without the other fails here.
// ---------------------------------------------------------------------------
describe("import language round-trip (#729)", () => {

  test("35. every SUPPORTED_LANGS code survives an export→import round-trip", () => {
    for (const { code } of SUPPORTED_LANGS) {
      const plan = planImport(validImportData({ language: code }));
      assert.strictEqual(
        plan.toSave.language,
        code,
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
      const plan = planImport(validImportData({ language: code }));
      assert.strictEqual(plan.toSave.language, code, `"${code}" must round-trip`);
    }
  });

  test("37. unknown/invalid language codes are rejected", () => {
    for (const bad of ["", "xx", "EN", "en-US", "klingon", null, undefined, 42]) {
      const plan = planImport(validImportData({ language: bad }));
      assert.strictEqual(plan.toSave.language, undefined, `"${String(bad)}" must be rejected`);
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
    const prefs = {
      experimentalParamClassesEnabled: true,
      honorCreatorMode: true,
      creatorAllowlist: ["youtube.com/@example"],
    };
    const payload = buildExportPayload(prefs, { devMode: false, appVersion: "1.0.0" });
    assert.strictEqual(payload.experimentalParamClassesEnabled, true, "was silently dropped");
    assert.strictEqual(payload.honorCreatorMode, true, "was silently dropped");
    assert.deepStrictEqual(payload.creatorAllowlist, ["youtube.com/@example"], "was silently dropped");
  });

  test("39. import round-trips honorCreatorMode + experimentalParamClassesEnabled as booleans", () => {
    const plan = planImport(validImportData({ honorCreatorMode: true, experimentalParamClassesEnabled: true }));
    assert.strictEqual(plan.toSave.honorCreatorMode, true, 'toSave must include "honorCreatorMode"');
    assert.strictEqual(plan.toSave.experimentalParamClassesEnabled, true, 'toSave must include "experimentalParamClassesEnabled"');
  });

  test("40. import round-trips creatorAllowlist through the pure validator", () => {
    const plan = planImport(validImportData({ creatorAllowlist: ["YouTube.com/@Example", "youtube.com/@example"] }));
    // addCreatorAllowlistEntry normalizes case and drops the duplicate
    assert.deepStrictEqual(plan.toSave.creatorAllowlist, ["youtube.com/@example"]);
  });

  // #964 — permission-gate bypass
  test("41. followShortenersEnabled is NOT included in toSave; only surfaced via special", () => {
    const plan = planImport(validImportData({ followShortenersEnabled: true }));
    assert.strictEqual(plan.toSave.followShortenersEnabled, undefined, "followShortenersEnabled must never be in toSave (pure module cannot check permissions)");
    assert.strictEqual(plan.special.followShortenersRequested, true);

    const planFalse = planImport(validImportData({ followShortenersEnabled: false }));
    assert.strictEqual(planFalse.special.followShortenersRequested, false);

    const planMissing = planImport(validImportData({}));
    assert.strictEqual(planMissing.special.followShortenersRequested, false);

    // The actual host-permission gate stays in options.js.
    assert.ok(
      /followShortenersRequested\s*&&\s*\(await hasShortenerPermissions\(\)\)/.test(OPTIONS_SOURCE),
      "options.js must only enable followShortenersEnabled when the host grant is present"
    );
    assert.ok(
      OPTIONS_SOURCE.includes("chrome.permissions.contains"),
      "hasShortenerPermissions must check chrome.permissions.contains"
    );
  });

  // drop-affiliate-injection PR 1b: injectOwnAffiliate was removed from
  // SETTINGS_FIELDS/BOOLEAN_KEYS along with its Settings row, so it no
  // longer round-trips through import at all — even when the imported file
  // still carries the legacy key (e.g. an old settings backup).
  test("42. injectOwnAffiliate no longer round-trips through import (schema removed)", () => {
    const plan = planImport(validImportData({ injectOwnAffiliate: true }));
    assert.strictEqual(plan.toSave.injectOwnAffiliate, undefined);
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
    assert.deepStrictEqual([...TOAST_DURATION_OPTIONS], [5, 10, 15, 30, 45, 60]);
    assert.equal(snapToastDuration(45), 45, "an offered value maps to itself");
    assert.equal(snapToastDuration(60), 60, "the ceiling is reachable");
    assert.equal(snapToastDuration(22), 15, "22 snaps to nearest (15, distance 7 < 8)");
    assert.equal(snapToastDuration(23), 30, "23 snaps to nearest (30, distance 7 < 8)");
    assert.equal(snapToastDuration(1000), 60, "out-of-range high clamps to 60");
    assert.equal(snapToastDuration(NaN), 15, "non-finite falls back to 15");
    // The single source of truth now lives in settings-schema.js.
    assert.ok(
      SETTINGS_SCHEMA_SOURCE.includes("export const TOAST_DURATION_OPTIONS"),
      "settings-schema.js must define TOAST_DURATION_OPTIONS"
    );
    assert.ok(
      SETTINGS_SCHEMA_SOURCE.includes("export function snapToastDuration"),
      "settings-schema.js must define snapToastDuration"
    );
  });
});
