/**
 * MUGA — the 16 params #1228 removed from the global strip list stay stripped
 * at the network layer (commit 13f1250)
 *
 * #1228 removed 16 params from TRACKING_PARAMS because each one is already
 * covered per-host in domain-rules.json's `stripParams`. That premise only
 * became true for every host once 13f1250 deleted the `AMAZON_HOST_RE` gate
 * in tools/generate-rules.mjs — before that, a non-Amazon host's `stripParams`
 * entries never reached the generated DNR ruleset, so dropping the global
 * entry would have silently downgraded the param from pre-request DNR
 * stripping to post-load `history.replaceState` (see that gate-removal
 * comment for the full reasoning).
 *
 * This test pins the invariant the gate removal exists to guarantee: for
 * each of the 16 removed params —
 *   (1) it is absent from TRACKING_PARAMS (it must stay removed, not creep
 *       back in), and
 *   (2) for every host it is anchored to, that host's DNR profile rule (in
 *       the generated src/rules/tracking-params.json) both lists the param
 *       in removeParams AND does not exclude that host via
 *       excludedRequestDomains.
 *
 * If either check fails, the param would stop being stripped before the
 * request leaves the browser — reintroducing exactly the class of defect
 * #1228 fixed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TRACKING_PARAMS } from "../../src/lib/affiliates.js";
import {
  DNR_DOMAIN_PRESERVE_RULE_ID_BASE,
  DNR_DOMAIN_PRESERVE_MAX_RULES,
} from "../../src/lib/dnr-ids.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const RULES_PATH = join(ROOT, "src", "rules", "tracking-params.json");

const RULES = JSON.parse(readFileSync(RULES_PATH, "utf8"));
const PROFILE_RULES = RULES.filter(
  (r) =>
    r.id >= DNR_DOMAIN_PRESERVE_RULE_ID_BASE &&
    r.id < DNR_DOMAIN_PRESERVE_RULE_ID_BASE + DNR_DOMAIN_PRESERVE_MAX_RULES,
);
const trackingLc = new Set(TRACKING_PARAMS.map((p) => p.toLowerCase()));

const removeOf = (rule) =>
  rule.action?.redirect?.transform?.queryTransform?.removeParams ?? [];

// All 16 amazon.* marketplace hosts that share the extra-strips profile for
// the Amazon-anchored params below.
const AMAZON_HOSTS = [
  "amazon.ca", "amazon.co.jp", "amazon.co.uk", "amazon.com",
  "amazon.com.au", "amazon.com.br", "amazon.com.mx", "amazon.de",
  "amazon.es", "amazon.fr", "amazon.in", "amazon.it", "amazon.nl",
  "amazon.pl", "amazon.se", "amazon.sg",
];

/**
 * The 16 params #1228 removed from TRACKING_PARAMS, each mapped to every
 * host its coverage is anchored to. Sourced from src/rules/domain-rules.json
 * `stripParams` (the same source generate-rules.mjs reads).
 */
const PARAM_ANCHORED_HOSTS = {
  _r: ["tiktok.com"],
  _t: ["tiktok.com"],
  dchild: AMAZON_HOSTS,
  dib: AMAZON_HOSTS,
  dib_tag: AMAZON_HOSTS,
  igsh: ["instagram.com"],
  is_from_webapp: ["tiktok.com"],
  mibextid: ["facebook.com", "fb.com"],
  napm: ["11st.co.kr", "naver.com", "shopping.naver.com"],
  pd_rd_i: AMAZON_HOSTS,
  pd_rd_r: AMAZON_HOSTS,
  pd_rd_w: AMAZON_HOSTS,
  pd_rd_wg: AMAZON_HOSTS,
  qid: AMAZON_HOSTS,
  sender_device: ["tiktok.com"],
  smid: [...AMAZON_HOSTS, "nytimes.com"],
};

describe("#1228 — removed global params stay stripped at the network layer", () => {
  for (const [param, hosts] of Object.entries(PARAM_ANCHORED_HOSTS)) {
    describe(param, () => {
      test(`"${param}" is absent from TRACKING_PARAMS`, () => {
        assert.ok(
          !trackingLc.has(param.toLowerCase()),
          `"${param}" is back in TRACKING_PARAMS — it was removed by #1228 because its ` +
            "coverage is host-anchored; either it belongs in the global list again (revert " +
            "the removal) or it must come back out.",
        );
      });

      for (const host of hosts) {
        test(`"${param}" is stripped by a DNR profile rule scoped to "${host}"`, () => {
          const rule = PROFILE_RULES.find((r) =>
            (r.condition?.requestDomains ?? []).includes(host),
          );
          assert.ok(
            rule,
            `no DNR profile rule covers "${host}" — "${param}" would stop being stripped ` +
              "before the request leaves the browser. Run `npm run build:rules`.",
          );

          const excluded = new Set(rule.condition?.excludedRequestDomains ?? []);
          assert.ok(
            !excluded.has(host),
            `the DNR profile rule covering "${param}" on "${host}" (id ${rule.id}) excludes ` +
              `"${host}" from itself — "${param}" would stop being stripped before the ` +
              "request leaves the browser.",
          );

          const removeParamsLc = new Set(removeOf(rule).map((p) => p.toLowerCase()));
          assert.ok(
            removeParamsLc.has(param.toLowerCase()),
            `"${param}" is not in the removeParams of the DNR profile rule covering "${host}" ` +
              `(id ${rule.id}) — "${param}" would stop being stripped before the request ` +
              "leaves the browser. Run `npm run build:rules`.",
          );
        });
      }
    });
  }
});
