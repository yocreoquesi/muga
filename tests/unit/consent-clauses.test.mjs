/**
 * MUGA — consent-clauses (#370)
 *
 * Pure-logic tests for clausesForDelta. Covers the version-walk that
 * the onboarding page uses to surface only the clauses introduced
 * after the user's last accepted version.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clausesForDelta, CONSENT_CLAUSES_BY_VERSION } from "../../src/lib/consent-clauses.js";
import { CONSENT_VERSION_MANIFEST } from "../../src/lib/consent-version-manifest.js";
import { TRANSLATIONS } from "../../src/lib/i18n.js";

const FIXTURE_MANIFEST = Object.freeze([
  Object.freeze({ version: "1.0", additive: false }),
  Object.freeze({ version: "1.1", additive: true }),
  Object.freeze({ version: "1.2", additive: true }),
  Object.freeze({ version: "2.0", additive: false }),
]);

const FIXTURE_CLAUSES = Object.freeze({
  "1.0": Object.freeze([]),
  "1.1": Object.freeze(["clause_a", "clause_b"]),
  "1.2": Object.freeze(["clause_c"]),
  "2.0": Object.freeze(["clause_d", "clause_e"]),
});

describe("clausesForDelta — empty cases", () => {
  test("empty manifest returns []", () => {
    const r = clausesForDelta({
      acceptedVersion: "1.0",
      requiredVersion: "1.1",
      manifest: [],
      clausesByVersion: FIXTURE_CLAUSES,
    });
    assert.deepEqual(r, []);
  });

  test("required version not in manifest returns []", () => {
    const r = clausesForDelta({
      acceptedVersion: "1.0",
      requiredVersion: "9.9",
      manifest: FIXTURE_MANIFEST,
      clausesByVersion: FIXTURE_CLAUSES,
    });
    assert.deepEqual(r, []);
  });

  test("user already at required (no delta)", () => {
    const r = clausesForDelta({
      acceptedVersion: "1.1",
      requiredVersion: "1.1",
      manifest: FIXTURE_MANIFEST,
      clausesByVersion: FIXTURE_CLAUSES,
    });
    assert.deepEqual(r, []);
  });
});

describe("clausesForDelta — single-version delta", () => {
  test("user at 1.0, required 1.1 → returns 1.1 clauses", () => {
    const r = clausesForDelta({
      acceptedVersion: "1.0",
      requiredVersion: "1.1",
      manifest: FIXTURE_MANIFEST,
      clausesByVersion: FIXTURE_CLAUSES,
    });
    assert.deepEqual(r, ["clause_a", "clause_b"]);
  });
});

describe("clausesForDelta — multi-version delta", () => {
  test("user at 1.0, required 1.2 → returns 1.1 + 1.2 clauses in order", () => {
    const r = clausesForDelta({
      acceptedVersion: "1.0",
      requiredVersion: "1.2",
      manifest: FIXTURE_MANIFEST,
      clausesByVersion: FIXTURE_CLAUSES,
    });
    assert.deepEqual(r, ["clause_a", "clause_b", "clause_c"]);
  });

  test("user at 1.0, required 2.0 → all clauses across the path", () => {
    const r = clausesForDelta({
      acceptedVersion: "1.0",
      requiredVersion: "2.0",
      manifest: FIXTURE_MANIFEST,
      clausesByVersion: FIXTURE_CLAUSES,
    });
    assert.deepEqual(r, ["clause_a", "clause_b", "clause_c", "clause_d", "clause_e"]);
  });

  test("user at 1.1, required 2.0 → 1.2 + 2.0 clauses (skips already-accepted 1.1)", () => {
    const r = clausesForDelta({
      acceptedVersion: "1.1",
      requiredVersion: "2.0",
      manifest: FIXTURE_MANIFEST,
      clausesByVersion: FIXTURE_CLAUSES,
    });
    assert.deepEqual(r, ["clause_c", "clause_d", "clause_e"]);
  });
});

describe("clausesForDelta — null acceptedVersion (legacy / never-accepted)", () => {
  test("null acceptedVersion → all clauses up to required", () => {
    const r = clausesForDelta({
      acceptedVersion: null,
      requiredVersion: "1.2",
      manifest: FIXTURE_MANIFEST,
      clausesByVersion: FIXTURE_CLAUSES,
    });
    assert.deepEqual(r, ["clause_a", "clause_b", "clause_c"]);
  });
});

describe("clausesForDelta — default CONSENT_CLAUSES_BY_VERSION", () => {
  test("baseline 1.0 has no surfaceable clauses (delta-mode never fires for 1.0 alone)", () => {
    const r = clausesForDelta({
      acceptedVersion: null,
      requiredVersion: "1.0",
      manifest: [{ version: "1.0", additive: false }],
    });
    assert.deepEqual(r, []);
  });

  test("CONSENT_CLAUSES_BY_VERSION is frozen", () => {
    assert.ok(Object.isFrozen(CONSENT_CLAUSES_BY_VERSION));
  });
});

// ---------------------------------------------------------------------------
// #888 — the 1.1 additive bump surfaces the remote-rules-default clause in the
// delta list. This runs against the LIVE manifest + clause map so a 1.0 user
// upgrading to 1.1 sees exactly the remote-rules disclosure.
// ---------------------------------------------------------------------------
describe("consent-clauses — #888 remote-rules default clause (live map)", () => {
  test("CONSENT_CLAUSES_BY_VERSION['1.1'] discloses the remote-rules clause", () => {
    assert.deepEqual(
      [...(CONSENT_CLAUSES_BY_VERSION["1.1"] || [])],
      ["ob_clause_remote_rules_default"]
    );
  });

  test("user at 1.0, required 1.1 → delta surfaces the remote-rules clause", () => {
    const r = clausesForDelta({
      acceptedVersion: "1.0",
      requiredVersion: "1.1",
      manifest: CONSENT_VERSION_MANIFEST,
      // default clausesByVersion (live map)
    });
    assert.deepEqual(r, ["ob_clause_remote_rules_default"]);
  });

  test("the clause i18n key resolves to non-empty text in EN and ES (official locales)", () => {
    assert.ok(
      typeof TRANSLATIONS.ob_clause_remote_rules_default?.en === "string" &&
        TRANSLATIONS.ob_clause_remote_rules_default.en.trim().length > 0,
      "EN clause text must exist"
    );
    assert.ok(
      typeof TRANSLATIONS.ob_clause_remote_rules_default?.es === "string" &&
        TRANSLATIONS.ob_clause_remote_rules_default.es.trim().length > 0,
      "ES clause text must exist"
    );
    // The disclosure must name the endpoint so the user sees where the egress goes.
    assert.ok(
      TRANSLATIONS.ob_clause_remote_rules_default.en.includes("rules.muga.app"),
      "EN clause text must name rules.muga.app"
    );
  });
});

// ---------------------------------------------------------------------------
// Retired: drop-cookie-consent (Slice D of 6) removed the entire Cookie
// Consent Minimizer subsystem this clause originally disclosed (#1027).
// Unlike the "1.3"/"1.4" sections below (pilots that never shipped to real
// users), this feature DID ship and its disclosure DID reach real users —
// but since the capability itself no longer exists in the codebase, the
// clause list for "1.2" was emptied so no one (fresh or upgrading) is ever
// shown a disclosure for dead functionality. REQUIRED_CONSENT_VERSION stays
// "1.2" unchanged, so this is NOT a re-onboard trigger: consent-policy.js's
// evaluate() compares version numbers only, and every user already at or
// past "1.2" is already `valid` and never re-evaluated against this clause
// list. See consent-clauses.js's docblock ("Scope-reducing removal
// exception") for the full rationale on why this is a narrow, deliberate
// exception to the append-only invariant.
// ---------------------------------------------------------------------------
describe("consent-clauses — retired cookie-consent-minimizer clause (version 1.2 is now empty)", () => {
  test("CONSENT_CLAUSES_BY_VERSION['1.2'] is empty — the retired feature no longer has a real disclosure", () => {
    assert.deepEqual([...(CONSENT_CLAUSES_BY_VERSION["1.2"] || [])], []);
  });

  test("user at 1.1, required 1.2 -> delta surfaces nothing (no clause for a removed feature)", () => {
    const r = clausesForDelta({
      acceptedVersion: "1.1",
      requiredVersion: "1.2",
      manifest: CONSENT_VERSION_MANIFEST,
      // default clausesByVersion (live map)
    });
    assert.deepEqual(r, []);
  });

  test("the retired feature's old i18n key no longer exists", () => {
    assert.equal(TRANSLATIONS.ob_clause_cookie_consent_minimizer, undefined);
  });
});

// ---------------------------------------------------------------------------
// Retired: cookie-consent-accept Slice 2a's Didomi-only "minimum consent"
// pilot never shipped to real users (proven non-viable, engram id 1331) —
// version "1.3"'s clause list is now empty, RETIRED-BEFORE-SHIP.
// ---------------------------------------------------------------------------
describe("consent-clauses — retired Slice 2a clause (version 1.3 is now empty)", () => {
  test("CONSENT_CLAUSES_BY_VERSION['1.3'] is empty — the retired pilot never shipped a real disclosure", () => {
    assert.deepEqual([...(CONSENT_CLAUSES_BY_VERSION["1.3"] || [])], []);
  });

  test("user at 1.2, required 1.3 -> delta surfaces nothing (no soft re-onboard for the retired pilot)", () => {
    const r = clausesForDelta({
      acceptedVersion: "1.2",
      requiredVersion: "1.3",
      manifest: CONSENT_VERSION_MANIFEST,
      // default clausesByVersion (live map)
    });
    assert.deepEqual(r, []);
  });

  test("the retired pilot's old i18n key no longer exists", () => {
    assert.equal(TRANSLATIONS.ob_clause_cookie_consent_accept_pilot, undefined);
  });
});

// ---------------------------------------------------------------------------
// Retired: cookie-consent-paywall-accept originally staged the 1.4 additive
// bump to disclose the real accept-when-necessary mechanism (a DOM click on
// a consent-or-pay wall's own free "Accept all" button). That mechanism was
// deleted entirely before it ever shipped to real users — MUGA never ships
// a capability that accepts cookies on the user's behalf — so, like "1.3"
// above, version "1.4"'s clause list is now empty, RETIRED-BEFORE-SHIP.
// ---------------------------------------------------------------------------
describe("consent-clauses — retired cookie-consent-paywall-accept clause (version 1.4 is now empty)", () => {
  test("CONSENT_CLAUSES_BY_VERSION['1.4'] is empty — the retired mechanism never shipped a real disclosure", () => {
    assert.deepEqual([...(CONSENT_CLAUSES_BY_VERSION["1.4"] || [])], []);
  });

  test("user at 1.2, required 1.4 -> delta surfaces nothing (no soft re-onboard for the retired mechanism)", () => {
    const r = clausesForDelta({
      acceptedVersion: "1.2",
      requiredVersion: "1.4",
      manifest: CONSENT_VERSION_MANIFEST,
      // default clausesByVersion (live map)
    });
    assert.deepEqual(r, []);
  });

  test("the retired mechanism's old i18n key no longer exists", () => {
    assert.equal(TRANSLATIONS.ob_clause_cookie_consent_accept_paywall, undefined);
  });
});
