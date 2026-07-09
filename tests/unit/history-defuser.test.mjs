/**
 * MUGA — Tests for the History Defuser (#444 / B10).
 *
 * The defuser wraps `history.pushState` and `history.replaceState` so that
 * any URL the page tries to push into the session history is run through
 * the cleaner pipeline first. This eliminates a major SPA leak: without
 * the defuser, sites that read `window.location.search` AFTER a router
 * push see the dirty URL and re-emit analytics with the tracking params
 * MUGA had already stripped at navigation.
 *
 * The module under test is a PURE factory — `installHistoryDefuser` —
 * which takes an injectable history-like object and an injectable URL
 * cleaner. No DOM, no jsdom (project rule: no third-party test libs).
 * The content-script entry that wires the real `window.history` and the
 * content-bundled `processUrl` is structural; the contract is enforced
 * here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { installHistoryDefuser } from "../../src/lib/history-defuser.js";
import { processUrl } from "../../src/lib/cleaner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a stub history-like object whose pushState/replaceState are spy
 * functions that record their (state, title, url) arguments. Mirrors the
 * shape of the real `window.history` for the two methods the defuser
 * wraps. No prototype, no extra noise — just the surface area the
 * defuser touches.
 */
function makeHistoryStub() {
  const calls = { pushState: [], replaceState: [] };
  const history = {
    pushState(state, title, url) {
      calls.pushState.push({ state, title, url, thisRef: this });
    },
    replaceState(state, title, url) {
      calls.replaceState.push({ state, title, url, thisRef: this });
    },
  };
  return { history, calls };
}

/**
 * Identity cleaner — returns its argument unchanged. Used in tests where
 * the defuser should be a transparent pass-through (e.g. URLs already
 * clean, or the disabled-state guard).
 */
const identityCleaner = (url) => url;

/**
 * Tracking-stripping cleaner — strips `utm_source`, `utm_medium`, and
 * `fbclid` query params from absolute or relative URLs. Mirrors the
 * subset of behaviour the real cleaner exposes; tests don't need the
 * full param list.
 */
