/**
 * MUGA — host-scoped remote facts reach processUrl (#1409).
 *
 * The signed channel's scoped section (`remoteRulesMeta.scopedFacts`) used to
 * reach only the DNR navigation rules. Every path that cleans through
 * processUrl instead (copy-clean, context menu, selection, the PROCESS_URL
 * message, previews) kept a scoped tracking param on exactly the host the
 * payload says to strip it from. The service worker now passes the facts on
 * `prefs.remoteScopedFacts`, next to `prefs.remoteParams`, and processUrl
 * strips the host's scoped params after the preserve and affiliate checks,
 * exactly like the global remote params.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { processUrl } from "../../src/lib/cleaner.js";
import { buildScopedDnrRules } from "../../src/lib/remote-rules.js";
import { scopedParamsForHostname } from "../../src/lib/scoped-params.js";
import { cleanForPreview } from "../../src/lib/cleaning-context.js";
import { PREF_DEFAULTS } from "../../src/lib/prefs.js";

const FACTS = [
  { param: "_1ld", hosts: ["boosty.to"] },
  { param: "_1lp", hosts: ["boosty.to"] },
  { param: "sc_src", hosts: ["shop.example.org", "other.example"] },
];

const swPrefs = (overrides = {}) => ({
  ...PREF_DEFAULTS,
  onboardingDone: true,
  notifyForeignAffiliate: false,
  remoteParams: [],
  remoteScopedFacts: FACTS,
  ...overrides,
});

const run = (url, prefs = swPrefs(), domainRules = []) =>
  processUrl(url, prefs, domainRules, undefined, undefined, "", [], []);

/** Chrome's DNR outcome for the scoped rules alone (case-sensitive, like Chrome). */
function dnrScopedStrip(rawUrl, facts) {
  const u = new URL(rawUrl);
  const under = (h, ds) => ds.some((d) => h === d || h.endsWith("." + d));
  const rule = buildScopedDnrRules(facts).find((r) => under(u.hostname, r.condition.requestDomains));
  if (!rule) return rawUrl;
  for (const p of rule.action.redirect.transform.queryTransform.removeParams) u.searchParams.delete(p);
  return u.toString();
}

describe("scopedParamsForHostname — same suffix semantics as the DNR requestDomains", () => {
  test("exact host and subdomains match; look-alikes and parents do not", () => {
    assert.deepEqual([...scopedParamsForHostname("boosty.to", FACTS)].sort(), ["_1ld", "_1lp"]);
    assert.deepEqual([...scopedParamsForHostname("www.boosty.to", FACTS)].sort(), ["_1ld", "_1lp"]);
    assert.equal(scopedParamsForHostname("notboosty.to", FACTS).size, 0);
    assert.equal(scopedParamsForHostname("example.org", FACTS).size, 0);
    assert.deepEqual([...scopedParamsForHostname("SHOP.example.org", FACTS)], ["sc_src"]);
  });

  test("malformed input yields nothing", () => {
    assert.equal(scopedParamsForHostname("boosty.to", undefined).size, 0);
    assert.equal(scopedParamsForHostname("boosty.to", [null, { param: 1, hosts: "x" }]).size, 0);
    assert.equal(scopedParamsForHostname("", FACTS).size, 0);
  });
});

describe("processUrl applies host-scoped remote facts (#1409)", () => {
  test("navigation-vs-copy parity: the scoped param DNR strips is stripped by processUrl too", () => {
    const url = "https://boosty.to/post?_1ld=abc&utm_source=x&keep=1";
    const copy = run(url);
    const nav = dnrScopedStrip(url, FACTS);
    assert.equal(new URL(nav).searchParams.has("_1ld"), false, "sanity: the DNR scoped rule strips it");
    assert.equal(new URL(copy.cleanUrl).searchParams.has("_1ld"), false, "copy-clean must strip it too");
    assert.equal(copy.cleanUrl, "https://boosty.to/post?keep=1");
    assert.ok(copy.removedTracking.includes("_1ld"));
  });

  test("a subdomain of the anchored host is covered", () => {
    assert.equal(run("https://www.boosty.to/p?_1lp=z&keep=1").cleanUrl, "https://www.boosty.to/p?keep=1");
  });

  test("the same param on any other host is left alone (never widened)", () => {
    const url = "https://example.com/p?_1ld=abc&keep=1";
    assert.equal(run(url).cleanUrl, url);
  });

  test("a domain preserve still wins over a scoped fact", () => {
    const domainRules = [{ domain: "boosty.to", preserveParams: ["_1ld"] }];
    const r = run("https://boosty.to/post?_1ld=abc&_1lp=z", swPrefs(), domainRules);
    assert.equal(r.cleanUrl, "https://boosty.to/post?_1ld=abc");
  });

  test("without scoped facts nothing changes (default prefs shape)", () => {
    const url = "https://boosty.to/post?_1ld=abc";
    assert.equal(run(url, swPrefs({ remoteScopedFacts: undefined })).cleanUrl, url);
  });
});

// service-worker.js is browser-only (top-level chrome.* wiring), so its part is
// pinned with the codebase's source-guard pattern, like REQ-MERGE-5's.
describe("service worker hands the scoped facts to processUrl (#1409)", () => {
  const sw = readFileSync(new URL("../../src/background/service-worker.js", import.meta.url), "utf8")
    .replace(/\r\n/g, "\n");
  const cacheFn = sw.slice(sw.indexOf("function getPrefsWithCache()"), sw.indexOf("\n}\n", sw.indexOf("function getPrefsWithCache()")));

  test("getPrefsWithCache merges remoteRulesMeta.scopedFacts next to remoteParams", () => {
    assert.match(cacheFn, /prefs\.remoteScopedFacts = Array\.isArray\(remote\.remoteRulesMeta\?\.scopedFacts\)/);
  });

  test("a remoteRulesMeta change invalidates the prefs cache", () => {
    assert.match(sw, /if \(changes\.remoteParams \|\| changes\.remoteRulesMeta\) _invalidatePrefsCache\(\);/);
  });

  test("the getPrefs reply to content scripts does not carry the scoped facts", () => {
    const handler = sw.slice(sw.indexOf('if (message.type === "getPrefs")'), sw.indexOf("return true;", sw.indexOf('if (message.type === "getPrefs")')));
    assert.match(handler, /remoteScopedFacts: undefined/);
  });
});

describe("previews apply the context's scoped facts (#1409 via #1442)", () => {
  const ctx = { domainRules: [], pathStripRules: [], pathAffiliateRules: [], remoteParams: [], scopedFacts: FACTS };

  test("cleanForPreview strips the host's scoped params", () => {
    const prefs = { ...PREF_DEFAULTS, onboardingDone: true };
    const r = cleanForPreview("https://boosty.to/post?_1ld=abc&keep=1", prefs, ctx, { referrer: "" });
    assert.equal(r.cleanUrl, "https://boosty.to/post?keep=1");
  });

  test("remote rules off on this device: the preview applies no scoped facts", () => {
    const prefs = { ...PREF_DEFAULTS, onboardingDone: true, remoteRulesEnabled: false };
    const url = "https://boosty.to/post?_1ld=abc&keep=1";
    assert.equal(cleanForPreview(url, prefs, ctx, { referrer: "" }).cleanUrl, url);
  });
});
