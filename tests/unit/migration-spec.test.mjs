/**
 * MUGA — migration spec schema (#363)
 *
 * Validates that every entry in MIGRATIONS has the documented shape, that
 * ids are unique, that version pairs are well-formed, and — critically —
 * that any entry tagged `networkRelated: true` has a non-empty
 * `bannerCopyKey`. The last check is the silent-migration prevention guard:
 * a network-related pref default cannot flip without a user-visible banner.
 *
 * The spec ships empty (#363) — these assertions run against the empty list
 * cleanly, and protect every future entry that lands in the spec.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MIGRATIONS } from "../../src/lib/migration-spec.js";
import { compareVersions } from "../../src/lib/migration-evaluator.js";

const REQUIRED_FIELDS = [
  "id",
  "fromVersion",
  "toVersion",
  "prefs",
  "proposedValue",
  "networkRelated",
  "bannerCopyKey",
];

const SEMVER_RE = /^\d+(\.\d+){0,2}$/;

describe("migration-spec — shape", () => {
  test("MIGRATIONS is an array", () => {
    assert.ok(Array.isArray(MIGRATIONS), "MIGRATIONS must be an array");
  });

  test("MIGRATIONS is frozen (append-only invariant — entries cannot be mutated)", () => {
    assert.ok(Object.isFrozen(MIGRATIONS), "MIGRATIONS must be Object.freeze()'d");
  });
});

describe("migration-spec — entry validation", () => {
  for (const m of MIGRATIONS) {
    describe(`entry "${m?.id || "(missing id)"}"`, () => {
      for (const field of REQUIRED_FIELDS) {
        test(`has required field "${field}"`, () => {
          assert.ok(field in m, `Missing field: ${field}`);
        });
      }

      test("id is a non-empty string", () => {
        assert.equal(typeof m.id, "string");
        assert.ok(m.id.length > 0);
      });

      test("fromVersion is well-formed semver", () => {
        assert.match(m.fromVersion, SEMVER_RE);
      });

      test("toVersion is well-formed semver", () => {
        assert.match(m.toVersion, SEMVER_RE);
      });

      test("toVersion > fromVersion", () => {
        assert.ok(
          compareVersions(m.toVersion, m.fromVersion) > 0,
          `toVersion (${m.toVersion}) must be greater than fromVersion (${m.fromVersion})`
        );
      });

      test("prefs is a non-empty array of strings", () => {
        assert.ok(Array.isArray(m.prefs));
        assert.ok(m.prefs.length > 0);
        m.prefs.forEach(p => assert.equal(typeof p, "string"));
      });

      test("proposedValue is an object covering every entry in prefs", () => {
        assert.equal(typeof m.proposedValue, "object");
        for (const key of m.prefs) {
          assert.ok(key in m.proposedValue, `proposedValue missing pref "${key}"`);
        }
      });

      test("networkRelated is a boolean", () => {
        assert.equal(typeof m.networkRelated, "boolean");
      });

      test("bannerCopyKey is required and non-empty when networkRelated is true", () => {
        if (m.networkRelated) {
          assert.equal(typeof m.bannerCopyKey, "string");
          assert.ok(
            m.bannerCopyKey.length > 0,
            "Network-related migrations MUST have a non-empty bannerCopyKey. " +
            "Silent migration of network-related prefs is forbidden."
          );
        } else {
          assert.equal(typeof m.bannerCopyKey, "string");
        }
      });
    });
  }
});

describe("migration-spec — global invariants", () => {
  test("ids are unique across the spec", () => {
    const ids = MIGRATIONS.map(m => m.id);
    const uniq = new Set(ids);
    assert.equal(ids.length, uniq.size, "Duplicate id detected in MIGRATIONS");
  });
});
