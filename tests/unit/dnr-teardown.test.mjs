/**
 * MUGA — the consent gate verifies that it actually closed (#1257 item 5)
 *
 * `applyDnrState`'s gate-closed branch calls eight teardown steps. Each caught
 * its own error, logged it and returned; nothing looked at the results and
 * nothing retried. So if one threw while consent was being withdrawn, that ID
 * range's rules stayed registered and kept acting at the network layer for a
 * user who had just disabled the extension — which the function's own comments
 * say must never happen.
 *
 * ── Why this verifies state rather than collecting return values ───────────
 *
 * The obvious fix is to have each step report success and to check the eight
 * answers. That is weaker than it looks: it asks each step whether it BELIEVES
 * it succeeded, and the failure that matters is a step returning normally while
 * its rules survive — a partial update, or a range the step does not know it
 * owns. Reading back what is registered answers a question that does not depend
 * on any step's self-report, and the `unowned` case below is the one a
 * return-value check could never see at all.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  tearDownAndVerify,
  residualRules,
  ownedDynamicRanges,
} from "../../src/background/dnr-teardown.js";
import * as DNR_IDS from "../../src/lib/dnr-ids.js";

const RANGES = ownedDynamicRanges(DNR_IDS);
const silent = () => {};

/** A teardown over an in-memory set of registered rule IDs. */
function makeWorld(initialIds = []) {
  const live = new Set(initialIds);
  return {
    live,
    clear: (ids) => async () => { for (const id of ids) live.delete(id); },
    fail: (message) => async () => { throw new Error(message); },
    read: async () => [...live],
  };
}

// ── The range map ────────────────────────────────────────────────────────────

describe("ownedDynamicRanges", () => {
  test("covers every dynamic family dnr-ids.js declares", () => {
    const singles = [
      DNR_IDS.DNR_CUSTOM_PARAMS_RULE_ID,
      DNR_IDS.DNR_REMOTE_PARAMS_RULE_ID,
      DNR_IDS.DNR_SUPPRESS_REFERER_RULE_ID,
      DNR_IDS.DNR_BLOCK_BEACONS_RULE_ID,
    ];
    const bases = [
      DNR_IDS.DNR_ALLOWLIST_RULE_ID_BASE,
      DNR_IDS.DNR_BLOCKLIST_REFERER_RULE_ID_BASE,
      DNR_IDS.DNR_BLOCKLIST_BEACON_RULE_ID_BASE,
      DNR_IDS.DNR_SCOPED_PARAMS_RULE_ID_BASE,
      DNR_IDS.DNR_CATEGORY_FILTER_RULE_ID_BASE,
    ];
    for (const id of [...singles, ...bases]) {
      assert.strictEqual(
        residualRules([id], RANGES).owned.length, 1,
        `id ${id} must be recognised as MUGA-owned, or the gate cannot verify it was removed`
      );
    }
  });

  test("the last id of a range is inside it, not one past the end", () => {
    const lastAllowlist =
      DNR_IDS.DNR_ALLOWLIST_RULE_ID_BASE + DNR_IDS.DNR_ALLOWLIST_MAX_RULES - 1;
    assert.deepStrictEqual(residualRules([lastAllowlist], RANGES).owned, [lastAllowlist]);
  });
});

describe("residualRules", () => {
  test("reports nothing when nothing is registered", () => {
    assert.deepStrictEqual(residualRules([], RANGES), { owned: [], unowned: [] });
  });

  test("separates MUGA-owned ids from ones no range claims", () => {
    // A rule MUGA registered from a family nobody added to the range map is the
    // most dangerous kind for a consent gate: it is invisible to the teardown
    // that was meant to remove it. It must still be reported.
    const { owned, unowned } = residualRules(
      [DNR_IDS.DNR_CUSTOM_PARAMS_RULE_ID, 99999],
      RANGES
    );
    assert.deepStrictEqual(owned, [DNR_IDS.DNR_CUSTOM_PARAMS_RULE_ID]);
    assert.deepStrictEqual(unowned, [99999]);
  });

  test("tolerates a missing list rather than throwing inside the gate", () => {
    assert.deepStrictEqual(residualRules(undefined, RANGES), { owned: [], unowned: [] });
  });
});

// ── The teardown ─────────────────────────────────────────────────────────────

describe("tearDownAndVerify — the happy path", () => {
  test("reports ok when every step runs and nothing survives", async () => {
    const w = makeWorld([DNR_IDS.DNR_CUSTOM_PARAMS_RULE_ID, DNR_IDS.DNR_REMOTE_PARAMS_RULE_ID]);
    const result = await tearDownAndVerify({
      ranges: RANGES,
      readLiveRuleIds: w.read,
      report: silent,
      steps: {
        custom: w.clear([DNR_IDS.DNR_CUSTOM_PARAMS_RULE_ID]),
        remote: w.clear([DNR_IDS.DNR_REMOTE_PARAMS_RULE_ID]),
      },
    });

    assert.deepStrictEqual(result, { ok: true, failedSteps: [], residual: [], attempts: 1 });
  });
});

