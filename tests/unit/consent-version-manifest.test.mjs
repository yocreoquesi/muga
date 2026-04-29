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
