/**
 * MUGA — Programmatic affiliate-canary runner (#771 / epic #785).
 *
 * Runs every affiliate-survival canary against the LIVE cleaner and returns a
 * structured verdict — no test harness required. This is what the rule-ingestion
 * pipeline's GATE 3 (#777) calls: after a candidate strip rule is applied, it
 * runs this and rejects the candidate if any affiliate canary broke.
 *
 * Relocated from tests/fixtures/canary-runner.mjs to
 * tools/affiliate-safety/runner.mjs (#777, EPIC C). The PRESERVE loop now
 * delegates to evaluateCanary (shared with GATE 3) — behavior-preserving:
 * evaluateCanary with extraRemoteParams=[] reconstructs the same semantics as
 * the original inline loop (param-level, collect-all, throw→single failure).
 *
 * Pure: imports only the cleaner + the domain modules. Safe to call from CLI,
 * tests, or the pipeline.
 */

import { processUrl, getLandingPolicy } from "../../src/lib/cleaner.js";
import { PRESERVE_CANARIES, LANDING_CANARIES } from "./canaries.mjs";
import { evaluateCanary } from "./evaluate.mjs";

/**
 * @typedef {{ name: string, kind: "preserve"|"landing", reason: string }} CanaryFailure
 *
 * @returns {{ ok: boolean, total: number, failures: CanaryFailure[] }}
 *   `ok` is true iff every canary held. `failures` names each broken canary and
 *   exactly why (which param, expected vs actual) so the caller can report it.
 */
export function runAffiliateCanaries() {
  const failures = [];

  // WHY: evaluateCanary with no extraRemoteParams is behavior-identical to the
  // original inline loop (canary-runner.mjs:26-45) — param-level, collect-all.
  for (const c of PRESERVE_CANARIES) failures.push(...evaluateCanary(c, processUrl));

  // LANDING loop unchanged — getLandingPolicy has a different shape and is NOT
  // part of GATE 3's scope.
  for (const c of LANDING_CANARIES) {
    const policy = getLandingPolicy(c.landingHost, c.referrer);
    for (const param of c.mustPreserve) {
      if (!policy.preserve.has(param)) {
        failures.push({ name: c.name, kind: "landing", reason: `${param} not preserved (network ${c.network})` });
      }
    }
  }

  return {
    ok: failures.length === 0,
    total: PRESERVE_CANARIES.length + LANDING_CANARIES.length,
    failures,
  };
}
