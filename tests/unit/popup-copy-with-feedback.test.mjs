/**
 * MUGA — #935: shared copyWithFeedback() helper for the popup's three
 * clipboard flows (history-entry click, copy-clean icon button,
 * copy-original button).
 *
 * Follows the source-grep convention used across the popup-*.test.mjs
 * family (popup.js is a plain DOMContentLoaded script with no exports, so
 * these tests pin structure/behavior at the source level rather than
 * importing + executing the module).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");

describe("#935 — copyWithFeedback helper extracted and shared", () => {
  test("popup.js declares a copyWithFeedback(text, handlers) helper", () => {
    assert.ok(
      /function\s+copyWithFeedback\s*\(\s*text\s*,\s*\{\s*onSuccess\s*,\s*onError\s*,\s*onRevert\s*\}\s*\)/.test(popupSrc),
      "popup.js must declare copyWithFeedback(text, { onSuccess, onError, onRevert })",
    );
  });

  test("copyWithFeedback writes to the clipboard (via copyToClipboard) and reverts after exactly 1200ms on both outcomes", () => {
    const fnIdx = popupSrc.indexOf("function copyWithFeedback");
    assert.ok(fnIdx !== -1, "copyWithFeedback must be defined");
    const body = popupSrc.slice(fnIdx, fnIdx + 500);
    // #991: copyWithFeedback routes through the shared copyToClipboard()
    // helper (Clipboard API + document.execCommand("copy") legacy fallback)
    // instead of calling navigator.clipboard.writeText directly, so copy
    // still works in restricted popup contexts (e.g. Android WebExtension).
    assert.ok(/copyToClipboard\(\s*text\s*\)/.test(body), "must call copyToClipboard(text)");
    const revertCalls = body.match(/setTimeout\(\s*onRevert\s*,\s*1200\s*\)/g) || [];
    assert.equal(revertCalls.length, 2, "onRevert must be scheduled via setTimeout(onRevert, 1200) on both the success and error paths");
  });

  test("all three clipboard call sites route through copyWithFeedback", () => {
    // #946: the history-entry click and copy-clean button no longer copy
    // `entry.clean` (the value stored at navigation time, computed with
    // injectOwnAffiliate ON) directly — they reprocess copy-safe via
    // getCopySafeCleanUrl(entry.original) first and pass the
    // resolved `safeUrl` into copyWithFeedback. Only copy-original still
    // copies `entry.original` directly (it was never MUGA-tagged to begin
    // with, so it needs no reprocessing).
    const directEntryCalls = popupSrc.match(/copyWithFeedback\(\s*entry\.\w+/g) || [];
    assert.equal(
      directEntryCalls.length,
      1,
      `expected exactly 1 copyWithFeedback(entry.___, ...) call site (copy-original button); found ${directEntryCalls.length}`,
    );
    const copySafeCalls = popupSrc.match(/copyWithFeedback\(\s*safeUrl\b/g) || [];
    assert.equal(
      copySafeCalls.length,
      2,
      `expected exactly 2 copyWithFeedback(safeUrl, ...) call sites (history-entry click, copy-clean button); found ${copySafeCalls.length}`,
    );
  });

  test("no call site still hand-rolls its own navigator.clipboard.writeText(...).then/.catch pattern", () => {
    // #991: navigator.clipboard.writeText is now called from exactly ONE
    // place — inside the shared copyToClipboard(text) helper, which adds the
    // document.execCommand("copy") legacy fallback (mirroring
    // src/content/cleaner.js) for contexts where the Clipboard API is
    // unavailable or blocked (e.g. some Android WebExtension popups).
    // copyWithFeedback and showRecentActivity's per-row copy button both
    // route through copyToClipboard() instead of calling writeText directly.
    const writeTextCalls = [...popupSrc.matchAll(/navigator\.clipboard\.writeText\(/g)];
    assert.equal(
      writeTextCalls.length,
      1,
      `expected exactly 1 direct navigator.clipboard.writeText(...) call site (inside copyToClipboard) after the #991 fallback extraction; found ${writeTextCalls.length}`,
    );
    // Exactly one definition, and exactly the two intended call sites.
    // (Doc-comment prose may also mention "copyToClipboard()" by name, so a
    // raw substring count would over-match — check the specific code shapes
    // instead.)
    assert.equal(
      (popupSrc.match(/function copyToClipboard\(text\)/g) || []).length,
      1,
      "copyToClipboard(text) must be defined exactly once",
    );
    assert.ok(/copyWithFeedback\(text, \{ onSuccess, onError, onRevert \}\) \{\s*copyToClipboard\(text\)/.test(popupSrc), "copyWithFeedback must call copyToClipboard(text)");
    assert.ok(popupSrc.includes("await copyToClipboard(row.url)"), "showRecentActivity's row copy button must call copyToClipboard(row.url)");
  });

  test("copyToClipboard falls back to document.execCommand(\"copy\") when the Clipboard API rejects (#991)", () => {
    const fnIdx = popupSrc.indexOf("function copyToClipboard");
    assert.ok(fnIdx !== -1, "popup.js must declare a copyToClipboard(text) helper");
    const body = popupSrc.slice(fnIdx, fnIdx + 700);
    assert.ok(/navigator\.clipboard\.writeText\(\s*text\s*\)/.test(body), "must attempt the Clipboard API first");
    assert.ok(/\.catch\(/.test(body), "must catch a Clipboard API rejection to trigger the fallback");
    assert.ok(body.includes('document.execCommand("copy")'), "must fall back to document.execCommand(\"copy\")");
    assert.ok(/try\s*\{[^}]*document\.execCommand\("copy"\)/.test(body), "execCommand call must be wrapped in try/catch, matching cleaner.js's defensive pattern");
  });

  test("history-entry click preserves the 'copied' classList toggle behavior", () => {
    const idx = popupSrc.indexOf('entryDiv.addEventListener("click"');
    assert.ok(idx !== -1, "entryDiv click handler must exist");
    const block = popupSrc.slice(idx, idx + 700);
    assert.ok(block.includes('entryDiv.classList.add("copied")'), "must still add the copied class on success");
    assert.ok(block.includes('entryDiv.classList.remove("copied")'), "must still remove the copied class on revert");
    assert.ok(block.includes('t("history_copied", lang)'), "must still show the translated copied label on success");
  });

  test("copy-clean icon button preserves the icon-swap + fontSize behavior", () => {
    const idx = popupSrc.indexOf('copyCleanBtn.addEventListener("click"');
    assert.ok(idx !== -1, "copyCleanBtn click handler must exist");
    // #946: window widened from 500 — the handler now wraps its body in
    // getCopySafeCleanUrl(...).then(...), pushing the icon-swap/revert
    // calls further from the listener's opening line.
    const block = popupSrc.slice(idx, idx + 650);
    assert.ok(block.includes('copyCleanBtn.textContent = "✓"'), "must still show ✓ on success");
    assert.ok(block.includes('copyCleanBtn.textContent = "✗"'), "must still show ✗ on failure");
    assert.ok(block.includes('_setClipboardIcon(copyCleanBtn)'), "must still restore the clipboard icon on revert");
  });

  test("copy-original button preserves the label-swap-and-restore behavior", () => {
    const idx = popupSrc.indexOf('copyOrigBtn.addEventListener("click"');
    assert.ok(idx !== -1, "copyOrigBtn click handler must exist");
    const block = popupSrc.slice(idx, idx + 400);
    assert.ok(block.includes("const origText = copyOrigBtn.textContent"), "must still capture the original label before writing");
    assert.ok(block.includes('t("history_copied", lang)'), "must still show the translated copied label on success");
    assert.ok(block.includes('copyOrigBtn.textContent = "✗"'), "must still show ✗ on failure");
    assert.ok(block.includes("copyOrigBtn.textContent = origText"), "must still restore the original label on revert");
  });
});
