/**
 * MUGA — #946: copy-safe cleaning for content-script copy paths.
 *
 * Every user-facing COPY/SHARE affordance must put the cleanest SAFE form
 * of a URL on the clipboard: tracking stripped, third-party creator
 * attribution preserved, and — critically — NO MUGA-injected affiliate tag.
 * Navigation-time injection is the monetization model and must stay ON;
 * only copy actions must suppress it.
 *
 * background/service-worker.js#handleProcessUrl already had this right for
 * the keyboard-shortcut / context-menu-on-a-link / selection-fallback paths
 * (its `effectivePrefs` branch forces `injectOwnAffiliate: false` and
 * `notifyForeignAffiliate: false` when `skipNotify` is set). This file
 * covers the two content-script-local copy paths that were missing the
 * same suppression:
 *
 *   1. GET_AND_COPY_CLEAN_SELECTION — the content-script side of the
 *      right-click "Copy clean selection" context-menu item (cleans an
 *      entire DOM selection locally, no service-worker round trip per URL).
 *   2. The `copy` DOM event listener — Ctrl+C / Cmd+C.
 *
 * Both call `window.__mugaCleaner.processUrl()` (the bundled cleaner) with
 * a *live* prefs object (`_contentPrefs`) mirroring whatever the user has
 * configured for navigation. Before the fix, that included
 * `injectOwnAffiliate` verbatim — so copying a link on an affiliate store
 * could put MUGA's own tag on the clipboard, exactly the non-consensual
 * hijack this ticket exists to prevent.
 *
 * ## Why a `vm` harness
 *
 * Content scripts cannot be `import`-ed (no ES modules; top-level
 * `chrome.*` / `window.*` / `document.*` references). Per the #951
 * precedent in content-cleaner-patterns.test.mjs, we execute the raw
 * source text inside a fresh `vm` context with minimal browser-global
 * stand-ins and inspect the REAL arguments passed to
 * `window.__mugaCleaner.processUrl()`. This is a behavioral test — it
 * would fail if someone reverted the prefs-copy fix, even if the
 * surrounding code shape changed — rather than a source-string match.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";

import { processUrl } from "../../src/lib/cleaner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cleanerSource = readFileSync(join(__dirname, "../../src/content/cleaner.js"), "utf8");
const require = createRequire(import.meta.url);
const domainRules = require("../../src/rules/domain-rules.json");

function mockFetch(url) {
  if (url.includes("domain-rules.json")) return Promise.resolve({ json: () => Promise.resolve([]) });
  if (url.includes("path-strip-rules.json")) return Promise.resolve({ json: () => Promise.resolve([]) });
  if (url.includes("path-affiliate-rules.json")) return Promise.resolve({ json: () => Promise.resolve([]) });
  return Promise.reject(new Error("unexpected fetch: " + url));
}

/**
 * Runs the content script and dispatches a synthetic Ctrl+C `copy` event
 * with `selectionText` as the current DOM selection's plain text.
 *
 * @returns {Promise<{ processUrlCalls: any[][], clipboardWritten: string|null }>}
 */
