/**
 * MUGA — Regression tests for #1095.
 *
 * Bug: a trailing dot in the hostname (`www.amazon.com.` — a valid FQDN
 * that browsers and DNS resolvers treat as IDENTICAL to `www.amazon.com`,
 * the trailing dot marking the DNS root) bypassed every host-matching path
 * in the cleaner:
 *
 *   - `getPatternsForHost()` (src/lib/affiliates.js) only strips a leading
 *     `www.` before its index lookup, so `amazon.com.` never resolves to
 *     the Amazon affiliate patterns — stripAllAffiliates silently found NO
 *     patterns for the host and left a foreign `tag` value completely
 *     untouched.
 *   - `domainMatches()` / `isSiteFullyExempt()` (blacklist, whitelist,
 *     pause-by-site) have the same gap — a domain-only whitelist/blacklist
 *     entry for "amazon.com" never matched "amazon.com.".
 *
 * Fix: `processUrl` normalizes the hostname used for ALL matching decisions
 * (the `earlyHostname` used for the full-site-exemption check, and the main
 * `hostname` threaded through blacklist/whitelist/affiliate-pattern lookups)
 * by stripping a single trailing dot, mirroring the existing `www.` strip.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { processUrl } from "../../src/lib/cleaner.js";

const require = createRequire(import.meta.url);
const domainRules = require("../../src/rules/domain-rules.json");

const PREFS = {
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  stripAllAffiliates: false,
  blacklist: [],
  whitelist: [],
};

describe("#1095 — trailing-dot FQDN bypasses host matching", () => {
  test("stripAllAffiliates strips a foreign tag on a trailing-dot host", () => {
    const raw = "https://www.amazon.com./dp/X?tag=evil-20";
    const { cleanUrl } = processUrl(
      raw,
      { ...PREFS, stripAllAffiliates: true },
      domainRules,
    );

    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.has("tag"), false, "foreign tag must be stripped on the trailing-dot host, same as the dotless host");
  });

  test("a domain-only whitelist entry (pause-by-site) matches the trailing-dot host", () => {
    const raw = "https://www.amazon.com./dp/X?utm_source=newsletter";
    const { action, cleanUrl } = processUrl(
      raw,
      { ...PREFS, whitelist: ["amazon.com"] },
      domainRules,
    );

    assert.equal(action, "untouched", "domain-only whitelist must fully exempt the trailing-dot host");
    assert.equal(cleanUrl, raw, "exempt site must be returned completely unmodified");
  });

  test("a domain-only blacklist entry wipes params on the trailing-dot host", () => {
    const raw = "https://www.amazon.com./dp/X?tag=creator-21&utm_source=x";
    const { action, cleanUrl } = processUrl(
      raw,
      { ...PREFS, blacklist: ["amazon.com"] },
      domainRules,
    );

    assert.equal(action, "blacklisted", "domain-only blacklist must match the trailing-dot host");
    assert.equal(new URL(cleanUrl).search, "", "all params must be wiped on the blacklisted trailing-dot host");
  });
});
