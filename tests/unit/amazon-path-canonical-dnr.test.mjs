/**
 * MUGA — Structural validation for amazon-path-canonical.json DNR rules (#903)
 *
 * Chrome-only: strips the Amazon SEO path slug on direct navigation to a
 * /dp/ product page via a standalone DNR regexSubstitution redirect, e.g.
 *   https://www.amazon.de/-/en/Some-Slug/dp/B0044R881I/?th=1
 *   → https://www.amazon.de/-/en/dp/B0044R881I/?th=1
 *
 * Verifies the rule resource is well-formed, its ID does not collide with
 * any other static ruleset or dynamic rule ID, the regex preserves the
 * `/-/xx` locale prefix and query string while stripping only the slug,
 * and the already-canonical output URL cannot re-match (loop prevention).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  DNR_CUSTOM_PARAMS_RULE_ID,
  DNR_REMOTE_PARAMS_RULE_ID,
} from "../../src/lib/dnr-ids.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const amazonPathRules = JSON.parse(
  readFileSync(join(ROOT, "src/rules/amazon-path-canonical.json"), "utf8")
);
const trackingRules = JSON.parse(readFileSync(join(ROOT, "src/rules/tracking-params.json"), "utf8"));
const ampRules = JSON.parse(readFileSync(join(ROOT, "src/rules/amp-redirect.json"), "utf8"));
const wrapperRules = JSON.parse(readFileSync(join(ROOT, "src/rules/wrapper-dnr-rules.json"), "utf8"));

describe("amazon-path-canonical.json — shape", () => {
  test("is an array", () => {
    assert.ok(Array.isArray(amazonPathRules));
  });

  test("contains exactly one rule", () => {
    assert.equal(amazonPathRules.length, 1);
  });

  test("rule has id, priority, action.type === redirect, regexSubstitution, condition.regexFilter, resourceTypes ['main_frame']", () => {
    const [r] = amazonPathRules;
    assert.equal(typeof r.id, "number");
    assert.equal(typeof r.priority, "number");
    assert.equal(r.action?.type, "redirect");
    assert.equal(typeof r.action?.redirect?.regexSubstitution, "string");
    assert.equal(typeof r.condition?.regexFilter, "string");
    assert.deepEqual(r.condition?.resourceTypes, ["main_frame"]);
  });
});

// ---------------------------------------------------------------------------
// ID collision guard — must not collide with any other static ruleset ID
// (tracking-params.json, amp-redirect.json, wrapper-dnr-rules.json) or any
// dynamic rule ID declared in src/lib/dnr-ids.js.
// ---------------------------------------------------------------------------
describe("amazon-path-canonical.json — ID non-collision (#903)", () => {
  test("rule ID does not collide with tracking-params.json, amp-redirect.json, wrapper-dnr-rules.json, or dynamic dnr-ids.js IDs", () => {
    const otherStaticIds = [
      ...trackingRules.map(r => r.id),
      ...ampRules.map(r => r.id),
      ...wrapperRules.map(r => r.id),
    ];
    const dynamicIds = [DNR_CUSTOM_PARAMS_RULE_ID, DNR_REMOTE_PARAMS_RULE_ID];
    const allOtherIds = new Set([...otherStaticIds, ...dynamicIds]);

    for (const r of amazonPathRules) {
      assert.ok(
        !allOtherIds.has(r.id),
        `amazon-path-canonical.json rule ID ${r.id} collides with an existing static or dynamic rule ID`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Engine seam: Chrome DNR compiles regexFilter with RE2, NOT the JS RegExp
// engine. The two can diverge on the same pattern, so — when the optional
// `re2` devDependency is installed (see package.json) — we evaluate the rule
// with RE2, the SAME engine Chrome ships, and additionally assert JS ⇄ RE2
// agreement (see the "engine parity" describe below). If re2 is unavailable
// in this environment (e.g. the native module could not be built), we fall
// back to the JS RegExp approximation.
//
// IMPORTANT (test scope): these fixtures exercise the amazon_path_canonical
// rule (id 200) IN ISOLATION — slug removal + verbatim query pass-through.
// End to end, MUGA loads more rulesets, and the always-on global
// tracking_params rule (id 1, urlFilter "*") additionally strips curated
// tracking params. So a param such as `psc` IS preserved by rule 200 alone
// (asserted here) but is stripped from the FINAL composed URL by rule 1 — a
// benign one that stays (e.g. `th`) survives end to end. The e2e spec
// (tests/e2e/amazon-path-canonical.spec.mjs) is authoritative for the
// composed, real-Chromium substitution result.
// ---------------------------------------------------------------------------

let RE2 = null;
try {
  ({ default: RE2 } = await import("re2"));
} catch {
  // re2 is an optional native devDependency; fall back to JS RegExp below.
  RE2 = null;
}
const RE2_ACTIVE = RE2 !== null;

// RE2 capture-group substitution syntax \1\2\3 maps directly to JS
// backreferences, so we implement the substitution the same way for both
// engines and only swap the matcher.
function substitute(sub, m) {
  let out = sub;
  for (let i = 1; i < m.length; i++) {
    out = out.replace(new RegExp("\\\\" + i, "g"), m[i] ?? "");
  }
  return out;
}

function matchWith(engine, filter, url) {
  if (engine === "re2") return new RE2(filter).exec(url);
  return url.match(new RegExp(filter));
}

// Applies the rule using RE2 when available, else JS RegExp.
function applyRule(rule, url) {
  const m = matchWith(RE2_ACTIVE ? "re2" : "js", rule.condition.regexFilter, url);
  if (!m) return null;
  return substitute(rule.action.redirect.regexSubstitution, m);
}

const [RULE] = amazonPathRules;

describe("amazon-path-canonical.json — slug stripping, locale + query preserved", () => {
  test("issue URL: /-/en locale prefix + slug + trailing slash + query", () => {
    const result = applyRule(
      RULE,
      "https://www.amazon.de/-/en/Arcos-Serie-Universal-Kochmesser-Polyoxymethylen/dp/B0044R881I/?th=1"
    );
    assert.equal(result, "https://www.amazon.de/-/en/dp/B0044R881I/?th=1");
  });

  test("no-locale URL, query begins with '?' right after ASIN: slug stripped, query preserved (regression for #903 e2e drop)", () => {
    // This is the exact URL the #903 CI e2e used. Under BOTH JS RegExp and RE2
    // (Chrome's engine), capture group 3 = "?psc=1" and rule 200 IN ISOLATION
    // preserves it verbatim — there is no trailing slash synthesized before
    // the query. The end-to-end e2e result differs ONLY because the global
    // tracking_params rule (id 1) independently strips the curated `psc`
    // param; that is not a defect of this rule. See the engine-seam note above.
    const result = applyRule(RULE, "https://www.amazon.com/Some-Slug-Here/dp/B0044R881I?psc=1");
    assert.equal(result, "https://www.amazon.com/dp/B0044R881I?psc=1");
  });

  test("no-locale URL, multi-param query (?a=1&b=2) preserved verbatim", () => {
    const result = applyRule(RULE, "https://www.amazon.com/Some-Slug/dp/B0044R881I?a=1&b=2");
    assert.equal(result, "https://www.amazon.com/dp/B0044R881I?a=1&b=2");
  });

  test("no-locale URL, path-suffix tail (/ref=...) preserved verbatim", () => {
    const result = applyRule(RULE, "https://www.amazon.com/Some-Slug/dp/B0044R881I/ref=sr_1_1");
    assert.equal(result, "https://www.amazon.com/dp/B0044R881I/ref=sr_1_1");
  });

  test("no-locale URL, trailing slash and empty tail preserved verbatim", () => {
    assert.equal(
      applyRule(RULE, "https://www.amazon.com/Some-Slug/dp/B0044R881I/"),
      "https://www.amazon.com/dp/B0044R881I/"
    );
    assert.equal(
      applyRule(RULE, "https://www.amazon.com/Some-Slug/dp/B0044R881I"),
      "https://www.amazon.com/dp/B0044R881I"
    );
  });

  // Addendum: the /-/xx locale prefix is functional (Amazon uses it to pick
  // the storefront language) and MUST survive slug removal for every
  // supported locale, not just /-/en.
  test("preserves /-/es locale prefix (amazon.es)", () => {
    const result = applyRule(RULE, "https://www.amazon.es/-/es/Otro-Slug-De-Producto/dp/B0044R881I");
    assert.equal(result, "https://www.amazon.es/-/es/dp/B0044R881I");
  });

  test("preserves /-/ja locale prefix (amazon.co.jp, multi-label TLD)", () => {
    const result = applyRule(RULE, "https://www.amazon.co.jp/-/ja/Slug-Japones-De-Producto/dp/B0044R881I");
    assert.equal(result, "https://www.amazon.co.jp/-/ja/dp/B0044R881I");
  });
});

describe("amazon-path-canonical.json — idempotency (loop prevention)", () => {
  test("already-canonical URL (no locale) does NOT match regexFilter", () => {
    const re = new RegExp(RULE.condition.regexFilter);
    assert.equal(re.test("https://www.amazon.com/dp/B0044R881I?psc=1"), false);
  });

  test("already-canonical URL WITH /-/en locale does NOT match regexFilter", () => {
    const re = new RegExp(RULE.condition.regexFilter);
    assert.equal(re.test("https://www.amazon.de/-/en/dp/B0044R881I?th=1"), false);
  });

  test("already-canonical URL WITH /-/es locale does NOT match regexFilter", () => {
    const re = new RegExp(RULE.condition.regexFilter);
    assert.equal(re.test("https://www.amazon.es/-/es/dp/B0044R881I"), false);
  });

  test("already-canonical URL WITH /-/ja locale does NOT match regexFilter", () => {
    const re = new RegExp(RULE.condition.regexFilter);
    assert.equal(re.test("https://www.amazon.co.jp/-/ja/dp/B0044R881I"), false);
  });
});

// ---------------------------------------------------------------------------
// Safe-fail on unrecognized locale forms: the path-locale capture group is
// `(?:/-/[a-z]{2,3})?`, matching Amazon's real path-locale codes (two-letter
// ISO 639-1 language codes such as en/es/de/fr/it/ja; three letters is
// reserved headroom, no known Amazon path code needs it). A locale segment
// outside that shape (uppercase, hyphenated region suffix like en-US) must
// NOT be partially consumed — the rule must simply not match rather than
// produce a mangled path.
// ---------------------------------------------------------------------------
describe("amazon-path-canonical.json — safe-fail on malformed locale prefix", () => {
  const re = () => new RegExp(RULE.condition.regexFilter);

  test("uppercase locale (/-/EN) does not match — URL left untouched", () => {
    assert.equal(re().test("https://www.amazon.de/-/EN/Slug/dp/B0044R881I"), false);
  });

  test("region-suffixed locale (/-/en-US) does not match — URL left untouched", () => {
    assert.equal(re().test("https://www.amazon.de/-/en-US/Slug/dp/B0044R881I"), false);
  });
});

describe("amazon-path-canonical.json — non-product pages are not matched", () => {
  const re = () => new RegExp(RULE.condition.regexFilter);

  test("search results page", () => {
    assert.equal(re().test("https://www.amazon.com/s?k=knife"), false);
  });

  test("cart page", () => {
    assert.equal(re().test("https://www.amazon.com/gp/cart/view.html"), false);
  });

  test("homepage", () => {
    assert.equal(re().test("https://www.amazon.com/"), false);
  });
});

// ---------------------------------------------------------------------------
// Moat safety: the rule must only ever touch the path, never the query
// string. Any param in domain-rules.json's Amazon preserveParams, or the
// tracking-params.json Amazon-scoped strip rule, must pass through
// untouched — the regex only removes the path segment before "dp/ASIN",
// everything else (including "?...") is captured verbatim and replayed.
// ---------------------------------------------------------------------------
describe("amazon-path-canonical.json — moat safety: query string is never touched", () => {
  test("regexFilter never matches on a literal query-string separator ('\\?')", () => {
    // The pattern uses "?" only as regex syntax (non-capturing groups "(?:",
    // optional quantifiers, and the "[/?]" tail-delimiter char class) — never
    // an escaped literal "\?" that would target the URL's query-string
    // separator. Everything from "dp/ASIN" onward (path suffix + "?query") is
    // passed through untouched via the trailing `((?:[/?].*)?)$` capture group
    // instead of being parsed/matched.
    assert.ok(
      !RULE.condition.regexFilter.includes("\\?"),
      "regexFilter must not contain an escaped literal '\\?' — the query string must never be parsed, only passed through"
    );
    assert.ok(
      RULE.condition.regexFilter.endsWith("((?:[/?].*)?)$"),
      "regexFilter must end with a tail capture group that is empty OR begins with a '/' or '?' delimiter and then passes the remainder through verbatim"
    );
  });

  test("functional/affiliate params (tag, th, psc) survive the redirect untouched", () => {
    assert.equal(
      applyRule(RULE, "https://www.amazon.de/-/en/Slug/dp/B0044R881I/?th=1&tag=creator-21"),
      "https://www.amazon.de/-/en/dp/B0044R881I/?th=1&tag=creator-21"
    );
    assert.equal(
      applyRule(RULE, "https://www.amazon.com/Slug/dp/B0044R881I?psc=1"),
      "https://www.amazon.com/dp/B0044R881I?psc=1"
    );
  });
});

// ---------------------------------------------------------------------------
// Engine parity (JS RegExp vs RE2): Chrome DNR uses RE2. This guards against
// the exact class of false confidence that let #903 ship — a pattern that
// behaves one way under JS RegExp and another under RE2. When the optional
// `re2` devDependency is installed, we assert both engines agree (match/no-match
// AND the substituted output) across the full behavioural corpus. If re2 is not
// installed, the block reports that parity was NOT machine-verified and defers
// to the e2e spec, which runs in real Chromium.
// ---------------------------------------------------------------------------
describe("amazon-path-canonical.json — JS RegExp vs RE2 engine parity (#903)", () => {
  const CORPUS = [
    "https://www.amazon.de/-/en/Arcos-Serie/dp/B0044R881I/?th=1",
    "https://www.amazon.com/Some-Slug-Here/dp/B0044R881I?psc=1",
    "https://www.amazon.com/Some-Slug/dp/B0044R881I?a=1&b=2",
    "https://www.amazon.com/Some-Slug/dp/B0044R881I/ref=sr_1_1",
    "https://www.amazon.com/Some-Slug/dp/B0044R881I/",
    "https://www.amazon.com/Some-Slug/dp/B0044R881I",
    "https://www.amazon.es/-/es/Otro/dp/B0044R881I",
    "https://www.amazon.co.jp/-/ja/Slug/dp/B0044R881I",
    // idempotency / non-matching
    "https://www.amazon.com/dp/B0044R881I?psc=1",
    "https://www.amazon.de/-/en/dp/B0044R881I?th=1",
    "https://www.amazon.de/-/EN/Slug/dp/B0044R881I",
    "https://www.amazon.de/-/en-US/Slug/dp/B0044R881I",
    "https://www.amazon.com/s?k=knife",
    "https://www.amazon.com/gp/cart/view.html",
    "https://www.amazon.com/",
  ];

  test(RE2_ACTIVE ? "RE2 is the active engine and agrees with JS RegExp on every corpus URL" : "re2 not installed — parity NOT machine-verified (e2e in real Chromium is authoritative)", () => {
    if (!RE2_ACTIVE) {
      // Not a hard failure: re2 is an optional native module. We still encode
      // the intended outcomes elsewhere in this file, and the Chrome e2e spec
      // validates the real RE2 substitution behaviour end to end.
      assert.ok(true);
      return;
    }
    const sub = RULE.action.redirect.regexSubstitution;
    const filter = RULE.condition.regexFilter;
    for (const url of CORPUS) {
      const jm = matchWith("js", filter, url);
      const rm = matchWith("re2", filter, url);
      assert.equal(
        Boolean(jm),
        Boolean(rm),
        `match/no-match diverges between JS and RE2 for ${url}`
      );
      if (jm && rm) {
        assert.equal(
          substitute(sub, jm),
          substitute(sub, rm),
          `substituted output diverges between JS and RE2 for ${url}`
        );
      }
    }
  });
});
