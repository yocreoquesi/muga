/**
 * MUGA — Tests for content script patterns (cleaner.js)
 *
 * Verifies rewrite loop eviction strategy and MutationObserver optimization
 * by reading source code patterns.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cleanerSource = readFileSync(join(__dirname, "../../src/content/cleaner.js"), "utf8");

// ── Rewrite loop eviction ────────────────────────────────────────────────────

describe("Rewrite loop — time-based eviction", () => {
  test("evicts stale entries older than 2s", () => {
    assert.ok(
      cleanerSource.includes("now - val.firstTs > 2000"),
      "should delete entries older than 2000ms"
    );
  });

  test("starts eviction scan at a reasonable threshold", () => {
    assert.ok(
      cleanerSource.includes("_rewriteLog.size > 50"),
      "should trigger eviction scan when map exceeds 50 entries"
    );
  });

  test("keeps safety cap at 200 entries after eviction", () => {
    assert.ok(
      cleanerSource.includes("_rewriteLog.size > 200"),
      "should bulk-clear as safety net if still over 200 after eviction"
    );
  });

  test("does not bulk-clear as first resort", () => {
    // The eviction loop (delete stale) should appear BEFORE the safety-cap clear
    const evictPos = cleanerSource.indexOf("now - val.firstTs > 2000");
    const clearPos = cleanerSource.indexOf("_rewriteLog.size > 200");
    assert.ok(evictPos < clearPos, "time-based eviction should run before safety-cap clear");
  });
});

// ── MutationObserver ping blocking optimization ──────────────────────────────

describe("MutationObserver — ping blocking debounce", () => {
  test("handles attribute changes immediately (not batched)", () => {
    // Attribute ping removal must be synchronous to prevent clicks
    // before the next animation frame
    const observerBlock = cleanerSource.slice(
      cleanerSource.indexOf("new MutationObserver"),
      cleanerSource.indexOf("observer.observe")
    );
    const attrCheckPos = observerBlock.indexOf('"attributes"');
    const rafPos = observerBlock.indexOf("requestAnimationFrame");
    assert.ok(
      attrCheckPos < rafPos,
      "attribute removal should happen before rAF batching"
    );
  });

  test("batches childList mutations via requestAnimationFrame", () => {
    assert.ok(
      cleanerSource.includes("requestAnimationFrame"),
      "should use rAF to batch new-node ping removal"
    );
  });

  test("deduplicates rAF calls", () => {
    assert.ok(
      cleanerSource.includes("_pingBatchId"),
      "should track pending rAF to avoid duplicate scheduling"
    );
  });
});

describe("Temporal Dead Zone guard — _contentPrefs declaration ordering", () => {
  // Regression for bug reported on nukebg.app (issue #298): Firefox threw
  // "can't access lexical declaration '_contentPrefs' before initialization"
  // because event handlers registered early in the IIFE fired before the
  // let declaration line ran. Declarations MUST sit above the first reader.

  test("_contentPrefs is declared before any reader references it", () => {
    const declPos = cleanerSource.indexOf("let _contentPrefs");
    assert.ok(declPos > 0, "expected `let _contentPrefs` declaration");

    const firstReadPos = cleanerSource.indexOf("_contentPrefs?.");
    assert.ok(firstReadPos > 0, "expected at least one `_contentPrefs?.` reader");

    assert.ok(
      declPos < firstReadPos,
      "declaration must come before any reader to avoid Firefox TDZ"
    );
  });

  test("_contentPrefsPending is declared before first use", () => {
    const declPos = cleanerSource.indexOf("let _contentPrefsPending");
    assert.ok(declPos > 0, "expected `let _contentPrefsPending` declaration");

    const firstUsePos = cleanerSource.indexOf("_contentPrefsPending =");
    // First `=` is the declaration itself; find the NEXT assignment / read.
    const nextUsePos = cleanerSource.indexOf("_contentPrefsPending", firstUsePos + 1);
    assert.ok(nextUsePos > declPos, "every use must come after the declaration");
  });

  test("both prefs cache vars are hoisted near the top of the IIFE", () => {
    // Hoisting target: within the first 120 lines of the file so no handler
    // registered later can outrun them, regardless of site-specific timing.
    const declPos = cleanerSource.indexOf("let _contentPrefs");
    const lineNumber = cleanerSource.slice(0, declPos).split("\n").length;
    assert.ok(
      lineNumber < 120,
      `_contentPrefs should be declared in the top of the IIFE (found at line ${lineNumber})`
    );
  });
});

// ── Native shortener resolution path (ADR-0004 phase 5, #701) ─────────────────
// The proxy was decommissioned; generic shorteners now resolve natively via a
// RESOLVE_SHORTENER message. These structural assertions cover the content-script
// send/navigate path that lost its dedicated coverage when proxy-navigate.js was
// deleted (review S-1/S-2). They guard the no-fallback failure handling: every
// failure mode must still navigate to the original href so navigation never hangs.
describe("RESOLVE_SHORTENER — content-script path", () => {
  test("only resolves generic shorteners, gated on followShortenersEnabled", () => {
    assert.ok(
      cleanerSource.includes("isGenericShortener(url.hostname)"),
      "must gate the native path on isGenericShortener"
    );
    assert.ok(
      cleanerSource.includes("followShortenersEnabled"),
      "must gate resolution on the followShortenersEnabled opt-in pref"
    );
  });

  test("sends RESOLVE_SHORTENER (not the removed UNWRAP_VIA_PROXY)", () => {
    assert.ok(
      cleanerSource.includes('type: "RESOLVE_SHORTENER"'),
      "must send the RESOLVE_SHORTENER message type"
    );
    assert.ok(
      !cleanerSource.includes("UNWRAP_VIA_PROXY"),
      "the decommissioned UNWRAP_VIA_PROXY message must not remain"
    );
  });

  test("navigates to the resolved destination only on ok:true", () => {
    assert.ok(
      cleanerSource.includes("response?.ok === true"),
      "must navigate only when the SW reports ok:true"
    );
    assert.ok(
      cleanerSource.includes("navigate(dest, opensNewTab)"),
      "success path must navigate to the resolved destination"
    );
  });

  test("validates destination scheme + length before navigating (defense in depth)", () => {
    assert.ok(
      cleanerSource.includes("dest.length <= 2000"),
      "must cap destination length"
    );
    assert.ok(
      cleanerSource.includes('dest.startsWith("https://")') &&
        cleanerSource.includes('dest.startsWith("http://")'),
      "must restrict destination to http(s)"
    );
  });

  test("no-fallback safety: every failure path navigates to the original href", () => {
    // With the proxy gone there is no second resolver — a SW error, timeout,
    // ok:false, or invalid destination must all fall back to the original URL
    // so navigation never hangs.
    const occurrences = cleanerSource.split("navigate(href, opensNewTab)").length - 1;
    assert.ok(
      occurrences >= 2,
      `expected >=2 href fallbacks (timeout/error AND ok:false/invalid), found ${occurrences}`
    );
    assert.ok(
      cleanerSource.includes("shortener-resolve timeout"),
      "must bound the resolve on a timeout so it cannot hang"
    );
  });
});

// ── Behavioral harness: executes content/cleaner.js in a sandboxed vm context ──
// (#951) Unlike the source-string assertions above, this actually RUNS the
// content script against mocked chrome/document/window/fetch globals and
// inspects the real arguments passed to window.__mugaCleaner.processUrl().
// This is the regression coverage for #951: before the fix, none of the
// content-script processUrl() call sites threaded pathStripRules /
// pathAffiliateRules through, so path-based stripping (e.g. Amazon's
// trailing "/ref=") and path-based affiliate injection (e.g. Bookshop.org)
// were silently dead on every in-page navigation. A plain text-search
// assertion checking that the "getPathRulesCached" helper merely EXISTS
// in the file would not have caught the original bug — the helper could
// exist and still not be wired into the actual processUrl() call. Only
// inspecting the real call arguments proves the wiring works. The
// source-grep ratchet (#824, see tests/unit/source-grep-ratchet.test.mjs)
// also caps this file's text-search assertion count at its current
// baseline, so new coverage here must be behavioral rather than another
// raw-source string-match assertion.
//
// Content scripts cannot be `import`-ed (no ES modules, top-level
// `chrome.*`/`window.*`/`document.*` references), so we execute the raw
// source text inside a fresh `vm` context populated with minimal stand-ins
// for the browser globals it touches at document_start.

/**
 * Runs content/cleaner.js in an isolated vm context configured to exercise
 * the document_start self-clean branch (`!_hasDNR` guard — DNR is a
 * background-only API, never present in a content-script context), then
 * resolves once the async self-clean chain has settled.
 *
 * @param {object} opts
 * @param {string} opts.href - simulated `window.location.href`
 * @param {Array} opts.pathStripRulesFixture - fixture returned for rules/path-strip-rules.json
 * @param {Array} opts.pathAffiliateRulesFixture - fixture returned for rules/path-affiliate-rules.json
 * @returns {Promise<{ processUrlCalls: any[][] }>}
 */
