/**
 * MUGA — Property-based tests for the cleaner pipeline (issue #988).
 *
 * Generates a deterministic corpus of synthetic URLs from a small grammar
 * (scheme + affiliate/plain host + path + a mix of tracking params,
 * functional params, MUGA's own affiliate tag, and a third-party creator
 * tag) using a seeded mulberry32 PRNG, then asserts three invariants that
 * must hold across the WHOLE corpus:
 *
 *   1. Idempotence — cleaning an already-cleaned URL is a no-op.
 *   2. Copy-safe no-leak (#946) — the copy/share prefs shape
 *      (injectOwnAffiliate: false, notifyForeignAffiliate: false) must
 *      never cause a tag matching MUGA's FORMER own-tag values to appear on
 *      the output unless it was already present on the input. This is a
 *      trivial pass since drop-affiliate-injection (PR 1a) removed
 *      injection entirely, but the assertion is kept as a regression guard.
 *   3. Affiliate preservation — a third-party creator's affiliate tag
 *      survives under default (non-strip-all) prefs and is removed only
 *      when the user opts into stripAllAffiliates. MUGA no longer injects
 *      its own tag under any prefs combination (injection removed).
 *
 * The real `processUrl()` pipeline is exercised directly (same call shape
 * used by tests/unit/content-copy-safe-injection.test.mjs and
 * tests/unit/cleaner-affiliate-pipeline.test.mjs):
 *
 *   processUrl(rawUrl, prefs, domainRules, canonicalBundle, frequencyTracker,
 *              referrer, pathStripRules, pathAffiliateRules)
 *
 * This file is TEST-ONLY. If a generated case reveals a real invariant
 * violation, that is a genuine cleaner bug — the assertion must NOT be
 * weakened and production code must NOT be touched to make it pass.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { processUrl } from "../../src/lib/cleaner.js";
import { TRACKING_PARAMS } from "../../src/lib/affiliates.js";

const require = createRequire(import.meta.url);
const domainRules = require("../../src/rules/domain-rules.json");

// ── Deterministic seeded PRNG (mulberry32) ───────────────────────────────
// No Math.random anywhere in this file — every run with the same SEED
// produces the exact same corpus, so a CI failure is always reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 988;
const rng = mulberry32(SEED);

function pick(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function pickN(arr, n) {
  // Sample n distinct entries via Fisher-Yates partial shuffle.
  const pool = arr.slice();
  const out = [];
  const count = Math.min(n, pool.length);
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Grammar data — sourced from the real ruleset, not invented ──────────

// Affiliate hosts + values that used to be MUGA's own tag (OUR_TAGS was
// removed from src/lib/affiliates.js in drop-affiliate-injection PR 1a).
// Kept here as fixed, arbitrary "pre-existing tag" values purely to
// generate deterministic test data — they carry no special meaning to the
// cleaner anymore.
const AFFILIATE_HOSTS = [
  { host: "amazon.com", param: "tag", ourTag: "muga0b-20" },
  { host: "amazon.es", param: "tag", ourTag: "muga0b-21" },
  { host: "amazon.de", param: "tag", ourTag: "muga0f-21" },
  { host: "amazon.fr", param: "tag", ourTag: "muga08a-21" },
  { host: "amazon.it", param: "tag", ourTag: "muga04f-21" },
  { host: "amazon.co.uk", param: "tag", ourTag: "muga0a-21" },
  { host: "ebay.com", param: "campid", ourTag: "5339147108" },
  { host: "ebay.es", param: "campid", ourTag: "5339147108" },
];

// Plain, non-affiliate hosts. Fictional/fixture-only names so they can
// never accidentally collide with a real entry in domain-rules.json.
const PLAIN_HOSTS = [
  "blog.cleaner-fixture.example",
  "news.cleaner-fixture.example",
  "recipes.cleaner-fixture.example",
];

// Third-party creator affiliate tag values. None of these may equal any
// ourTag value above (that would silently turn a "creator tag" case into
// an "already our tag" case and break the copy-safe invariant's premise).
const CREATOR_TAGS = ["creator-alpha-19", "youtuber-diego-21", "streamer-mika-07"];

// Functional params that MUST be preserved: none of these are tracking
// params (verified against TRACKING_PARAMS/TRACKING_PREFIXES) and "page"
// is additionally an explicit preserveParams entry for amazon.*/ebay.* in
// domain-rules.json.
const FUNCTIONAL_PARAMS = ["q", "id", "page", "sort"];

