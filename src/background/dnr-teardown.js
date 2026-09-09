/**
 * MUGA — the consent gate closes, and we check that it did (#1257 item 5)
 *
 * `applyDnrState`'s gate-closed branch calls eight teardown steps. Each one
 * catches its own error, logs it and returns. Nothing looked at the results and
 * nothing retried, so if one threw while consent was being withdrawn, that ID
 * range's rules stayed registered and kept acting at the network layer for a
 * user who had just disabled the extension. The function's own comments say
 * this must never happen.
 *
 * ── Why this verifies state instead of collecting return values ─────────────
 *
 * The obvious fix is to have each `sync*DNR` report success or failure and to
 * check the eight answers. That is weaker than it looks: it asks each step
 * whether it BELIEVES it succeeded, and the failure mode here is a step that
 * returns normally while the rules survive -- a partial `updateDynamicRules`,
 * a range the step does not know it owns, a rule registered by a path that was
 * added later and never wired into that step's idea of its own scope.
 *
 * So this reads back what is actually registered and asks a different question:
 * is anything of MUGA's still there? That answer does not depend on any step's
 * self-report, and it keeps working when a new rule family is added to
 * `dnr-ids.js` and someone forgets to extend the teardown -- which is precisely
 * the shape of mistake a consent gate cannot afford.
 */

/**
 * Every dynamic rule ID range MUGA registers, as [start, end] inclusive pairs.
 *
 * Derived from the caller's `dnr-ids.js` constants rather than hardcoded here,
 * so a new family added there flows in without editing this file.
 *
 * @param {object} ids the module namespace of lib/dnr-ids.js
 * @returns {Array<[number, number]>}
 */
export function ownedDynamicRanges(ids) {
  return [
    [ids.DNR_CUSTOM_PARAMS_RULE_ID, ids.DNR_CUSTOM_PARAMS_RULE_ID],
    [ids.DNR_REMOTE_PARAMS_RULE_ID, ids.DNR_REMOTE_PARAMS_RULE_ID],
    [ids.DNR_ALLOWLIST_RULE_ID_BASE, ids.DNR_ALLOWLIST_RULE_ID_BASE + ids.DNR_ALLOWLIST_MAX_RULES - 1],
    [ids.DNR_SUPPRESS_REFERER_RULE_ID, ids.DNR_SUPPRESS_REFERER_RULE_ID],
    [ids.DNR_BLOCK_BEACONS_RULE_ID, ids.DNR_BLOCK_BEACONS_RULE_ID],
    [ids.DNR_BLOCKLIST_REFERER_RULE_ID_BASE, ids.DNR_BLOCKLIST_REFERER_RULE_ID_BASE + ids.DNR_BLOCKLIST_MAX_RULES - 1],
    [ids.DNR_BLOCKLIST_BEACON_RULE_ID_BASE, ids.DNR_BLOCKLIST_BEACON_RULE_ID_BASE + ids.DNR_BLOCKLIST_MAX_RULES - 1],
    [ids.DNR_SCOPED_PARAMS_RULE_ID_BASE, ids.DNR_SCOPED_PARAMS_RULE_ID_BASE + ids.DNR_SCOPED_PARAMS_MAX_RULES - 1],
    [ids.DNR_CATEGORY_FILTER_RULE_ID_BASE, ids.DNR_CATEGORY_FILTER_RULE_ID_BASE + ids.DNR_CATEGORY_FILTER_MAX_RULES - 1],
  ];
}

/**
 * The MUGA-owned rule IDs still registered.
 *
 * Deliberately reports IDs outside every known range too, under `unowned`. A
 * rule MUGA registered from a family nobody remembered to add to
 * `ownedDynamicRanges` is the most dangerous kind for a consent gate, because
 * it is invisible to the teardown that was supposed to remove it.
 *
 * @param {number[]} liveIds IDs currently registered as dynamic rules
 * @param {Array<[number, number]>} ranges
 * @returns {{owned: number[], unowned: number[]}}
 */
export function residualRules(liveIds, ranges) {
  const owned = [];
  const unowned = [];
  for (const id of liveIds ?? []) {
    if (ranges.some(([lo, hi]) => id >= lo && id <= hi)) owned.push(id);
    else unowned.push(id);
  }
  return { owned, unowned };
}

/**
 * Runs the teardown steps, then verifies nothing MUGA-owned survived.
 *
 * A step that throws does not stop the others: on a consent withdrawal the goal
 * is to remove as much as possible, and abandoning the remaining seven because
 * the second failed leaves strictly more registered.
 *
 * One retry, not a loop. If a second full pass still leaves rules registered,
 * the problem is not transient and retrying forever would spin on every wake.
 *
 * @param {object} spec
 * @param {Record<string, () => Promise<unknown>>} spec.steps named teardown steps
 * @param {() => Promise<number[]>} spec.readLiveRuleIds reads back what remains
 * @param {Array<[number, number]>} spec.ranges from ownedDynamicRanges()
 * @param {(msg: string, detail?: unknown) => void} [spec.report]
 * @returns {Promise<{ok: boolean, failedSteps: string[], residual: number[], attempts: number}>}
 */
export async function tearDownAndVerify({ steps, readLiveRuleIds, ranges, report = console.error }) {
  const entries = Object.entries(steps);
  let failedSteps = [];
  let residual = [];
  let attempts = 0;

  for (attempts = 1; attempts <= 2; attempts++) {
    failedSteps = [];

    for (const [name, run] of entries) {
      try {
        await run();
      } catch (err) {
        // Collected, not thrown: the remaining steps still have work to do.
        failedSteps.push(name);
        report(`[MUGA] DNR teardown step "${name}" failed`, err);
      }
    }

    let liveIds;
    try {
      liveIds = await readLiveRuleIds();
    } catch (err) {
      // Unverifiable is not the same as clean, and must not be reported as it.
      report("[MUGA] DNR teardown could not read back the live rules", err);
      return { ok: false, failedSteps, residual: [], attempts };
    }

    const { owned, unowned } = residualRules(liveIds, ranges);
    residual = [...owned, ...unowned];

    if (residual.length === 0) {
      return { ok: true, failedSteps, residual: [], attempts };
    }

    if (attempts === 1) {
      report(
        "[MUGA] DNR teardown left rules registered; retrying once",
        { residual, failedSteps }
      );
    }
  }

  report(
    "[MUGA] DNR teardown FAILED: rules are still registered for a disabled or " +
      "non-consented extension. They will keep acting at the network layer.",
    { residual, failedSteps }
  );
  return { ok: false, failedSteps, residual, attempts: 2 };
}
