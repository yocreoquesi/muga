/**
 * MUGA — consent-policy (#365)
 *
 * Pure-logic tests for the version-comparison gate. Every status branch
 * covered: never-accepted, valid, soft-reonboard, hard-reonboard, plus
 * the fail-open edge cases (legacy install with no version, malformed
 * manifest, retired accepted version).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../../src/lib/consent-policy.js";
import { CONSENT_VERSION_MANIFEST } from "../../src/lib/consent-version-manifest.js";

// Fixture manifests for testing scenarios beyond the current single-entry baseline.
const MANIFEST_TWO_ADDITIVE = Object.freeze([
  Object.freeze({ version: "1.0", additive: false }),
  Object.freeze({ version: "1.1", additive: true }),
]);

const MANIFEST_TWO_MATERIAL = Object.freeze([
  Object.freeze({ version: "1.0", additive: false }),
  Object.freeze({ version: "2.0", additive: false }),
]);

const MANIFEST_THREE_MIXED = Object.freeze([
  Object.freeze({ version: "1.0", additive: false }),
  Object.freeze({ version: "1.1", additive: true }),  // additive
  Object.freeze({ version: "2.0", additive: false }), // material
]);

describe("consent-policy — never-accepted", () => {
  test("no stored record at all", () => {
    const r = evaluate({ stored: null, requiredVersion: "1.0", manifest: CONSENT_VERSION_MANIFEST });
    assert.equal(r.status, "never-accepted");
    assert.equal(r.acceptedVersion, null);
  });

  test("stored record with onboardingDone false", () => {
    const r = evaluate({
      stored: { onboardingDone: false, consentVersion: null, consentDate: null },
      requiredVersion: "1.0",
      manifest: CONSENT_VERSION_MANIFEST,
    });
    assert.equal(r.status, "never-accepted");
  });

  test("undefined stored", () => {
    const r = evaluate({ stored: undefined });
    assert.equal(r.status, "never-accepted");
  });
});

describe("consent-policy — valid", () => {
  test("accepted version equals required version", () => {
    const r = evaluate({
      stored: { onboardingDone: true, consentVersion: "1.0" },
      requiredVersion: "1.0",
      manifest: CONSENT_VERSION_MANIFEST,
    });
    assert.equal(r.status, "valid");
    assert.equal(r.acceptedVersion, "1.0");
  });

  test("accepted version greater than required (defensive)", () => {
    const r = evaluate({
      stored: { onboardingDone: true, consentVersion: "2.0" },
      requiredVersion: "1.0",
      manifest: CONSENT_VERSION_MANIFEST,
    });
    assert.equal(r.status, "valid");
  });

  test("legacy record with onboardingDone but no consentVersion → fail-open valid", () => {
    const r = evaluate({
      stored: { onboardingDone: true, consentVersion: null, consentDate: null },
      requiredVersion: "1.0",
      manifest: CONSENT_VERSION_MANIFEST,
    });
    assert.equal(r.status, "valid");
    assert.equal(r.acceptedVersion, null);
  });
});

describe("consent-policy — soft-reonboard (additive bump)", () => {
  test("user at 1.0, required 1.1 with additive: true", () => {
    const r = evaluate({
      stored: { onboardingDone: true, consentVersion: "1.0" },
      requiredVersion: "1.1",
      manifest: MANIFEST_TWO_ADDITIVE,
    });
    assert.equal(r.status, "soft-reonboard");
    assert.equal(r.acceptedVersion, "1.0");
    assert.equal(r.requiredVersion, "1.1");
  });
});

describe("consent-policy — hard-reonboard (material bump)", () => {
  test("user at 1.0, required 2.0 with additive: false", () => {
    const r = evaluate({
      stored: { onboardingDone: true, consentVersion: "1.0" },
      requiredVersion: "2.0",
      manifest: MANIFEST_TWO_MATERIAL,
    });
    assert.equal(r.status, "hard-reonboard");
  });

  test("user at 1.0, required 2.0 with one additive and one material in between → hard wins", () => {
    const r = evaluate({
      stored: { onboardingDone: true, consentVersion: "1.0" },
      requiredVersion: "2.0",
      manifest: MANIFEST_THREE_MIXED,
    });
    // Path: 1.0 → 1.1 (additive) → 2.0 (material). Material along the way → hard.
    assert.equal(r.status, "hard-reonboard");
  });

  test("user at 1.1 (additive), required 2.0 (material) — material gate", () => {
    const r = evaluate({
      stored: { onboardingDone: true, consentVersion: "1.1" },
      requiredVersion: "2.0",
      manifest: MANIFEST_THREE_MIXED,
    });
    assert.equal(r.status, "hard-reonboard");
  });
});

describe("consent-policy — fail-open edge cases", () => {
  test("required version not in manifest → valid (config bug, do not punish user)", () => {
    const r = evaluate({
      stored: { onboardingDone: true, consentVersion: "1.0" },
      requiredVersion: "9.9", // not in manifest
      manifest: CONSENT_VERSION_MANIFEST,
    });
    assert.equal(r.status, "valid");
  });

  test("accepted version retired from manifest → valid", () => {
    const r = evaluate({
      stored: { onboardingDone: true, consentVersion: "0.5" }, // not in current manifest
      requiredVersion: "1.0",
      manifest: CONSENT_VERSION_MANIFEST,
    });
    assert.equal(r.status, "valid");
  });
});

describe("consent-policy — defaults from CONSENT_VERSION_MANIFEST", () => {
  test("called with only stored (uses default required + manifest)", () => {
    // The default manifest currently has only "1.0". A user accepted at
    // "1.0" should be valid against the default.
    const r = evaluate({
      stored: { onboardingDone: true, consentVersion: "1.0" },
    });
    assert.equal(r.status, "valid");
    assert.equal(r.requiredVersion, "1.0");
  });

  test("never-accepted with defaults", () => {
    const r = evaluate({ stored: null });
    assert.equal(r.status, "never-accepted");
  });
});