// Safe path segments — none match AUTH_PATH_RE
// (/(oauth|oauth2|authorize|callback|auth|signin|login|sso|saml|checkout|payment|pay)(\/|$)/)
// so every generated URL actually reaches the tracking/affiliate pipeline
// instead of short-circuiting to "untouched".
const PATHS = [
  "/",
  "/dp/B08N5WRWNW",
  "/product/12345",
  "/item/abc-123",
  "/shop/electronics",
  "/deals/today",
  "/search-results",
];

const SCHEMES = ["http", "https"];

// Sanity check on the grammar's own premise — fail loudly here rather than
// producing a confusing property-test failure downstream.
for (const tag of CREATOR_TAGS) {
  for (const h of AFFILIATE_HOSTS) {
    if (tag === h.ourTag) {
      throw new Error(`Grammar bug: creator tag "${tag}" collides with ourTag for ${h.host}`);
    }
  }
}

// ── Prefs variants ────────────────────────────────────────────────────────

const NAV_PREFS = Object.freeze({
  enabled: true,
  onboardingDone: true,
  injectOwnAffiliate: true,
  notifyForeignAffiliate: true,
  stripAllAffiliates: false,
  blacklist: [],
  whitelist: [],
  disabledCategories: [],
});

// The copy/share prefs shape (#946): the content-script copy paths and
// background handleProcessUrl's skipNotify branch both force these two
// toggles off regardless of the user's live navigation prefs.
const COPY_PREFS = Object.freeze({
  enabled: true,
  onboardingDone: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  stripAllAffiliates: false,
  blacklist: [],
  whitelist: [],
  disabledCategories: [],
});

const STRIP_ALL_PREFS = Object.freeze({
  ...NAV_PREFS,
  stripAllAffiliates: true,
  // notifyForeignAffiliate detection is gated off automatically when
  // stripAllAffiliates is on (see handleAffiliatePipeline Step 3), kept
  // here only for readability of the fixture.
  notifyForeignAffiliate: false,
});

const NO_INJECT_PREFS = Object.freeze({
  ...NAV_PREFS,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
});

// ── Case generation ───────────────────────────────────────────────────────

/**
 * @typedef {object} GeneratedCase
 * @property {string} rawUrl
 * @property {{host:string, param:string, ourTag:string}|null} affiliateHost
 * @property {"none"|"ourTag"|"creatorTag"} tagState
 * @property {string|null} creatorTagValue
 */

function generateCase(index) {
  const scheme = pick(SCHEMES);
  const useAffiliateHost = rng() < 0.7;
  const affiliateHost = useAffiliateHost ? pick(AFFILIATE_HOSTS) : null;
  const bareHost = affiliateHost ? affiliateHost.host : pick(PLAIN_HOSTS);
  const host = rng() < 0.3 ? `www.${bareHost}` : bareHost;
  const path = pick(PATHS);

  const params = [];

  // 1-4 real tracking params from the ruleset, with deterministic values.
  const trackingSample = pickN(TRACKING_PARAMS, 1 + Math.floor(rng() * 4));
  trackingSample.forEach((name, i) => params.push([name, `v${index}_${i}`]));

  // 0-2 functional params that must survive cleaning untouched.
  const functionalSample = pickN(FUNCTIONAL_PARAMS, Math.floor(rng() * 3));
  functionalSample.forEach((name) => params.push([name, `${name}val${index}`]));

  // Affiliate tag state, only meaningful on affiliate hosts.
  let tagState = "none";
  let creatorTagValue = null;
  if (affiliateHost) {
    const roll = rng();
    if (roll < 0.34) {
      tagState = "none";
    } else if (roll < 0.67) {
      tagState = "ourTag";
      params.push([affiliateHost.param, affiliateHost.ourTag]);
    } else {
      tagState = "creatorTag";
      creatorTagValue = pick(CREATOR_TAGS);
      params.push([affiliateHost.param, creatorTagValue]);
    }
  }

  const orderedParams = shuffle(params);
  const query = orderedParams.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const rawUrl = `${scheme}://${host}${path}${query ? `?${query}` : ""}`;

  return { rawUrl, affiliateHost, tagState, creatorTagValue };
}

