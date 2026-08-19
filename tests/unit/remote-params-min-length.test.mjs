/**
 * MUGA: remote params carry no host scope, so very short names must not enter.
 *
 * The signed payload is a flat list of names and buildRemoteRule() applies it
 * with `condition: { resourceTypes: ["main_frame"] }` — no urlFilter, no
 * requestDomains. Every name in it therefore strips on every site.
 *
 * Both upstream sources the ingestion pipeline reads disagree with that for
 * short names. Of the twenty one- and two-character names that reached the
 * list, ZERO are global rules in ClearURLs and only `si` sits in AdGuard
 * Filter 17's global bucket; the rest are scoped to single hosts — `_d` to
 * tiktok.com, `af` to aliexpress, `sa` to google, `u1` to walmart.com. So
 * ingesting one promotes "on tiktok.com, _d is a tracker" into "_d is a
 * tracker everywhere".
 *
 * That is how #1212 happened: `u` is ShareASale's affiliate id and a ClearURLs
 * rule scoped to tweakers and LinkedIn Learning, and it was being stripped on
 * shareasale.com, destroying the creator's attribution on a host whose entire
 * contract is to pass through untouched.
 *
 * Host-scoped facts belong in src/rules/domain-rules.json, which matches on
 * hostname suffix. This file pins the floor that keeps them out of the global
 * list, and checks that the names removed in #1217 really did land there
 * rather than simply being dropped.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { MIN_PARAM_LEN, validateParams } from "../../src/lib/remote-rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const NOW = Date.parse("2026-08-19T00:00:00.000Z");
const FRESH = { version: 0, published: null };
const OPTS = { newVersion: 1, newPublished: "2026-08-18T00:00:00.000Z" };

describe("remote params: the minimum-length floor (#1217)", () => {
  test("the floor is 3, which is the shortest name that has never caused harm", () => {
    // Every name that reached production and had to be pulled was one or two
    // characters. Three-character entries already in the list are deliberately
    // left alone rather than swept up on a hunch.
    assert.equal(MIN_PARAM_LEN, 3);
  });

  test("a two-character param is rejected at runtime", () => {
    const result = validateParams(["_d"], FRESH, NOW, OPTS);
    assert.equal(result.ok, false, "`_d` is a tiktok.com rule upstream and must not apply globally");
  });

  test("a one-character param is rejected at runtime", () => {
    const result = validateParams(["u"], FRESH, NOW, OPTS);
    assert.equal(result.ok, false, "`u` is ShareASale's affiliate id on the host that matters (#1212)");
  });

  test("a three-character param still passes, so the floor is not over-tight", () => {
    const result = validateParams(["aqs"], FRESH, NOW, OPTS);
    assert.equal(result.ok, true, `expected "aqs" to survive; got ${result.code}`);
    assert.deepEqual(result.accepted, ["aqs"]);
  });
});

describe("the floor cannot drift between signing and runtime", () => {
  test("sign-rules.mjs imports MIN_PARAM_LEN from src/lib/remote-rules.js", () => {
    const tool = read("tools/sign-rules.mjs");
    assert.ok(
      /import\s*\{[^}]*MIN_PARAM_LEN[^}]*\}\s*from\s*["'][^"']*remote-rules\.js["']/s.test(tool),
      "sign-rules.mjs must import the floor rather than redeclare it, or a signed payload could " +
        "carry names the runtime then rejects (or worse, the other way round)",
    );
  });

  test("sign-rules.mjs does not redeclare MIN_PARAM_LEN inline", () => {
    const tool = read("tools/sign-rules.mjs");
    assert.ok(
      !/const\s+MIN_PARAM_LEN\s*=/.test(tool),
      "an inline copy is exactly the drift surface the denylist imports were introduced to close",
    );
  });
});

describe("the published list honours the floor", () => {
  test("no param in docs/rules/v1/params.json is shorter than the floor", () => {
    const published = JSON.parse(read("docs/rules/v1/params.json"));
    const tooShort = published.params.filter((p) => p.length < MIN_PARAM_LEN);
    assert.deepEqual(
      tooShort,
      [],
      `these names carry no host scope but strip everywhere: ${tooShort.join(", ")}. ` +
        `Move them to src/rules/domain-rules.json at the host their upstream rule declares.`,
    );
  });
});

describe("the removed names were re-homed, not just deleted (#1217)", () => {
  // Dropping them outright would have quietly reduced cleaning on the sites
  // where the upstream fact is true. Most were already present in
  // domain-rules.json at the right scope; these are the ones #1217 added.
  const EXPECTED = [
    ["tiktok.com", "_d"],
    ["tiktok.com", "_r"],
    ["tiktok.com", "_t"],
    ["aliexpress.com", "af"],
    ["aliexpress.com", "cv"],
    ["aliexpress.com", "dp"],
    ["google.com", "oq"],
    ["google.com", "sa"],
    ["youtube.com", "pp"],
    ["youtube.com", "si"],
    ["walmart.com", "u1"],
    ["flipkart.com", "fm"],
  ];

  test("each host-scoped name strips on the host its upstream rule declares", () => {
    const rules = JSON.parse(read("src/rules/domain-rules.json"));
    const missing = [];
    for (const [domain, param] of EXPECTED) {
      const entry = rules.find((r) => r.domain === domain);
      if (!entry || !(entry.stripParams ?? []).includes(param)) missing.push(`${param} on ${domain}`);
    }
    assert.deepEqual(missing, [], `re-homing lost these: ${missing.join(", ")}`);
  });

  test("nothing re-homed leaked back into the global list", () => {
    const published = JSON.parse(read("docs/rules/v1/params.json"));
    const leaked = EXPECTED.map(([, p]) => p).filter((p) => published.params.includes(p));
    assert.deepEqual(
      [...new Set(leaked)],
      [],
      `these are host-scoped and must live only in domain-rules.json: ${leaked.join(", ")}`,
    );
  });
});
