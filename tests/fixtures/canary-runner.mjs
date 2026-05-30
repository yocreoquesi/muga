/**
 * MUGA — Programmatic affiliate-canary runner (#771 / epic #785).
 *
 * Runs every affiliate-survival canary against the LIVE cleaner and returns a
 * structured verdict — no test harness required. This is what the rule-ingestion
 * pipeline's GATE 3 (#777) calls: after a candidate strip rule is applied, it
 * runs this and rejects the candidate if any affiliate canary broke.
 *
 * Pure: imports only the cleaner + the fixtures. Safe to call from CLI, tests,
 * or the pipeline.
 */

import { processUrl, getLandingPolicy } from "../../src/lib/cleaner.js";
import { PRESERVE_CANARIES, LANDING_CANARIES } from "./affiliate-canaries.mjs";

/**
 * @typedef {{ name: string, kind: "preserve"|"landing", reason: string }} CanaryFailure
 *
 * @returns {{ ok: boolean, total: number, failures: CanaryFailure[] }}
 *   `ok` is true iff every canary held. `failures` names each broken canary and
 *   exactly why (which param, expected vs actual) so the caller can report it.
 */
export function runAffiliateCanaries() {
  const failures = [];

  for (const c of PRESERVE_CANARIES) {
    let params;
    try {
      params = new URL(processUrl(c.url, c.prefs).cleanUrl).searchParams;
    } catch (err) {
      failures.push({ name: c.name, kind: "preserve", reason: `processUrl threw: ${err.message}` });
      continue;
    }
    for (const [param, value] of Object.entries(c.mustSurvive)) {
      const got = params.get(param);
      if (got !== value) {
        failures.push({ name: c.name, kind: "preserve", reason: `${param} expected "${value}", got "${got}"` });
      }
    }
    for (const param of c.mustStrip) {
      if (params.has(param)) {
        failures.push({ name: c.name, kind: "preserve", reason: `${param} should have been stripped` });
      }
    }
  }

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
