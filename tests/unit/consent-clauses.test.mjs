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
// #1027 — the 1.2 additive bump surfaces the cookie-consent-minimizer clause
// in the delta list. Mirrors the #888 section above against the LIVE map.
// ---------------------------------------------------------------------------
describe("consent-clauses — #1027 cookie-consent-minimizer clause (live map)", () => {
  test("CONSENT_CLAUSES_BY_VERSION['1.2'] discloses the cookie-consent-minimizer clause", () => {
    assert.deepEqual(
      [...(CONSENT_CLAUSES_BY_VERSION["1.2"] || [])],
      ["ob_clause_cookie_consent_minimizer"]
    );
  });

  test("user at 1.1, required 1.2 -> delta surfaces the cookie-consent-minimizer clause", () => {
    const r = clausesForDelta({
      acceptedVersion: "1.1",
      requiredVersion: "1.2",
      manifest: CONSENT_VERSION_MANIFEST,
      // default clausesByVersion (live map)
    });
    assert.deepEqual(r, ["ob_clause_cookie_consent_minimizer"]);
  });

  test("the clause i18n key resolves to non-empty text in EN and ES (official locales)", () => {
    assert.ok(
      typeof TRANSLATIONS.ob_clause_cookie_consent_minimizer?.en === "string" &&
        TRANSLATIONS.ob_clause_cookie_consent_minimizer.en.trim().length > 0,
      "EN clause text must exist"
    );
    assert.ok(
      typeof TRANSLATIONS.ob_clause_cookie_consent_minimizer?.es === "string" &&
        TRANSLATIONS.ob_clause_cookie_consent_minimizer.es.trim().length > 0,
      "ES clause text must exist"
    );
  });
});