const CASE_COUNT = 300;
const CORPUS = Array.from({ length: CASE_COUNT }, (_, i) => generateCase(i));

// ── Shared processUrl call helper ────────────────────────────────────────
// Matches the real call shape from content-copy-safe-injection.test.mjs /
// cleaner-affiliate-pipeline.test.mjs: (rawUrl, prefs, domainRules,
// canonicalBundle, frequencyTracker, referrer, pathStripRules, pathAffiliateRules).
function clean(rawUrl, prefs) {
  return processUrl(rawUrl, prefs, domainRules, undefined, undefined, "", [], []);
}

function tagValueOf(url, param) {
  try {
    return new URL(url).searchParams.get(param);
  } catch {
    return undefined;
  }
}

// ── Invariant 1: Idempotence ──────────────────────────────────────────────

describe("cleaner property: idempotence (processUrl(processUrl(x)) === processUrl(x))", () => {
  test(`holds across ${CASE_COUNT} generated cases under default navigation prefs`, () => {
    const failures = [];
    for (const c of CORPUS) {
      const first = clean(c.rawUrl, NAV_PREFS);
      const second = clean(first.cleanUrl, NAV_PREFS);
      if (second.cleanUrl !== first.cleanUrl) {
        failures.push({
          invariant: "idempotence",
          rawUrl: c.rawUrl,
          firstPass: first.cleanUrl,
          secondPass: second.cleanUrl,
        });
      }
    }
    assert.equal(
      failures.length,
      0,
      `Idempotence violated in ${failures.length}/${CASE_COUNT} case(s). ` +
        `First offender: ${JSON.stringify(failures[0], null, 2)}`,
    );
  });
});

// ── Invariant 2: Copy-safe never leaks our own tag ────────────────────────

describe("cleaner property: copy-safe cleaning never injects MUGA's own affiliate tag (#946)", () => {
  test(`holds across every affiliate-host case where the input did not already carry our tag`, () => {
    const failures = [];
    for (const c of CORPUS) {
      if (!c.affiliateHost) continue;
      const { param, ourTag } = c.affiliateHost;
      const inputHadOurTag = tagValueOf(c.rawUrl, param) === ourTag;
      const result = clean(c.rawUrl, COPY_PREFS);
      const outputTagValue = tagValueOf(result.cleanUrl, param);

      if (!inputHadOurTag && outputTagValue === ourTag) {
        failures.push({
          invariant: "copy-safe-no-leak",
          rawUrl: c.rawUrl,
          cleanUrl: result.cleanUrl,
          action: result.action,
          reason: "our own tag appeared on copy-safe output even though the input never had it",
        });
      }
      if (!inputHadOurTag && result.action === "injected") {
        failures.push({
          invariant: "copy-safe-no-injected-action",
          rawUrl: c.rawUrl,
          cleanUrl: result.cleanUrl,
          action: result.action,
          reason: 'copy-safe prefs must never report action "injected"',
        });
      }
    }
    assert.equal(
      failures.length,
      0,
      `Copy-safe leak in ${failures.length} case(s). First offender: ${JSON.stringify(failures[0], null, 2)}`,
    );
  });
});

// ── Invariant 3: Third-party affiliate preservation ───────────────────────

