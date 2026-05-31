/**
 * MUGA: pure break-evaluation for ONE preserve-style affiliate canary.
 *
 * Extracted from the inline loop in canary-runner.mjs (#777, EPIC C) to enable
 * independent unit-testing and sharing between the runner and GATE 3 (#777).
 * Behavior is identical to the original inline logic: param-level, collect-all
 * (no short-circuit), throw→single failure.
 */

/**
 * @typedef {{ name: string, kind: "preserve", reason: string }} CanaryFailure
 */

/**
 * Evaluates a single preserve-style canary against a given processUrlFn.
 *
 * Merges `canary.prefs.remoteParams` (if any) with `extraRemoteParams` so the
 * cleaner considers the candidate param as a remote-injected tracking param.
 * Collects ALL param-level failures (no short-circuit) — a canary with 2 broken
 * mustSurvive entries yields 2 CanaryFailure entries.
 *
 * @param {{ name: string, url: string, prefs?: object, mustSurvive: Record<string,string>, mustStrip: string[] }} canary
 * @param {(url: string, prefs: object) => { cleanUrl: string }} processUrlFn
 * @param {string[]} extraRemoteParams — additional params to inject via remoteParams (defaults to [])
 * @returns {CanaryFailure[]} empty array means the canary held; non-empty means it broke
 */
export function evaluateCanary(canary, processUrlFn, extraRemoteParams = []) {
  const failures = [];
  // WHY: merge canary's own remoteParams (if any) with the extra ones supplied by
  // the caller (e.g. GATE 3 passes [candidate.param] here).
  const remoteParams = [...(canary.prefs?.remoteParams ?? []), ...extraRemoteParams];
  let params;
  try {
    params = new URL(processUrlFn(canary.url, { ...canary.prefs, remoteParams }).cleanUrl).searchParams;
  } catch (err) {
    // WHY: a throwing cleaner must not crash the gate/runner — record it and
    // return early so the caller sees a concrete failure rather than an exception.
    return [{ name: canary.name, kind: "preserve", reason: `processUrl threw: ${err.message}` }];
  }
  for (const [param, value] of Object.entries(canary.mustSurvive)) {
    const got = params.get(param);
    if (got !== value) {
      failures.push({ name: canary.name, kind: "preserve", reason: `${param} expected "${value}", got "${got}"` });
    }
  }
  for (const param of canary.mustStrip) {
    if (params.has(param)) {
      failures.push({ name: canary.name, kind: "preserve", reason: `${param} should have been stripped` });
    }
  }
  return failures;
}
