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

  test("copyWithFeedback writes to the clipboard and reverts after exactly 1200ms on both outcomes", () => {
    const fnIdx = popupSrc.indexOf("function copyWithFeedback");
    assert.ok(fnIdx !== -1, "copyWithFeedback must be defined");
    const body = popupSrc.slice(fnIdx, fnIdx + 500);
    assert.ok(/navigator\.clipboard\.writeText\(\s*text\s*\)/.test(body), "must call navigator.clipboard.writeText(text)");
    const revertCalls = body.match(/setTimeout\(\s*onRevert\s*,\s*1200\s*\)/g) || [];
    assert.equal(revertCalls.length, 2, "onRevert must be scheduled via setTimeout(onRevert, 1200) on both the success and error paths");
  });

  test("all three clipboard call sites route through copyWithFeedback", () => {
    const calls = popupSrc.match(/copyWithFeedback\(\s*entry\.\w+/g) || [];
    assert.equal(
      calls.length,
      3,
      `expected 3 copyWithFeedback(entry.___, ...) call sites (history-entry click, copy-clean button, copy-original button); found ${calls.length}`,
    );
  });

  test("no call site still hand-rolls its own navigator.clipboard.writeText(...).then/.catch pattern", () => {
    // Only the copyWithFeedback definition itself may call writeText directly.
    const writeTextCalls = [...popupSrc.matchAll(/navigator\.clipboard\.writeText\(/g)];
    // The showRecentActivity per-row copy button (#460) uses its own await/try-catch
    // flow (different shape entirely — no revert-to-previous-label semantics), so it
    // is intentionally out of scope for #935 and still calls writeText directly.
    // Expected surviving direct call sites: copyWithFeedback's own body (1) +
    // showRecentActivity's per-row copy button (1).
    assert.equal(
      writeTextCalls.length,
      2,
      `expected exactly 2 direct navigator.clipboard.writeText(...) call sites after the #935 extraction (copyWithFeedback itself + the unrelated showRecentActivity row-copy flow); found ${writeTextCalls.length}`,
    );
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
    const block = popupSrc.slice(idx, idx + 500);
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
