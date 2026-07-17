/**
 * MUGA: Unit tests for src/lib/settings-schema.js
 *
 * Single source of truth for the Settings export/import feature (#973
 * follow-up). This module is pure (no chrome/DOM APIs), so it is fully
 * testable via direct import — no source-string inspection needed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_LANGS } from "../../src/lib/i18n.js";
import { IMPORT_LIST_CAPS } from "../../src/lib/validation.js";
import {
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_FIELDS,
  BOOLEAN_KEYS,
  TOAST_DURATION_OPTIONS,
  snapToastDuration,
  COOKIE_CONSENT_MODE_OPTIONS,
  clampCookieConsentMode,
  isCookieConsentModeActive,
  buildExportPayload,
  planImport,
  diffImport,
} from "../../src/lib/settings-schema.js";

function validImportData(overrides = {}) {
  return {
    muga: true,
    blacklist: [],
    whitelist: [],
    customParams: [],
    ...overrides,
  };
}

// A representative prefs object matching PREF_DEFAULTS shape, with every
// field set to a distinct, checkable value.
const SAMPLE_PREFS = {
  enabled: true,
  injectOwnAffiliate: true,
  notifyForeignAffiliate: true,
  stripAllAffiliates: false,
  blacklist: ["evil.com"],
  whitelist: ["good.com::tag::abc"],
  customParams: ["ref_code"],
  dnrEnabled: true,
  activeDefenseEnabled: true,
  contextMenuEnabled: true,
  blockPings: true,
  ampRedirect: true,
  unwrapRedirects: true,
  language: "es",
  disabledCategories: ["utm"],
  toastDuration: 30,
  paramBreakdown: true,
  showReportButton: true,
  domainStats: true,
  showBadge: true,
  followShortenersEnabled: true,
  remoteRulesEnabled: true,
  canonicalExtractorEnabled: true,
  crossSiteFrequencyEnabled: true,
  attributionLedgerEnabled: true,
  userCustomRules: ["promo_id"],
  experimentalParamClassesEnabled: true,
  honorCreatorMode: true,
  creatorAllowlist: ["youtube.com/@example"],
  cookieConsentMode: "reject-only",
  cookieConsentAcceptConsented: false,
};

describe("SETTINGS_SCHEMA_VERSION", () => {
  test("is a positive integer, currently 1", () => {
    assert.strictEqual(SETTINGS_SCHEMA_VERSION, 1);
    assert.ok(Number.isInteger(SETTINGS_SCHEMA_VERSION) && SETTINGS_SCHEMA_VERSION > 0);
  });
});

describe("SETTINGS_FIELDS / BOOLEAN_KEYS", () => {
  test("BOOLEAN_KEYS has exactly the 20 documented plain-boolean prefs", () => {
    // cookieConsentAcceptConsented is deliberately NOT here: it is the reserved
    // accept-gate flag for Slice 2 and must never be imported until then, so it
    // is kept out of the importable BOOLEAN_KEYS set (export still round-trips
    // it via SETTINGS_FIELDS).
    const EXPECTED = [
      "enabled", "injectOwnAffiliate", "notifyForeignAffiliate", "stripAllAffiliates",
      "dnrEnabled", "activeDefenseEnabled", "blockPings", "ampRedirect", "unwrapRedirects", "contextMenuEnabled",
      "paramBreakdown", "showReportButton", "domainStats", "showBadge", "honorCreatorMode",
      "experimentalParamClassesEnabled", "canonicalExtractorEnabled", "crossSiteFrequencyEnabled",
      "attributionLedgerEnabled", "hoverPreviewEnabled",
    ];
    assert.deepStrictEqual([...BOOLEAN_KEYS].sort(), [...EXPECTED].sort());
    assert.strictEqual(BOOLEAN_KEYS.length, 20);
  });

  test("permission-gated and local keys are NOT in BOOLEAN_KEYS", () => {
    assert.ok(!BOOLEAN_KEYS.includes("followShortenersEnabled"));
    assert.ok(!BOOLEAN_KEYS.includes("remoteRulesEnabled"));
    assert.ok(!BOOLEAN_KEYS.includes("devMode"));
  });

  test("SETTINGS_FIELDS has no duplicate keys (single source of truth)", () => {
    const keys = SETTINGS_FIELDS.map((f) => f.key);
    assert.strictEqual(new Set(keys).size, keys.length);
  });

  test("injectOwnAffiliate is flagged guarded", () => {
    const field = SETTINGS_FIELDS.find((f) => f.key === "injectOwnAffiliate");
    assert.strictEqual(field.guarded, true);
  });
});

describe("buildExportPayload", () => {
  test("full round-trip: every SETTINGS_FIELDS key is present with the correct value", () => {
    const payload = buildExportPayload(SAMPLE_PREFS, { devMode: true, appVersion: "9.9.9" });
    for (const field of SETTINGS_FIELDS) {
      if (field.kind === "local") {
        assert.strictEqual(payload[field.key], true, `"${field.key}" must come from the devMode param`);
      } else {
        assert.deepStrictEqual(payload[field.key], SAMPLE_PREFS[field.key], `"${field.key}" must round-trip from prefs`);
      }
    }
  });

  test("payload is flat (no nested 'settings' object) and stays a plain object", () => {
    const payload = buildExportPayload(SAMPLE_PREFS, { devMode: false, appVersion: "1.0.0" });
    assert.strictEqual(payload.settings, undefined);
    assert.strictEqual(Object.getPrototypeOf(payload), Object.prototype);
  });

  test("includes muga: true, version, and schemaVersion", () => {
    const payload = buildExportPayload({}, { devMode: false, appVersion: "2.0.0" });
    assert.strictEqual(payload.muga, true);
    assert.strictEqual(payload.version, "2.0.0");
    assert.strictEqual(payload.schemaVersion, SETTINGS_SCHEMA_VERSION);
  });

  test("is pure: does not mutate the input prefs object", () => {
    const prefs = { ...SAMPLE_PREFS };
    const frozen = Object.freeze({ ...prefs });
    assert.doesNotThrow(() => buildExportPayload(frozen, { devMode: false, appVersion: "1.0.0" }));
  });
});

describe("planImport — structural validation", () => {
  test("returns { ok: false } for missing/falsy muga", () => {
    assert.deepStrictEqual(planImport(validImportData({ muga: false })), { ok: false });
    assert.deepStrictEqual(planImport({ blacklist: [], whitelist: [], customParams: [] }), { ok: false });
  });

  test("returns { ok: false } for non-array blacklist/whitelist/customParams", () => {
    assert.deepStrictEqual(planImport(validImportData({ blacklist: "nope" })), { ok: false });
    assert.deepStrictEqual(planImport(validImportData({ whitelist: 42 })), { ok: false });
    assert.deepStrictEqual(planImport(validImportData({ customParams: null })), { ok: false });
  });

  test("returns { ok: false } for a malformed blacklist/whitelist entry", () => {
    assert.deepStrictEqual(planImport(validImportData({ blacklist: ["has space.com"] })), { ok: false });
    assert.deepStrictEqual(planImport(validImportData({ whitelist: ["a::b::c::d"] })), { ok: false });
  });

  test("returns { ok: false } for non-object input", () => {
    assert.deepStrictEqual(planImport(null), { ok: false });
    assert.deepStrictEqual(planImport(undefined), { ok: false });
    assert.deepStrictEqual(planImport("not json"), { ok: false });
  });
});

describe("planImport — legacy files (no schemaVersion)", () => {
  test("a file with no schemaVersion field imports exactly as a versioned one would", () => {
    const legacy = validImportData({ enabled: true, toastDuration: 45, language: "de" });
    assert.strictEqual(legacy.schemaVersion, undefined);
    const plan = planImport(legacy);
    assert.equal(plan.ok, true);
    assert.strictEqual(plan.toSave.enabled, true);
    assert.strictEqual(plan.toSave.toastDuration, 45);
    assert.strictEqual(plan.toSave.language, "de");
  });

  test("an unrecognized/future schemaVersion is not rejected in this slice", () => {
    const plan = planImport(validImportData({ schemaVersion: 999, enabled: true }));
    assert.equal(plan.ok, true);
    assert.strictEqual(plan.toSave.enabled, true);
  });

  // #911: a real user file (Edge 149, MUGA 2.3) with ~1400 custom params was
  // wrongly rejected as "not a muga configuration". A legacy export — no
  // schemaVersion, an old manifest `version`, an oversized list, and none of
  // the fields added after 2.3 — must still import: the big list truncates to
  // the cap (never rejects), and absent newer fields keep their defaults.
  test("a legacy 2.3-era file with ~1400 custom params imports (truncates, never rejects) (#911)", () => {
    const bigParams = Array.from({ length: 1400 }, (_, i) => `ptrk${i}`);
    const legacy = {
      muga: true,
      version: "2.3",
      blacklist: ["evil.com"],
      whitelist: [],
      customParams: bigParams,
      // fields that did not exist in 2.3 are intentionally absent
    };
    assert.strictEqual(legacy.schemaVersion, undefined);

    const plan = planImport(legacy);
    assert.equal(plan.ok, true, "an oversized legacy list must truncate, not reject");
    assert.strictEqual(plan.toSave.customParams.length, IMPORT_LIST_CAPS.customParams);
    assert.ok(plan.skipped > 0, "the over-cap entries must be reported as skipped");

    // Absent post-2.3 fields must not be written, so their defaults survive.
    for (const key of ["creatorAllowlist", "experimentalParamClassesEnabled", "honorCreatorMode", "canonicalExtractorEnabled"]) {
      assert.strictEqual(plan.toSave[key], undefined, `absent legacy field "${key}" must keep its default`);
    }
  });
});

describe("planImport — full round-trip of every field", () => {
  test("every BOOLEAN_KEYS entry round-trips when true", () => {
    const data = validImportData(Object.fromEntries(BOOLEAN_KEYS.map((k) => [k, true])));
    const plan = planImport(data);
    assert.equal(plan.ok, true);
    for (const key of BOOLEAN_KEYS) {
      assert.strictEqual(plan.toSave[key], true, `"${key}" must round-trip`);
    }
  });

  test("lists round-trip through capImportedLists", () => {
    const plan = planImport(validImportData({
      blacklist: ["a.com"],
      whitelist: ["b.com::tag::x"],
      customParams: ["ref_code"],
    }));
    assert.deepStrictEqual(plan.toSave.blacklist, ["a.com"]);
    assert.deepStrictEqual(plan.toSave.whitelist, ["b.com::tag::x"]);
    assert.deepStrictEqual(plan.toSave.customParams, ["ref_code"]);
    assert.strictEqual(plan.skipped, 0);
  });

  test("disabledCategories round-trips when every entry is valid", () => {
    const plan = planImport(validImportData({ disabledCategories: ["utm", "generic"] }));
    assert.deepStrictEqual(plan.toSave.disabledCategories, ["utm", "generic"]);
  });

  test("disabledCategories with any invalid entry is rejected wholesale", () => {
    const plan = planImport(validImportData({ disabledCategories: ["utm", "bogus"] }));
    assert.strictEqual(plan.toSave.disabledCategories, undefined);
  });

  test("toastDuration snaps via the shared snapToastDuration", () => {
    for (const raw of [1, 12, 22, 23, 999, NaN]) {
      const plan = planImport(validImportData({ toastDuration: raw }));
      assert.strictEqual(plan.toSave.toastDuration, snapToastDuration(raw));
    }
  });

  test("cookieConsentMode import keeps off/reject-only verbatim", () => {
    for (const mode of ["off", "reject-only"]) {
      const plan = planImport(validImportData({ cookieConsentMode: mode }));
      assert.strictEqual(plan.toSave.cookieConsentMode, mode);
    }
  });

  test("cookieConsentMode import collapses accept-when-necessary to reject-only (not pre-seedable until Slice 2)", () => {
    // Importing must never pre-seed the reserved accept state without a consent
    // gesture; only the import path is clamped this hard.
    const plan = planImport(validImportData({ cookieConsentMode: "accept-when-necessary" }));
    assert.strictEqual(plan.toSave.cookieConsentMode, "reject-only");
  });

  test("cookieConsentMode clamps an unrecognized value to the safe default (reject-only)", () => {
    const plan = planImport(validImportData({ cookieConsentMode: "bogus-mode" }));
    assert.strictEqual(plan.toSave.cookieConsentMode, "reject-only");
  });

  test("cookieConsentAcceptConsented is NOT importable (reserved accept-gate for Slice 2)", () => {
    const plan = planImport(validImportData({ cookieConsentAcceptConsented: true }));
    assert.strictEqual(plan.toSave.cookieConsentAcceptConsented, undefined);
    const planFalse = planImport(validImportData({ cookieConsentAcceptConsented: false }));
    assert.strictEqual(planFalse.toSave.cookieConsentAcceptConsented, undefined);
  });

  test("language round-trips for every SUPPORTED_LANGS code, rejects unknown codes", () => {
    for (const { code } of SUPPORTED_LANGS) {
      const plan = planImport(validImportData({ language: code }));
      assert.strictEqual(plan.toSave.language, code);
    }
    const rejected = planImport(validImportData({ language: "not-a-lang" }));
    assert.strictEqual(rejected.toSave.language, undefined);
  });

  test("experimentalParamClassesEnabled and honorCreatorMode round-trip (#968)", () => {
    const plan = planImport(validImportData({
      experimentalParamClassesEnabled: true,
      honorCreatorMode: true,
    }));
    assert.strictEqual(plan.toSave.experimentalParamClassesEnabled, true);
    assert.strictEqual(plan.toSave.honorCreatorMode, true);
  });

  test("creatorAllowlist round-trips through the pure validator, dropping dupes/invalid entries (#968)", () => {
    const plan = planImport(validImportData({
      creatorAllowlist: ["youtube.com/@a", "YOUTUBE.COM/@A", "not valid entry!"],
    }));
    assert.deepStrictEqual(plan.toSave.creatorAllowlist, ["youtube.com/@a"]);
  });

  test("userCustomRules is filtered via isValidCustomParam and capped", () => {
    const plan = planImport(validImportData({
      userCustomRules: ["ref_code", "q", "tag", "promo id"],
    }));
    // "q" (denylisted) and "tag" (affiliate guard) and "promo id" (bad format) are dropped.
    assert.deepStrictEqual(plan.toSave.userCustomRules, ["ref_code"]);
  });
});

describe("planImport — #964 followShortenersEnabled permission gate", () => {
  test("followShortenersEnabled never appears in toSave — pure module cannot check permissions", () => {
    const plan = planImport(validImportData({ followShortenersEnabled: true }));
    assert.strictEqual(plan.toSave.followShortenersEnabled, undefined);
  });

  test("special.followShortenersRequested reflects the raw imported value", () => {
    assert.strictEqual(planImport(validImportData({ followShortenersEnabled: true })).special.followShortenersRequested, true);
    assert.strictEqual(planImport(validImportData({ followShortenersEnabled: false })).special.followShortenersRequested, false);
    assert.strictEqual(planImport(validImportData({})).special.followShortenersRequested, false);
    assert.strictEqual(planImport(validImportData({ followShortenersEnabled: "true" })).special.followShortenersRequested, false, "non-boolean truthy values must not be treated as a request");
  });

  // options.js branches on followShortenersProvided (not raw data) to tell
  // "present as false" (write false) apart from "absent" (leave untouched),
  // keeping the gate derived from the migrated plan.
  test("special.followShortenersProvided is true only for a real boolean, false for absent/non-boolean", () => {
    assert.strictEqual(planImport(validImportData({ followShortenersEnabled: true })).special.followShortenersProvided, true);
    assert.strictEqual(planImport(validImportData({ followShortenersEnabled: false })).special.followShortenersProvided, true);
    assert.strictEqual(planImport(validImportData({})).special.followShortenersProvided, false);
    assert.strictEqual(planImport(validImportData({ followShortenersEnabled: "true" })).special.followShortenersProvided, false);
  });
});

describe("planImport — #987 remoteRulesEnabled permission gate", () => {
  test("remoteRulesEnabled never appears in toSave — options.js gates it on the host grant", () => {
    const plan = planImport(validImportData({ remoteRulesEnabled: true }));
    assert.strictEqual(plan.toSave.remoteRulesEnabled, undefined);
  });

  test("special.remoteRulesProvided/Requested split present-false from absent", () => {
    assert.strictEqual(planImport(validImportData({ remoteRulesEnabled: true })).special.remoteRulesRequested, true);
    assert.strictEqual(planImport(validImportData({ remoteRulesEnabled: true })).special.remoteRulesProvided, true);
    assert.strictEqual(planImport(validImportData({ remoteRulesEnabled: false })).special.remoteRulesRequested, false);
    assert.strictEqual(planImport(validImportData({ remoteRulesEnabled: false })).special.remoteRulesProvided, true);
    assert.strictEqual(planImport(validImportData({})).special.remoteRulesProvided, false);
    assert.strictEqual(planImport(validImportData({ remoteRulesEnabled: "true" })).special.remoteRulesProvided, false, "non-boolean truthy values must not be treated as a request");
  });

  test("remoteRulesEnabled round-trips through export (permission-gated kind)", () => {
    assert.strictEqual(buildExportPayload({ remoteRulesEnabled: false }, {}).remoteRulesEnabled, false);
    assert.strictEqual(buildExportPayload({ remoteRulesEnabled: true }, {}).remoteRulesEnabled, true);
  });
});

describe("planImport — #965 guarded pref reconciliation input", () => {
  test("injectOwnAffiliate lands in toSave as a plain boolean so options.js can reconcile it", () => {
    const plan = planImport(validImportData({ injectOwnAffiliate: true }));
    assert.strictEqual(plan.toSave.injectOwnAffiliate, true);
    const planFalse = planImport(validImportData({ injectOwnAffiliate: false }));
    assert.strictEqual(planFalse.toSave.injectOwnAffiliate, false);
  });
});

describe("planImport — devMode (local-only, not a synced pref)", () => {
  test("special.devMode carries the raw boolean, undefined when absent", () => {
    assert.strictEqual(planImport(validImportData({ devMode: true })).special.devMode, true);
    assert.strictEqual(planImport(validImportData({ devMode: false })).special.devMode, false);
    assert.strictEqual(planImport(validImportData({})).special.devMode, undefined);
  });

  test("devMode never appears in toSave (it is not a synced pref)", () => {
    const plan = planImport(validImportData({ devMode: true }));
    assert.strictEqual(plan.toSave.devMode, undefined);
  });
});

describe("SETTINGS_FIELDS — label", () => {
  test("every field carries a non-empty string labelKey", () => {
    for (const field of SETTINGS_FIELDS) {
      assert.strictEqual(typeof field.label, "string", `"${field.key}" must have a label`);
      assert.ok(field.label.length > 0, `"${field.key}".label must not be empty`);
    }
  });
});

describe("diffImport", () => {
  test("returns [] when nothing changed", () => {
    assert.deepStrictEqual(diffImport(SAMPLE_PREFS, SAMPLE_PREFS), []);
  });

  test("returns [] when incomingValues is missing keys present in currentValues (no diff to report)", () => {
    assert.deepStrictEqual(diffImport(SAMPLE_PREFS, {}), []);
  });

  test("a boolean flip produces a single scalar row", () => {
    const incoming = { ...SAMPLE_PREFS, injectOwnAffiliate: false };
    const rows = diffImport(SAMPLE_PREFS, incoming);
    assert.strictEqual(rows.length, 1);
    assert.deepStrictEqual(rows[0], {
      key: "injectOwnAffiliate",
      labelKey: "row_inject_label",
      kind: "scalar",
      before: true,
      after: false,
    });
  });

  test("a list field with both an add and a removal produces a list row with both arrays populated", () => {
    const current = { ...SAMPLE_PREFS, blacklist: ["a.com", "b.com"] };
    const incoming = { ...SAMPLE_PREFS, blacklist: ["b.com", "c.com"] };
    const rows = diffImport(current, incoming);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].key, "blacklist");
    assert.strictEqual(rows[0].kind, "list");
    assert.deepStrictEqual(rows[0].added, ["c.com"]);
    assert.deepStrictEqual(rows[0].removed, ["a.com"]);
  });

  test("a list field with the same entries in a different order produces no row", () => {
    const current = { ...SAMPLE_PREFS, blacklist: ["a.com", "b.com", "c.com"] };
    const incoming = { ...SAMPLE_PREFS, blacklist: ["c.com", "a.com", "b.com"] };
    assert.deepStrictEqual(diffImport(current, incoming), []);
  });

  test("returns FULL uncapped arrays even when they exceed 20 entries (capping is a rendering concern)", () => {
    const bigList = Array.from({ length: 25 }, (_, i) => `tracker${i}.com`);
    const current = { ...SAMPLE_PREFS, blacklist: [] };
    const incoming = { ...SAMPLE_PREFS, blacklist: bigList };
    const rows = diffImport(current, incoming);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].added.length, 25);
    assert.deepStrictEqual(rows[0].added, bigList);
  });

  test("a mixed diff touching multiple fields comes back in SETTINGS_FIELDS declaration order", () => {
    const current = { ...SAMPLE_PREFS, blacklist: ["a.com"], creatorAllowlist: [] };
    const incoming = {
      ...SAMPLE_PREFS,
      // out-of-declaration-order writes below; the result must still follow
      // SETTINGS_FIELDS order (enabled < blacklist < toastDuration < creatorAllowlist).
      creatorAllowlist: ["youtube.com/@a"],
      toastDuration: 60,
      enabled: false,
      blacklist: ["a.com", "z.com"],
    };
    const rows = diffImport(current, incoming);
    assert.deepStrictEqual(rows.map((r) => r.key), ["enabled", "blacklist", "toastDuration", "creatorAllowlist"]);
  });

  test("is pure: does not mutate either input object", () => {
    const current = Object.freeze({ ...SAMPLE_PREFS, blacklist: Object.freeze(["a.com"]) });
    const incoming = Object.freeze({ ...SAMPLE_PREFS, blacklist: Object.freeze(["b.com"]) });
    assert.doesNotThrow(() => diffImport(current, incoming));
  });
});

describe("TOAST_DURATION_OPTIONS / snapToastDuration", () => {
  test("options span the full 5..60 range", () => {
    assert.deepStrictEqual([...TOAST_DURATION_OPTIONS], [5, 10, 15, 30, 45, 60]);
  });

  test("snaps to the nearest offered option", () => {
    assert.equal(snapToastDuration(5), 5);
    assert.equal(snapToastDuration(60), 60);
    assert.equal(snapToastDuration(22), 15);
    assert.equal(snapToastDuration(23), 30);
    assert.equal(snapToastDuration(1000), 60);
    assert.equal(snapToastDuration(NaN), 15);
  });
});

describe("COOKIE_CONSENT_MODE_OPTIONS / clampCookieConsentMode", () => {
  test("the enum has exactly the three documented members, reject-only first", () => {
    assert.deepStrictEqual([...COOKIE_CONSENT_MODE_OPTIONS], ["off", "reject-only", "accept-when-necessary"]);
  });

  test("clamps every valid member to itself", () => {
    for (const mode of COOKIE_CONSENT_MODE_OPTIONS) {
      assert.equal(clampCookieConsentMode(mode), mode);
    }
  });

  test("clamps an unrecognized value, or a non-string, to the safe default (reject-only)", () => {
    assert.equal(clampCookieConsentMode("bogus"), "reject-only");
    assert.equal(clampCookieConsentMode(undefined), "reject-only");
    assert.equal(clampCookieConsentMode(null), "reject-only");
    assert.equal(clampCookieConsentMode(123), "reject-only");
  });
});

// isCookieConsentModeActive (cookie-consent-accept Slice 2a): the
// modeActive gate-wiring boundary — src/lib/cmp-adapters.js's
// computeCookieGate no longer compares the mode string itself (that file
// stays lexically restricted, see its structural guard); instead the
// caller (background/service-worker.js) validates the mode against this
// closed-enum boundary here and hands a pre-validated boolean down. This
// module has no lexical restriction, so it is the one safe place to name
// every active enum member explicitly.
describe("isCookieConsentModeActive", () => {
  test("reject-only is active", () => {
    assert.equal(isCookieConsentModeActive("reject-only"), true);
  });

  test("accept-when-necessary is active", () => {
    assert.equal(isCookieConsentModeActive("accept-when-necessary"), true);
  });

  test("off is not active", () => {
    assert.equal(isCookieConsentModeActive("off"), false);
  });

  test("an unrecognized string, or a non-string, is not active (fail-closed)", () => {
    assert.equal(isCookieConsentModeActive("bogus"), false);
    assert.equal(isCookieConsentModeActive(undefined), false);
    assert.equal(isCookieConsentModeActive(null), false);
    assert.equal(isCookieConsentModeActive(123), false);
  });
});
