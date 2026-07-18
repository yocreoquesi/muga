/**
 * MUGA — consent-version-manifest schema (#365)
 *
 * Validates the manifest's append-only invariant and shape. Runs
 * against the live manifest so any future addition is checked
 * automatically.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CONSENT_VERSION_MANIFEST,
  REQUIRED_CONSENT_VERSION,
} from "../../src/lib/consent-version-manifest.js";
import { compareVersions } from "../../src/lib/migration-evaluator.js";

const SEMVER_RE = /^\d+(\.\d+){0,2}$/;

describe("consent-version-manifest — shape", () => {
  test("CONSENT_VERSION_MANIFEST is a frozen array", () => {
    assert.ok(Array.isArray(CONSENT_VERSION_MANIFEST));
    assert.ok(Object.isFrozen(CONSENT_VERSION_MANIFEST));
  });

  test("manifest has at least one entry", () => {
    assert.ok(CONSENT_VERSION_MANIFEST.length >= 1);
  });

  test("REQUIRED_CONSENT_VERSION is a non-empty string", () => {
    assert.equal(typeof REQUIRED_CONSENT_VERSION, "string");
    assert.ok(REQUIRED_CONSENT_VERSION.length > 0);
  });

  test("REQUIRED_CONSENT_VERSION is present in the manifest", () => {
    const found = CONSENT_VERSION_MANIFEST.find(m => m.version === REQUIRED_CONSENT_VERSION);
    assert.ok(found, `REQUIRED_CONSENT_VERSION "${REQUIRED_CONSENT_VERSION}" must be a manifest entry`);
  });
});

describe("consent-version-manifest — entry validation", () => {
  for (const entry of CONSENT_VERSION_MANIFEST) {
    describe(`entry "${entry.version}"`, () => {
      test("is frozen", () => {
        assert.ok(Object.isFrozen(entry), "entries must be Object.freeze()'d for the append-only invariant");
      });

      test("version is well-formed semver", () => {
        assert.match(entry.version, SEMVER_RE);
      });

      test("additive is a boolean", () => {
        assert.equal(typeof entry.additive, "boolean");
      });
    });
  }
});

describe("consent-version-manifest — #888 remote-rules additive bump", () => {
  test("manifest contains a 1.1 entry marked additive: true", () => {
    const entry = CONSENT_VERSION_MANIFEST.find(m => m.version === "1.1");
    assert.ok(entry, "manifest must contain the 1.1 entry (#888)");
    assert.equal(entry.additive, true, "1.1 must be additive (soft re-onboard), not material");
  });
});

describe("consent-version-manifest — #1027 cookie-consent-minimizer additive bump", () => {
  test("manifest contains a 1.2 entry marked additive: true", () => {
    const entry = CONSENT_VERSION_MANIFEST.find(m => m.version === "1.2");
    assert.ok(entry, "manifest must contain the 1.2 entry (#1027)");
    assert.equal(entry.additive, true, "1.2 must be additive (soft re-onboard), not material");
  });
});

// cookie-consent-accept Slice 2a's 1.3 entry never activated a real
// disclosure — its Didomi-only "minimum consent" pilot was proven
// non-viable before shipping (engram id 1331) and retired. It remains in
// the manifest (append-only) but REQUIRED_CONSENT_VERSION never pointed at
// it and its clause list is empty (see consent-clauses.test.mjs).
describe("consent-version-manifest — the retired 1.3 entry stays in the manifest but was never activated", () => {
  test("manifest still contains a 1.3 entry marked additive: true (append-only — never delete a published entry)", () => {
    const entry = CONSENT_VERSION_MANIFEST.find(m => m.version === "1.3");
    assert.ok(entry, "manifest must contain the 1.3 entry");
    assert.equal(entry.additive, true, "1.3 must be additive (soft re-onboard), not material");
  });

  test("REQUIRED_CONSENT_VERSION never pointed at 1.3", () => {
    assert.notEqual(REQUIRED_CONSENT_VERSION, "1.3");
  });
});

// cookie-consent-paywall-accept: the 1.4 entry activates the REAL
// accept-when-necessary mechanism — a DOM click on a consent-or-pay wall's
// free "Accept all" button when the wall offers no free reject option. This
// GRANTS the site's advertising/tracking cookies, which is disclosure-worthy
// even though the feature itself stays off until the user opts in AND
// completes the explicit consent gesture (see
// src/lib/cmp-accept-adapters.js's L2). Existing users who accepted 1.2 or
// 1.3 get a SOFT re-onboard (delta review) surfacing this one new clause,
// not a hard gate.
describe("consent-version-manifest — cookie-consent-paywall-accept activates the 1.4 entry", () => {
  test("manifest contains a 1.4 entry marked additive: true", () => {
    const entry = CONSENT_VERSION_MANIFEST.find(m => m.version === "1.4");
    assert.ok(entry, "manifest must contain the 1.4 entry");
    assert.equal(entry.additive, true, "1.4 must be additive (soft re-onboard), not material");
  });

  test("REQUIRED_CONSENT_VERSION is 1.4", () => {
    assert.equal(REQUIRED_CONSENT_VERSION, "1.4");
  });

  test("1.4 is the latest manifest entry", () => {
    const latest = CONSENT_VERSION_MANIFEST[CONSENT_VERSION_MANIFEST.length - 1];
    assert.equal(latest.version, "1.4");
  });
});

describe("consent-version-manifest — global invariants", () => {
  test("versions are unique", () => {
    const versions = CONSENT_VERSION_MANIFEST.map(m => m.version);
    const uniq = new Set(versions);
    assert.equal(versions.length, uniq.size, "duplicate version detected in manifest");
  });

  test("manifest is in ascending version order", () => {
    for (let i = 1; i < CONSENT_VERSION_MANIFEST.length; i++) {
      const prev = CONSENT_VERSION_MANIFEST[i - 1].version;
      const curr = CONSENT_VERSION_MANIFEST[i].version;
      assert.ok(
        compareVersions(curr, prev) > 0,
        `manifest must be ascending; found ${curr} after ${prev}`
      );
    }
  });
});
