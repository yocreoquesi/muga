/**
 * MUGA — Unit tests for src/lib/wrapper-dnr-builder.js
 *
 * Verifies the pure DNR-rule builder used by scripts/generate-dnr-rules.mjs:
 *   - REGEX_PURE_WRAPPER_IDS lists exactly the seven in-scope wrapper ids
 *     (issue #449, slice B6)
 *   - buildDnrRules() converts the full WRAPPERS table into 7 valid DNR
 *     rule objects of the expected shape (regexFilter + regexSubstitution)
 *   - Each rule's regexFilter compiles as a JS RegExp
 *   - Each rule's regexFilter targets the correct host and param key for the
 *     wrapper it represents
 *   - Wrapper entries whose hostPatterns contain a RegExp (e.g. Impact) are
 *     never emitted as DNR rules — even if their id is added to the allowlist
 *   - validateDnrRules flags rule-count overshoot, duplicate IDs, and passes
 *     the canonical 7-rule output
 *   - buildDnrRules is idempotent: same input → identical output (key order,
 *     numeric IDs, regex strings)
 *
 * Resolves a chunk of issue #449.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  REGEX_PURE_WRAPPER_IDS,
  buildDnrRules,
  validateDnrRules,
} from "../../src/lib/wrapper-dnr-builder.js";
import { WRAPPERS } from "../../src/lib/wrapper-engine.js";

// ---------------------------------------------------------------------------
// REGEX_PURE_WRAPPER_IDS — the explicit allowlist for slice B6
// ---------------------------------------------------------------------------
describe("REGEX_PURE_WRAPPER_IDS", () => {
  const expected = [
    "facebook-l",
    "facebook-lm",
    "skimlinks-redirectingat",
    "skimlinks-skimresources",
    "shareasale",
    "rakuten",
  ];

  test("lists exactly the six in-scope wrapper ids (awin retired in #684)", () => {
    assert.deepEqual([...REGEX_PURE_WRAPPER_IDS].sort(), [...expected].sort());
  });

  test("has length 6", () => {
    assert.equal(REGEX_PURE_WRAPPER_IDS.length, 6);
  });
});

// ---------------------------------------------------------------------------
// buildDnrRules — happy path with the real WRAPPERS table
// ---------------------------------------------------------------------------
describe("buildDnrRules — full WRAPPERS table", () => {
  const rules = buildDnrRules(WRAPPERS);

  test("returns exactly 6 rules", () => {
    assert.equal(rules.length, 6);
  });

  test("each rule has id, priority, action, condition", () => {
    for (const rule of rules) {
      assert.equal(typeof rule.id, "number", `rule.id must be a number`);
      assert.equal(typeof rule.priority, "number", `rule.priority must be a number`);
      assert.equal(typeof rule.action, "object");
      assert.equal(typeof rule.condition, "object");
    }
  });

  test("each rule.action is type=redirect with regexSubstitution \\1", () => {
    for (const rule of rules) {
      assert.equal(rule.action.type, "redirect");
      assert.equal(typeof rule.action.redirect, "object");
      assert.equal(rule.action.redirect.regexSubstitution, "\\1");
    }
  });

  test("each rule.condition.regexFilter is a non-empty string", () => {
    for (const rule of rules) {
      assert.equal(typeof rule.condition.regexFilter, "string");
      assert.ok(rule.condition.regexFilter.length > 0);
    }
  });

  test("each rule.condition.regexFilter compiles as a RegExp", () => {
    for (const rule of rules) {
      assert.doesNotThrow(
        () => new RegExp(rule.condition.regexFilter),
        `regexFilter must compile: ${rule.condition.regexFilter}`,
      );
    }
  });

  test("each rule.condition.resourceTypes is [main_frame, sub_frame]", () => {
    for (const rule of rules) {
      assert.deepEqual(rule.condition.resourceTypes, ["main_frame", "sub_frame"]);
    }
  });

  test("all rule IDs are unique", () => {
    const ids = rules.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("rule IDs are positive integers", () => {
    for (const rule of rules) {
      assert.ok(Number.isInteger(rule.id) && rule.id > 0, `bad id: ${rule.id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// buildDnrRules — per-wrapper host/param assertions
// ---------------------------------------------------------------------------
describe("buildDnrRules — host + param targeting", () => {
  const rules = buildDnrRules(WRAPPERS);
  /** @type {(id: string) => {regexFilter: string}} */
  const filterFor = (id) => {
    // The builder annotates each rule with a non-DNR property only used by
    // tests? No — to keep rules valid, we instead derive from order: the
    // builder MUST emit rules in REGEX_PURE_WRAPPER_IDS order. Tests assert
    // this order and use it to identify rules.
    const idx = REGEX_PURE_WRAPPER_IDS.indexOf(id);
    return rules[idx].condition;
  };

  test("Facebook l.facebook.com rule matches l.facebook.com only and ?u= param", () => {
    const f = filterFor("facebook-l").regexFilter;
    assert.match("https://l.facebook.com/l.php?u=https%3A%2F%2Fm.com&h=abc", new RegExp(f));
    assert.doesNotMatch("https://lm.facebook.com/l.php?u=https%3A%2F%2Fm.com", new RegExp(f));
    assert.ok(f.includes("l\\.facebook\\.com"));
  });

  test("Facebook lm.facebook.com rule matches lm.facebook.com only and ?u= param", () => {
    const f = filterFor("facebook-lm").regexFilter;
    assert.match("https://lm.facebook.com/l.php?u=https%3A%2F%2Fm.com", new RegExp(f));
    assert.doesNotMatch("https://l.facebook.com/l.php?u=https%3A%2F%2Fm.com", new RegExp(f));
    assert.ok(f.includes("lm\\.facebook\\.com"));
  });

  test("Skimlinks redirectingat rule matches go.redirectingat.com and ?url= param", () => {
    const f = filterFor("skimlinks-redirectingat").regexFilter;
    assert.match("https://go.redirectingat.com/?url=https%3A%2F%2Fm.com&id=1", new RegExp(f));
    assert.doesNotMatch("https://go.skimresources.com/?url=https%3A%2F%2Fm.com", new RegExp(f));
    assert.ok(f.includes("redirectingat\\.com"));
  });

  test("Skimlinks skimresources rule matches go.skimresources.com and ?url= param", () => {
    const f = filterFor("skimlinks-skimresources").regexFilter;
    assert.match("https://go.skimresources.com/?url=https%3A%2F%2Fm.com", new RegExp(f));
    assert.doesNotMatch("https://go.redirectingat.com/?url=https%3A%2F%2Fm.com", new RegExp(f));
    assert.ok(f.includes("skimresources\\.com"));
  });

  test("ShareASale rule matches shareasale.com/r.cfm and ?urllink= param", () => {
    const f = filterFor("shareasale").regexFilter;
    assert.match("https://shareasale.com/r.cfm?u=1&urllink=https%3A%2F%2Fm.com", new RegExp(f));
    assert.match("https://www.shareasale.com/r.cfm?urllink=https%3A%2F%2Fm.com", new RegExp(f));
    assert.ok(f.includes("shareasale\\.com"));
    assert.ok(f.includes("urllink"));
  });

  test("Rakuten rule matches click.linksynergy.com/deeplink and ?murl= param", () => {
    const f = filterFor("rakuten").regexFilter;
    assert.match(
      "https://click.linksynergy.com/deeplink?id=1&murl=https%3A%2F%2Fm.com",
      new RegExp(f),
    );
    assert.ok(f.includes("linksynergy\\.com"));
    assert.ok(f.includes("murl"));
  });
});

