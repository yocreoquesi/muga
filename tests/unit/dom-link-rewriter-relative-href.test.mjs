/**
 * MUGA — #1012: DOM Link Rewriter must clean RELATIVE `<a href>` values.
 *
 * Both `src/content/dom-link-rewriter.js` (B8, MutationObserver) and
 * `src/content/dom-link-rewriter-click.js` (B9, capture-phase click) call
 * a local `urlCleaner(raw)` that PREFERS `window.__mugaCleaner.processUrl`
 * when it's attached (the normal running state — the cleaner bundle loads
 * earlier in the manifest content_scripts array).
 *
 * Root cause: the real `processUrl` -> `unwrapAndExtract` parses with
 * `new URL(rawUrl)` — NO base (see src/lib/cleaner.js). A relative href
 * (e.g. "/product?utm_source=x") throws there, is caught, and processUrl
 * returns an "untouched" payload whose `cleanUrl` is the ORIGINAL dirty
 * relative string. Before the fix, `urlCleaner` returned that dirty
 * string straight through and never fell back to the base-aware
 * `inlineCleanUrl` — relative hrefs passed through uncleaned while
 * absolute hrefs were cleaned correctly.
 *
 * ## Why a `vm` harness (not the pure-factory unit tests)
 *
 * `tests/unit/dom-link-rewriter.test.mjs` and
 * `dom-link-rewriter-click.test.mjs` exercise the pure factories in
 * `src/lib/` with a test-supplied `urlCleaner` stub — they never touch
 * the "prefer window.__mugaCleaner.processUrl" logic that only lives
 * inline in the content-script copies. Content scripts can't be
 * `import`-ed (IIFE, no ES modules — Firefox MV2 constraint), so per the
 * `content-copy-safe-injection.test.mjs` / `content-cleaner-patterns.test.mjs`
 * precedent we execute the raw content-script source inside a `vm`
 * context with minimal DOM/window stand-ins, attach a `window.__mugaCleaner`
 * mock that reproduces the REAL `processUrl` bug behavior (throws on a
 * relative URL, returns the untouched/dirty string), and observe the
 * actual anchors after the rewriter's initial pass.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));

const REWRITER_FILES = [
  { path: "../../src/content/dom-link-rewriter.js", label: "dom-link-rewriter.js (B8)" },
  { path: "../../src/content/dom-link-rewriter-click.js", label: "dom-link-rewriter-click.js (B9)" },
];

/**
 * Builds a stub `<a>`-like node mirroring the pure-factory test helper's
 * `makeAnchor` — exposes only `getAttribute`/`setAttribute`, records every
 * write for idempotency assertions.
 */
function makeAnchor(href) {
  let current = href;
  const setCalls = [];
  return {
    tagName: "A",
    nodeType: 1,
    getAttribute(name) { return name === "href" ? current : null; },
    setAttribute(name, value) {
      setCalls.push({ name, value });
      if (name === "href") current = value;
    },
    // B9's getAnchorFromEvent calls event.target.closest("a[href]") — this
    // stub anchor always matches its own selector, mirroring a real <a>.
    closest(sel) { return sel === "a[href]" ? this : null; },
    get __href() { return current; },
    get __setCalls() { return setCalls; },
  };
}

/**
 * Mimics the REAL `window.__mugaCleaner.processUrl` bug: `new URL(rawUrl)`
 * with no base throws on a relative string, and the caught branch returns
 * an "untouched" payload carrying the ORIGINAL (dirty) string as
 * `cleanUrl`. For an absolute URL it strips the tracking params found in
 * `STRIP_FOR_TEST`, matching the real cleaner's observable contract.
 */
const STRIP_FOR_TEST = new Set(["utm_source", "gclid"]);
function fakeProcessUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl); // no base — matches src/lib/cleaner.js unwrapAndExtract
  } catch {
    return { cleanUrl: rawUrl, action: "untouched" }; // the #1012 bug behavior
  }
  let changed = false;
  for (const k of [...url.searchParams.keys()]) {
    if (STRIP_FOR_TEST.has(k)) {
      url.searchParams.delete(k);
      changed = true;
    }
  }
  return { cleanUrl: url.toString(), action: changed ? "cleaned" : "untouched" };
}

/**
 * Runs a content-script's IIFE inside a fresh vm context, wires up the
 * `muga:history-gate` nonce handshake + gate event (enabled: true) so the
 * observer/click-listener installs and — for B8 — runs its initial pass
 * over `document.querySelectorAll("a[href]")`, then returns the anchors
 * for inspection.
 *
 * `attachBundle: false` omits `window.__mugaCleaner` entirely, exercising
 * the pre-bundle-attach fallback path (inlineCleanUrl only).
 */
function runContentScript(sourcePath, { anchors, locationHref, attachBundle = true, processUrlImpl = fakeProcessUrl }) {
  const source = readFileSync(join(__dirname, sourcePath), "utf8");
  const listeners = {};

  const fakeDocument = {
    documentElement: {},
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type, fn) { if (listeners[type] === fn) delete listeners[type]; },
    querySelectorAll(sel) { return sel === "a[href]" ? anchors : []; },
  };

  const fakeWindow = { location: { href: locationHref } };
  fakeWindow.self = fakeWindow;
  fakeWindow.top = fakeWindow;
  if (attachBundle) {
    fakeWindow.__mugaCleaner = { processUrl: processUrlImpl };
  }

  class FakeMutationObserver {
    observe() { /* no-op — initial pass is what these tests exercise */ }
    disconnect() { /* no-op */ }
  }

  const sandbox = {
    window: fakeWindow,
    document: fakeDocument,
    MutationObserver: FakeMutationObserver,
    console,
    URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: sourcePath });

  const nonce = "test-nonce";
  listeners["muga:history-gate:nonce"]({ detail: { nonce } });
  listeners["muga:history-gate"]({ detail: { nonce, enabled: true } });

  // B8 (MutationObserver) rewrites existing anchors via its initial
  // `rewriteAll(document.querySelectorAll("a[href]"))` pass, already
  // triggered above by the gate event. B9 (click interceptor) only
  // reacts to a real click/mousedown — no initial-pass equivalent — so
  // simulate the click here to drive the SAME `rewriteLink` codepath.
  if (typeof listeners.click === "function") {
    for (const anchor of anchors) listeners.click({ target: anchor });
  }

  return { anchors };
}

