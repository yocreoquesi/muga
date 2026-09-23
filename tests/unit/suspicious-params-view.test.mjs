/**
 * MUGA — Unit tests for planSuspiciousParamsSettingsView
 * (src/lib/suspicious-params-view.js) (#1351)
 *
 * Run with: npm test
 *
 * Pure view-model for the FREQUENCY subgroup of the popup's old
 * "Suspicious params" section, now rendered inside Settings' Activity
 * section (ADR-0011 Decision 3, 2026-09-24 maintainer decision on #1351:
 * the ENTROPY subgroup stays read-only in the popup; the FREQUENCY subgroup
 * and every action that writes userCustomRules move here). Extracted so the
 * row-shaping / promoted / already-reported branching is unit-testable
 * without a DOM or a chrome.storage stub — options.js is browser-only and
 * can't be exercised under node:test, mirroring the precedent set by
 * domain-stats-view.js / remote-rules-changelog-view.js /
 * attribution-ledger-view.js.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { planSuspiciousParamsSettingsView } from "../../src/lib/suspicious-params-view.js";

describe("planSuspiciousParamsSettingsView — pure view-model for the #1351 Activity frequency panel", () => {
  test("no flags -> empty view, no rows", () => {
    const view = planSuspiciousParamsSettingsView({ frequencyFlags: [] });
    assert.strictEqual(view.empty, true);
    assert.deepStrictEqual(view.rows, []);
  });

  test("missing/null/undefined input -> empty view, never throws", () => {
    assert.deepStrictEqual(planSuspiciousParamsSettingsView(), { empty: true, rows: [] });
    assert.deepStrictEqual(planSuspiciousParamsSettingsView(null), { empty: true, rows: [] });
    assert.deepStrictEqual(planSuspiciousParamsSettingsView({ frequencyFlags: null }), { empty: true, rows: [] });
  });

  test("shapes each row with domains/values carried through", () => {
    const view = planSuspiciousParamsSettingsView({
      frequencyFlags: [{ param: "uid", domains: 5, values: 8 }],
    });
    assert.strictEqual(view.empty, false);
    assert.strictEqual(view.rows.length, 1);
    assert.strictEqual(view.rows[0].param, "uid");
    assert.strictEqual(view.rows[0].domains, 5);
    assert.strictEqual(view.rows[0].values, 8);
  });

  test("defaults domains/values to 0 when malformed", () => {
    const view = planSuspiciousParamsSettingsView({
      frequencyFlags: [{ param: "uid", domains: "five", values: undefined }],
    });
    assert.strictEqual(view.rows[0].domains, 0);
    assert.strictEqual(view.rows[0].values, 0);
  });

  test("marks a row isPromoted when the param is already in userCustomRules (case-insensitive)", () => {
    const view = planSuspiciousParamsSettingsView({
      frequencyFlags: [{ param: "UID", domains: 3, values: 3 }],
      userCustomRules: ["uid"],
    });
    assert.strictEqual(view.rows[0].isPromoted, true);
  });

  test("marks a row NOT isPromoted when the param is absent from userCustomRules", () => {
    const view = planSuspiciousParamsSettingsView({
      frequencyFlags: [{ param: "uid", domains: 3, values: 3 }],
      userCustomRules: ["other_param"],
    });
    assert.strictEqual(view.rows[0].isPromoted, false);
  });

  test("tolerates a missing/malformed userCustomRules list", () => {
    const view = planSuspiciousParamsSettingsView({
      frequencyFlags: [{ param: "uid", domains: 3, values: 3 }],
      userCustomRules: null,
    });
    assert.strictEqual(view.rows[0].isPromoted, false);
  });

  test("carries the reportedDate through when submittedParams has an entry for the param", () => {
    const view = planSuspiciousParamsSettingsView({
      frequencyFlags: [{ param: "uid", domains: 3, values: 3 }],
      submittedParams: { uid: "2026-09-01" },
    });
    assert.strictEqual(view.rows[0].reportedDate, "2026-09-01");
  });

  test("reportedDate is null when submittedParams has no entry for the param", () => {
    const view = planSuspiciousParamsSettingsView({
      frequencyFlags: [{ param: "uid", domains: 3, values: 3 }],
      submittedParams: { other_param: "2026-09-01" },
    });
    assert.strictEqual(view.rows[0].reportedDate, null);
  });

  test("tolerates a missing/malformed submittedParams map", () => {
    const view = planSuspiciousParamsSettingsView({
      frequencyFlags: [{ param: "uid", domains: 3, values: 3 }],
      submittedParams: null,
    });
    assert.strictEqual(view.rows[0].reportedDate, null);
  });

  test("filters out malformed flag entries (non-object or missing param)", () => {
    const view = planSuspiciousParamsSettingsView({
      frequencyFlags: [null, "not-an-object", { domains: 1, values: 1 }, { param: "ok", domains: 1, values: 1 }],
    });
    assert.strictEqual(view.rows.length, 1);
    assert.strictEqual(view.rows[0].param, "ok");
  });
});
