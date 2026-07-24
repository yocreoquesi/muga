/**
 * MUGA — Unit tests for isSiteFullyBlacklisted() / getFullyBlacklistedDomains()
 * (referer-beacon-privacy, PR 1: Foundation)
 *
 * These are structural clones of isSiteFullyExempt()/getFullyExemptDomains()
 * but read prefs.blacklist instead of prefs.whitelist. Per design D2, a
 * bare-domain blacklist entry (no `::param` suffix) marks a domain as
 * FORCE-suppressed for Referer/beacon purposes (later PRs wire the actual
 * DNR/webRequest enforcement — this slice only adds the pure predicates).
 *
 * Param-scoped entries ("example.com::tag::x") must NOT count — they only
 * protect one affiliate value, not a "treat this domain aggressively" signal.
 *
 * This slice is behavior-inert: no caller wires these predicates into any
 * enforcement path yet.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isSiteFullyBlacklisted, getFullyBlacklistedDomains } from "../../src/lib/cleaner.js";

describe("isSiteFullyBlacklisted — bare-domain match", () => {
  test("bare-domain blacklist entry matches the exact host", () => {
    assert.strictEqual(
      isSiteFullyBlacklisted("evil.com", { blacklist: ["evil.com"], whitelist: [] }),
      true,
    );
  });

  test("bare-domain blacklist entry matches a subdomain", () => {
    assert.strictEqual(
      isSiteFullyBlacklisted("www.evil.com", { blacklist: ["evil.com"], whitelist: [] }),
      true,
    );
    assert.strictEqual(
      isSiteFullyBlacklisted("sub.evil.com", { blacklist: ["evil.com"], whitelist: [] }),
      true,
    );
  });

  test("www-prefixed blacklist entry normalizes the same as a bare entry", () => {
    assert.strictEqual(
      isSiteFullyBlacklisted("evil.com", { blacklist: ["www.evil.com"], whitelist: [] }),
      true,
    );
  });

  test("non-matching host returns false", () => {
    assert.strictEqual(
      isSiteFullyBlacklisted("safe.com", { blacklist: ["evil.com"], whitelist: [] }),
      false,
    );
  });
});

describe("isSiteFullyBlacklisted — param-scoped entries are excluded", () => {
  test("a param-scoped entry (domain::param::value) does NOT count as a blacklist match", () => {
    assert.strictEqual(
      isSiteFullyBlacklisted("evil.com", { blacklist: ["evil.com::tag::abc"], whitelist: [] }),
      false,
    );
  });

  test("mixed list: bare entry still matches even alongside a param-scoped entry for a different domain", () => {
    const prefs = { blacklist: ["evil.com::tag::abc", "bad.com"], whitelist: [] };
    assert.strictEqual(isSiteFullyBlacklisted("bad.com", prefs), true);
    assert.strictEqual(isSiteFullyBlacklisted("evil.com", prefs), false);
  });
});

describe("isSiteFullyBlacklisted — malformed/absent input never throws (fail-safe = false)", () => {
  test("empty hostname returns false", () => {
    assert.strictEqual(isSiteFullyBlacklisted("", { blacklist: ["evil.com"] }), false);
  });

  test("null/undefined hostname returns false", () => {
    assert.strictEqual(isSiteFullyBlacklisted(null, { blacklist: ["evil.com"] }), false);
    assert.strictEqual(isSiteFullyBlacklisted(undefined, { blacklist: ["evil.com"] }), false);
  });

  test("non-string hostname returns false", () => {
    assert.strictEqual(isSiteFullyBlacklisted(42, { blacklist: ["evil.com"] }), false);
  });

  test("null/undefined/non-object prefs returns false", () => {
    assert.strictEqual(isSiteFullyBlacklisted("evil.com", null), false);
    assert.strictEqual(isSiteFullyBlacklisted("evil.com", undefined), false);
    assert.strictEqual(isSiteFullyBlacklisted("evil.com", "not an object"), false);
  });

  test("missing/non-array prefs.blacklist returns false, never throws", () => {
    assert.strictEqual(isSiteFullyBlacklisted("evil.com", {}), false);
    assert.strictEqual(isSiteFullyBlacklisted("evil.com", { blacklist: "not-an-array" }), false);
  });

  test("a malformed entry in the blacklist array is skipped, not thrown", () => {
    assert.doesNotThrow(() => {
      isSiteFullyBlacklisted("evil.com", { blacklist: [null, undefined, 42, "evil.com"] });
    });
    assert.strictEqual(
      isSiteFullyBlacklisted("evil.com", { blacklist: [null, undefined, 42, "evil.com"] }),
      true,
    );
  });
});

describe("isSiteFullyBlacklisted — allowlist/blacklist independence", () => {
  test("whitelist entries have no effect on the blacklist predicate (checked independently)", () => {
    // Same domain on BOTH lists: isSiteFullyBlacklisted only reads .blacklist —
    // the allowlist-wins precedence rule is enforced by CALLERS composing both
    // predicates (later PRs), not by this predicate itself.
    assert.strictEqual(
      isSiteFullyBlacklisted("both.com", { blacklist: ["both.com"], whitelist: ["both.com"] }),
      true,
    );
  });

  test("a domain only on the whitelist is not reported as blacklisted", () => {
    assert.strictEqual(
      isSiteFullyBlacklisted("good.com", { blacklist: [], whitelist: ["good.com"] }),
      false,
    );
  });
});

describe("getFullyBlacklistedDomains — bare-domain extraction", () => {
  test("returns the bare, deduped, lowercased domain list", () => {
    const domains = getFullyBlacklistedDomains({
      blacklist: ["Evil.com", "www.Evil.com", "bad.com"],
      whitelist: [],
    });
    assert.deepEqual([...domains].sort(), ["bad.com", "evil.com"]);
  });

  test("param-scoped entries are excluded from the domain list", () => {
    const domains = getFullyBlacklistedDomains({
      blacklist: ["evil.com::tag::abc", "bad.com"],
      whitelist: [],
    });
    assert.deepEqual(domains, ["bad.com"]);
  });

  test("malformed/absent prefs returns an empty array, never throws", () => {
    assert.deepEqual(getFullyBlacklistedDomains(null), []);
    assert.deepEqual(getFullyBlacklistedDomains(undefined), []);
    assert.deepEqual(getFullyBlacklistedDomains({}), []);
    assert.deepEqual(getFullyBlacklistedDomains({ blacklist: "not-an-array" }), []);
  });

  test("a malformed entry inside the blacklist array is skipped, not thrown", () => {
    assert.doesNotThrow(() => {
      getFullyBlacklistedDomains({ blacklist: [null, undefined, 42, "evil.com"] });
    });
    assert.deepEqual(
      getFullyBlacklistedDomains({ blacklist: [null, undefined, 42, "evil.com"] }),
      ["evil.com"],
    );
  });

  test("whitelist entries have no effect on the blacklisted-domains list", () => {
    const domains = getFullyBlacklistedDomains({ blacklist: ["evil.com"], whitelist: ["good.com"] });
    assert.deepEqual(domains, ["evil.com"]);
  });
});