// ---------------------------------------------------------------------------
// buildDnrRules — defensive: regex hostPatterns are never emitted
// ---------------------------------------------------------------------------
describe("buildDnrRules — defensive against regex hostPatterns", () => {
  test("an entry with a RegExp hostPattern is filtered out even if its id is allowlisted", () => {
    const fakeImpact = {
      id: "facebook-l", // pretend an allowlisted id, but with a regex hostPattern
      name: "Bad Facebook",
      hostPatterns: [/^[a-z]+\.example\.com$/],
      pathPatterns: null,
      extract: () => null,
    };
    const rules = buildDnrRules([fakeImpact]);
    assert.equal(rules.length, 0, "must not emit a rule for entries with regex hostPatterns");
  });

  test("Impact (regex hostPatterns, id not in allowlist) is never emitted", () => {
    const rules = buildDnrRules(WRAPPERS);
    // No rule's regex should mention pxf.io.
    for (const rule of rules) {
      assert.doesNotMatch(rule.condition.regexFilter, /pxf/i);
    }
  });
});

// ---------------------------------------------------------------------------
// buildDnrRules — idempotency
// ---------------------------------------------------------------------------
describe("buildDnrRules — idempotency", () => {
  test("two calls with the same input produce deeply equal output", () => {
    const a = buildDnrRules(WRAPPERS);
    const b = buildDnrRules(WRAPPERS);
    assert.deepEqual(a, b);
  });

  test("two calls produce identical JSON serialization", () => {
    const a = JSON.stringify(buildDnrRules(WRAPPERS));
    const b = JSON.stringify(buildDnrRules(WRAPPERS));
    assert.equal(a, b);
  });
});

