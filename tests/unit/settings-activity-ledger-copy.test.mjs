/**
 * MUGA — Activity ledger panel copy affordances (#1352).
 *
 * Ports the coverage of two retired popup test files
 * (tests/unit/popup-copy-with-feedback.test.mjs, #935; and
 * tests/unit/popup-copy-safe-history.test.mjs, #946) to options.js, which
 * now owns copyToClipboard/copyWithFeedback/getCopySafeCleanUrl and the
 * "This session" row builder that calls them — all moved verbatim from
 * popup.js as part of merging both ledgers into Settings' unified Activity
 * ledger panel.
 *
 * options.js is a plain DOMContentLoaded script with no exports and
 * top-level chrome.* / document.* references, so it cannot be import-ed in
 * Node (same constraint as every popup-*.test.mjs before it). Structural
 * assertions pin the wiring; getCopySafeCleanUrl is additionally exercised
 * BEHAVIORALLY by evaluating its real source against a fake chrome.runtime.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const optionsSrc = readFileSync(resolve(root, "src/options/options.js"), "utf8");

/** Extracts a top-level `async function <name>(...) { ... }` block via brace matching. */
function extractFunctionSource(src, name) {
  const idx = src.indexOf(`async function ${name}`);
  assert.ok(idx !== -1, `${name} must be defined as an async function`);
  let depth = 0;
  let started = false;
  let i = idx;
  for (; i < src.length; i++) {
    if (src[i] === "{") { depth++; started = true; }
    else if (src[i] === "}") {
      depth--;
      if (started && depth === 0) { i++; break; }
    }
  }
  return src.slice(idx, i);
}

/** Builds a callable getCopySafeCleanUrl bound to a fake `chrome` global. */
function buildGetCopySafeCleanUrl(fakeChrome) {
  const fnSrc = extractFunctionSource(optionsSrc, "getCopySafeCleanUrl");
  const factory = new Function("chrome", `"use strict";\n${fnSrc}\nreturn getCopySafeCleanUrl;`);
  return factory(fakeChrome);
}

describe("#946/#1352 — getCopySafeCleanUrl helper (behavioral, now in options.js)", () => {
  test("reprocesses via PROCESS_URL with skipNotify:true and returns the copy-safe cleanUrl", async () => {
    let sentMessage;
    const fakeChrome = {
      runtime: {
        sendMessage: (msg) => {
          sentMessage = msg;
          return Promise.resolve({ cleanUrl: "https://example.com/clean-no-tag", action: "injected" });
        },
      },
    };
    const getCopySafeCleanUrl = buildGetCopySafeCleanUrl(fakeChrome);
    const result = await getCopySafeCleanUrl("https://example.com/raw?tag=x");

    assert.equal(sentMessage.type, "PROCESS_URL");
    assert.equal(sentMessage.url, "https://example.com/raw?tag=x", "must reprocess the ORIGINAL url, not the stale nav-time clean value");
    assert.equal(sentMessage.skipNotify, true, "must mirror handleProcessUrl's copy-safe effectivePrefs branch");
    assert.equal(sentMessage.skipSideEffects, true, "#966: a copy must NOT re-count stats, duplicate history, or push a ledger event");
    assert.equal(result, "https://example.com/clean-no-tag");
  });

  test("falls back to the tag-free original when the service worker is unreachable", async () => {
    const fakeChrome = { runtime: { sendMessage: () => Promise.reject(new Error("SW unreachable")) } };
    const getCopySafeCleanUrl = buildGetCopySafeCleanUrl(fakeChrome);
    const result = await getCopySafeCleanUrl("https://example.com/raw?utm_source=x");
    assert.equal(result, "https://example.com/raw?utm_source=x");
  });

  test("falls back to the tag-free original when the response has no usable cleanUrl", async () => {
    const fakeChrome = { runtime: { sendMessage: () => Promise.resolve({ action: "error", cleanUrl: null }) } };
    const getCopySafeCleanUrl = buildGetCopySafeCleanUrl(fakeChrome);
    const result = await getCopySafeCleanUrl("https://example.com/raw");
    assert.equal(result, "https://example.com/raw");
  });
});

describe("#946/#1352 — session-history row copy handlers reprocess via getCopySafeCleanUrl", () => {
  test("entry-row click-to-copy calls getCopySafeCleanUrl(entry.original)", () => {
    const idx = optionsSrc.indexOf('entryDiv.addEventListener("click"');
    assert.ok(idx !== -1, "entryDiv click handler must exist");
    const block = optionsSrc.slice(idx, idx + 700);
    assert.ok(block.includes("getCopySafeCleanUrl(entry.original)"));
  });

  test("copy-clean icon button calls getCopySafeCleanUrl(entry.original)", () => {
    const idx = optionsSrc.indexOf('copyCleanBtn.addEventListener("click"');
    assert.ok(idx !== -1, "copyCleanBtn click handler must exist");
    const block = optionsSrc.slice(idx, idx + 500);
    assert.ok(block.includes("getCopySafeCleanUrl(entry.original)"));
  });

  test("copy-original button still copies entry.original directly (never carried a tag)", () => {
    const idx = optionsSrc.indexOf('copyOrigBtn.addEventListener("click"');
    assert.ok(idx !== -1, "copyOrigBtn click handler must exist");
    const block = optionsSrc.slice(idx, idx + 400);
    assert.ok(block.includes("copyWithFeedback(entry.original,"));
  });
});

