/**
 * MUGA — regression guard: README facts a reader can check against the
 * product (#1424, #1435).
 *
 *   (A) No first-setup flow: onboarding has no settings, so no section may
 *       claim features are "configured during first setup", and the removed
 *       pre-navigation toggle (ADR-0011) is not listed as an option.
 *   (B) UI names: list and switch names match the Settings labels.
 *   (C) Permissions: every permission in both manifests is named, and the
 *       README does not say "Nothing else".
 *   (D) Programs: the preserved-program count matches the code (query-param
 *       table + path rules + Steam Curator's preserveParams).
 *   (E) Backronyms match the ones muga.app rotates.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PREF_DEFAULTS } from "../../src/lib/prefs.js";
import { AFFILIATE_PATTERNS } from "../../src/lib/affiliates.js";
import en from "../../src/lib/locales/en.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const README = read("README.md");

describe("(A) no first-setup flow and no removed toggle", () => {
  test("source of truth: the listed features are on by default", () => {
    for (const key of ["blockPings", "ampRedirect", "unwrapRedirects"]) {
      assert.equal(PREF_DEFAULTS[key], true, `${key} defaults to true`);
    }
  });
  test("no 'configured during first setup' heading", () => {
    assert.ok(!/configured during first setup/i.test(README));
  });
  test("pre-navigation cleaning is not presented as an option", () => {
    assert.ok(!/\*\*Pre-navigation cleaning\*\*/.test(README));
  });
});

describe("(B) README uses the names the UI uses", () => {
  test("beacon switch label", () => {
    assert.ok(!/Block `<a ping>` beacons/.test(README));
    assert.ok(README.includes(en.row_pings_label));
  });
  test("list names", () => {
    assert.ok(!/\b(?:black|white)list/i.test(README), "Settings calls them Blocked domains / Protected tags & domains");
    assert.ok(README.includes("Blocked domains"));
    assert.ok(README.includes("Protected tags & domains"));
  });
  test("README does not claim the popup shows a preserved-referral line (removed, 2026-09-24)", () => {
    assert.ok(!/popup shows a "Creator referral preserved" badge/.test(README));
    assert.ok(!/the popup says "Looks like a creator referral/i.test(README));
  });
  test("stripAllAffiliates is listed once", () => {
    assert.ok(!/Strip all affiliate parameters \(opt-in\)/.test(README));
  });
});

describe("(C) README names every manifest permission", () => {
  const mv3 = JSON.parse(read("src/manifest.json"));
  const mv2 = JSON.parse(read("src/manifest.v2.json"));
  const perms = new Set(
    [...mv3.permissions, ...mv2.permissions].filter((p) => p !== "<all_urls>")
  );
  for (const p of perms) {
    test(p, () => assert.ok(README.includes(`\`${p}\``), `README should name \`${p}\``));
  }
  test("no 'Nothing else'", () => {
    assert.ok(!/Nothing else\./.test(README));
  });
  test("mentions the optional host permissions", () => {
    assert.ok(/optional host permissions/i.test(README));
  });
});

describe("(D) README program count matches the code", () => {
  const pathRules = JSON.parse(read("src/rules/path-affiliate-rules.json"));
  const domainRules = JSON.parse(read("src/rules/domain-rules.json"));
  const steam = domainRules.filter((r) => r.domain === "steampowered.com" && r.preserveParams?.length);
  const expected = AFFILIATE_PATTERNS.length + pathRules.length + steam.length;
  test(`states ${expected} programs and names the path rules file`, () => {
    const m = README.match(/preserves creator affiliate tags on \*\*(\d+) programs\*\*/);
    assert.ok(m, "README should state the program count");
    assert.equal(Number(m[1]), expected);
    assert.ok(README.includes("src/rules/path-affiliate-rules.json"));
  });
});

describe("(E) backronyms match muga.app", () => {
  const landing = read("landing/index.html");
  const lines = [...landing.matchAll(/'(M[^']+\.)'/g)].map((m) => m[1]);
  test("landing rotator has three backronyms", () => assert.equal(lines.length, 3));
  for (const line of lines) {
    test(line, () => assert.ok(README.includes(line)));
  }
});