describe("cleaner property: third-party creator affiliate tag preservation", () => {
  test("a creator tag survives under default (non-strip-all) prefs", () => {
    const failures = [];
    for (const c of CORPUS) {
      if (!c.affiliateHost || c.tagState !== "creatorTag") continue;
      const { param } = c.affiliateHost;
      const result = clean(c.rawUrl, NAV_PREFS);
      const outputTagValue = tagValueOf(result.cleanUrl, param);
      if (outputTagValue !== c.creatorTagValue) {
        failures.push({
          invariant: "creator-tag-preserved-default",
          rawUrl: c.rawUrl,
          cleanUrl: result.cleanUrl,
          expectedCreatorTag: c.creatorTagValue,
          actualTagValue: outputTagValue,
        });
      }
    }
    assert.equal(
      failures.length,
      0,
      `Creator tag not preserved in ${failures.length} case(s). ` +
        `First offender: ${JSON.stringify(failures[0], null, 2)}`,
    );
  });

  test("a creator tag is removed once the user opts into stripAllAffiliates", () => {
    const failures = [];
    for (const c of CORPUS) {
      if (!c.affiliateHost || c.tagState !== "creatorTag") continue;
      const { param } = c.affiliateHost;
      const result = clean(c.rawUrl, STRIP_ALL_PREFS);
      const outputTagValue = tagValueOf(result.cleanUrl, param);
      if (outputTagValue === c.creatorTagValue) {
        failures.push({
          invariant: "creator-tag-stripped-under-strip-all",
          rawUrl: c.rawUrl,
          cleanUrl: result.cleanUrl,
          creatorTagValue: c.creatorTagValue,
        });
      }
    }
    assert.equal(
      failures.length,
      0,
      `stripAllAffiliates failed to remove the creator tag in ${failures.length} case(s). ` +
        `First offender: ${JSON.stringify(failures[0], null, 2)}`,
    );
  });

  test("no tag is ever injected on a tagless URL, regardless of injectOwnAffiliate (removed)", () => {
    const failures = [];
    for (const c of CORPUS) {
      if (!c.affiliateHost || c.tagState !== "none") continue;
      const { param } = c.affiliateHost;

      const withInjectPref = clean(c.rawUrl, NAV_PREFS); // injectOwnAffiliate: true (inert)
      const withInjectPrefTag = tagValueOf(withInjectPref.cleanUrl, param);
      if (withInjectPrefTag || withInjectPref.action === "injected") {
        failures.push({
          invariant: "no-tag-ever-injected-pref-on",
          rawUrl: c.rawUrl,
          cleanUrl: withInjectPref.cleanUrl,
          action: withInjectPref.action,
          unexpectedTagValue: withInjectPrefTag,
        });
      }

      const withoutInjectPref = clean(c.rawUrl, NO_INJECT_PREFS); // injectOwnAffiliate: false
      const withoutInjectPrefTag = tagValueOf(withoutInjectPref.cleanUrl, param);
      if (withoutInjectPrefTag) {
        failures.push({
          invariant: "no-tag-ever-injected-pref-off",
          rawUrl: c.rawUrl,
          cleanUrl: withoutInjectPref.cleanUrl,
          unexpectedTagValue: withoutInjectPrefTag,
        });
      }
    }
    assert.equal(
      failures.length,
      0,
      `Tag injection detected in ${failures.length} case(s) — MUGA must never inject its own tag. ` +
        `First offender: ${JSON.stringify(failures[0], null, 2)}`,
    );
  });
});

// ── Corpus sanity (guards the generator itself, not the cleaner) ─────────

describe("cleaner property: corpus sanity", () => {
  test("generates the expected number of cases with a mix of affiliate and plain hosts", () => {
    assert.equal(CORPUS.length, CASE_COUNT);
    const affiliateCount = CORPUS.filter((c) => c.affiliateHost).length;
    const plainCount = CASE_COUNT - affiliateCount;
    assert.ok(affiliateCount > 0, "corpus must include affiliate-host cases");
    assert.ok(plainCount > 0, "corpus must include plain-host cases");
  });

  test("is fully deterministic across two independent generator runs with the same seed", () => {
    const rngA = mulberry32(SEED);
    const rngB = mulberry32(SEED);
    const samplesA = Array.from({ length: 20 }, () => rngA());
    const samplesB = Array.from({ length: 20 }, () => rngB());
    assert.deepEqual(samplesA, samplesB, "mulberry32 must produce identical sequences for the same seed");
  });
});