describe("#935/#1352 — copyWithFeedback helper (now in options.js)", () => {
  test("options.js declares a copyWithFeedback(text, handlers) helper", () => {
    assert.ok(
      /function\s+copyWithFeedback\s*\(\s*text\s*,\s*\{\s*onSuccess\s*,\s*onError\s*,\s*onRevert\s*\}\s*\)/.test(optionsSrc),
    );
  });

  test("copyWithFeedback writes via copyToClipboard and reverts after 1200ms on both outcomes", () => {
    const fnIdx = optionsSrc.indexOf("function copyWithFeedback");
    assert.ok(fnIdx !== -1);
    const body = optionsSrc.slice(fnIdx, fnIdx + 500);
    assert.ok(/copyToClipboard\(\s*text\s*\)/.test(body));
    const revertCalls = body.match(/setTimeout\(\s*onRevert\s*,\s*1200\s*\)/g) || [];
    assert.equal(revertCalls.length, 2, "onRevert must be scheduled on both success and error paths");
  });

  test("all three clipboard call sites (session-history row + recent-activity row) route through copyToClipboard/copyWithFeedback", () => {
    const directEntryCalls = optionsSrc.match(/copyWithFeedback\(\s*entry\.\w+/g) || [];
    assert.equal(directEntryCalls.length, 1, "expected exactly 1 copyWithFeedback(entry.___, ...) call site (copy-original button)");
    const copySafeCalls = optionsSrc.match(/copyWithFeedback\(\s*safeUrl\b/g) || [];
    assert.equal(copySafeCalls.length, 2, "expected exactly 2 copyWithFeedback(safeUrl, ...) call sites (row click, copy-clean button)");
    assert.ok(optionsSrc.includes("await copyToClipboard(row.url)"), "recent-activity row's copy button must call copyToClipboard(row.url)");
  });

  test("copyToClipboard delegates to the shared writeToClipboard() helper, not a bare navigator.clipboard.writeText chain", () => {
    const fnIdx = optionsSrc.indexOf("function copyToClipboard");
    const fnBody = optionsSrc.slice(fnIdx, optionsSrc.indexOf("\n}", fnIdx));
    assert.ok(!/navigator\.clipboard\.writeText\(/.test(fnBody));
    assert.ok(/writeToClipboard\(\s*navigator\.clipboard\s*,/.test(fnBody));
  });

  test("options.js imports writeToClipboard from ../lib/clipboard.js", () => {
    assert.ok(/import\s*\{\s*writeToClipboard\s*\}\s*from\s*["']\.\.\/lib\/clipboard\.js["']/.test(optionsSrc));
  });

  test("copyToClipboard falls back to document.execCommand(\"copy\") (#991, #1098)", () => {
    const fnIdx = optionsSrc.indexOf("function copyToClipboard");
    const body = optionsSrc.slice(fnIdx, fnIdx + 700);
    assert.ok(body.includes('document.execCommand("copy")'));
    assert.ok(/try\s*\{[^}]*document\.execCommand\("copy"\)/.test(body));
  });

  test("session-history row click preserves the 'copied' classList toggle behavior", () => {
    const idx = optionsSrc.indexOf('entryDiv.addEventListener("click"');
    const block = optionsSrc.slice(idx, idx + 700);
    assert.ok(block.includes('entryDiv.classList.add("copied")'));
    assert.ok(block.includes('entryDiv.classList.remove("copied")'));
    assert.ok(block.includes('t("history_copied", lang)'));
  });

  test("copy-clean icon button preserves the icon-swap behavior", () => {
    const idx = optionsSrc.indexOf('copyCleanBtn.addEventListener("click"');
    const block = optionsSrc.slice(idx, idx + 650);
    assert.ok(block.includes('copyCleanBtn.textContent = "✓"'));
    assert.ok(block.includes('copyCleanBtn.textContent = "✗"'));
    assert.ok(block.includes("_setClipboardIcon(copyCleanBtn)"));
  });

  test("copy-original button preserves the label-swap-and-restore behavior", () => {
    const idx = optionsSrc.indexOf('copyOrigBtn.addEventListener("click"');
    const block = optionsSrc.slice(idx, idx + 400);
    assert.ok(block.includes("const origText = copyOrigBtn.textContent"));
    assert.ok(block.includes('t("history_copied", lang)'));
    assert.ok(block.includes("copyOrigBtn.textContent = origText"));
  });
});

describe("popup.js no longer has any clipboard/copy-safe helper (fully moved to options.js)", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");

  for (const name of ["copyToClipboard", "copyWithFeedback", "getCopySafeCleanUrl", "_setClipboardIcon", "_createClipboardSvg"]) {
    test(`popup.js no longer declares ${name}`, () => {
      assert.ok(
        !new RegExp(`function\\s+${name}\\s*\\(`).test(popupSrc),
        `popup.js must not declare ${name} anymore`,
      );
    });
  }
});
