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

// #1439: an unwrap-only result (the wrapper was removed, the destination had
// nothing else to strip) must surface as "cleaned". Otherwise the `untouched`
// guard drops it: Firefox leaves the navigation on the wrapper, and the SW
// stats/Activity gate never records it.
describe("Firefox webRequest stripper — redirect wrappers with a clean destination (#1439)", () => {
  const GOOGLE_URL = "https://www.google.com/url?sa=t&url=https%3A%2F%2Fexample.com%2F%3Fa%3D1&ved=2ah&usg=AOv";
  const FB_CLEAN_DEST = "https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2F%3Fx%3D1&h=AT0";

  test("google.com/url?url= with a clean destination is redirected to the destination", () => {
    const decision = strip(GOOGLE_URL);
    assert.ok(decision, "the wrapper must be redirected, not passed through");
    assert.equal(decision.cleanUrl, "https://example.com/?a=1");
    assert.equal(decision.result.action, "cleaned");
  });

  test("l.facebook.com/l.php?u= with a clean destination is redirected to the destination", () => {
    const decision = strip(FB_CLEAN_DEST);
    assert.ok(decision, "the wrapper must be redirected, not passed through");
    assert.equal(decision.cleanUrl, "https://example.com/?x=1");
  });

  test("processUrl reports an unwrap-only result as cleaned (stats + Activity parity)", () => {
    const r = processUrl(GOOGLE_URL, makePrefs(), DOMAIN_RULES, undefined, undefined, "", [], []);
    assert.equal(r.cleanUrl, "https://example.com/?a=1");
    assert.equal(r.action, "cleaned");
  });

  test("the cached-whitelist branch (handleWhitelistedDomain) also reports an unwrap-only result as cleaned", () => {
    const prefs = makePrefs();
    // The SW cache carries pre-parsed lists; a param-less entry for the
    // destination routes processUrl through handleWhitelistedDomain.
    prefs._parsedWhitelist = [parseListEntry("example.com")];
    const r = processUrl(GOOGLE_URL, prefs, DOMAIN_RULES, undefined, undefined, "", [], []);
    assert.equal(r.cleanUrl, "https://example.com/?a=1");
    assert.equal(r.action, "cleaned");
  });

  test("a direct, already-clean URL stays untouched (no false promotion)", () => {
    const r = processUrl("https://example.com/?a=1", makePrefs(), DOMAIN_RULES, undefined, undefined, "", [], []);
    assert.equal(r.action, "untouched");
    assert.equal(strip("https://example.com/?a=1"), null);
  });
});

// #1437: the "Unwrap redirect wrappers" toggle (unwrapRedirects) must govern
// every processUrl-based path (link click, copy-clean, context menu, Firefox
// navigation stripper), not only the DNR ruleset and the content script's
// redirect unwrap.
describe("unwrapRedirects:false leaves redirect wrappers wrapped on every processUrl path (#1437)", () => {
  const off = () => makePrefs({ unwrapRedirects: false });
  const FB = "https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2F%3Ffbclid%3Dabc%26x%3D1&h=AT0";
  const GOOGLE_URL = "https://www.google.com/url?sa=t&url=https%3A%2F%2Fexample.com%2F%3Fa%3D1";

  test("processUrl keeps l.facebook.com/l.php?u= wrapped", () => {
    const r = processUrl(FB, off(), DOMAIN_RULES, undefined, undefined, "", [], []);
    const out = new URL(r.cleanUrl);
    assert.equal(out.hostname, "l.facebook.com");
    assert.ok(out.searchParams.get("u"), "the wrapped destination must still be there");
  });

  test("processUrl keeps google.com/url?url= wrapped", () => {
    const r = processUrl(GOOGLE_URL, off(), DOMAIN_RULES, undefined, undefined, "", [], []);
    const out = new URL(r.cleanUrl);
    assert.equal(out.hostname, "www.google.com");
    assert.equal(out.pathname, "/url");
  });

  test("computeNavigationStrip does not redirect the navigation off the wrapper", () => {
    for (const url of [FB, GOOGLE_URL]) {
      const d = strip(url, off());
      if (d) assert.notEqual(new URL(d.cleanUrl).hostname, "example.com", `must not unwrap ${url} with the toggle off`);
    }
  });

  test("tracking params on the wrapper URL itself are still stripped", () => {
    const url = "https://www.google.com/url?url=https%3A%2F%2Fexample.com%2F&utm_source=x";
    const r = processUrl(url, off(), DOMAIN_RULES, undefined, undefined, "", [], []);
    const out = new URL(r.cleanUrl);
    assert.equal(out.hostname, "www.google.com");
    assert.equal(out.searchParams.has("utm_source"), false);
    assert.equal(out.searchParams.get("url"), "https://example.com/");
  });

  test("the canonical-extractor tier (which depends on wrapper detection) is off too", () => {
    const url = "https://www.google.com/url?url=opaque-token";
    const bundle = { linkCanonical: "https://example.com/article", jsonLdId: null };
    // Sanity: with the toggle on, this opaque wrapper resolves via the canonical tier.
    const on = processUrl(url, makePrefs(), DOMAIN_RULES, bundle, undefined, "", [], []);
    assert.equal(on.cleanUrl, "https://example.com/article");
    const r = processUrl(url, off(), DOMAIN_RULES, bundle, undefined, "", [], []);
    assert.equal(new URL(r.cleanUrl).hostname, "www.google.com");
  });

  test("default (pref true) still unwraps", () => {
    const r = processUrl(GOOGLE_URL, makePrefs({ unwrapRedirects: true }), DOMAIN_RULES, undefined, undefined, "", [], []);
    assert.equal(r.cleanUrl, "https://example.com/?a=1");
  });
});