// ---------------------------------------------------------------------------
// validateDnrRules
// ---------------------------------------------------------------------------
describe("validateDnrRules", () => {
  test("ok=true for the canonical 7-rule output", () => {
    const result = validateDnrRules(buildDnrRules(WRAPPERS));
    assert.equal(result.ok, true);
    assert.deepEqual(result.warnings, []);
  });

  test("warns when rule count exceeds maxRuleCount", () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => ({
      id: i + 1,
      priority: 1,
      action: { type: "redirect", redirect: { regexSubstitution: "\\1" } },
      condition: {
        regexFilter: `^https://e${i}\\.com/.*[?&]p=([^&]+)`,
        resourceTypes: ["main_frame", "sub_frame"],
      },
    }));
    const result = validateDnrRules(tooMany, { maxRuleCount: 10 });
    assert.equal(result.ok, false);
    assert.ok(result.warnings.some((w) => /rule count/i.test(w)));
  });

  test("warns on duplicate IDs", () => {
    const dup = [
      {
        id: 1,
        priority: 1,
        action: { type: "redirect", redirect: { regexSubstitution: "\\1" } },
        condition: {
          regexFilter: "^https://a\\.com/.*[?&]p=([^&]+)",
          resourceTypes: ["main_frame", "sub_frame"],
        },
      },
      {
        id: 1,
        priority: 1,
        action: { type: "redirect", redirect: { regexSubstitution: "\\1" } },
        condition: {
          regexFilter: "^https://b\\.com/.*[?&]p=([^&]+)",
          resourceTypes: ["main_frame", "sub_frame"],
        },
      },
    ];
    const result = validateDnrRules(dup);
    assert.equal(result.ok, false);
    assert.ok(result.warnings.some((w) => /duplicate/i.test(w)));
  });

  test("warns on uncompilable regexFilter", () => {
    const bad = [
      {
        id: 1,
        priority: 1,
        action: { type: "redirect", redirect: { regexSubstitution: "\\1" } },
        condition: {
          regexFilter: "(unterminated",
          resourceTypes: ["main_frame", "sub_frame"],
        },
      },
    ];
    const result = validateDnrRules(bad);
    assert.equal(result.ok, false);
    assert.ok(result.warnings.some((w) => /regex/i.test(w)));
  });
});
