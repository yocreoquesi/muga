/**
 * MUGA — Unit tests for src/lib/wrapper-dnr-builder.js
 *
 * Verifies the pure DNR-rule builder used by scripts/generate-dnr-rules.mjs:
 *   - REGEX_PURE_WRAPPER_IDS lists the allowlisted wrapper ids (issue #449,
 *     slice B6)
 *   - buildDnrRules() converts the WRAPPERS table into valid DNR rule objects
 *     of the expected shape (regexFilter + regexSubstitution) — only for ids
 *     whose source wrapper still exists in WRAPPERS (defensive skip)
 *   - Each rule's regexFilter compiles as a JS RegExp
 *   - Each rule's regexFilter targets the correct host and param key for the
 *     wrapper it represents
 *   - Wrapper entries whose hostPatterns contain a RegExp (e.g. Impact) are
 *     never emitted as DNR rules — even if their id is added to the allowlist
 *   - validateDnrRules flags rule-count overshoot, duplicate IDs, and passes
 *     the canonical output
 *   - buildDnrRules is idempotent: same input → identical output (key order,
 *     numeric IDs, regex strings)
 *
 * Post-#907 note: REGEX_PURE_WRAPPER_IDS and the RECIPES table in
 * src/lib/wrapper-dnr-builder.js still list `skimlinks-redirectingat`,
 * `skimlinks-skimresources`, and `shareasale` — those three recipes are now
 * dead code. buildDnrRules looks up each recipe's sourceId ("skimlinks" /
 * "shareasale") in the WRAPPERS table by id; since #907 excludes both from
 * WRAPPERS (pass-through reclassification), the lookup always misses and the
 * recipe is skipped. Only facebook-l and facebook-lm still resolve to a
 * source, so buildDnrRules(WRAPPERS) now emits exactly 2 rules. This mirrors
 * the SKIMLINKS_SPEC_IDS/skimlinksMerged dead-code note in
 * src/lib/wrapper-engine.js — harmless, left in place.
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
  ];

  test("lists exactly the five allowlisted wrapper ids (awin retired #684, rakuten retired #692) — skimlinks/shareasale entries are dead since #907, see file header", () => {
    assert.deepEqual([...REGEX_PURE_WRAPPER_IDS].sort(), [...expected].sort());
  });

  test("has length 5", () => {
    assert.equal(REGEX_PURE_WRAPPER_IDS.length, 5);
  });
});

// ---------------------------------------------------------------------------
// buildDnrRules — happy path with the real WRAPPERS table
// ---------------------------------------------------------------------------
describe("buildDnrRules — full WRAPPERS table", () => {
  const rules = buildDnrRules(WRAPPERS);

  test("returns exactly 2 rules (facebook-l, facebook-lm — skimlinks/shareasale recipes are dead since #907)", () => {
    assert.equal(rules.length, 2);
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

  test("skimlinks-redirectingat/skimlinks-skimresources/shareasale recipes produce NO rule (#907 — sourceId missing from WRAPPERS)", () => {
    // These three ids are still allowlisted in REGEX_PURE_WRAPPER_IDS, but
    // their recipes' sourceId ("skimlinks" / "shareasale") no longer exists
    // in WRAPPERS since #907's pass-through reclassification. buildDnrRules
    // skips a recipe when bySourceId.get(recipe.sourceId) misses — see the
    // file header note. Only facebook-l and facebook-lm remain.
    assert.equal(rules.length, 2);
    for (const rule of rules) {
      assert.doesNotMatch(rule.condition.regexFilter, /redirectingat|skimresources|shareasale/i);
    }
  });

  test("no rule mentions linksynergy.com (Rakuten retired in #692)", () => {
    for (const rule of rules) {
      assert.doesNotMatch(rule.condition.regexFilter, /linksynergy/i);
    }
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
  test("ok=true for the canonical 2-rule output (post-#907)", () => {
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
