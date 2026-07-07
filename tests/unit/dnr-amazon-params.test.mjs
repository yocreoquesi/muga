/**
 * MUGA — Amazon internal-nav params inside the per-domain-profile DNR rule
 *
 * Chrome cleans the CURRENT page via DNR only (the in-page cleaner is skipped
 * when DNR is present), and Chrome applies AT MOST ONE redirect rule per request.
 * So Amazon internal-nav tags (ref, ref_, pf_rd_*, sr, …) that the cleaner strips
 * via domain-rules — but that are unsafe to strip site-wide — must be folded into
 * the SAME rule that carries the global tracking params for Amazon. That is
 * Amazon's per-domain-profile rule: requestDomains-scoped to Amazon marketplaces,
 * removeParams = all TRACKING_PARAMS (minus Amazon's preserveParams) PLUS the
 * internal-nav strips. Amazon is excluded from the global rule so it matches only
 * this one complete rule.
 *
 * These tests pin:
 *   1. Amazon is excluded from the global rule (never double-matches),
 *   2. Amazon's profile rule strips BOTH the global params and the internal-nav
 *      tags (the fix: one complete rule, not a separate half-rule),
 *   3. the SAFETY invariant: it never strips a creator-attribution or protected
 *      nav/search key, and
 *   4. artifact ↔ generator sync (drift guard).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AFFILIATE_PATTERNS, TRACKING_PARAMS } from "../../src/lib/affiliates.js";
import { AFFILIATE_PARAM_GUARD, REMOTE_PARAM_DENYLIST } from "../../src/lib/remote-rules.js";
import {
  DNR_STATIC_RULE_ID,
  DNR_DOMAIN_PRESERVE_RULE_ID_BASE,
  DNR_DOMAIN_PRESERVE_MAX_RULES,
} from "../../src/lib/dnr-ids.js";
import { buildDnrRules } from "../../tools/generate-rules.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const RULES = JSON.parse(readFileSync(join(ROOT, "src/rules/tracking-params.json"), "utf8"));
const DOMAIN_RULES = JSON.parse(readFileSync(join(ROOT, "src/rules/domain-rules.json"), "utf8"));

const AMAZON_HOST_RE = /(^|\.)amazon\./;
const removeOf = (rule) => rule?.action?.redirect?.transform?.queryTransform?.removeParams ?? [];

const GLOBAL = RULES.find((r) => r.id === DNR_STATIC_RULE_ID);
const PROFILE_RULES = RULES.filter(
  (r) =>
    r.id >= DNR_DOMAIN_PRESERVE_RULE_ID_BASE &&
    r.id < DNR_DOMAIN_PRESERVE_RULE_ID_BASE + DNR_DOMAIN_PRESERVE_MAX_RULES,
);

// Every Amazon marketplace domain the cleaner knows about.
const amazonEntries = DOMAIN_RULES.filter(
  (r) => typeof r.domain === "string" && AMAZON_HOST_RE.test(r.domain),
);
const amazonDomains = [...new Set(amazonEntries.map((r) => r.domain))].sort();

// The profile rule(s) that cover Amazon hosts. All marketplaces share the same
// strip/preserve profile today, so this is normally a single rule — but collect
// all matches to stay robust if a marketplace ever diverges.
const amazonProfileRules = PROFILE_RULES.filter((r) =>
  (r.condition?.requestDomains ?? []).some((d) => AMAZON_HOST_RE.test(d)),
);
// removeParams seen across Amazon profile rules.
const amazonRemove = [...new Set(amazonProfileRules.flatMap(removeOf))];

const amazonStrip = new Set();
const amazonPreserve = new Set();
for (const r of amazonEntries) {
  for (const p of r.stripParams ?? []) amazonStrip.add(p);
  for (const p of r.preserveParams ?? []) amazonPreserve.add(p);
}
const trackingLc = new Set(TRACKING_PARAMS.map((p) => p.toLowerCase()));
// The "extra" strips folded in beyond the global tracking set: the internal-nav
// params. These are the ones the safety invariants must scrutinise.
const extraStrips = amazonRemove.filter((p) => !trackingLc.has(p.toLowerCase()));

describe("Amazon DNR — one complete rule per host", () => {
  test("Amazon is excluded from the global rule (never double-matches)", () => {
    const excluded = new Set(GLOBAL.condition?.excludedRequestDomains ?? []);
    for (const d of amazonDomains) {
      assert.ok(
        excluded.has(d),
        `Amazon host "${d}" must be in the global rule's excludedRequestDomains so it only matches its profile rule`,
      );
    }
  });

  test("Amazon's params live in a requestDomains-scoped profile rule (never global urlFilter)", () => {
    assert.ok(amazonProfileRules.length > 0, "at least one Amazon profile rule must exist");
    for (const r of amazonProfileRules) {
      assert.equal(r.condition?.urlFilter, undefined,
        "the Amazon profile rule must NOT use a global urlFilter");
      assert.ok(Array.isArray(r.condition?.requestDomains) && r.condition.requestDomains.length > 0);
      assert.deepEqual(r.condition?.resourceTypes, ["main_frame"]);
    }
  });

  test("every Amazon marketplace domain is covered by a profile rule", () => {
    const covered = [
      ...new Set(amazonProfileRules.flatMap((r) => r.condition?.requestDomains ?? [])),
    ].filter((d) => AMAZON_HOST_RE.test(d)).sort();
    assert.deepEqual(covered, amazonDomains);
  });
});

describe("Amazon DNR — the profile rule carries the COMPLETE strip set", () => {
  test("also strips the global tracking params (the one-rule-per-request fix)", () => {
    // The whole point of folding: because Amazon is excluded from the global
    // rule, its profile rule must itself carry the global tracking params.
    for (const p of ["utm_source", "gclid", "fbclid"]) {
      assert.ok(
        amazonRemove.map((x) => x.toLowerCase()).includes(p),
        `Amazon profile rule must also strip global param "${p}" — otherwise it leaks on Amazon`,
      );
    }
  });

  test("closes the reported gap — the known internal-nav tags are stripped", () => {
    for (const p of ["ref", "ref_", "pf_rd_t", "pf_rd_i", "pf_rd_m", "sr"]) {
      assert.ok(
        amazonRemove.includes(p),
        `internal nav tag "${p}" must be stripped on Amazon`,
      );
    }
  });

  test("every internal-nav (extra) strip is one the cleaner strips on Amazon", () => {
    for (const p of extraStrips) {
      assert.ok(amazonStrip.has(p), `"${p}" must be in Amazon domain-rules stripParams`);
    }
  });

  test("never strips a param Amazon needs (preserveParams)", () => {
    for (const p of amazonRemove) {
      assert.ok(!amazonPreserve.has(p), `"${p}" is functional on Amazon (preserveParams) — must not strip`);
    }
  });
});

describe("Amazon DNR — SAFETY (never harm creator attribution)", () => {
  test("no internal-nav strip is an affiliate-attribution key (AFFILIATE_PARAM_GUARD)", () => {
    const guard = new Set([...AFFILIATE_PARAM_GUARD].map((s) => s.toLowerCase()));
    for (const p of extraStrips) {
      assert.ok(!guard.has(p.toLowerCase()),
        `"${p}" is affiliate-guarded — stripping it could break a creator's referral`);
    }
  });

  test("no internal-nav strip is a protected nav/search key (REMOTE_PARAM_DENYLIST)", () => {
    const deny = new Set([...REMOTE_PARAM_DENYLIST].map((s) => s.toLowerCase()));
    for (const p of extraStrips) {
      assert.ok(!deny.has(p.toLowerCase()), `"${p}" is a protected nav/search key — must not strip`);
    }
  });

  test("the affiliate param 'tag' is NEVER in the strip list", () => {
    assert.ok(!amazonRemove.map((p) => p.toLowerCase()).includes("tag"));
  });

  test("no stripped param is the attribution param of any Amazon-targeting affiliate program", () => {
    // A param like `ref` is fine to strip on Amazon even though it's Vercel's
    // affiliate param, because Vercel does not operate on amazon.* — but a param
    // that IS an affiliate key for a program targeting an Amazon domain must
    // never be stripped.
    const amazonProgramParams = new Set(
      AFFILIATE_PATTERNS
        .filter((p) => (p.domains ?? []).some((d) => AMAZON_HOST_RE.test(d)))
        .map((p) => p.param.toLowerCase()),
    );
    for (const p of amazonRemove) {
      assert.ok(
        !amazonProgramParams.has(p.toLowerCase()),
        `"${p}" is an affiliate param for an Amazon-targeting program — must not strip`,
      );
    }
  });
});

describe("Amazon DNR — artifact ↔ generator sync (drift guard)", () => {
  test("the committed Amazon profile rule equals buildDnrRules() output", () => {
    const rebuilt = buildDnrRules();
    const rebuiltAmazon = rebuilt.filter((r) =>
      (r.condition?.requestDomains ?? []).some((d) => AMAZON_HOST_RE.test(d)),
    );
    const committedAmazon = RULES.filter((r) =>
      (r.condition?.requestDomains ?? []).some((d) => AMAZON_HOST_RE.test(d)),
    );
    assert.deepEqual(
      committedAmazon,
      rebuiltAmazon,
      "tracking-params.json is stale — run `npm run compile:rules`",
    );
  });
});
