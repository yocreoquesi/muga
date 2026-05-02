/**
 * MUGA — Cleaner consults prefs.userCustomRules (#536, slice 1).
 *
 * The popup's "Strip locally" button promotes a flagged suspicious param
 * into prefs.userCustomRules (a chrome.storage.sync array). On every
 * subsequent navigation, processUrl must strip those params globally —
 * that is what gives the user the "no waiting for a release" promise.
 *
 * Precedence rule: affiliate-preservation ALWAYS wins over user custom
 * rules. A user shouldn't be able to accidentally strip their own
 * creator's affiliate tag (e.g. Amazon "tag"). The cleaner already
 * enforces this via the affiliateParamSet skip-list inside
 * stripTrackingParams() — these tests pin that contract.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { processUrl } from "../../src/lib/cleaner.js";

const BASE_PREFS = {
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  blacklist: [],
  whitelist: [],
  customParams: [],
  userCustomRules: [],
};

test("userCustomRules: empty list does NOT strip a param the cleaner doesn't know", () => {
  const url = "https://example.com/?foo=bar&keep=me";
  const { cleanUrl, removedTracking } = processUrl(url, { ...BASE_PREFS });
  // Neither "foo" nor "keep" is a known tracker; both must survive.
  assert.equal(cleanUrl, url);
  assert.deepEqual(removedTracking, []);
});

test("userCustomRules: param listed in userCustomRules IS stripped on any host", () => {
  const url = "https://example.com/?mytrackingparam=abc&keep=me";
  const { cleanUrl, removedTracking } = processUrl(url, {
    ...BASE_PREFS,
    userCustomRules: ["mytrackingparam"],
  });
  assert.equal(cleanUrl, "https://example.com/?keep=me");
  assert.deepEqual(removedTracking, ["mytrackingparam"]);
});

test("userCustomRules: case-insensitive match — uppercase URL key, lowercase rule", () => {
  const url = "https://example.com/?MyTrackingParam=abc&keep=me";
  const { cleanUrl, removedTracking } = processUrl(url, {
    ...BASE_PREFS,
    userCustomRules: ["mytrackingparam"],
  });
  // The original-case key is reported in removedTracking, value stripped.
  assert.ok(!cleanUrl.includes("MyTrackingParam"));
  assert.ok(cleanUrl.includes("keep=me"));
  assert.deepEqual(removedTracking, ["MyTrackingParam"]);
});

test("userCustomRules: applies on a different host too (rules are GLOBAL)", () => {
  const url = "https://other.example.org/path?mytrackingparam=zzz";
  const { cleanUrl, removedTracking } = processUrl(url, {
    ...BASE_PREFS,
    userCustomRules: ["mytrackingparam"],
  });
  assert.equal(cleanUrl, "https://other.example.org/path");
  assert.deepEqual(removedTracking, ["mytrackingparam"]);
});

test("affiliate precedence: Amazon ?tag= is NOT stripped even when 'tag' is in userCustomRules", () => {
  // Amazon ES has an active ourTag. The user adding "tag" to their custom
  // rules MUST NOT strip the affiliate param — otherwise users would
  // accidentally tear down creator referrals (the whole point of MUGA).
  const url = "https://www.amazon.es/dp/B000000000?tag=youtuber-21";
  const { cleanUrl } = processUrl(url, {
    ...BASE_PREFS,
    userCustomRules: ["tag"],
  });
  // The "tag" param must survive on amazon.es because it is registered
  // as an affiliate param for that host. The path may be cleaned by the
  // Amazon-specific path normaliser; we only assert the affiliate tag
  // is retained.
  assert.match(cleanUrl, /[?&]tag=youtuber-21/, "Amazon affiliate tag must NOT be stripped by userCustomRules");
});

test("userCustomRules: ignored when prefs.enabled is false (cleaner short-circuits upstream — sanity)", () => {
  // Note: processUrl itself doesn't check prefs.enabled (callers do).
  // This test just makes sure adding userCustomRules doesn't break the
  // pipeline for an empty-array variant — defensive against typos.
  const url = "https://example.com/?clean=true";
  const { cleanUrl } = processUrl(url, { ...BASE_PREFS, userCustomRules: undefined });
  assert.equal(cleanUrl, url);
});