function trackingCleaner(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return rawUrl;
  const STRIP = new Set(["utm_source", "utm_medium", "fbclid"]);
  let u;
  try {
    // Absolute URL path.
    u = new URL(rawUrl);
  } catch {
    // Relative URL path: anchor against an arbitrary base, then re-emit
    // path+search+hash so callers see the same shape they passed in.
    try {
      u = new URL(rawUrl, "https://example.invalid/");
      for (const k of [...u.searchParams.keys()]) {
        if (STRIP.has(k)) u.searchParams.delete(k);
      }
      return u.pathname + u.search + u.hash;
    } catch {
      return rawUrl;
    }
  }
  for (const k of [...u.searchParams.keys()]) {
    if (STRIP.has(k)) u.searchParams.delete(k);
  }
  return u.toString();
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("installHistoryDefuser — basic wrapping", () => {
  test("returns originals so callers can uninstall", () => {
    const { history } = makeHistoryStub();
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    const originals = installHistoryDefuser(history, identityCleaner);
    assert.equal(originals.pushState, originalPush);
    assert.equal(originals.replaceState, originalReplace);
  });

  test("wrapping replaces both methods on the host object", () => {
    const { history } = makeHistoryStub();
    const before = history.pushState;
    installHistoryDefuser(history, identityCleaner);
    assert.notEqual(history.pushState, before);
    assert.equal(typeof history.pushState, "function");
    assert.equal(typeof history.replaceState, "function");
  });

  test("uninstall via returned originals restores host methods", () => {
    const { history } = makeHistoryStub();
    const originals = installHistoryDefuser(history, identityCleaner);
    history.pushState = originals.pushState;
    history.replaceState = originals.replaceState;
    assert.equal(history.pushState, originals.pushState);
    assert.equal(history.replaceState, originals.replaceState);
  });
});

describe("installHistoryDefuser — pushState cleaning", () => {
  test("pushState with a tracking-decorated URL produces a clean entry", () => {
    const { history, calls } = makeHistoryStub();
    installHistoryDefuser(history, trackingCleaner);
    history.pushState(null, "", "/foo?utm_source=x&id=42");
    assert.equal(calls.pushState.length, 1);
    assert.equal(calls.pushState[0].url, "/foo?id=42");
  });

  test("pushState forwards state and title unchanged", () => {
    const { history, calls } = makeHistoryStub();
    installHistoryDefuser(history, trackingCleaner);
    const stateObj = { page: 7, nested: { a: 1 } };
    history.pushState(stateObj, "My Title", "/x?utm_medium=y");
    assert.equal(calls.pushState.length, 1);
    // Deep ref equality on state — must NOT be cloned or replaced.
    assert.equal(calls.pushState[0].state, stateObj);
    assert.equal(calls.pushState[0].title, "My Title");
  });

  test("pushState preserves an empty-string title verbatim", () => {
    const { history, calls } = makeHistoryStub();
    installHistoryDefuser(history, trackingCleaner);
    history.pushState({}, "", "/y?fbclid=abc");
    assert.equal(calls.pushState[0].title, "");
  });

  test("pushState forwards null url unchanged (cleaner not invoked)", () => {
    const { history, calls } = makeHistoryStub();
    installHistoryDefuser(history, () => {
      throw new Error("cleaner should not run for null url");
    });
    history.pushState({ a: 1 }, "t", null);
    assert.equal(calls.pushState[0].url, null);
  });

  test("pushState forwards undefined url unchanged (cleaner not invoked)", () => {
    const { history, calls } = makeHistoryStub();
    installHistoryDefuser(history, () => {
      throw new Error("cleaner should not run for undefined url");
    });
    history.pushState({}, "t");
    assert.equal(calls.pushState[0].url, undefined);
  });

  test("pushState swallows cleaner errors and forwards original url", () => {
    const { history, calls } = makeHistoryStub();
    installHistoryDefuser(history, () => {
      throw new Error("boom");
    });
    history.pushState({}, "", "/foo?utm_source=x");
    assert.equal(calls.pushState[0].url, "/foo?utm_source=x");
  });
});

describe("installHistoryDefuser — replaceState parity", () => {
  test("replaceState behaviour identical to pushState", () => {
    const { history, calls } = makeHistoryStub();
    installHistoryDefuser(history, trackingCleaner);
    history.replaceState(null, "", "/foo?utm_source=x&id=42");
    assert.equal(calls.replaceState.length, 1);
    assert.equal(calls.replaceState[0].url, "/foo?id=42");
  });

  test("replaceState forwards state and title unchanged", () => {
    const { history, calls } = makeHistoryStub();
    installHistoryDefuser(history, trackingCleaner);
    const stateObj = { route: "/dash" };
    history.replaceState(stateObj, "T", "/z?fbclid=abc");
    assert.equal(calls.replaceState[0].state, stateObj);
    assert.equal(calls.replaceState[0].title, "T");
    assert.equal(calls.replaceState[0].url, "/z");
  });

  test("does not invoke cleaner when url is missing", () => {
    let called = 0;
    const { history, calls } = makeHistoryStub();
    installHistoryDefuser(history, (u) => {
      called++;
      return u;
    });
    history.replaceState({}, "");
    assert.equal(called, 0);
    assert.equal(calls.replaceState[0].url, undefined);
  });
});

describe("installHistoryDefuser — disabled-state guard", () => {
  test("when isEnabled returns false, cleaner is not called and original url forwards", () => {
    let called = 0;
    const { history, calls } = makeHistoryStub();
    installHistoryDefuser(history, (_u) => {
      called++;
      return "MUTATED";
    }, { isEnabled: () => false });
    history.pushState({}, "", "/foo?utm_source=x");
    history.replaceState({}, "", "/bar?fbclid=z");
    assert.equal(called, 0);
    assert.equal(calls.pushState[0].url, "/foo?utm_source=x");
    assert.equal(calls.replaceState[0].url, "/bar?fbclid=z");
  });

  test("when isEnabled returns true, cleaner runs", () => {
    const { history, calls } = makeHistoryStub();
    installHistoryDefuser(history, trackingCleaner, { isEnabled: () => true });
    history.pushState({}, "", "/foo?utm_source=x");
    assert.equal(calls.pushState[0].url, "/foo");
  });
});

describe("installHistoryDefuser — passthrough on no-op clean", () => {
  test("if cleaner returns the same string, the call still flows through", () => {
    const { history, calls } = makeHistoryStub();
    installHistoryDefuser(history, identityCleaner);
    history.pushState({}, "", "/already-clean");
    assert.equal(calls.pushState[0].url, "/already-clean");
  });

  test("if cleaner returns null, original url forwards", () => {
    const { history, calls } = makeHistoryStub();
    installHistoryDefuser(history, () => null);
    history.pushState({}, "", "/x?utm_source=y");
    assert.equal(calls.pushState[0].url, "/x?utm_source=y");
  });
});

// ── Manifest + content-script wiring (structural) ──────────────────────────

describe("history-defuser — content-script wiring", () => {
  test("manifest.json registers the main-world wrap at document_start with world MAIN", () => {
    const manifest = JSON.parse(readFileSync(
      join(__dirname, "../../src/manifest.json"), "utf8"
    ));
    const entry = manifest.content_scripts.find((e) =>
      Array.isArray(e.js) && e.js.some((p) => p.endsWith("history-defuser-mainworld.js"))
    );
    assert.ok(entry, "history-defuser-mainworld.js must be in a content_scripts entry");
    assert.equal(entry.run_at, "document_start");
    assert.equal(entry.world, "MAIN",
      "main-world wrap must declare world MAIN so the page-world history is wrapped");
  });

  test("manifest.json registers the isolated-world gate at document_start", () => {
    const manifest = JSON.parse(readFileSync(
      join(__dirname, "../../src/manifest.json"), "utf8"
    ));
    const entry = manifest.content_scripts.find((e) =>
      Array.isArray(e.js) && e.js.some((p) => p.endsWith("history-defuser.js"))
    );
    assert.ok(entry, "history-defuser.js must be in a content_scripts entry");
    assert.equal(entry.run_at, "document_start");
  });

  test("manifest.v2.json registers the isolated gate but NOT the mainworld wrap (#1026)", () => {
    // history-defuser-mainworld.js is Chrome-MV3-only (world:MAIN). On
    // Firefox MV2 the page-world wrap is done directly by history-defuser.js
    // via window.wrappedJSObject + exportFunction, so the mainworld file must
    // not be loaded at all on MV2.
    const manifest = JSON.parse(readFileSync(
      join(__dirname, "../../src/manifest.v2.json"), "utf8"
    ));
    const gateEntry = manifest.content_scripts.find((e) =>
      Array.isArray(e.js) && e.js.some((p) => p.endsWith("history-defuser.js"))
    );
    const wrapEntry = manifest.content_scripts.find((e) =>
      Array.isArray(e.js) && e.js.some((p) => p.endsWith("history-defuser-mainworld.js"))
    );
    assert.ok(gateEntry, "history-defuser.js (gate) must be registered for MV2");
    assert.equal(gateEntry.run_at, "document_start");
    assert.equal(wrapEntry, undefined,
      "history-defuser-mainworld.js must NOT be registered for MV2 (Chrome-MV3-only)");
  });

  test("content/history-defuser.js is an IIFE (no ES module imports)", () => {
    const src = readFileSync(
      join(__dirname, "../../src/content/history-defuser.js"), "utf8"
    );
    assert.ok(/^\(function/m.test(src), "content script must be an IIFE");
    assert.equal(/^\s*import\s+/m.test(src), false,
      "content script must not contain top-level ES module imports");
    // Gate dispatches the cross-world event.
    assert.ok(/muga:history-gate/.test(src),
      "gate script must dispatch muga:history-gate events");
  });

  test("content/history-defuser.js guards storage listener with a once-flag (#832)", () => {
    // Defense-in-depth guard: a _storageListenerInstalled boolean (or equivalent
    // named flag) must gate the addListener call so that any hypothetical
    // re-execution path (or future refactor) cannot accumulate duplicate listeners.
    // The IIFE guard (window.__mugaHistoryDefuserGate) already prevents double
    // execution in practice; this flag is explicit defense-in-depth + documentation.
    const src = readFileSync(
      join(__dirname, "../../src/content/history-defuser.js"), "utf8"
    );
    assert.ok(
      /_storageListenerInstalled/.test(src),
      "content/history-defuser.js must use a _storageListenerInstalled boolean to guard addListener",
    );
    // The flag must be set to true before or immediately after addListener so
    // subsequent code paths cannot re-register.
    assert.ok(
      /_storageListenerInstalled\s*=\s*true/.test(src),
      "content/history-defuser.js must set _storageListenerInstalled = true after registering",
    );
    // The addListener must be conditional on the flag being falsy.
    assert.ok(
      /!\s*_storageListenerInstalled/.test(src) || /if\s*\(\s*!_storageListenerInstalled/.test(src),
      "content/history-defuser.js must check !_storageListenerInstalled before calling addListener",
    );
  });

  test("content/history-defuser-mainworld.js is an IIFE that wraps both history methods", () => {
    const src = readFileSync(
      join(__dirname, "../../src/content/history-defuser-mainworld.js"), "utf8"
    );
    assert.ok(/^\(function/m.test(src), "content script must be an IIFE");
    assert.equal(/^\s*import\s+/m.test(src), false,
      "content script must not contain top-level ES module imports");
    assert.ok(/history\.pushState\s*=/.test(src) && /history\.replaceState\s*=/.test(src),
      "main-world script must reassign both history methods");
    // No chrome.* CALLS — main-world scripts have no extension messaging.
    // Strip line comments and block comments before scanning, so the
    // file-level docblock that mentions "chrome.*" prose doesn't trip
    // this guard.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.equal(/\bchrome\.[a-zA-Z]/.test(stripped), false,
      "main-world script must not call any chrome.* extension API");
    // Gate listener present.
    assert.ok(/muga:history-gate/.test(src),
      "main-world wrap must listen for muga:history-gate to honor disabled state");
  });
});

// ── SPA reclean pipeline (#951 Layer B) ─────────────────────────────────────
//
// Layer A (#955) fixed DNR + the document_start self-clean but left a gap:
// a same-document SPA navigation (history.pushState/replaceState, popstate,
// hashchange) never re-runs the cleaning pipeline, so path rules (Amazon's
// trailing "/ref=...") and domain-scoped query params (e.g. "aref") survive
// an on-site pushState navigation. This section proves:
//   1. processUrl (the pure function __mugaReclean delegates to) DOES clean
//      both path segments and domain-scoped query params when given real
//      domainRules + pathRules — i.e. the underlying pipeline is capable of
//      the full clean once wired with both rule sets together.
//   2. content/cleaner.js actually wires window.__mugaReclean to pass both
//      pathRules.pathStripRules and pathRules.pathAffiliateRules into
//      processUrl (the exact gap that let Layer A's bug ship — the
//      pre-#951 self-clean omitted path rules from some call sites).
//   3. The loop-guard, nonce handling, and dispatch wiring exist in source.
//
// content/cleaner.js and content/history-defuser*.js are plain IIFEs with
// no module exports (chrome.*, window, document side effects at parse
// time), so — following this repo's established pattern for these files
// (see the "content-script wiring" describe block above, and
// tests/unit/content-script.test.mjs) — wiring is verified via structural
// source assertions, while the actual cleaning LOGIC is verified against
// the real, exported pure `processUrl` function with the project's real
// rule data. This matches the "prefer testing pure logic over IIFE side
// effects" convention.

const cleanerSrc = readFileSync(
  join(__dirname, "../../src/content/cleaner.js"), "utf8"
);
const mainworldSrc = readFileSync(
  join(__dirname, "../../src/content/history-defuser-mainworld.js"), "utf8"
);
const gateSrc = readFileSync(
  join(__dirname, "../../src/content/history-defuser.js"), "utf8"
);

// Minimal prefs — mirrors the shape used by other processUrl integration
// tests (see tests/unit/cleaner-canonical-integration.test.mjs).
const RECLEAN_PREFS = {
  enabled: true,
  onboardingDone: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  blacklist: [],
  whitelist: [],
};

const domainRules = JSON.parse(
  readFileSync(join(__dirname, "../../src/rules/domain-rules.json"), "utf8")
);
const pathStripRules = JSON.parse(
  readFileSync(join(__dirname, "../../src/rules/path-strip-rules.json"), "utf8")
);
const pathAffiliateRules = JSON.parse(
  readFileSync(join(__dirname, "../../src/rules/path-affiliate-rules.json"), "utf8")
);

describe("processUrl — full reclean on an Amazon-like pushState URL (#951 Layer B)", () => {
  test("real path-strip-rules.json is non-empty (the exact data Layer A's bug omitted)", () => {
    assert.ok(Array.isArray(pathStripRules) && pathStripRules.length > 0,
      "path-strip-rules.json must be non-empty for this regression to mean anything");
    assert.ok(Array.isArray(pathAffiliateRules),
      "path-affiliate-rules.json must parse to an array");
  });

  test("strips the Amazon /ref= path segment AND the domain-scoped aref query param together", () => {
    // Simulates a same-document pushState navigation (e.g. an on-site
    // banner click) landing a dirty Amazon URL — no network request is
    // ever made for this, so DNR never sees it; only the local pipeline
    // (domainRules + pathRules) can catch it.
    const dirty = "https://www.amazon.com/Some-Product-Name/dp/B0044R881I/ref=sr_1_1?aref=abc123&th=1";
    const result = processUrl(
      dirty, RECLEAN_PREFS, domainRules,
      undefined, undefined, undefined,
      pathStripRules, pathAffiliateRules,
    );
    assert.ok(result && result.cleanUrl, "processUrl must return a cleanUrl");
    assert.ok(!result.cleanUrl.includes("/ref="),
      `path-strip must remove the trailing /ref= segment, got: ${result.cleanUrl}`);
    assert.ok(!/[?&]aref=/.test(result.cleanUrl),
      `domain-scoped strip must remove aref, got: ${result.cleanUrl}`);
    // Functional param preserved (amazon.com preserveParams includes "th").
    assert.ok(/[?&]th=1/.test(result.cleanUrl),
      "functional param th must survive the clean");
  });

  test("WITHOUT pathStripRules, the /ref= segment survives (proves path rules are load-bearing)", () => {
    const dirty = "https://www.amazon.com/Some-Product-Name/dp/B0044R881I/ref=sr_1_1?aref=abc123&th=1";
    const result = processUrl(
      dirty, RECLEAN_PREFS, domainRules,
      undefined, undefined, undefined,
      [], [], // <- empty path rules, same shape as the pre-#951 self-clean bug
    );
    assert.ok(result.cleanUrl.includes("/ref="),
      "without path rules, /ref= must NOT be stripped — this is the exact regression #951 Layer B fixes");
    // Domain-scoped query strip is independent of path rules and still fires.
    assert.ok(!/[?&]aref=/.test(result.cleanUrl));
  });
});

describe("content/cleaner.js — window.__mugaReclean wiring (#951 Layer B)", () => {
  test("exposes window.__mugaReclean as a global for history-defuser.js to call", () => {
    assert.ok(/window\.__mugaReclean\s*=\s*function/.test(cleanerSrc),
      "cleaner.js must assign window.__mugaReclean = function (...) {...}");
  });

  function recleanBody() {
    const match = cleanerSrc.match(
      /window\.__mugaReclean\s*=\s*function[\s\S]*?\n {2}\};/
    );
    assert.ok(match, "must be able to isolate the __mugaReclean function body");
    return match[0];
  }

  test("__mugaReclean passes pathRules.pathStripRules and pathRules.pathAffiliateRules into processUrl", () => {
    const body = recleanBody();
    assert.ok(/processUrl\(/.test(body), "__mugaReclean must call processUrl");
    assert.ok(body.includes("pathRules.pathStripRules"),
      "__mugaReclean must forward pathRules.pathStripRules to processUrl");
    assert.ok(body.includes("pathRules.pathAffiliateRules"),
      "__mugaReclean must forward pathRules.pathAffiliateRules to processUrl");
    // Guards against a silent regression back to hardcoded empty arrays —
    // the exact shape of the pre-#951 bug.
    assert.equal(/processUrl\([^)]*\[\],\s*\[\]/.test(body), false,
      "__mugaReclean must not call processUrl with hardcoded empty path-rule arrays");
  });

  test("__mugaReclean also forwards domainRules (so domain-scoped params like aref are stripped)", () => {
    const body = recleanBody();
    assert.ok(body.includes("domainRules"),
      "__mugaReclean must forward domainRules to processUrl");
  });

  test("loop guard: __mugaReclean short-circuits when the URL matches the last recleaned URL", () => {
    const body = recleanBody();
    assert.ok(/_lastRecleanUrl/.test(body),
      "__mugaReclean must reference a _lastRecleanUrl guard");
    // The short-circuit compare must appear BEFORE the processUrl() call so
    // the guard actually prevents redundant work / recursive re-entry.
    const guardIdx = body.indexOf("url === _lastRecleanUrl");
    const processIdx = body.indexOf("processUrl(");
    assert.ok(guardIdx !== -1, "must compare url === _lastRecleanUrl");
    assert.ok(guardIdx < processIdx,
      "the loop-guard check must run before processUrl() is invoked");
    // _lastRecleanUrl must be updated with the cleaned result so a
    // subsequent re-entrant call (triggered by our own replaceState) is
    // recognized and short-circuited.
    assert.ok(/_lastRecleanUrl\s*=\s*result\.cleanUrl/.test(body),
      "_lastRecleanUrl must be set to the cleaned URL after a successful clean");
  });

  test("__mugaReclean bails when prefs are missing/disabled/not onboarded", () => {
    const body = recleanBody();
    assert.ok(/!_contentPrefs/.test(body) && /_contentPrefs\.enabled/.test(body),
      "__mugaReclean must gate on _contentPrefs.enabled");
    assert.ok(/onboardingDone/.test(body),
      "__mugaReclean must gate on onboardingDone");
  });

  test("__mugaReclean uses a URL-keyed loop cap, not the hostname-keyed isRewriteLoop", () => {
    const body = recleanBody();
    assert.ok(/isRecleanLoop\(url\)/.test(body),
      "__mugaReclean must call the URL-keyed isRecleanLoop(url) guard");
    assert.ok(!/isRewriteLoop\(/.test(body),
      "__mugaReclean must NOT reuse the hostname-keyed isRewriteLoop() — it throttles legit rapid SPA navs and shares the click-rewrite budget");
  });

  test("document_start self-clean delegates to window.__mugaReclean (single code path)", () => {
    assert.ok(/window\.__mugaReclean\(window\.location\.href\)/.test(cleanerSrc),
      "the document_start self-clean must call window.__mugaReclean, not duplicate the logic");
  });
});

describe("content/history-defuser-mainworld.js — post-commit dispatch (#951 Layer B)", () => {
  test("dispatches muga:history-committed after a committed pushState/replaceState", () => {
    assert.ok(/muga:history-committed/.test(mainworldSrc),
      "main-world wrap must dispatch muga:history-committed");
  });

  test("the commit event must NOT carry the gate nonce (main-world event is page-readable, #811)", () => {
    const match = mainworldSrc.match(
      /function dispatchCommitted[\s\S]*?detail:\s*\{([^}]*)\}/
    );
    assert.ok(match, "dispatchCommitted must build a muga:history-committed detail");
    assert.ok(!/nonce/.test(match[1]),
      "committed detail must not include the nonce — a MAIN-world event leaks it to page scripts, reopening the #811 gate-spoof");
  });

  test("commit dispatch only fires when the gate is open", () => {
    // dispatchCommitted(...) call sites must be guarded by gateOpen().
    const pushSite = mainworldSrc.match(
      /history\.pushState = function pushState[\s\S]*?\n {2}\};/
    )[0];
    const replaceSite = mainworldSrc.match(
      /history\.replaceState = function replaceState[\s\S]*?\n {2}\};/
    )[0];
    assert.ok(/gateOpen\(\)\)\s*dispatchCommitted/.test(pushSite),
      "pushState wrap must only dispatchCommitted when gateOpen()");
    assert.ok(/gateOpen\(\)\)\s*dispatchCommitted/.test(replaceSite),
      "replaceState wrap must only dispatchCommitted when gateOpen()");
  });
});