function runContentScriptSelfClean({ href, pathStripRulesFixture, pathAffiliateRulesFixture }) {
  return new Promise((resolve, reject) => {
    const processUrlCalls = [];

    function mockFetch(url) {
      if (url.includes("domain-rules.json")) {
        return Promise.resolve({ json: () => Promise.resolve([]) });
      }
      if (url.includes("path-strip-rules.json")) {
        return Promise.resolve({ json: () => Promise.resolve(pathStripRulesFixture) });
      }
      if (url.includes("path-affiliate-rules.json")) {
        return Promise.resolve({ json: () => Promise.resolve(pathAffiliateRulesFixture) });
      }
      return Promise.reject(new Error("unexpected fetch: " + url));
    }

    const parsedHref = new URL(href);
    const fakeLocation = { href, hostname: parsedHref.hostname, pathname: parsedHref.pathname };

    const fakeWindow = {
      location: fakeLocation,
      getSelection: () => null,
      open: () => {},
    };
    fakeWindow.self = fakeWindow;
    fakeWindow.top = fakeWindow;
    fakeWindow.__mugaCleaner = {
      processUrl: (...args) => {
        processUrlCalls.push(args);
        // Return cleanUrl === href so the self-clean branch stops right
        // after the call (no history.replaceState / sendMessage side
        // effects to also stub) — we only care about the call arguments.
        return { cleanUrl: href, junkRemoved: 0 };
      },
      isGenericShortener: () => false,
    };

    const fakeDocument = {
      addEventListener: () => {},
      getElementById: () => null,
      createElement: () => ({
        style: {}, setAttribute() {}, appendChild() {}, querySelectorAll: () => [], remove() {},
      }),
      documentElement: {},
      body: { appendChild() {} },
      querySelector: () => null,
      readyState: "complete",
      referrer: "",
    };

    const fakeChrome = {
      runtime: {
        id: "test-ext-id",
        lastError: null,
        getURL: (path) => path,
        onMessage: { addListener: () => {} },
        sendMessage: (msg, cb) => {
          if (msg && msg.type === "getPrefs" && typeof cb === "function") {
            cb({ enabled: true, onboardingDone: true, injectOwnAffiliate: false, _affiliateDomains: [] });
          }
          return Promise.resolve({ ok: false });
        },
      },
      storage: {
        sync: { get: (defaults, cb) => cb(defaults) },
        onChanged: { addListener: () => {} },
      },
      // declarativeNetRequest is intentionally omitted: `_hasDNR` must be
      // false for the self-clean branch under test to run — mirrors the
      // real content-script context, where the DNR API is never exposed.
    };

    const sandbox = {
      window: fakeWindow,
      document: fakeDocument,
      chrome: fakeChrome,
      navigator: { language: "en", clipboard: { writeText: () => Promise.resolve() } },
      location: fakeLocation,
      history: { state: null, replaceState: () => {} },
      fetch: mockFetch,
      URL,
      console,
      setTimeout,
      clearTimeout,
    };

    vm.createContext(sandbox);
    try {
      vm.runInContext(cleanerSource, sandbox, { filename: "content/cleaner.js" });
    } catch (err) {
      reject(err);
      return;
    }

    // The self-clean chain is `Promise.all([...]).then(...)` fed by a few
    // chained fetch()/json() hops. All of that is microtask work, which
    // fully drains before any macrotask (including a 0ms timer) runs.
    setTimeout(() => resolve({ processUrlCalls }), 50);
  });
}

