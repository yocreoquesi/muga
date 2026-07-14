/**
 * MUGA — #1098: navigator.clipboard.writeText() throws SYNCHRONOUSLY when
 * navigator.clipboard is undefined, so the document.execCommand("copy")
 * fallback never runs and the user gets no feedback at all.
 *
 * writeToClipboard() extracts the decision logic (Clipboard API vs. legacy
 * fallback) out of popup.js's DOM-bound copyToClipboard() so it can be
 * unit-tested directly with fake clipboard objects, without a real DOM.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { writeToClipboard } from "../../src/lib/clipboard.js";

describe("#1098 — writeToClipboard falls back correctly in every failure shape", () => {
  test("navigator.clipboard undefined: falls through to legacyFallback", async () => {
    let fallbackCalled = false;
    await writeToClipboard(undefined, "hello", () => {
      fallbackCalled = true;
    });
    assert.equal(fallbackCalled, true, "legacyFallback must run when clipboardApi is undefined");
  });

  test("navigator.clipboard is null: falls through to legacyFallback", async () => {
    let fallbackCalled = false;
    await writeToClipboard(null, "hello", () => {
      fallbackCalled = true;
    });
    assert.equal(fallbackCalled, true, "legacyFallback must run when clipboardApi is null");
  });

  test("clipboardApi present but has no writeText function: falls through to legacyFallback", async () => {
    let fallbackCalled = false;
    await writeToClipboard({}, "hello", () => {
      fallbackCalled = true;
    });
    assert.equal(fallbackCalled, true, "legacyFallback must run when writeText is not a function");
  });

  test("writeText() rejecting: falls through to legacyFallback", async () => {
    let fallbackCalled = false;
    const clipboardApi = { writeText: () => Promise.reject(new Error("denied")) };
    await writeToClipboard(clipboardApi, "hello", () => {
      fallbackCalled = true;
    });
    assert.equal(fallbackCalled, true, "legacyFallback must run when writeText() rejects");
  });

  test("writeText() throwing SYNCHRONOUSLY (the #1098 case): falls through to legacyFallback", async () => {
    let fallbackCalled = false;
    const clipboardApi = {
      writeText: () => {
        throw new TypeError("navigator.clipboard is undefined in this context");
      },
    };
    await writeToClipboard(clipboardApi, "hello", () => {
      fallbackCalled = true;
    });
    assert.equal(fallbackCalled, true, "legacyFallback must run when writeText() throws synchronously instead of rejecting");
  });

  test("writeText() succeeding: legacyFallback is NOT called, promise resolves", async () => {
    let fallbackCalled = false;
    const clipboardApi = { writeText: () => Promise.resolve() };
    await writeToClipboard(clipboardApi, "hello", () => {
      fallbackCalled = true;
    });
    assert.equal(fallbackCalled, false, "legacyFallback must not run when the Clipboard API succeeds");
  });

  test("both the Clipboard API and legacyFallback fail: the returned promise rejects", async () => {
    const clipboardApi = { writeText: () => Promise.reject(new Error("denied")) };
    await assert.rejects(
      () => writeToClipboard(clipboardApi, "hello", () => {
        throw new Error("execCommand also failed");
      }),
      /execCommand also failed/,
    );
  });

  test("clipboard undefined AND legacyFallback fails: the returned promise still rejects (no silent success)", async () => {
    await assert.rejects(
      () => writeToClipboard(undefined, "hello", () => {
        throw new Error("execCommand also failed");
      }),
      /execCommand also failed/,
    );
  });
});
