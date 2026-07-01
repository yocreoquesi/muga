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
// Behavioural fixtures: apply the regexFilter + regexSubstitution as a pure
// JS function using RegExp + .replace-style backreference substitution —
// RE2 capture-group substitution syntax \1/\2/\3 maps directly to JS
// backreferences. This mirrors the pattern used in amp-redirect-dnr.test.mjs.
// ---------------------------------------------------------------------------

function applyRule(rule, url) {
  const re = new RegExp(rule.condition.regexFilter);
  const m = url.match(re);
  if (!m) return null;
  let sub = rule.action.redirect.regexSubstitution;
  for (let i = 1; i < m.length; i++) {
    sub = sub.replace(new RegExp("\\\\" + i, "g"), m[i] ?? "");
  }
  return sub;
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

  test("no-locale URL: slug stripped, query preserved (no trailing slash before ?)", () => {
    const result = applyRule(RULE, "https://www.amazon.com/Some-Slug-Here/dp/B0044R881I?psc=1");
    // The rule does not synthesize a trailing slash before the query string —
    // it only removes the slug segment and passes the remainder through
    // verbatim via the third capture group, so "?psc=1" stays exactly as-is.
    assert.equal(result, "https://www.amazon.com/dp/B0044R881I?psc=1");
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
    // optional quantifiers) — never an escaped literal "\?" that would target
    // the URL's query-string separator. Everything from "dp/ASIN" onward
    // (path suffix + "?query") is passed through untouched via the trailing
    // `(.*)$` capture group instead of being parsed/matched.
    assert.ok(
      !RULE.condition.regexFilter.includes("\\?"),
      "regexFilter must not contain an escaped literal '\\?' — the query string must never be parsed, only passed through"
    );
    assert.ok(
      RULE.condition.regexFilter.endsWith("(.*)$"),
      "regexFilter must end with a catch-all capture group that passes the path suffix + query string through verbatim"
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
