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
import {
  CONSENT_VERSION_MANIFEST,
  REQUIRED_CONSENT_VERSION,
} from "../../src/lib/consent-version-manifest.js";

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
  test("user who accepted the current required version is valid (defaults)", () => {
    const r = evaluate({
      stored: { onboardingDone: true, consentVersion: REQUIRED_CONSENT_VERSION },
    });
    assert.equal(r.status, "valid");
    assert.equal(r.requiredVersion, REQUIRED_CONSENT_VERSION);
  });

  test("never-accepted with defaults", () => {
    const r = evaluate({ stored: null });
    assert.equal(r.status, "never-accepted");
  });
});

// ---------------------------------------------------------------------------
// #888 — flipping remoteRulesEnabled ON by default is disclosed to existing
// users via an ADDITIVE consent bump (1.0 → 1.1). A user who accepted "1.0"
// must see the SOFT re-onboard (delta review), not a hard gate, when the code
// requires the live REQUIRED_CONSENT_VERSION. This runs against the REAL
// manifest + required version (no fixtures) so a future material bump that
// forgets `additive: true` is caught.
// ---------------------------------------------------------------------------
describe("consent-policy — #888 remote-rules additive bump (live manifest)", () => {
  test("REQUIRED_CONSENT_VERSION is at least 1.1 (the #888 additive bump shipped)", () => {
    // Uses a manifest lookup rather than a hardcoded literal so this test
    // does not go stale every time a later additive bump ships (e.g. #1027).
    const idx = CONSENT_VERSION_MANIFEST.findIndex((m) => m.version === REQUIRED_CONSENT_VERSION);
    const idx11 = CONSENT_VERSION_MANIFEST.findIndex((m) => m.version === "1.1");
    assert.ok(idx11 !== -1, "manifest must still contain the 1.1 entry");
    assert.ok(idx >= idx11, "REQUIRED_CONSENT_VERSION must be at or after 1.1");
  });

  test("user who accepted 1.0 gets soft-reonboard against live defaults", () => {
    const r = evaluate({
      stored: { onboardingDone: true, consentVersion: "1.0" },
    });
    assert.equal(r.status, "soft-reonboard");
    assert.equal(r.acceptedVersion, "1.0");
    assert.equal(r.requiredVersion, REQUIRED_CONSENT_VERSION);
  });

  test("the 1.0 → required path contains no material version (stays soft)", () => {
    // Walk the live manifest from 1.0 to required; every intermediate entry
    // must be additive, otherwise a 1.0 user would be hard-gated.
    const requiredIdx = CONSENT_VERSION_MANIFEST.findIndex(
      (m) => m.version === REQUIRED_CONSENT_VERSION
    );
    const acceptedIdx = CONSENT_VERSION_MANIFEST.findIndex((m) => m.version === "1.0");
    assert.ok(requiredIdx > acceptedIdx, "required must be after 1.0 in the manifest");
    for (let i = acceptedIdx + 1; i <= requiredIdx; i++) {
      assert.equal(
        CONSENT_VERSION_MANIFEST[i].additive,
        true,
        `manifest entry ${CONSENT_VERSION_MANIFEST[i].version} must be additive so 1.0 users get a soft re-onboard`
      );
    }
  });
});
