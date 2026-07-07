/**
 * MUGA — Firefox CSP-immune history wrap (behavioral).
 *
 * history-defuser.js is an isolated-world IIFE. On Firefox MV2 it now wraps the
 * PAGE's history.pushState/replaceState via window.wrappedJSObject +
 * exportFunction (no injected <script>, so strict page CSPs like Amazon cannot
 * block it) and calls window.__mugaReclean on a same-document navigation.
 *
 * This test loads the real source in a shimmed content-script environment and
 * asserts: (1) a page pushState/replaceState triggers __mugaReclean when the
 * active-defense gate is open, (2) it does NOT when the gate is closed, and
 * (3) no <script> element is ever created (the CSP-immunity guarantee).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, "../../src/content/history-defuser.js"), "utf8");

/** Minimal EventTarget-ish stub that records createElement misuse. */
function makeDocument() {
  const listeners = new Map();
  return {
    createElementCalls: [],
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    dispatchEvent() { return true; },
    createElement(tag) { this.createElementCalls.push(tag); return { set src(_v) {}, remove() {}, appendChild() {} }; },
    head: null,
    documentElement: null,
  };
}

/**
 * Loads history-defuser.js in a shimmed Firefox content-script world.
 * `prefs` is what chrome.runtime.sendMessage("getPrefs") resolves to.
 * Returns handles to assert against.
 */
function loadDefuser(prefs) {
  const recleanCalls = [];
  const pageHistory = {
    pushCalls: [],
    replaceCalls: [],
    pushState(state, title, url) { this.pushCalls.push(url); },
    replaceState(state, title, url) { this.replaceCalls.push(url); },
  };
  const pageWindow = { history: pageHistory };

  const location = { href: "https://example.com/current", hostname: "example.com" };
  const window = {
    wrappedJSObject: pageWindow,
    location,
    __mugaReclean: (url) => recleanCalls.push(url),
    addEventListener() {},
  };
  window.self = window;
  window.top = window;

  const document = makeDocument();
  const chrome = {
    runtime: {
      getManifest: () => ({ manifest_version: 2 }),
      sendMessage: (_msg, cb) => cb(prefs),
      lastError: undefined,
    },
    storage: { onChanged: { addListener() {} } },
  };
  const exportFunction = (fn) => fn; // identity: exported fn is callable directly
  const CustomEvent = class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } };
  const consoleStub = { warn() {}, error() {}, log() {} };

  // Run the real IIFE with our stubs shadowing the browser globals it reads.
  const run = new Function(
    "window", "document", "chrome", "crypto", "exportFunction", "location", "CustomEvent", "console",
    SRC,
  );
  run(window, document, chrome, crypto, exportFunction, location, CustomEvent, consoleStub);

  return { pageHistory, recleanCalls, document };
}

const OPEN_PREFS = { enabled: true, onboardingDone: true, activeDefenseEnabled: true };

describe("Firefox history wrap — installs on the page world without a <script>", () => {
  test("wraps pushState/replaceState on window.wrappedJSObject.history", () => {
    const { pageHistory } = loadDefuser(OPEN_PREFS);
    // The wrap replaces the methods; they are still functions and still record.
    assert.equal(typeof pageHistory.pushState, "function");
    assert.equal(typeof pageHistory.replaceState, "function");
  });

  test("creates NO <script> element (CSP-immunity guarantee)", () => {
    const { document } = loadDefuser(OPEN_PREFS);
    assert.deepEqual(document.createElementCalls, [], "no <script> (or any element) should be created");
  });
});

describe("Firefox history wrap — triggers __mugaReclean on same-document navigation", () => {
  test("page pushState with the gate OPEN calls __mugaReclean with the new URL", () => {
    const { pageHistory, recleanCalls } = loadDefuser(OPEN_PREFS);
    pageHistory.pushState({}, "", "https://example.com/section?utm_source=a");
    assert.deepEqual(recleanCalls, ["https://example.com/section?utm_source=a"]);
    // The original is still invoked so the page's navigation is preserved.
    assert.deepEqual(pageHistory.pushCalls, ["https://example.com/section?utm_source=a"]);
  });

  test("page replaceState with the gate OPEN also triggers __mugaReclean", () => {
    const { pageHistory, recleanCalls } = loadDefuser(OPEN_PREFS);
    pageHistory.replaceState({}, "", "https://example.com/x?gclid=b");
    assert.deepEqual(recleanCalls, ["https://example.com/x?gclid=b"]);
  });

  test("null url falls back to the current location href", () => {
    const { pageHistory, recleanCalls } = loadDefuser(OPEN_PREFS);
    pageHistory.pushState({}, "");
    assert.deepEqual(recleanCalls, ["https://example.com/current"]);
  });
});

describe("Firefox history wrap — respects the active-defense gate", () => {
  test("gate CLOSED (MUGA disabled) does NOT call __mugaReclean, but still navigates", () => {
    const { pageHistory, recleanCalls } = loadDefuser({ enabled: false, onboardingDone: true, activeDefenseEnabled: true });
    pageHistory.pushState({}, "", "https://example.com/s?utm_source=a");
    assert.deepEqual(recleanCalls, [], "closed gate must not reclean");
    assert.deepEqual(pageHistory.pushCalls, ["https://example.com/s?utm_source=a"], "navigation must still happen");
  });

  test("gate CLOSED (active-defense turned off) does NOT call __mugaReclean", () => {
    const { pageHistory, recleanCalls } = loadDefuser({ enabled: true, onboardingDone: true, activeDefenseEnabled: false });
    pageHistory.pushState({}, "", "https://example.com/s?utm_source=a");
    assert.deepEqual(recleanCalls, []);
  });
});