describe("tearDownAndVerify — a failing step (#1257 item 5)", () => {
  test("one throwing step does not stop the others", async () => {
    // On a consent withdrawal the goal is to remove as much as possible.
    // Abandoning the remaining steps because the second threw leaves strictly
    // more registered than continuing does.
    const w = makeWorld([DNR_IDS.DNR_CUSTOM_PARAMS_RULE_ID, DNR_IDS.DNR_SUPPRESS_REFERER_RULE_ID]);
    await tearDownAndVerify({
      ranges: RANGES,
      readLiveRuleIds: w.read,
      report: silent,
      steps: {
        first: w.clear([DNR_IDS.DNR_CUSTOM_PARAMS_RULE_ID]),
        boom: w.fail("declarativeNetRequest unavailable"),
        third: w.clear([DNR_IDS.DNR_SUPPRESS_REFERER_RULE_ID]),
      },
    });

    assert.strictEqual(w.live.size, 0, "the step after the failure must still have run");
  });

  test("rules left registered are reported, and the gate does NOT claim success", async () => {
    // The defect, stated as a test: a step fails, its range survives, and the
    // old code proceeded as though the gate had closed.
    const orphan = DNR_IDS.DNR_BLOCK_BEACONS_RULE_ID;
    const w = makeWorld([orphan]);

    const result = await tearDownAndVerify({
      ranges: RANGES,
      readLiveRuleIds: w.read,
      report: silent,
      steps: { beacons: w.fail("network layer refused") },
    });

    assert.strictEqual(result.ok, false, "a gate that did not close must never report ok");
    assert.deepStrictEqual(result.failedSteps, ["beacons"]);
    assert.deepStrictEqual(result.residual, [orphan]);
  });

  test("a step that succeeds while its rules survive is still caught", async () => {
    // The case a return-value check cannot see, and the reason this verifies
    // state: the step returns normally and the rule is still there.
    const w = makeWorld([DNR_IDS.DNR_SCOPED_PARAMS_RULE_ID_BASE]);
    const result = await tearDownAndVerify({
      ranges: RANGES,
      readLiveRuleIds: w.read,
      report: silent,
      steps: { liar: async () => { /* claims success, removes nothing */ } },
    });

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.failedSteps, [], "no step reported failure, and yet");
    assert.deepStrictEqual(result.residual, [DNR_IDS.DNR_SCOPED_PARAMS_RULE_ID_BASE]);
  });

  test("retries once, and a transient failure then succeeds", async () => {
    const w = makeWorld([DNR_IDS.DNR_CUSTOM_PARAMS_RULE_ID]);
    let calls = 0;
    const result = await tearDownAndVerify({
      ranges: RANGES,
      readLiveRuleIds: w.read,
      report: silent,
      steps: {
        flaky: async () => {
          calls++;
          if (calls === 1) throw new Error("transient");
          w.live.delete(DNR_IDS.DNR_CUSTOM_PARAMS_RULE_ID);
        },
      },
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.attempts, 2, "the second pass is what cleared it");
  });

  test("retries once and no more, so a permanent failure cannot spin", async () => {
    const w = makeWorld([DNR_IDS.DNR_CUSTOM_PARAMS_RULE_ID]);
    let calls = 0;
    const result = await tearDownAndVerify({
      ranges: RANGES,
      readLiveRuleIds: w.read,
      report: silent,
      steps: { stuck: async () => { calls++; throw new Error("permanent"); } },
    });

    assert.strictEqual(calls, 2, "two passes, not a loop — this runs on every wake");
    assert.strictEqual(result.attempts, 2);
    assert.strictEqual(result.ok, false);
  });
});

describe("tearDownAndVerify — unverifiable is not clean", () => {
  test("a failing read-back reports failure rather than assuming success", async () => {
    // "I could not check" and "there is nothing left" must never collapse into
    // the same answer inside a consent gate.
    const result = await tearDownAndVerify({
      ranges: RANGES,
      readLiveRuleIds: async () => { throw new Error("getDynamicRules unavailable"); },
      report: silent,
      steps: { ok: async () => {} },
    });

    assert.strictEqual(result.ok, false);
  });

  test("the failure is reported with what survived", async () => {
    const messages = [];
    const orphan = DNR_IDS.DNR_ALLOWLIST_RULE_ID_BASE;
    const w = makeWorld([orphan]);

    await tearDownAndVerify({
      ranges: RANGES,
      readLiveRuleIds: w.read,
      report: (msg, detail) => messages.push({ msg, detail }),
      steps: { noop: async () => {} },
    });

    const final = messages[messages.length - 1];
    assert.match(final.msg, /FAILED/,
      "a silent failure here is indistinguishable from a gate that closed");
    assert.deepStrictEqual(final.detail.residual, [orphan]);
  });
});
