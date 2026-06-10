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

  test("manifest.v2.json registers both defuser scripts at document_start", () => {
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
    assert.ok(wrapEntry, "history-defuser-mainworld.js (wrap) must be registered for MV2");
    assert.equal(wrapEntry.run_at, "document_start");
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
