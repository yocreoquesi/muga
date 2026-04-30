/**
 * MUGA — Structural validation for amp-redirect.json DNR rules (#357)
 *
 * Verifies the amp-redirect rule resource is well-formed, IDs do not
 * collide with the static tracking-params ruleset, and the regex
 * substitutions match representative AMP URL shapes.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const ampRules = JSON.parse(readFileSync(join(ROOT, "src/rules/amp-redirect.json"), "utf8"));
const trackingRules = JSON.parse(readFileSync(join(ROOT, "src/rules/tracking-params.json"), "utf8"));

describe("amp-redirect.json — shape", () => {
  test("is an array", () => {
    assert.ok(Array.isArray(ampRules));
  });

  test("contains at least one rule", () => {
    assert.ok(ampRules.length > 0);
  });

  test("every rule has id, priority, action.type === redirect, condition.regexFilter, resourceTypes ['main_frame']", () => {
    for (const r of ampRules) {
      assert.equal(typeof r.id, "number");
      assert.equal(typeof r.priority, "number");
      assert.equal(r.action?.type, "redirect");
      assert.ok(typeof r.action?.redirect?.regexSubstitution === "string");
      assert.ok(typeof r.condition?.regexFilter === "string");
      assert.deepEqual(r.condition?.resourceTypes, ["main_frame"]);
    }
  });

  test("rule IDs are unique within the AMP ruleset", () => {
    const ids = ampRules.map(r => r.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

// ---------------------------------------------------------------------------
// Behavioural fixtures: each fixture URL applies the regex substitution and
// asserts the destination shape. This is a pure-function check of the rule's
// regex; the browser performs the same substitution at the network layer.
// ---------------------------------------------------------------------------

function applyRule(rule, url) {
  const re = new RegExp(rule.condition.regexFilter);
  const m = url.match(re);
  if (!m) return null;
  // chrome regexSubstitution uses \1 \2 etc; convert to JS replace string.
  let sub = rule.action.redirect.regexSubstitution;
  for (let i = 1; i < m.length; i++) {
    sub = sub.replace(new RegExp("\\\\" + i, "g"), m[i] ?? "");
  }
  return sub;
}

function applyAnyRule(url) {
  for (const r of ampRules) {
    const result = applyRule(r, url);
    if (result !== null) return { ruleId: r.id, redirect: result };
  }
  return null;
}

describe("amp-redirect.json — Google AMP cache (rule 100)", () => {
  test("https://www.google.com/amp/s/example.com/path → https://example.com/path", () => {
    const r = applyAnyRule("https://www.google.com/amp/s/example.com/path");
    assert.deepEqual(r, { ruleId: 100, redirect: "https://example.com/path" });
  });

  test("matches google.es and other ccTLDs", () => {
    const r = applyAnyRule("https://www.google.es/amp/s/example.es/articulo");
    assert.deepEqual(r, { ruleId: 100, redirect: "https://example.es/articulo" });
  });

  test("matches without www subdomain", () => {
    const r = applyAnyRule("https://google.com/amp/s/example.com/foo");
    assert.deepEqual(r, { ruleId: 100, redirect: "https://example.com/foo" });
  });
});

describe("amp-redirect.json — ampproject.org cache (rule 101)", () => {
  test("https://cdn.ampproject.org/c/s/example.com/article → https://example.com/article", () => {
    const r = applyAnyRule("https://cdn.ampproject.org/c/s/example.com/article");
    assert.deepEqual(r, { ruleId: 101, redirect: "https://example.com/article" });
  });
});

describe("amp-redirect.json — amp.* subdomain (rule 102)", () => {
  test("https://amp.example.com/article → https://example.com/article", () => {
    const r = applyAnyRule("https://amp.example.com/article");
    assert.deepEqual(r, { ruleId: 102, redirect: "https://example.com/article" });
  });

  test("preserves query string", () => {
    const r = applyAnyRule("https://amp.cnn.com/cnn/2024/news?ref=foo");
    assert.deepEqual(r, { ruleId: 102, redirect: "https://cnn.com/cnn/2024/news?ref=foo" });
  });

  test("matches root path", () => {
    const r = applyAnyRule("https://amp.example.com/");
    assert.deepEqual(r, { ruleId: 102, redirect: "https://example.com/" });
  });

  test("does NOT match when amp is not the leading subdomain", () => {
    // We do not unwrap subdomain.amp.example.com — only direct amp.* hosts.
    const r = applyAnyRule("https://www.amp.example.com/article");
    assert.equal(r, null);
  });
});

describe("amp-redirect.json — non-AMP traffic", () => {
  test("regular URL is not matched", () => {
    assert.equal(applyAnyRule("https://example.com/article"), null);
  });

  test("URL with utm_source is not matched (that's tracking-params territory)", () => {
    assert.equal(applyAnyRule("https://example.com/?utm_source=google"), null);
  });
});

describe("amp-redirect.json — non-collision with tracking-params", () => {
  test("AMP rule IDs do not collide with tracking-params rule IDs", () => {
    const trackingIds = new Set(trackingRules.map(r => r.id));
    for (const ampRule of ampRules) {
      assert.ok(!trackingIds.has(ampRule.id), `AMP rule ID ${ampRule.id} collides with tracking-params`);
    }
  });
});