function runContentScriptCopyEvent({ contentPrefsFixture, selectionText }) {
  return new Promise((resolve, reject) => {
    const processUrlCalls = [];
    const documentListeners = {};
    let clipboardWritten = null;

    const fakeDocument = {
      addEventListener: (type, fn) => { documentListeners[type] = fn; },
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

    const fakeSelection = { toString: () => selectionText };
    const fakeLocation = { href: "https://page.example/", hostname: "page.example", pathname: "/" };

    const fakeWindow = {
      location: fakeLocation,
      getSelection: () => fakeSelection,
      open: () => {},
    };
    fakeWindow.self = fakeWindow;
    fakeWindow.top = fakeWindow;
    fakeWindow.__mugaCleaner = {
      processUrl: (...args) => {
        processUrlCalls.push(args);
        return { cleanUrl: args[0], junkRemoved: 0, removedTracking: [] };
      },
      isGenericShortener: () => false,
    };

    const fakeChrome = {
      runtime: {
        id: "test-ext-id",
        lastError: null,
        getURL: (path) => path,
        onMessage: { addListener: () => {} },
        sendMessage: (msg, cb) => {
          if (msg && msg.type === "getPrefs" && typeof cb === "function") cb(contentPrefsFixture);
          return Promise.resolve({ ok: false });
        },
      },
      storage: {
        sync: { get: (defaults, cb) => cb(defaults) },
        onChanged: { addListener: () => {} },
      },
    };

    const sandbox = {
      window: fakeWindow,
      document: fakeDocument,
      chrome: fakeChrome,
      navigator: {
        language: "en",
        clipboard: { writeText: (text) => { clipboardWritten = text; return Promise.resolve(); } },
      },
      location: fakeLocation,
      history: { state: null, replaceState: () => {} },
      NodeFilter: { SHOW_TEXT: 4 },
      URL,
      console,
      setTimeout,
      clearTimeout,
      fetch: mockFetch,
    };

    vm.createContext(sandbox);
    try {
      vm.runInContext(cleanerSource, sandbox, { filename: "content/cleaner.js" });
    } catch (err) {
      reject(err);
      return;
    }

    // Let the eager getContentPrefs()/getDomainRulesCached()/getPathRulesCached()
    // chains settle (they're microtask/fetch-driven) before dispatching.
    setTimeout(() => {
      const copyHandler = documentListeners.copy;
      if (typeof copyHandler !== "function") {
        reject(new Error("document 'copy' listener was not registered"));
        return;
      }
      copyHandler({ preventDefault: () => {} });
      setTimeout(() => resolve({ processUrlCalls, clipboardWritten }), 20);
    }, 20);
  });
}

/**
 * Runs the content script and dispatches a synthetic
 * GET_AND_COPY_CLEAN_SELECTION message (the context-menu "Copy clean
 * selection" path), with `selectionText` standing in for the plain-text
 * content found inside the cloned DOM selection.
 *
 * @returns {Promise<{ processUrlCalls: any[][], responseResult: object }>}
 */
function runContentScriptSelectionMessage({ contentPrefsFixture, selectionText }) {
  return new Promise((resolve, reject) => {
    const processUrlCalls = [];
    let messageListener;
    let responseResult;

    const fakeContainer = { appendChild() {}, querySelectorAll: () => [] };

    const fakeDocument = {
      addEventListener: () => {},
      getElementById: () => null,
      createElement: (tag) => (tag === "div" ? fakeContainer : {
        style: {}, setAttribute() {}, appendChild() {}, querySelectorAll: () => [], remove() {},
      }),
      createTreeWalker: () => {
        let done = false;
        return {
          nextNode() {
            if (done) return null;
            done = true;
            return { textContent: selectionText };
          },
        };
      },
      documentElement: {},
      body: { appendChild() {} },
      querySelector: () => null,
      readyState: "complete",
      referrer: "",
    };

    const fakeSelection = {
      rangeCount: 1,
      getRangeAt: () => ({ cloneContents: () => ({}) }),
      toString: () => selectionText,
    };
    const fakeLocation = { href: "https://page.example/", hostname: "page.example", pathname: "/" };

    const fakeWindow = {
      location: fakeLocation,
      getSelection: () => fakeSelection,
      open: () => {},
    };
    fakeWindow.self = fakeWindow;
    fakeWindow.top = fakeWindow;
    fakeWindow.__mugaCleaner = {
      processUrl: (...args) => {
        processUrlCalls.push(args);
        return { cleanUrl: args[0], junkRemoved: 0 };
      },
      isGenericShortener: () => false,
    };

    const fakeChrome = {
      runtime: {
        id: "test-ext-id",
        lastError: null,
        getURL: (path) => path,
        onMessage: { addListener: (fn) => { messageListener = fn; } },
        sendMessage: (msg, cb) => {
          if (msg && msg.type === "getPrefs" && typeof cb === "function") cb(contentPrefsFixture);
          return Promise.resolve({ ok: false });
        },
      },
      storage: {
        sync: { get: (defaults, cb) => cb(defaults) },
        onChanged: { addListener: () => {} },
      },
    };

    const sandbox = {
      window: fakeWindow,
      document: fakeDocument,
      chrome: fakeChrome,
      navigator: { language: "en", clipboard: { writeText: () => Promise.resolve() } },
      location: fakeLocation,
      history: { state: null, replaceState: () => {} },
      NodeFilter: { SHOW_TEXT: 4 },
      URL,
      console,
      setTimeout,
      clearTimeout,
      fetch: mockFetch,
    };

    vm.createContext(sandbox);
    try {
      vm.runInContext(cleanerSource, sandbox, { filename: "content/cleaner.js" });
    } catch (err) {
      reject(err);
      return;
    }

    setTimeout(() => {
      if (typeof messageListener !== "function") {
        reject(new Error("chrome.runtime.onMessage listener was not registered"));
        return;
      }
      messageListener(
        { type: "GET_AND_COPY_CLEAN_SELECTION" },
        { id: "test-ext-id" },
        (resp) => { responseResult = resp; },
      );
      setTimeout(() => resolve({ processUrlCalls, responseResult }), 20);
    }, 20);
  });
}

/**
 * Runs the content script's document_start self-clean branch (NAVIGATION,
 * not copy) with a caller-supplied prefs fixture. Adapted from the #951
 * harness in content-cleaner-patterns.test.mjs, parameterized on
 * `contentPrefsFixture` so this file can prove the navigation path is
 * NOT touched by the copy-safe-prefs fix (regression guard, AC #6).
 */
function runContentScriptSelfClean({ href, contentPrefsFixture }) {
  return new Promise((resolve, reject) => {
    const processUrlCalls = [];
    const parsedHref = new URL(href);
    const fakeLocation = { href, hostname: parsedHref.hostname, pathname: parsedHref.pathname };

    const fakeWindow = { location: fakeLocation, getSelection: () => null, open: () => {} };
    fakeWindow.self = fakeWindow;
    fakeWindow.top = fakeWindow;
    fakeWindow.__mugaCleaner = {
      processUrl: (...args) => {
        processUrlCalls.push(args);
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
          if (msg && msg.type === "getPrefs" && typeof cb === "function") cb(contentPrefsFixture);
          return Promise.resolve({ ok: false });
        },
      },
      storage: {
        sync: { get: (defaults, cb) => cb(defaults) },
        onChanged: { addListener: () => {} },
      },
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

    setTimeout(() => resolve({ processUrlCalls }), 50);
  });
}

const TAGGED_URL = "https://www.amazon.es/dp/B08N5WRWNW?tag=creator-21&utm_source=newsletter";

// Live prefs mirror what a real user with both toggles ON would have —
// injection AND the foreign-affiliate toast are both enabled for navigation.
const CONTENT_PREFS_NAV_INJECTS = Object.freeze({
  enabled: true,
  onboardingDone: true,
  injectOwnAffiliate: true,
  notifyForeignAffiliate: true,
  _affiliateDomains: [],
});

describe("#946 — content-script copy paths suppress MUGA's own injection", () => {
  test("GET_AND_COPY_CLEAN_SELECTION (context-menu 'Copy clean selection') passes copy-safe prefs to processUrl", async () => {
    const { processUrlCalls } = await runContentScriptSelectionMessage({
      contentPrefsFixture: CONTENT_PREFS_NAV_INJECTS,
      selectionText: `Check this out: ${TAGGED_URL}`,
    });
    const call = processUrlCalls.find(([url]) => url === TAGGED_URL);
    assert.ok(call, "processUrl must be called with the URL found in the selection");
    const prefsArg = call[1];
    assert.equal(prefsArg.injectOwnAffiliate, false, "copy must suppress MUGA's own injection even though the live pref is ON");
    assert.equal(prefsArg.notifyForeignAffiliate, false, "copy must suppress the foreign-affiliate toast");
  });

  test("Ctrl+C copy event passes copy-safe prefs to processUrl", async () => {
    const { processUrlCalls } = await runContentScriptCopyEvent({
      contentPrefsFixture: CONTENT_PREFS_NAV_INJECTS,
      selectionText: `Look: ${TAGGED_URL}`,
    });
    const call = processUrlCalls.find(([url]) => url === TAGGED_URL);
    assert.ok(call, "processUrl must be called with the URL found in the copied text");
    const prefsArg = call[1];
    assert.equal(prefsArg.injectOwnAffiliate, false);
    assert.equal(prefsArg.notifyForeignAffiliate, false);
  });

  test("copy-safe prefs are a NEW object — the live _contentPrefs reference is never mutated", async () => {
    const { processUrlCalls } = await runContentScriptCopyEvent({
      contentPrefsFixture: CONTENT_PREFS_NAV_INJECTS,
      selectionText: TAGGED_URL,
    });
    const call = processUrlCalls.find(([url]) => url === TAGGED_URL);
    const prefsArg = call[1];
    assert.notEqual(prefsArg, CONTENT_PREFS_NAV_INJECTS, "processUrl must receive a copy, not the live prefs object");
    assert.equal(CONTENT_PREFS_NAV_INJECTS.injectOwnAffiliate, true, "the live prefs object itself must remain untouched after a copy action");
  });
});

describe("#946 — regression guard: navigation-path injection is untouched", () => {
  test("document_start self-clean still passes the real (unsuppressed) prefs through to processUrl", async () => {
    const href = "https://www.amazon.es/dp/B08N5WRWNW";
    const { processUrlCalls } = await runContentScriptSelfClean({
      href,
      contentPrefsFixture: CONTENT_PREFS_NAV_INJECTS,
    });
    assert.equal(processUrlCalls.length, 1, "self-clean must call processUrl exactly once");
    const prefsArg = processUrlCalls[0][1];
    assert.equal(prefsArg.injectOwnAffiliate, true, "navigation-path self-clean must NOT suppress injection — only copy paths do");
    assert.equal(prefsArg, CONTENT_PREFS_NAV_INJECTS, "navigation passes the SAME prefs object, unmodified — no copy-safe override applied");
  });
});

// ── Real processUrl(): copy-safe prefs still preserve third-party attribution ──
// These exercise the actual cleaner pipeline (not the vm-mocked stub above) to
// prove that suppressing injectOwnAffiliate/notifyForeignAffiliate on copy does
// NOT strip a third-party creator's own tag, and does not disturb opaque
// affiliate-redirect-network wrapper handling (constraint: copy inherits the
// existing isAffiliateRedirectNetwork gate for free).
describe("#946 — copy-safe prefs preserve third-party attribution (real processUrl)", () => {
  const COPY_PREFS = {
    enabled: true,
    onboardingDone: true,
    injectOwnAffiliate: false,
    notifyForeignAffiliate: false,
    stripAllAffiliates: false,
    blacklist: [],
    whitelist: [],
    disabledCategories: [],
  };

  test("a third-party (creator) affiliate tag survives copy-safe cleaning untouched", () => {
    const raw = "https://www.amazon.com/dp/B00X?utm_source=newsletter&tag=someothercreator-21";
    const r = processUrl(raw, COPY_PREFS, domainRules);
    assert.ok(r.cleanUrl.includes("tag=someothercreator-21"), "foreign creator tag must survive copy-safe cleaning");
    assert.ok(!r.cleanUrl.includes("utm_source"), "unrelated tracking noise is still stripped");
    assert.notEqual(r.action, "injected", "copy-safe prefs must never report our own injection");
  });

  test("copy-safe prefs never add MUGA's own tag to an untagged affiliate URL", () => {
    const raw = "https://www.amazon.com/dp/B00X";
    const r = processUrl(raw, COPY_PREFS, domainRules);
    assert.notEqual(r.action, "injected");
    assert.ok(!new URL(r.cleanUrl).searchParams.has("tag"), "no tag param should be added on copy");
  });

  test("an affiliate-redirect-network wrapper is left intact on copy (unwrap gate inherited, not bypassed)", () => {
    const wrapped = "https://s.click.aliexpress.com/e/_abcDEF12";
    const withCopyPrefs = processUrl(wrapped, COPY_PREFS, domainRules);
    const withNavPrefs = processUrl(wrapped, { ...COPY_PREFS, injectOwnAffiliate: true, notifyForeignAffiliate: true }, domainRules);
    assert.equal(withCopyPrefs.cleanUrl, wrapped, "opaque wrapper must pass through unmodified on copy");
    assert.equal(
      withCopyPrefs.cleanUrl, withNavPrefs.cleanUrl,
      "copy and navigation share the same unwrap gate — injectOwnAffiliate/notifyForeignAffiliate do not change wrapper handling",
    );
  });
});

// ── background/service-worker.js copy call sites (regression pin) ──────────
// Per prior triage, the keyboard-shortcut (Alt+Shift+C), context-menu
// "Copy link", and context-menu "Copy selection" fallback paths already
// route through handleProcessUrl's `effectivePrefs` branch, which forces
// injectOwnAffiliate/notifyForeignAffiliate off when `skipNotify` is set.
// service-worker.js cannot be imported in Node (top-level chrome.* calls at
// module scope — DNR setup, alarms, etc.), so this is pinned two ways:
// a source-location check that each call site still passes `skipNotify:
// true` (source-string is the correct tool here per the ratchet's own
// documented exemption criteria — the module is not importable), PLUS a
// behavioral test of the effectivePrefs branch re-expressed as a pure
// function, following the sw-robustness-833.test.mjs precedent for logic
// mirrors of un-importable SW code.
describe("#946 — background copy call sites already suppress injection (regression pin)", () => {
  const swSrc = readFileSync(join(__dirname, "../../src/background/service-worker.js"), "utf8");

  test("handleProcessUrl's effectivePrefs branch forces both toggles off on skipNotify", () => {
    const idx = swSrc.indexOf("const effectivePrefs = skipNotify");
    assert.ok(idx !== -1, "handleProcessUrl must build a copy-safe effectivePrefs branch");
    const block = swSrc.slice(idx, idx + 200);
    assert.ok(block.includes("notifyForeignAffiliate: false"));
    assert.ok(block.includes("injectOwnAffiliate: false"));
  });

  test("keyboard shortcut (Alt+Shift+C) copy call site passes skipNotify: true", () => {
    const idx = swSrc.indexOf('source: "shortcut"');
    assert.ok(idx !== -1, "shortcut copy call site must exist");
    assert.ok(swSrc.slice(Math.max(0, idx - 200), idx + 50).includes("skipNotify: true"));
  });

  test("context-menu 'Copy link' call site passes skipNotify: true", () => {
    const idx = swSrc.indexOf('source: "copy_link"');
    assert.ok(idx !== -1, "copy_link call site must exist");
    assert.ok(swSrc.slice(Math.max(0, idx - 200), idx + 50).includes("skipNotify: true"));
  });

  test("context-menu 'Copy selection' fallback call site passes skipNotify: true", () => {
    const idx = swSrc.indexOf('source: "copy_selection"');
    assert.ok(idx !== -1, "copy_selection call site must exist");
    assert.ok(swSrc.slice(Math.max(0, idx - 200), idx + 50).includes("skipNotify: true"));
  });
});

describe("#946 — effectivePrefs copy-safe logic (pure mirror, behavioral)", () => {
  // Mirrors handleProcessUrl's one-line branch verbatim.
  function buildEffectivePrefs(prefs, skipNotify) {
    return skipNotify
      ? { ...prefs, notifyForeignAffiliate: false, injectOwnAffiliate: false }
      : prefs;
  }

  test("skipNotify:true forces both toggles off regardless of the live prefs", () => {
    const live = { injectOwnAffiliate: true, notifyForeignAffiliate: true, enabled: true };
    const effective = buildEffectivePrefs(live, true);
    assert.equal(effective.injectOwnAffiliate, false);
    assert.equal(effective.notifyForeignAffiliate, false);
    assert.equal(live.injectOwnAffiliate, true, "the live prefs object must not be mutated");
  });

  test("skipNotify:false (normal navigation) passes prefs through unmodified", () => {
    const live = { injectOwnAffiliate: true, notifyForeignAffiliate: true, enabled: true };
    const effective = buildEffectivePrefs(live, false);
    assert.equal(effective, live, "navigation must receive the SAME prefs reference — no copy-safe override");
  });
});

// ── audit #1040 / #1041: copy-selection side effects ─────────────────────────
//
// #1040: GET_AND_COPY_CLEAN_SELECTION replaced cleaned URLs in the selection
//        text without sorting longest-first, so a shorter URL that is a prefix
//        of a longer one could corrupt the longer one during split/join. The
//        sibling Ctrl+C handler already sorts; this path must too.
// #1041: the service-worker context-menu FALLBACK loops over every URL in the
//        selection, so it must pass skipSideEffects (not just skipStats) or it
//        appends one history/ledger entry per URL for a single copy action.

describe("audit #1040 — copy-selection replaces longest URLs first", () => {
  test("GET_AND_COPY_CLEAN_SELECTION sorts urlMap entries by length descending", () => {
    assert.ok(
      /\[\s*\.\.\.\s*urlMap\s*\]\s*\.sort\(\s*\(\s*a\s*,\s*b\s*\)\s*=>\s*b\[0\]\.length\s*-\s*a\[0\]\.length\s*\)/.test(cleanerSource),
      "the copy-selection text replacement must sort urlMap entries longest-first to avoid prefix corruption",
    );
  });
});

describe("audit #1041 — service-worker copy-selection fallback skips side effects", () => {
  const swSource = readFileSync(join(__dirname, "../../src/background/service-worker.js"), "utf8");
  test("the copy_selection fallback passes skipSideEffects:true (not just skipStats)", () => {
    assert.ok(
      /handleProcessUrl\(\s*candidate\s*,\s*\{[^}]*source:\s*["']copy_selection["'][^}]*skipSideEffects:\s*true[^}]*\}/.test(swSource),
      "the selection-copy fallback must pass skipSideEffects:true so it does not duplicate history/ledger per URL",
    );
  });
});