describe("Self-clean — processUrl() is called with real path rules (#951)", () => {
  test("document_start self-clean threads non-empty pathStripRules/pathAffiliateRules into processUrl", async () => {
    const pathStripRulesFixture = [{
      domain: "amazon",
      domainPattern: "(?:^|\\.)amazon\\.[a-z.]+$",
      pathPatterns: ["/ref=[^/]*$"],
      replacements: [""],
      flags: [""],
    }];
    const pathAffiliateRulesFixture = [{
      domain: "bookshop.org",
      referralPaths: [],
      injectPath: "/p/",
      injectParam: "affiliate",
      injectValue: "124046",
    }];

    const { processUrlCalls } = await runContentScriptSelfClean({
      href: "https://www.amazon.es/dp/B08N5WRWNW/ref=abc123",
      pathStripRulesFixture,
      pathAffiliateRulesFixture,
    });

    assert.equal(processUrlCalls.length, 1, "self-clean must call processUrl exactly once");
    const [url, prefs, domainRules, canonicalBundle, frequencyTracker, referrer, pathStripRules, pathAffiliateRules] =
      processUrlCalls[0];

    assert.equal(processUrlCalls[0].length, 8, "processUrl must be called with the full 8-arg signature");
    assert.equal(url, "https://www.amazon.es/dp/B08N5WRWNW/ref=abc123");
    assert.ok(prefs && prefs.enabled, "prefs must be threaded through");
    assert.ok(Array.isArray(domainRules), "domainRules must be threaded through");
    assert.equal(canonicalBundle, undefined, "canonicalBundle is unused at this call site");
    assert.equal(frequencyTracker, undefined, "frequencyTracker is unused at this call site");
    assert.equal(referrer, undefined, "referrer is unused at this call site");

    // The exact regression this test guards: before #951, these two args
    // were omitted entirely, so processUrl() silently defaulted them to
    // `[]` and every path-strip / path-affiliate rule was a no-op.
    assert.deepEqual(pathStripRules, pathStripRulesFixture);
    assert.ok(
      Array.isArray(pathStripRules) && pathStripRules.length > 0,
      "pathStripRules must be non-empty — an empty array silently disables path stripping (e.g. Amazon's trailing /ref=)"
    );
    assert.deepEqual(pathAffiliateRules, pathAffiliateRulesFixture);
    assert.ok(
      Array.isArray(pathAffiliateRules) && pathAffiliateRules.length > 0,
      "pathAffiliateRules must be non-empty — an empty array silently disables path-based affiliate injection (e.g. Bookshop.org)"
    );
  });
});