describe("content/history-defuser.js — muga:history-committed + popstate/hashchange (#951 Layer B)", () => {
  test("listens for muga:history-committed without a nonce gate (forged events are harmless; a nonce would leak)", () => {
    const match = gateSrc.match(
      /document\.addEventListener\("muga:history-committed"[\s\S]*?\}\);/
    );
    assert.ok(match, "history-defuser.js must listen for muga:history-committed");
    const handler = match[0];
    assert.ok(!/e\.detail\.nonce/.test(handler),
      "handler must NOT gate the committed event on a nonce — the MAIN-world event cannot carry one without leaking it (#811)");
    assert.ok(/window\.__mugaReclean/.test(handler),
      "handler must call window.__mugaReclean on a commit event");
  });

  test("adds popstate and hashchange listeners that call window.__mugaReclean (additive same-document coverage)", () => {
    assert.ok(/addEventListener\("popstate"/.test(gateSrc),
      "history-defuser.js must add a popstate listener");
    assert.ok(/addEventListener\("hashchange"/.test(gateSrc),
      "history-defuser.js must add a hashchange listener");
    const popstateBlock = gateSrc.match(/addEventListener\("popstate"[\s\S]*?\}\);/)[0];
    const hashchangeBlock = gateSrc.match(/addEventListener\("hashchange"[\s\S]*?\}\);/)[0];
    assert.ok(popstateBlock.includes("window.__mugaReclean"),
      "popstate listener must call window.__mugaReclean");
    assert.ok(hashchangeBlock.includes("window.__mugaReclean"),
      "hashchange listener must call window.__mugaReclean");
  });
});
