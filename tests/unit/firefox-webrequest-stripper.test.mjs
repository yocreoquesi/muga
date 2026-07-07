/**
 * MUGA — Firefox blocking-webRequest navigation stripper (computeNavigationStrip).
 *
 * On Firefox MV2, service-worker.js registers a blocking
 * webRequest.onBeforeRequest listener (onBeforeNavigateStrip) that strips
 * tracking params from top-level navigations by returning {redirectUrl} — the
 * real equivalent of Chrome's DNR, and (unlike DNR) the source of the Firefox
 * cleaned-URL counter. The listener delegates its decision to the pure,
 * chrome-free computeNavigationStrip in cleaner.js, so these tests exercise the
 * SAME code the listener runs (no divergence between test and production).
 *
 * They pin: (1) param parity with processUrl, (2) idempotency (the loop guard —
 * a clean URL is never redirected again), (3) the enabled/onboarding/allowlist
 * guards, (4) non-http pass-through, and (5) injection suppression (network layer
 * strips only, matching Chrome's DNR).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { computeNavigationStrip, processUrl, parseListEntry } from "../../src/lib/cleaner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const DOMAIN_RULES = JSON.parse(readFileSync(join(ROOT, "src/rules/domain-rules.json"), "utf8"));

/** Build a materialized prefs snapshot shaped like the SW's cachedPrefs. */
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
    injectOwnAffiliate: false,
    ...overrides,
  };
  prefs._parsedBlacklist = (prefs.blacklist || []).map(parseListEntry);
  prefs._parsedWhitelist = (prefs.whitelist || []).map(parseListEntry);
  return prefs;
}

const strip = (url, prefs = makePrefs()) =>
  computeNavigationStrip(url, prefs, DOMAIN_RULES, [], [], undefined);

describe("Firefox webRequest stripper — param parity with processUrl", () => {
  test("strips the same params processUrl would (single source of truth)", () => {
    const url = "https://example.com/p?utm_source=nl&gclid=abc&keep=yes";
    const prefs = makePrefs();
    const decision = strip(url, prefs);
    // The listener suppresses injection/notify — mirror that when computing the
    // reference so the comparison is apples-to-apples.
    const ref = processUrl(url, prefs, DOMAIN_RULES, undefined, undefined, "", [], []);
    assert.ok(decision, "a dirty URL must yield a redirect decision");
    assert.equal(decision.cleanUrl, ref.cleanUrl);
    const params = new URL(decision.cleanUrl).searchParams;
    assert.equal(params.has("utm_source"), false, "utm_source must be stripped");
    assert.equal(params.has("gclid"), false, "gclid must be stripped");
    assert.equal(params.get("keep"), "yes", "non-tracking params must survive");
  });

  test("strips multiple UTM params at once", () => {
    const decision = strip("https://example.com/?utm_source=a&utm_medium=b&utm_campaign=c");
    assert.ok(decision);
    assert.equal(new URL(decision.cleanUrl).search, "");
  });
});

describe("Firefox webRequest stripper — no redirect when nothing to strip", () => {
  test("a clean URL returns null (no redirect issued)", () => {
    assert.equal(strip("https://example.com/page?keep=yes&ok=1"), null);
  });

  test("a URL with no query returns null", () => {
    assert.equal(strip("https://example.com/page"), null);
  });
});

describe("Firefox webRequest stripper — idempotency (loop guard)", () => {
  test("feeding the cleaned URL back returns null — Chrome's one-redirect-per-request is preserved without looping", () => {
    const first = strip("https://example.com/?utm_source=a&gclid=b&keep=1");
    assert.ok(first, "first pass strips");
    const second = strip(first.cleanUrl);
    assert.equal(second, null, "the clean URL must not be redirected again");
  });
});

describe("Firefox webRequest stripper — guards", () => {
  test("returns null when MUGA is disabled", () => {
    assert.equal(strip("https://example.com/?utm_source=a", makePrefs({ enabled: false })), null);
  });

  test("returns null before onboarding is complete", () => {
    assert.equal(strip("https://example.com/?utm_source=a", makePrefs({ onboardingDone: false })), null);
  });

  test("returns null on a fully-allowlisted (whitelisted) domain", () => {
    // A domain-only whitelist entry fully exempts the site — the stripper must
    // not touch it, mirroring the DNR allowlist "allow" rules on Chrome.
    const prefs = makePrefs({ whitelist: ["example.com"] });
    assert.equal(strip("https://example.com/?utm_source=a&gclid=b", prefs), null);
  });
});

describe("Firefox webRequest stripper — non-http and malformed pass through", () => {
  for (const url of ["chrome://extensions", "moz-extension://abc/x", "data:text/html,hi", "about:blank", "ftp://h/x"]) {
    test(`returns null for non-http URL: ${url}`, () => {
      assert.equal(strip(url), null);
    });
  }

  test("returns null for a non-string url", () => {
    assert.equal(computeNavigationStrip(undefined, makePrefs(), DOMAIN_RULES, [], [], undefined), null);
  });
});

describe("Firefox webRequest stripper — injection is suppressed (network layer strips only, like DNR)", () => {
  test("with injectOwnAffiliate on, the redirect target is the strip-only URL (no tag injected at the network layer)", () => {
    const url = "https://example.com/?utm_source=a&keep=1";
    const withInject = strip(url, makePrefs({ injectOwnAffiliate: true }));
    const withoutInject = strip(url, makePrefs({ injectOwnAffiliate: false }));
    assert.ok(withInject);
    assert.ok(withoutInject);
    // Suppressing injection means both produce the identical strip-only result.
    assert.equal(withInject.cleanUrl, withoutInject.cleanUrl);
    assert.equal(withInject.result.action !== "injected", true, "network strip must not be an injection");
  });
});
