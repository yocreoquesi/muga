/**
 * MUGA — canonical mixed-case tracker spellings in the GENERATED DNR ruleset (#1436).
 *
 * Chrome's declarativeNetRequest removes query params by exact, case-sensitive
 * comparison (Chromium GetModifiedQuery: std::binary_search on the raw key).
 * Every MUGA param source is lowercase, so without the canonical spellings a
 * real-world `hsCtaTracking`, `ScCid` or `__mk_es_ES` reached the server on the
 * first request on Chrome. These tests read src/rules/tracking-params.json (the
 * file Chrome actually loads), not the generator's inputs.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DNR_CASE_VARIANTS, withCaseVariants } from "../../tools/dnr-case-variants.mjs";
import { TRACKING_PARAMS } from "../../src/lib/affiliates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const RULES = JSON.parse(readFileSync(join(ROOT, "src/rules/tracking-params.json"), "utf8"));
const DOMAIN_RULES = JSON.parse(readFileSync(join(ROOT, "src/rules/domain-rules.json"), "utf8"));

const removeOf = (rule) => rule.action?.redirect?.transform?.queryTransform?.removeParams ?? [];
const stripRules = RULES.filter((r) => r.action?.type === "redirect" && removeOf(r).length > 0);

/** The one param-stripping rule that matches a host (host-only rules). */
function ruleForHost(host) {
  const under = (h, ds) => (ds ?? []).some((d) => h === d || h.endsWith("." + d));
  const matches = stripRules.filter((r) => {
    const c = r.condition;
    if (c.urlFilter && c.urlFilter !== "*") return false; // path-scoped rules: not host-wide
    if (c.requestDomains && !under(host, c.requestDomains)) return false;
    if (c.excludedRequestDomains && under(host, c.excludedRequestDomains)) return false;
    return true;
  });
  assert.equal(matches.length, 1, `exactly one host-wide strip rule must match ${host}`);
  return matches[0];
}

describe("DNR case variants — table hygiene", () => {
  const known = new Set(TRACKING_PARAMS.map((p) => p.toLowerCase()));
  for (const rule of DOMAIN_RULES) for (const p of rule.stripParams ?? []) known.add(p.toLowerCase());

  for (const [lc, forms] of Object.entries(DNR_CASE_VARIANTS)) {
    test(`${lc}: lowercase key, real variants, known param`, () => {
      assert.equal(lc, lc.toLowerCase(), "keys are the lowercase param");
      assert.ok(known.has(lc), `${lc} must be a TRACKING_PARAM or a domain stripParam (no dead entries)`);
      assert.ok(forms.length > 0);
      for (const v of forms) {
        assert.equal(v.toLowerCase(), lc, `${v} must be a case variant of ${lc}`);
        assert.notEqual(v, lc, `${v} must differ from the lowercase form`);
      }
    });
  }
});

describe("DNR case variants — withCaseVariants", () => {
  test("appends variants after the originals, sorted, without duplicates", () => {
    assert.deepEqual(
      withCaseVariants(["utm_source", "sccid", "hsctatracking", "ScCid"]),
      ["utm_source", "sccid", "hsctatracking", "ScCid", "hsCtaTracking"],
    );
  });

  test("never adds a variant whose lowercase form the list does not remove", () => {
    assert.deepEqual(withCaseVariants(["utm_source"]), ["utm_source"]);
  });
});

describe("DNR case variants — generated ruleset (what Chrome loads)", () => {
  test("every strip rule that removes a lowercase param also removes its canonical spellings", () => {
    for (const rule of stripRules) {
      const set = new Set(removeOf(rule));
      for (const [lc, forms] of Object.entries(DNR_CASE_VARIANTS)) {
        if (!set.has(lc)) continue;
        for (const v of forms) {
          assert.ok(set.has(v), `rule ${rule.id} removes "${lc}" but not "${v}"`);
        }
      }
    }
  });

  test("no rule removes a variant whose lowercase form it keeps (a preserve can never be widened)", () => {
    for (const rule of stripRules) {
      const set = new Set(removeOf(rule));
      for (const p of set) {
        if (p === p.toLowerCase()) continue;
        assert.ok(set.has(p.toLowerCase()), `rule ${rule.id} removes "${p}" without "${p.toLowerCase()}"`);
      }
    }
  });

  test("removeParams lists stay duplicate-free", () => {
    for (const rule of stripRules) {
      const list = removeOf(rule);
      assert.equal(new Set(list).size, list.length, `rule ${rule.id} has duplicate removeParams`);
    }
  });

  // Real-world spellings from #1436, checked against the rule that matches the host.
  const CASES = [
    ["www.example.com", "hsCtaTracking"],
    ["www.example.com", "ScCid"],
    ["www.example.com", "elqTrackId"],
    ["www.example.com", "elqCampaignId"],
    ["www.example.com", "omnisendContactID"],
    ["www.amazon.es", "__mk_es_ES"],
    ["www.amazon.de", "__mk_de_DE"],
    ["www.amazon.co.jp", "__mk_ja_JP"],
    ["www.nytimes.com", "referringSource"],
    ["www.bloomberg.com", "leadSource"],
  ];
  for (const [host, key] of CASES) {
    test(`${host}: the matching rule removes "${key}" exactly as spelled`, () => {
      const rule = ruleForHost(host);
      assert.ok(removeOf(rule).includes(key), `rule ${rule.id} matching ${host} keeps "${key}" on Chrome`);
    });
  }
});
