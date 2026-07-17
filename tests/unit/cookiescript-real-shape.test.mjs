/**
 * MUGA — CookieScript Tier 1 adapter: real-site detection regression.
 *
 * EU real-site verification (2026-07-17, engram
 * sdd/cookie-consent-coverage/eu-real-site-verification) found that on the
 * real cookie-script.com deployment `typeof window.CookieScript` is
 * `"function"`, NOT `"object"`. MUGA's mandatory detection gate computed
 * `hasCookieScriptGlobal` as `typeof window.CookieScript === "object"`
 * (src/content/cookie-noise-mainworld.js's `collectSignals`, and the
 * `wrappedJSObject`-mediated equivalent in src/content/cookie-noise.js's
 * `fxCollectSignals`) — so the mandatory gate NEVER fires on the real
 * vendor shape, even though `window.CookieScript.instance.rejectAllAction()`
 * works and would successfully reject.
 *
 * This test loads the REAL `collectSignals`/`fxCollectSignals` functions
 * (extracted verbatim from the content-script source, not re-typed) against
 * a synthetic `window` shaped exactly like the real cookie-script.com
 * deployment, then threads the result through the real
 * `cookieScriptAdapter` from src/lib/cmp-adapters.js — proving the full,
 * real detection pipeline (not just hand-typed boolean signals) now
 * recognizes the vendor's actual shape while still rejecting non-matches.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { cookieScriptAdapter, didomiAdapter } from "../../src/lib/cmp-adapters.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAINWORLD_SRC = readFileSync(
  resolve(__dirname, "../../src/content/cookie-noise-mainworld.js"),
  "utf8"
);
const ISOLATED_SRC = readFileSync(resolve(__dirname, "../../src/content/cookie-noise.js"), "utf8");

/**
 * Extracts a named function's full source (from `function <name>(` through
 * its matching closing brace) via string-aware brace counting. Used instead
 * of a hardcoded line range so the test keeps working across unrelated
 * edits elsewhere in the file.
 */
function extractFunction(source, name) {
  const anchor = `function ${name}(`;
  const start = source.indexOf(anchor);
  assert.ok(start !== -1, `could not find "${anchor}" in source`);
  const braceStart = source.indexOf("{", start);
  assert.ok(braceStart !== -1, `could not find opening brace for ${name}`);

  let depth = 0;
  let inString = null;
  let i = braceStart;
  for (; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];
    if (inString) {
      if (ch === inString && prev !== "\\") inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  assert.ok(depth === 0, `unbalanced braces while extracting ${name}`);
  return source.slice(start, i);
}

/** Runs the real, extracted `collectSignals()` against a fake window/document. */
function runCollectSignals(window, document) {
  const fnSrc = extractFunction(MAINWORLD_SRC, "collectSignals");
  const run = new Function("window", "document", `${fnSrc}\nreturn collectSignals();`);
  return run(window, document);
}

/** Runs the real, extracted `fxCollectSignals()` against a fake window/document. */
function runFxCollectSignals(window, document) {
  const fnSrc = extractFunction(ISOLATED_SRC, "fxCollectSignals");
  const run = new Function("window", "document", `${fnSrc}\nreturn fxCollectSignals();`);
  return run(window, document);
}

/** Minimal DOM stub exposing only what collectSignals reads. */
function makeDocument({ injected = false, description = false } = {}) {
  return {
    getElementById(id) {
      if (id === "cookiescript_injected") return injected ? {} : null;
      if (id === "cookiescript_description") return description ? {} : null;
      return null;
    },
    querySelector() {
      return null;
    },
    body: { classList: { contains: () => false } },
  };
}

/** The real cookie-script.com shape: window.CookieScript is a FUNCTION with .instance. */
function makeRealShapeCookieScriptGlobal() {
  const rejectCalls = [];
  function CookieScript() {}
  CookieScript.instance = {
    rejectAllAction() {
      rejectCalls.push("rejectAllAction");
    },
  };
  return { CookieScript, rejectCalls };
}

describe("cookie-noise-mainworld.js collectSignals — CookieScript real-site shape (function, not object)", () => {
  test("window.CookieScript as a FUNCTION with .instance.rejectAllAction -> hasCookieScriptGlobal true", () => {
    const { CookieScript } = makeRealShapeCookieScriptGlobal();
    const window = { CookieScript };
    const document = makeDocument({ injected: true, description: true });

    const signals = runCollectSignals(window, document);

    assert.equal(signals.hasCookieScriptGlobal, true);
    assert.equal(signals.hasCookieScriptInstance, true);
    assert.equal(signals.hasRejectAllActionFn, true);
  });

  test("real-shape signals threaded through the real cookieScriptAdapter -> detect + canReject true", () => {
    const { CookieScript } = makeRealShapeCookieScriptGlobal();
    const window = { CookieScript };
    const document = makeDocument({ injected: true, description: true });

    const signals = runCollectSignals(window, document);

    assert.ok(cookieScriptAdapter.detect(signals) >= 1);
    assert.equal(cookieScriptAdapter.canReject(signals), true);
  });

  test("discrimination preserved: bare object global with NO .instance still fails closed", () => {
    const window = { CookieScript: {} };
    const document = makeDocument({ injected: true, description: true });

    const signals = runCollectSignals(window, document);

    assert.equal(signals.hasCookieScriptGlobal, true);
    assert.equal(signals.hasCookieScriptInstance, false);
    assert.equal(cookieScriptAdapter.canReject(signals), false);
  });

  test("discrimination preserved: no CookieScript global at all (Didomi-shaped page) never crosses over", () => {
    const window = {
      Didomi: {
        setUserDisagreeToAll() {},
        getCurrentUserStatus() {
          return {};
        },
      },
    };
    const document = makeDocument({ injected: false, description: false });

    const signals = runCollectSignals(window, document);

    assert.equal(signals.hasCookieScriptGlobal, false);
    assert.equal(cookieScriptAdapter.canReject(signals), false);
    // The point here is solely that the CookieScript adapter never claims a
    // non-CookieScript page (a real Didomi-shaped page, in this case) —
    // Didomi's own adapter firing on its own page is expected and unrelated
    // to this regression.
    assert.equal(didomiAdapter.canReject(signals), true);
  });
});

describe("cookie-noise.js fxCollectSignals — CookieScript real-site shape via wrappedJSObject (Firefox)", () => {
  test("wrappedJSObject.CookieScript as a FUNCTION with .instance.rejectAllAction -> hasCookieScriptGlobal true", () => {
    const { CookieScript } = makeRealShapeCookieScriptGlobal();
    const window = { wrappedJSObject: { CookieScript } };
    const document = makeDocument({ injected: true, description: true });

    const signals = runFxCollectSignals(window, document);

    assert.equal(signals.hasCookieScriptGlobal, true);
    assert.equal(signals.hasCookieScriptInstance, true);
    assert.equal(signals.hasRejectAllActionFn, true);
    assert.equal(cookieScriptAdapter.canReject(signals), true);
  });

  test("discrimination preserved: bare function global with NO .instance still fails closed (Firefox)", () => {
    function CookieScript() {}
    const window = { wrappedJSObject: { CookieScript } };
    const document = makeDocument({ injected: true, description: true });

    const signals = runFxCollectSignals(window, document);

    assert.equal(signals.hasCookieScriptGlobal, true);
    assert.equal(signals.hasCookieScriptInstance, false);
    assert.equal(cookieScriptAdapter.canReject(signals), false);
  });
});