describe("#1012 — relative <a href> tracking params are stripped (bundle attached)", () => {
  for (const { path, label } of REWRITER_FILES) {
    test(`${label}: relative href with a single tracking param is cleaned and stays relative`, () => {
      const dirty = makeAnchor("/product?utm_source=newsletter");
      runContentScript(path, {
        anchors: [dirty],
        locationHref: "https://shop.example/category/",
      });
      assert.equal(dirty.__href, "/product",
        "utm_source must be stripped and the href must stay relative (no scheme/host)");
    });

    test(`${label}: relative href with a path and a real param keeps the real param`, () => {
      const dirty = makeAnchor("/a/b?gclid=z&id=7");
      runContentScript(path, {
        anchors: [dirty],
        locationHref: "https://shop.example/somewhere/",
      });
      assert.equal(dirty.__href, "/a/b?id=7",
        "gclid must be stripped, id=7 (a real param) must survive, and the shape stays relative");
    });

    test(`${label}: already-clean relative href triggers NO setAttribute (idempotency)`, () => {
      const clean = makeAnchor("/product?id=9");
      runContentScript(path, {
        anchors: [clean],
        locationHref: "https://shop.example/category/",
      });
      assert.equal(clean.__setCalls.length, 0,
        "a relative href with no tracking params must not be rewritten at all");
    });

    test(`${label}: relative href is unaffected by absolute-URL cleaning (regression guard)`, () => {
      const dirty = makeAnchor("https://other.example/p?utm_source=x&id=1");
      runContentScript(path, {
        anchors: [dirty],
        locationHref: "https://shop.example/category/",
      });
      assert.equal(dirty.__href, "https://other.example/p?id=1",
        "absolute hrefs must still be cleaned and stay absolute — pre-existing behavior");
    });

    test(`${label}: without the bundle attached, relative hrefs still clean via inlineCleanUrl`, () => {
      const dirty = makeAnchor("/product?utm_source=newsletter&id=3");
      runContentScript(path, {
        anchors: [dirty],
        locationHref: "https://shop.example/category/",
        attachBundle: false,
      });
      assert.equal(dirty.__href, "/product?id=3",
        "the pre-bundle-attach fallback (inlineCleanUrl) already handled relative hrefs correctly");
    });

    // ── Regression guards (post-fix review) ──────────────────────────────

    test(`${label}: hash-only href on a tracking-decorated page is UNCHANGED (no query of its own)`, () => {
      // The page itself was opened via a tracking link, so its location
      // carries utm_source. A "#section" anchor has NO query of its own —
      // resolving it against the page URL would inherit the page's query,
      // and cleaning that would rewrite an in-page anchor that carried no
      // tracking itself. The `?`-guard must short-circuit before resolving.
      const anchor = makeAnchor("#section");
      runContentScript(path, {
        anchors: [anchor],
        locationHref: "https://shop.example/landing?utm_source=ad",
      });
      assert.equal(anchor.__href, "#section",
        "a hash-only href must stay exactly as-is — it has no query of its own to clean");
      assert.equal(anchor.__setCalls.length, 0,
        "no setAttribute must fire for a query-less relative href (idempotency)");
    });

    test(`${label}: query-less relative path on a tracking-decorated page is UNCHANGED`, () => {
      const anchor = makeAnchor("/about");
      runContentScript(path, {
        anchors: [anchor],
        locationHref: "https://shop.example/landing?utm_source=ad",
      });
      assert.equal(anchor.__href, "/about",
        "a relative path with no query of its own must not inherit + strip the page's query");
      assert.equal(anchor.__setCalls.length, 0,
        "no setAttribute must fire for a query-less relative href (idempotency)");
    });

    test(`${label}: cross-origin unwrap must NOT be mis-relativized onto the current origin`, () => {
      // processUrl can UNWRAP a redirect wrapper and return a DIFFERENT-
      // origin absolute URL. Re-emitting pathname+search+hash would graft
      // that other-origin path onto the current origin (a silently wrong
      // link). The same-origin guard must return the original raw instead.
      const crossOriginUnwrap = (raw) => {
        // Only the resolved wrapper URL triggers the cross-origin unwrap.
        if (raw === "https://shop.example/go?utm_source=x") {
          return { cleanUrl: "https://external.example/dest", action: "unwrapped" };
        }
        return { cleanUrl: raw, action: "untouched" };
      };
      const anchor = makeAnchor("/go?utm_source=x");
      runContentScript(path, {
        anchors: [anchor],
        locationHref: "https://shop.example/",
        processUrlImpl: crossOriginUnwrap,
      });
      assert.equal(anchor.__href, "/go?utm_source=x",
        "a cross-origin unwrap result must NOT be grafted onto the current origin — leave the href untouched");
    });
  }
});
