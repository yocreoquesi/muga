/**
 * MUGA: Tier 2 gate-reuse guard (#1027 Phase 4, task 4.4).
 *
 * Tier 2 (src/lib/cmp-tier2-rules.js, cmp-adapters.js's TIER2 adapters, and
 * cookie-noise.js's runTier2RejectDispatcher) rides the SAME
 * `cookieConsentMode` pref and the SAME allowlist/blocklist exemption check
 * Tier 1 already uses (see src/lib/cmp-adapters.js's computeCookieGate and
 * cookie-noise.js's `_tier2GateOpen = open` wiring, both from PR 1/PR 2 of
 * this chain). This file asserts, structurally, that no Tier 2-specific
 * toggle/pref/manifest entry was ever introduced -- Tier 2 must stay
 * completely silent within the existing consent feature, per spec.md's
 * "Tier 2 rides the existing consent gate" requirement.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PREF_DEFAULTS } from "../../src/lib/prefs.js";
import { COOKIE_CONSENT_MODE_OPTIONS, SETTINGS_FIELDS, BOOLEAN_KEYS } from "../../src/lib/settings-schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");

// Case-insensitive: catches "tier2", "Tier 2", "tier_2", "tierTwo", etc. in
// one pass. Selector/id strings inside cmp-tier2-rules.js legitimately
// contain "tier2"-shaped substrings (the file itself), so that file is
// intentionally excluded from this particular scan -- this guard is about
// TOGGLE/PREF/MANIFEST surface, not the rule-data file's own naming.
const TIER2_TOKEN = /tier[\s_-]?2|tiertwo/i;

describe("Tier 2 gate reuse — no new toggle/pref/manifest entry", () => {
  test("PREF_DEFAULTS has no tier2-specific key", () => {
    for (const key of Object.keys(PREF_DEFAULTS)) {
      assert.doesNotMatch(key, TIER2_TOKEN, `PREF_DEFAULTS must not gain a Tier 2-specific key: ${key}`);
    }
  });

  test("PREF_DEFAULTS still carries the existing cookieConsentMode key Tier 2 reuses", () => {
    assert.ok("cookieConsentMode" in PREF_DEFAULTS, "cookieConsentMode must exist -- Tier 2 has no gate of its own");
    assert.equal(PREF_DEFAULTS.cookieConsentMode, "reject-only");
  });

  test("cookieConsentMode stays a 2-state enum (no tier2-aware third mode was added)", () => {
    assert.deepEqual([...COOKIE_CONSENT_MODE_OPTIONS].sort(), ["off", "reject-only"]);
  });

  test("SETTINGS_FIELDS has exactly one cookieConsentMode row, no tier2-specific settings row", () => {
    const cookieRows = SETTINGS_FIELDS.filter((f) => f.key === "cookieConsentMode");
    assert.equal(cookieRows.length, 1, "cookieConsentMode must be declared exactly once in SETTINGS_FIELDS");
    for (const field of SETTINGS_FIELDS) {
      assert.doesNotMatch(field.key, TIER2_TOKEN, `SETTINGS_FIELDS must not gain a Tier 2-specific field: ${field.key}`);
    }
  });

  test("BOOLEAN_KEYS has no tier2-specific boolean toggle", () => {
    for (const key of BOOLEAN_KEYS) {
      assert.doesNotMatch(key, TIER2_TOKEN, `BOOLEAN_KEYS must not gain a Tier 2-specific toggle: ${key}`);
    }
  });

  test("manifest.json (MV3) declares no tier2-specific permission, WAR entry, or key", () => {
    const manifest = readFileSync(join(REPO_ROOT, "src/manifest.json"), "utf8");
    assert.doesNotMatch(manifest, TIER2_TOKEN, "src/manifest.json must not reference Tier 2 -- it rides the existing content-script/permission surface");
  });

  test("manifest.v2.json (Firefox) declares no tier2-specific permission, WAR entry, or key", () => {
    const manifest = readFileSync(join(REPO_ROOT, "src/manifest.v2.json"), "utf8");
    assert.doesNotMatch(manifest, TIER2_TOKEN, "src/manifest.v2.json must not reference Tier 2 -- it rides the existing content-script/permission surface");
  });

  test("options.js (Settings UI wiring) introduces no tier2-specific DOM id/pref reference", () => {
    const optionsJs = readFileSync(join(REPO_ROOT, "src/options/options.js"), "utf8");
    assert.doesNotMatch(optionsJs, TIER2_TOKEN, "options.js must not reference Tier 2 -- it is silent within the existing cookieConsentMode row");
  });

  test("onboarding.js introduces no tier2-specific step, pref, or copy key", () => {
    const onboardingJs = readFileSync(join(REPO_ROOT, "src/onboarding/onboarding.js"), "utf8");
    assert.doesNotMatch(onboardingJs, TIER2_TOKEN, "onboarding.js must not reference Tier 2 -- no new onboarding step was added");
  });

  test("cookie-noise.js's Tier 2 dispatcher reuses the same _tier2GateOpen assignment sourced from computeGate's `open`, not a new gate variable", () => {
    const cookieNoise = readFileSync(join(REPO_ROOT, "src/content/cookie-noise.js"), "utf8");
    // Mirrors the PR 2 sync-test precedent: a negative lookbehind skips the
    // `let _tier2GateOpen = false;` declaration and asserts the REAL
    // assignment inside readPrefsAndGate() sets it from the literal `open`
    // variable that already encodes cookieConsentMode + allowlist/blocklist.
    assert.match(
      cookieNoise,
      /(?<!let )_tier2GateOpen\s*=\s*open;/,
      "_tier2GateOpen must be assigned from the same `open` boolean computeGate() already produces for Tier 1 -- not a separate Tier 2 gate"
    );
  });
});
