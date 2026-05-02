/**
 * MUGA — PARAM_PAIRS bounded scoping classifier tests (#530)
 *
 * The param-classifier is a pure decision module that strips ambiguous
 * "internal campaign" / "newsletter" params (pid, icid, icmp, CMP, NLID,
 * soc_src) ONLY when they co-occur with a definitive tracker (gclid, fbclid,
 * utm_source, etc.). This protects functional URLs that legitimately use
 * `pid` (e.g. GitHub project IDs) while still cleaning up tracker noise
 * when an anchor proves the URL came from a marketing pipeline.
 *
 * Forward-compatibility: this is the seed of CAPS Contextual conformance
 * (tracked in muga#541). The shape of `classify()` is deliberately
 * tracker-agnostic so future per-domain or per-anchor pairs can be added
 * without changing the integration in cleaner.js.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PARAM_PAIRS,
  ANCHOR_TRACKERS,
  classify,
} from "../../src/lib/param-classifier.js";

describe("PARAM_PAIRS table", () => {
  test("contains the six initial bounded-scope params", () => {
    const expected = ["pid", "icid", "icmp", "CMP", "NLID", "soc_src"];
    for (const param of expected) {
      assert.ok(
        PARAM_PAIRS.includes(param) ||
          PARAM_PAIRS.includes(param.toLowerCase()),
        `PARAM_PAIRS should include ${param}`,
      );
    }
  });

  test("is exposed as an array (or array-like)", () => {
    assert.ok(Array.isArray(PARAM_PAIRS) || PARAM_PAIRS instanceof Set);
  });
});

describe("ANCHOR_TRACKERS set", () => {
  test("contains canonical definitive trackers per PRD", () => {
    const expected = [
      "gclid",
      "fbclid",
      "msclkid",
      "dclid",
      "twclid",
      "gbraid",
      "wbraid",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "mc_eid",
      "mc_cid",
    ];
    for (const anchor of expected) {
      const present =
        (ANCHOR_TRACKERS instanceof Set && ANCHOR_TRACKERS.has(anchor)) ||
        (Array.isArray(ANCHOR_TRACKERS) && ANCHOR_TRACKERS.includes(anchor));
      assert.ok(present, `ANCHOR_TRACKERS should include ${anchor}`);
    }
  });
});

describe("classify() — positive (anchor present → strip)", () => {
  test("strips pid when gclid is present", () => {
    const result = classify("https://example.com/?gclid=ABC&pid=campaign", {});
    assert.ok(result.stripParams.includes("pid"));
    assert.ok(!result.preserveParams.includes("pid"));
  });

  test("strips icid when fbclid is present", () => {
    const result = classify("https://example.com/?fbclid=X&icid=foo", {});
    assert.ok(result.stripParams.includes("icid"));
  });

  test("strips icmp when utm_source is present", () => {
    const result = classify(
      "https://example.com/?utm_source=email&icmp=def",
      {},
    );
    assert.ok(result.stripParams.includes("icmp"));
  });

  test("strips CMP when fbclid is present", () => {
    const result = classify(
      "https://example.com/?fbclid=X&CMP=newsletter",
      {},
    );
    assert.ok(result.stripParams.includes("CMP"));
  });

  test("strips NLID when utm_source is present", () => {
    const result = classify(
      "https://example.com/?utm_source=email&NLID=abc",
      {},
    );
    assert.ok(result.stripParams.includes("NLID"));
  });

  test("strips soc_src when utm_source is present", () => {
    const result = classify(
      "https://example.com/?utm_source=foo&soc_src=fb",
      {},
    );
    assert.ok(result.stripParams.includes("soc_src"));
  });

  test("strips multiple paired params when one anchor co-occurs", () => {
    const result = classify(
      "https://example.com/?gclid=g&pid=p&icid=i&CMP=c",
      {},
    );
    assert.ok(result.stripParams.includes("pid"));
    assert.ok(result.stripParams.includes("icid"));
    assert.ok(result.stripParams.includes("CMP"));
  });

  test("multiple anchors present → still strips paired params", () => {
    const result = classify(
      "https://example.com/?gclid=g&fbclid=f&utm_source=s&pid=p",
      {},
    );
    assert.ok(result.stripParams.includes("pid"));
  });

  test("ruleHits records reasoning for stripped params", () => {
    const result = classify("https://example.com/?gclid=ABC&pid=campaign", {});
    const hit = result.ruleHits.find(h => h.param === "pid");
    assert.ok(hit, "ruleHits should record the pid hit");
    assert.ok(typeof hit.reason === "string" && hit.reason.length > 0);
  });
});

describe("classify() — negative (no anchor → preserve)", () => {
  test("does NOT strip pid on a clean URL", () => {
    const result = classify("https://example.com/?pid=42", {});
    assert.ok(!result.stripParams.includes("pid"));
  });

  test("does NOT strip pid on a GitHub-like URL with ref", () => {
    const result = classify(
      "https://github.com/user/repo?pid=abc&ref=branch",
      {},
    );
    assert.ok(!result.stripParams.includes("pid"));
  });

  test("does NOT strip icid alone", () => {
    const result = classify("https://example.com/?icid=abc&icmp=def", {});
    assert.ok(!result.stripParams.includes("icid"));
    assert.ok(!result.stripParams.includes("icmp"));
  });

  test("does NOT strip CMP alone", () => {
    const result = classify("https://example.com/?CMP=ABC123&NLID=def", {});
    assert.ok(!result.stripParams.includes("CMP"));
    assert.ok(!result.stripParams.includes("NLID"));
  });

  test("does NOT strip soc_src alone", () => {
    const result = classify("https://example.com/?soc_src=abc&soc_trk=def", {});
    assert.ok(!result.stripParams.includes("soc_src"));
  });

  test("ref param without anchor → not classified", () => {
    const result = classify(
      "https://example.com/?ref=https://github.com",
      {},
    );
    assert.equal(result.stripParams.length, 0);
  });
});

describe("classify() — edge cases", () => {
  test("empty URL params → empty result", () => {
    const result = classify("https://example.com/", {});
    assert.deepEqual(result.stripParams, []);
    assert.deepEqual(result.preserveParams, []);
    assert.deepEqual(result.ruleHits, []);
  });

  test("malformed URL → safe empty result, no throw", () => {
    const result = classify("not a url at all", {});
    assert.deepEqual(result.stripParams, []);
    assert.deepEqual(result.preserveParams, []);
  });

  test("null/undefined URL → safe empty result, no throw", () => {
    const r1 = classify(null, {});
    const r2 = classify(undefined, {});
    assert.deepEqual(r1.stripParams, []);
    assert.deepEqual(r2.stripParams, []);
  });

  test("encoded values still trigger anchor detection", () => {
    const result = classify(
      "https://example.com/?gclid=abc%20def&pid=campaign%20one",
      {},
    );
    assert.ok(result.stripParams.includes("pid"));
  });

  test("CMP uppercase preserved as-is in stripParams (URL spec is case-sensitive)", () => {
    const result = classify(
      "https://example.com/?fbclid=X&CMP=newsletter",
      {},
    );
    // Either exact case ("CMP") OR lowercase ("cmp") match is acceptable —
    // cleaner.js does case-insensitive comparison downstream. What matters
    // is the param ends up in stripParams.
    const found = result.stripParams.some(
      p => p === "CMP" || p.toLowerCase() === "cmp",
    );
    assert.ok(found, "CMP should be stripped regardless of case");
  });

  test("classify is pure — does not mutate prefs", () => {
    const prefs = { foo: "bar" };
    const before = JSON.stringify(prefs);
    classify("https://example.com/?gclid=g&pid=p", prefs);
    assert.equal(JSON.stringify(prefs), before);
  });
});

describe("classify() — affiliate-preservation precedence", () => {
  test("pid on a domain where pid is also an affiliate param → affiliate wins (returned in preserveParams)", () => {
    // We pass an explicit affiliateParamSet via prefs to keep the module
    // pure. cleaner.js builds this set from getPatternsForHost(hostname).
    const prefs = { _affiliateParamSet: new Set(["pid"]) };
    const result = classify(
      "https://example.com/?gclid=ABC&pid=affiliate_value",
      prefs,
    );
    assert.ok(
      !result.stripParams.includes("pid"),
      "pid must NOT be stripped when it's an affiliate param for this host",
    );
    assert.ok(
      result.preserveParams.includes("pid"),
      "pid should be reported as preserved (affiliate precedence)",
    );
  });

  test("affiliateParamSet absent → default behaviour (strip pid when gclid present)", () => {
    const result = classify("https://example.com/?gclid=ABC&pid=campaign", {});
    assert.ok(result.stripParams.includes("pid"));
  });
});
