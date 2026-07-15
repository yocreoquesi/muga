/**
 * MUGA — Regression test for #1111 (audit-2026-07 follow-up).
 *
 * #1095 made the affiliate-pattern / blacklist / whitelist / pause-by-site
 * paths trailing-dot aware, but `stripTrackingParams` and
 * `detectPreservedAffiliate` still re-derived `url.hostname` raw, so a
 * trailing-dot FQDN skipped DOMAIN-SPECIFIC preserve/strip rules. This threads
 * the same `stripTrailingDot()` normalization into those two internal paths.
 *
 * Observable via a domain-scoped strip param (11st.co.kr's `xfrom`): it is only
 * stripped when the domain rule matches, so a trailing-dot host discriminates
 * the fix (survives before, stripped after).
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

describe("#1111 — domain-scoped strip rules apply on a trailing-dot host", () => {
  test("a domain-specific strip param is removed on the trailing-dot host, same as the dotless host", () => {
    const dotless = processUrl("https://11st.co.kr/p?xfrom=abc&keep=1", PREFS, domainRules).cleanUrl;
    const dotted = processUrl("https://11st.co.kr./p?xfrom=abc&keep=1", PREFS, domainRules).cleanUrl;

    // Sanity: the dotless host strips the domain-scoped param.
    assert.equal(new URL(dotless).searchParams.has("xfrom"), false, "xfrom must be stripped on 11st.co.kr");
    // The fix: the trailing-dot host behaves identically.
    assert.equal(new URL(dotted).searchParams.has("xfrom"), false, "xfrom must also be stripped on 11st.co.kr.");
    // A non-tracking param survives on both.
    assert.equal(new URL(dotted).searchParams.get("keep"), "1", "a functional param must survive");
  });
});
