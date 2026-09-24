/**
 * MUGA — Activity ledger scope-filtering view-model (#1352).
 *
 * Pure logic deciding which of the two Activity ledger sub-panels
 * ("This session" / "Recent activity") is visible for a given scope value.
 * Extracted as its own module (rather than inlined in options.js) for the
 * same reason every other Activity-panel branch got one: options.js is
 * browser-only and cannot be exercised under node:test.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_SCOPES,
  DEFAULT_ACTIVITY_SCOPE,
  isValidActivityScope,
  planActivityScopeView,
} from "../../src/lib/activity-scope-view.js";

describe("ACTIVITY_SCOPES / DEFAULT_ACTIVITY_SCOPE", () => {
  test("exposes exactly two scopes: session and recent", () => {
    assert.deepStrictEqual(Object.values(ACTIVITY_SCOPES).sort(), ["recent", "session"]);
  });

  test("default scope is session", () => {
    assert.strictEqual(DEFAULT_ACTIVITY_SCOPE, ACTIVITY_SCOPES.SESSION);
  });
});

describe("isValidActivityScope", () => {
  test("accepts both known scopes", () => {
    assert.strictEqual(isValidActivityScope(ACTIVITY_SCOPES.SESSION), true);
    assert.strictEqual(isValidActivityScope(ACTIVITY_SCOPES.RECENT), true);
  });

  test("rejects anything else", () => {
    for (const bad of [undefined, null, "", "SESSION", "everything", 0, {}]) {
      assert.strictEqual(isValidActivityScope(bad), false, `expected ${JSON.stringify(bad)} to be invalid`);
    }
  });
});

describe("planActivityScopeView", () => {
  test("session scope hides the recent panel, shows the session panel", () => {
    assert.deepStrictEqual(planActivityScopeView(ACTIVITY_SCOPES.SESSION), {
      scope: ACTIVITY_SCOPES.SESSION,
      sessionPanelHidden: false,
      recentPanelHidden: true,
    });
  });

  test("recent scope hides the session panel, shows the recent panel", () => {
    assert.deepStrictEqual(planActivityScopeView(ACTIVITY_SCOPES.RECENT), {
      scope: ACTIVITY_SCOPES.RECENT,
      sessionPanelHidden: true,
      recentPanelHidden: false,
    });
  });

  test("an invalid/missing scope falls back to the default rather than hiding both panels", () => {
    for (const bad of [undefined, null, "bogus"]) {
      const result = planActivityScopeView(bad);
      assert.strictEqual(result.scope, DEFAULT_ACTIVITY_SCOPE);
      assert.strictEqual(result.sessionPanelHidden, false);
      assert.strictEqual(result.recentPanelHidden, true);
    }
  });

  test("exactly one panel is ever visible", () => {
    for (const scope of Object.values(ACTIVITY_SCOPES)) {
      const { sessionPanelHidden, recentPanelHidden } = planActivityScopeView(scope);
      assert.notStrictEqual(sessionPanelHidden, recentPanelHidden);
    }
  });
});
