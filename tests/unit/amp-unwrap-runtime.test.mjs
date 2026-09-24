/**
 * MUGA — AMP detours in the runtime cleaner (#1441).
 *
 * Chrome skips Google-hosted AMP at the network layer (amp_redirect DNR
 * ruleset). Firefox does not declare that ruleset, and its content-script
 * fallback only handles a publisher's own `amp.` subdomain, so the Google
 * shapes (google.<tld>/amp/s/ and the <publisher>.cdn.ampproject.org cache)
 * were never redirected there. processUrl now unwraps both shapes, gated on
 * the "Skip AMP detours" toggle (ampRedirect), so the Firefox navigation
 * stripper, link clicks and copy-clean handle them on both browsers.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { processUrl, computeNavigationStrip, parseListEntry } from "../../src/lib/cleaner.js";
import { unwrapAmpUrl } from "../../src/lib/amp-unwrap.js";

function makePrefs(overrides = {}) {
  const prefs = {
    enabled: true,
    onboardingDone: true,
    blacklist: [],
    whitelist: [],
    customParams: [],
    remoteParams: [],
    disabledCategories: [],
    stripAllAffiliates: false,
    notifyForeignAffiliate: false,
    ampRedirect: true,
    ...overrides,
  };
  prefs._parsedBlacklist = prefs.blacklist.map(parseListEntry);
  prefs._parsedWhitelist = prefs.whitelist.map(parseListEntry);
  return prefs;
}

const run = (url, prefs = makePrefs()) => processUrl(url, prefs, [], undefined, undefined, "", [], []);

describe("unwrapAmpUrl — pure shape matcher", () => {
  const CASES = [
    ["https://www.google.com/amp/s/example.com/article", "https://example.com/article"],
    ["https://google.com/amp/s/example.com/a?x=1", "https://example.com/a?x=1"],
    ["https://www.google.co.uk/amp/s/www.bbc.co.uk/news/amp/1", "https://www.bbc.co.uk/news/amp/1"],
    ["https://cdn.ampproject.org/c/s/example.com/article", "https://example.com/article"],
    ["https://www-bbc-com.cdn.ampproject.org/c/s/www.bbc.com/news/amp/x", "https://www.bbc.com/news/amp/x"],
    ["https://example-com.cdn.ampproject.org/v/s/example.com/a.amp.html?amp_js_v=0.1#h", "https://example.com/a.amp.html?amp_js_v=0.1#h"],
  ];
  for (const [input, expected] of CASES) {
    test(`${input} -> ${expected}`, () => {
      assert.equal(unwrapAmpUrl(new URL(input)), expected);
    });
  }

  const NOT_AMP = [
    "https://www.google.com/search?q=amp",
    "https://www.google.com/amp/example.com/article", // http origin shape, not handled by DNR either
    "https://google.evil.example/amp/s/example.com/a",
    "https://cdn.ampproject.org.evil.example/c/s/example.com/a",
    "https://a.b.cdn.ampproject.org/c/s/example.com/a",
    "https://example-com.cdn.ampproject.org/v0.js",
    "https://www.google.com/amp/s/",
    "https://www.google.com/amp/s/localhost/x",
    "https://example.com/amp/s/other.com/a",
  ];
  for (const input of NOT_AMP) {
    test(`not an AMP detour: ${input}`, () => {
      assert.equal(unwrapAmpUrl(new URL(input)), null);
    });
  }
});

describe("processUrl — AMP detours (#1441)", () => {
  test("google.com/amp/s/ is unwrapped and reported as cleaned", () => {
    const r = run("https://www.google.com/amp/s/example.com/article");
    assert.equal(r.cleanUrl, "https://example.com/article");
    assert.equal(r.action, "cleaned");
  });

  test("a per-publisher AMP cache URL is unwrapped, and the destination is then cleaned", () => {
    const r = run("https://example-com.cdn.ampproject.org/c/s/example.com/article?utm_source=x&id=7");
    assert.equal(r.cleanUrl, "https://example.com/article?id=7");
    assert.equal(r.action, "cleaned");
  });

  test("ampRedirect:false leaves AMP URLs alone", () => {
    const prefs = makePrefs({ ampRedirect: false });
    assert.equal(run("https://www.google.com/amp/s/example.com/article", prefs).action, "untouched");
    assert.equal(
      run("https://example-com.cdn.ampproject.org/c/s/example.com/article", prefs).cleanUrl,
      "https://example-com.cdn.ampproject.org/c/s/example.com/article",
    );
  });

  test("the Firefox navigation stripper redirects both Google AMP shapes", () => {
    for (const url of [
      "https://www.google.com/amp/s/example.com/article",
      "https://www-bbc-com.cdn.ampproject.org/c/s/www.bbc.com/news/amp/x",
    ]) {
      const d = computeNavigationStrip(url, makePrefs(), [], [], [], undefined);
      assert.ok(d, `${url} must be redirected`);
      assert.notEqual(new URL(d.cleanUrl).hostname.endsWith("ampproject.org"), true);
      assert.notEqual(new URL(d.cleanUrl).hostname, "www.google.com");
    }
  });

  test("an allowlisted AMP host stays untouched", () => {
    const prefs = makePrefs({ whitelist: ["google.com"] });
    assert.equal(run("https://www.google.com/amp/s/example.com/article", prefs).action, "untouched");
  });
});
