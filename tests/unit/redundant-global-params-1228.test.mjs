/**
 * MUGA — the 17 params dropped from the global list must stay host-scoped (#1228 step 1)
 *
 * #1228 measured 58 params in TRACKING_PARAMS that AdGuard Filter 17 only ever
 * anchors to specific hosts, never as an unanchored global rule. Of those, 17
 * satisfy a stricter test than the issue's original "also in domain-rules
 * stripParams" column: not just present somewhere in domain-rules.json, but
 * present under EVERY host the upstream anchor names. That is what makes
 * dropping the global entry lossless — a param is a tracker everywhere, but
 * MUGA's claim to clean it was never actually global, only the ENTRY was.
 *
 * This pins the invariant, not just the names. Two ways it can silently
 * break:
 *   - a bulk import re-adds one of the 17 to TRACKING_PARAMS (reintroducing
 *     the over-generalised global claim this step existed to remove), or
 *   - someone deletes the per-host stripParams entry that was the ONLY
 *     reason removing the global entry was safe (silently losing cleaning on
 *     that host, with nothing left to catch it).
 *
 * `ved`, `gs_lcp`, `sca_esv` pass the same upstream-anchor test (google.*) but
 * are deliberately NOT here: domain-rules.json profiles only google.com, so
 * dropping them globally would lose cleaning on google.es/de/co.uk/etc. They
 * are step 3 work, not step 1.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { TRACKING_PARAMS } from "../../src/lib/affiliates-data.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "../..");
const domainRules = JSON.parse(readFileSync(join(ROOT, "src/rules/domain-rules.json"), "utf8"));

// Every amazon.* TLD MUGA profiles today, derived (not hand-typed) so this
// stays correct if a marketplace is added or dropped later.
const amazonDomains = domainRules
  .map((e) => e.domain)
  .filter((d) => /^amazon\./.test(d));

/**
 * The 17 params #1228 step 1 removed from TRACKING_PARAMS, each mapped to the
 * host(s) domain-rules.json must keep carrying it under. This is the data
 * half of the invariant described above — see the PR for the upstream anchor
 * each one maps to.
 */
const DROPPED = {
  _r: ["tiktok.com"],
  _t: ["tiktok.com"],
  is_from_webapp: ["tiktok.com"],
  sender_device: ["tiktok.com"],
  igsh: ["instagram.com"],
  mibextid: ["facebook.com"],
  smid: ["nytimes.com"],
  napm: ["naver.com", "shopping.naver.com"],
  creativeasin: amazonDomains,
  dchild: amazonDomains,
  dib: amazonDomains,
  dib_tag: amazonDomains,
  qid: amazonDomains,
  pd_rd_i: amazonDomains,
  pd_rd_r: amazonDomains,
  pd_rd_w: amazonDomains,
  pd_rd_wg: amazonDomains,
};

describe("#1228 step 1 — the 17 dropped params stay covered per-host, not global", () => {
  test("fixture sanity: domain-rules.json still profiles at least one amazon.* TLD", () => {
    // Guards the amazon-anchored assertions below: if this ever resolved to
    // an empty array, every amazon param's coverage check would vacuously
    // pass a `hosts.every(...)` over zero hosts rather than failing loudly.
    assert.ok(
      amazonDomains.length > 0,
      "no amazon.* entries found in domain-rules.json — fixture is broken, not a real pass",
    );
  });

  test("none of the 17 dropped params are back in the global list", () => {
    const reintroduced = Object.keys(DROPPED).filter((p) => TRACKING_PARAMS.includes(p));
    assert.deepStrictEqual(
      reintroduced,
      [],
      `${reintroduced.join(", ")} ${reintroduced.length === 1 ? "is" : "are"} back in TRACKING_PARAMS. ` +
        "These were removed in #1228 step 1 because AdGuard Filter 17 only ever anchors them to " +
        "specific hosts and MUGA already strips them per-host — a bulk import must not silently " +
        "re-add the over-generalised global claim.",
    );
  });

  test("every dropped param is still stripped on every host its upstream anchor covers", () => {
    for (const [param, hosts] of Object.entries(DROPPED)) {
      for (const host of hosts) {
        const entry = domainRules.find((e) => e.domain === host);
        assert.ok(
          entry,
          `${param}: no domain-rules.json entry for ${host} anymore. ${param} was dropped from the ` +
            `global list ONLY because ${host} was believed to cover it — with the host entry gone, ` +
            `nothing cleans ${param} there anymore.`,
        );
        const strips = (entry.stripParams ?? []).map((p) => p.toLowerCase());
        assert.ok(
          strips.includes(param.toLowerCase()),
          `${param}: ${host}'s stripParams no longer lists it. ${param} left the global list because ` +
            `this per-host entry existed; delete it and MUGA silently stops cleaning ${param} on ` +
            `${host} — either restore the stripParams entry or put ${param} back in TRACKING_PARAMS.`,
        );
      }
    }
  });
});
