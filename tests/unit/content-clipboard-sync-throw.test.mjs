/**
 * MUGA — #1110: content/cleaner.js's copyToClipboard() had the same
 * synchronous-throw bug fixed in popup.js by #1098.
 *
 * `navigator.clipboard.writeText(text).catch(fallback)` throws
 * SYNCHRONOUSLY (instead of rejecting a Promise) when `navigator.clipboard`
 * itself is `undefined` — some restricted WebExtension contexts (e.g.
 * Firefox for Android) don't expose it at all. A synchronous throw never
 * reaches `.catch()`, so the `document.execCommand("copy")` legacy fallback
 * never ran and the copy failed silently, with no fallback attempted.
 *
 * content/cleaner.js is loaded by the manifest as a raw classic script (see
 * its own header comment and src/manifest.json's content_scripts list) — it
 * is NOT part of the esbuild content bundle (that's cleaner-bundle-src.mjs,
 * built from src/lib/ into cleaner-bundle.js). So it cannot `import` the
 * `writeToClipboard` helper from src/lib/clipboard.js (already unit-tested
 * in tests/unit/clipboard.test.mjs for the popup.js fix) and instead needs
 * its own inlined copy of the same guarded decision logic, mirroring the
 * established pattern this file already uses for other pure-logic mirrors
 * (e.g. computeRecleanTarget mirrors src/lib/reclean-target.js,
 * INLINE_AFFILIATE_REDIRECT_NETWORKS mirrors src/lib/opaque-networks.js).
 *
 * ## Why a `vm` harness
 *
 * Content scripts cannot be `import`-ed (no ES modules; top-level
 * `chrome.*` / `window.*` / `document.*` references). Per the #951/#946
 * precedent in content-cleaner-patterns.test.mjs and
 * content-copy-safe-injection.test.mjs, we execute the raw source text
 * inside a fresh `vm` context with minimal browser-global stand-ins and
 * dispatch a synthetic COPY_TO_CLIPBOARD runtime message (the direct
 * `copyToClipboard()` call site), observing whether the legacy
 * `document.execCommand("copy")` fallback actually ran.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cleanerSource = readFileSync(join(__dirname, "../../src/content/cleaner.js"), "utf8");

function mockFetch(url) {
  if (url.includes("domain-rules.json")) return Promise.resolve({ json: () => Promise.resolve([]) });
  if (url.includes("path-strip-rules.json")) return Promise.resolve({ json: () => Promise.resolve([]) });
  if (url.includes("path-affiliate-rules.json")) return Promise.resolve({ json: () => Promise.resolve([]) });
  return Promise.reject(new Error("unexpected fetch: " + url));
}

/**
 * Runs content/cleaner.js in a vm sandbox, then dispatches a synthetic
 * COPY_TO_CLIPBOARD runtime message — the message type whose handler calls
 * `copyToClipboard(message.text)` directly (see cleaner.js's onMessage
 * listener, last branch).
 *
 * @returns {Promise<{ threwSynchronously: Error|null, execCommandCalled: boolean, textareaValue: string|null }>}
 */
function runCopyToClipboardMessage({ clipboardApi, text = "hello https://example.com" }) {
  return new Promise((resolve, reject) => {
    let messageListener;
    let execCommandCalled = false;
    let textareaValue = null;

    const fakeTextarea = {
      style: {},
      setAttribute() {},
      set value(v) { textareaValue = v; },
      get value() { return textareaValue; },
      focus() {},
      select() {},
      remove() {},
    };

    const fakeDocument = {
      addEventListener: () => {},
      getElementById: () => null,
      createElement: () => fakeTextarea,
      execCommand: () => { execCommandCalled = true; return true; },
      documentElement: {},
      body: { appendChild() {} },
      querySelector: () => null,
      readyState: "complete",
      referrer: "",
    };

    const fakeLocation = { href: "https://page.example/", hostname: "page.example", pathname: "/" };
    const fakeWindow = {
      location: fakeLocation,
      getSelection: () => ({ toString: () => "" }),
      open: () => {},
    };
    fakeWindow.self = fakeWindow;
    fakeWindow.top = fakeWindow;
    fakeWindow.__mugaCleaner = { processUrl: () => null, isGenericShortener: () => false };

    const fakeChrome = {
      runtime: {
        id: "test-ext-id",
        lastError: null,
        getURL: (path) => path,
        onMessage: { addListener: (fn) => { messageListener = fn; } },
        sendMessage: (msg, cb) => {
          if (msg && msg.type === "getPrefs" && typeof cb === "function") cb({ enabled: true, onboardingDone: true });
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
      navigator: { language: "en", clipboard: clipboardApi },
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
    // chains settle before dispatching, same as the #946 harness.
    setTimeout(() => {
      if (typeof messageListener !== "function") {
        reject(new Error("chrome.runtime.onMessage listener was not registered"));
        return;
      }
      let threwSynchronously = null;
      try {
        messageListener({ type: "COPY_TO_CLIPBOARD", text }, { id: "test-ext-id" }, () => {});
      } catch (err) {
        threwSynchronously = err;
      }
      setTimeout(() => resolve({ threwSynchronously, execCommandCalled, textareaValue }), 20);
    }, 20);
  });
}

describe("#1110 — content script copyToClipboard falls back correctly in every failure shape", () => {
  test("navigator.clipboard undefined: does not throw synchronously, execCommand fallback runs", async () => {
    const { threwSynchronously, execCommandCalled, textareaValue } =
      await runCopyToClipboardMessage({ clipboardApi: undefined });
    assert.equal(threwSynchronously, null, "COPY_TO_CLIPBOARD handling must not throw synchronously when navigator.clipboard is undefined");
    assert.equal(execCommandCalled, true, "execCommand fallback must run when navigator.clipboard is undefined");
    assert.equal(textareaValue, "hello https://example.com");
  });

  test("writeText() throws synchronously (the #1110 case): execCommand fallback runs", async () => {
    const clipboardApi = {
      writeText: () => { throw new TypeError("navigator.clipboard is undefined in this context"); },
    };
    const { threwSynchronously, execCommandCalled } = await runCopyToClipboardMessage({ clipboardApi });
    assert.equal(threwSynchronously, null, "COPY_TO_CLIPBOARD handling must not propagate a synchronous throw from writeText()");
    assert.equal(execCommandCalled, true, "execCommand fallback must run when writeText() throws synchronously");
  });

  test("writeText() rejecting: execCommand fallback runs", async () => {
    const clipboardApi = { writeText: () => Promise.reject(new Error("denied")) };
    const { threwSynchronously, execCommandCalled } = await runCopyToClipboardMessage({ clipboardApi });
    assert.equal(threwSynchronously, null);
    assert.equal(execCommandCalled, true, "execCommand fallback must run when writeText() rejects");
  });

  test("writeText() succeeding: execCommand fallback does NOT run", async () => {
    let written = null;
    const clipboardApi = { writeText: (t) => { written = t; return Promise.resolve(); } };
    const { threwSynchronously, execCommandCalled } = await runCopyToClipboardMessage({ clipboardApi });
    assert.equal(threwSynchronously, null);
    assert.equal(execCommandCalled, false, "execCommand fallback must not run when the Clipboard API succeeds");
    assert.equal(written, "hello https://example.com");
  });
});
