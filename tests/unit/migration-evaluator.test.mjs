/**
 * MUGA — migration evaluator (#363)
 *
 * Pure-logic tests for evaluateMigrations. No I/O, no chrome stub needed.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluateMigrations, compareVersions } from "../../src/lib/migration-evaluator.js";

const FIXTURE = {
  id: "fixture-pref-flip",
  fromVersion: "1.0.0",
  toVersion: "2.0.0",
  prefs: ["fixturePref"],
  proposedValue: { fixturePref: true },
  networkRelated: false,
  bannerCopyKey: "fixture_banner",
};

const FIXTURE_NETWORK = {
  id: "fixture-network-flip",
  fromVersion: "1.5.0",
  toVersion: "2.5.0",
  prefs: ["fixtureNetworkPref"],
  proposedValue: { fixtureNetworkPref: true },
  networkRelated: true,
  bannerCopyKey: "fixture_network_banner",
};

describe("compareVersions", () => {
  test("returns negative for a < b", () => {
    assert.ok(compareVersions("1.0.0", "1.0.1") < 0);
    assert.ok(compareVersions("1.0.0", "2.0.0") < 0);
    assert.ok(compareVersions("1.9.9", "1.10.0") < 0);
  });
  test("returns zero for equal", () => {
    assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
    assert.equal(compareVersions("1.0", "1.0.0"), 0);
  });
  test("returns positive for a > b", () => {
    assert.ok(compareVersions("2.0.0", "1.0.0") > 0);
    assert.ok(compareVersions("1.10.0", "1.9.9") > 0);
  });
  test("treats missing components as zero", () => {
    assert.equal(compareVersions("1", "1.0.0"), 0);
    assert.equal(compareVersions("1.0", "1.0.0"), 0);
  });
});

describe("evaluateMigrations — empty / no-op cases", () => {
  test("empty migrations list returns []", () => {
    const result = evaluateMigrations({
      previousVersion: "1.0.0",
      currentVersion: "2.0.0",
      responses: {},
      prefs: {},
      migrations: [],
    });
    assert.deepEqual(result, []);
  });

  test("default MIGRATIONS list (which ships empty) returns []", () => {
    const result = evaluateMigrations({
      previousVersion: "1.0.0",
      currentVersion: "2.0.0",
      responses: {},
      prefs: {},
    });
    assert.deepEqual(result, []);
  });

  test("missing previousVersion returns []", () => {
    const result = evaluateMigrations({
      previousVersion: "",
      currentVersion: "2.0.0",
      responses: {},
      prefs: {},
      migrations: [FIXTURE],
    });
    assert.deepEqual(result, []);
  });

  test("missing currentVersion returns []", () => {
    const result = evaluateMigrations({
      previousVersion: "1.0.0",
      currentVersion: "",
      responses: {},
      prefs: {},
      migrations: [FIXTURE],
    });
    assert.deepEqual(result, []);
  });
});

describe("evaluateMigrations — upgrade window", () => {
  test("user crossing the migration window sees it", () => {
    const result = evaluateMigrations({
      previousVersion: "1.0.0",
      currentVersion: "2.0.0",
      responses: {},
      prefs: { fixturePref: false },
      migrations: [FIXTURE],
    });
    assert.deepEqual(result, [FIXTURE]);
  });

  test("user already past the migration window does not see it", () => {
    const result = evaluateMigrations({
      previousVersion: "2.0.1",
      currentVersion: "2.1.0",
      responses: {},
      prefs: { fixturePref: false },
      migrations: [FIXTURE],
    });
    assert.deepEqual(result, []);
  });

  test("user not yet at toVersion does not see it", () => {
    const result = evaluateMigrations({
      previousVersion: "1.0.0",
      currentVersion: "1.9.0",
      responses: {},
      prefs: { fixturePref: false },
      migrations: [FIXTURE],
    });
    assert.deepEqual(result, []);
  });

  test("fresh install (previousVersion < fromVersion) does see it", () => {
    // First install at v2.0.0 of an extension whose migration spec has
    // fromVersion 1.0.0 — the user IS upgrading across the window.
    const result = evaluateMigrations({
      previousVersion: "0.9.0",
      currentVersion: "2.0.0",
      responses: {},
      prefs: { fixturePref: false },
      migrations: [FIXTURE],
    });
    assert.deepEqual(result, [FIXTURE]);
  });
});

describe("evaluateMigrations — response gating", () => {
  test("accepted migration is not re-presented", () => {
    const result = evaluateMigrations({
      previousVersion: "1.0.0",
      currentVersion: "2.0.0",
      responses: { "fixture-pref-flip": "accept" },
      prefs: { fixturePref: false },
      migrations: [FIXTURE],
    });
    assert.deepEqual(result, []);
  });

  test("declined migration is not re-presented", () => {
    const result = evaluateMigrations({
      previousVersion: "1.0.0",
      currentVersion: "2.0.0",
      responses: { "fixture-pref-flip": "decline" },
      prefs: { fixturePref: false },
      migrations: [FIXTURE],
    });
    assert.deepEqual(result, []);
  });

  test("dismissed migration is not re-presented (dismiss is terminal, like decline — #736)", () => {
    // INTENTIONAL per #736: a recorded "dismiss" is terminal for the migration,
    // identical to "decline" at the evaluator level. Cross-version re-prompting
    // is governed by the version-window gate, not the response value. A true
    // transient "not now" would require NOT persisting dismiss (a UX follow-up).
    const result = evaluateMigrations({
      previousVersion: "1.0.0",
      currentVersion: "2.0.0",
      responses: { "fixture-pref-flip": "dismiss" },
      prefs: { fixturePref: false },
      migrations: [FIXTURE],
    });
    assert.deepEqual(result, []);
  });

  test("any recorded response (accept/decline/dismiss) is terminal for the migration (#736)", () => {
    for (const response of ["accept", "decline", "dismiss"]) {
      const result = evaluateMigrations({
        previousVersion: "1.0.0",
        currentVersion: "2.0.0",
        responses: { "fixture-pref-flip": response },
        prefs: { fixturePref: false },
        migrations: [FIXTURE],
      });
      assert.deepEqual(result, [], `response="${response}" must suppress the banner`);
    }
  });
});

describe("evaluateMigrations — pref state already matches", () => {
  test("user with pref already set to proposedValue does not see banner", () => {
    const result = evaluateMigrations({
      previousVersion: "1.0.0",
      currentVersion: "2.0.0",
      responses: {},
      prefs: { fixturePref: true }, // already matches proposedValue
      migrations: [FIXTURE],
    });
    assert.deepEqual(result, []);
  });

  test("user with one of two prefs not matching still sees banner", () => {
    const multi = {
      id: "multi",
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      prefs: ["a", "b"],
      proposedValue: { a: true, b: true },
      networkRelated: false,
      bannerCopyKey: "",
    };
    const result = evaluateMigrations({
      previousVersion: "1.0.0",
      currentVersion: "2.0.0",
      responses: {},
      prefs: { a: true, b: false },
      migrations: [multi],
    });
    assert.deepEqual(result, [multi]);
  });
});

describe("evaluateMigrations — multiple stacked migrations", () => {
  test("returns all unresolved migrations in declared order", () => {
    const result = evaluateMigrations({
      previousVersion: "1.0.0",
      currentVersion: "3.0.0",
      responses: {},
      prefs: { fixturePref: false, fixtureNetworkPref: false },
      migrations: [FIXTURE, FIXTURE_NETWORK],
    });
    assert.deepEqual(result, [FIXTURE, FIXTURE_NETWORK]);
  });

  test("returns only the unresolved subset when one was already accepted", () => {
    const result = evaluateMigrations({
      previousVersion: "1.0.0",
      currentVersion: "3.0.0",
      responses: { "fixture-pref-flip": "accept" },
      prefs: { fixturePref: true, fixtureNetworkPref: false },
      migrations: [FIXTURE, FIXTURE_NETWORK],
    });
    assert.deepEqual(result, [FIXTURE_NETWORK]);
  });
});
