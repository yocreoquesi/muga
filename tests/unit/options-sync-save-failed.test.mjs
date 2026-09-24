/**
 * MUGA — #1430: withSyncMutation silently reported a failed sync write as a
 * success (the boolean `false` that setPrefs resolves to on a storage error
 * was discarded), so addEntry/removeEntry in options.js could tell the user
 * an entry was added/removed when the write never actually persisted.
 *
 * Triage (2026-09-24, REDUCED scope): fix the ignored boolean in
 * withSyncMutation (covered behaviorally in sync-mutation.test.mjs) plus an
 * error toast in addEntry/removeEntry. The byte-budget / list-size-cap work
 * is explicitly out of scope.
 *
 * options.js touches `document` at module scope and cannot be imported
 * directly in a plain Node test (see options-patterns.test.mjs /
 * options-strip-globally-button.test.mjs for the same constraint), so these
 * are source-guard tests against the addEntry/removeEntry function bodies,
 * matching the repo's existing convention for this file.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TRANSLATIONS } from "../../src/lib/i18n.js";
import { SUPPORTED_LANGS } from "../../src/lib/i18n.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "../..");
const optionsJs = readFileSync(join(ROOT, "src/options/options.js"), "utf8");

function getFunctionBody(fnSignature) {
  const start = optionsJs.indexOf(fnSignature);
  assert.ok(start !== -1, `${fnSignature} must exist in options.js`);
  let depth = 0;
  let i = optionsJs.indexOf("{", start);
  const bodyStart = i;
  for (; i < optionsJs.length; i++) {
    if (optionsJs[i] === "{") depth++;
    else if (optionsJs[i] === "}") { depth--; if (depth === 0) break; }
  }
  return optionsJs.slice(bodyStart, i + 1);
}

describe("sync_save_failed: i18n key exists and is non-empty in all supported locales", () => {
  test("sync_save_failed key exists", () => {
    assert.ok(TRANSLATIONS.sync_save_failed, "sync_save_failed must exist");
  });

  test("every supported language has a non-empty sync_save_failed string", () => {
    for (const { code } of SUPPORTED_LANGS) {
      const val = TRANSLATIONS.sync_save_failed[code];
      assert.ok(typeof val === "string" && val.trim().length > 0, `${code} must have a non-empty sync_save_failed`);
    }
  });

  test("no em-dash in sync_save_failed for any locale", () => {
    for (const { code } of SUPPORTED_LANGS) {
      assert.ok(!TRANSLATIONS.sync_save_failed[code].includes("—"), `${code}.sync_save_failed must not contain an em-dash`);
    }
  });
});

describe("addEntry: shows sync_save_failed on a genuine write failure, not on duplicate/cap no-ops", () => {
  const body = getFunctionBody("function addEntry(listKey, inputId, containerId)");

  test("calls showToast(t(\"sync_save_failed\", ...)) somewhere in the write-result handler", () => {
    assert.match(body, /showToast\(t\("sync_save_failed",\s*_currentLang\)\)/);
  });

  test("the sync_save_failed toast fires only when mutateFn did NOT itself abort (duplicate/cap)", () => {
    // The function must track whether mutateFn's own abort paths (duplicate/cap)
    // already ran, so the write-failure toast doesn't ALSO fire for those
    // already-explained no-ops (which show list_full / are silently ignored by
    // design, not sync_save_failed).
    const failedToastIdx = body.indexOf('sync_save_failed');
    assert.ok(failedToastIdx !== -1);
    const before = body.slice(0, failedToastIdx);
    assert.match(before, /aborted/, "addEntry must track an abort flag to distinguish a no-op from a genuine save failure");
  });

  test("still re-renders the list on a successful add (next !== undefined)", () => {
    assert.match(body, /renderList\(containerId,\s*next,\s*listKey\)/);
  });

  // b5-3 audit fix #3: on a genuine write failure, the input used to be
  // cleared unconditionally BEFORE the success/failure branch ran, so a
  // failed add silently discarded what the user typed — "just click Add
  // again" didn't work because there was nothing left to resubmit. Clearing
  // now happens only in the success and aborted (duplicate/cap) branches,
  // not the genuine-failure one. Full behavioral coverage (the input keeps
  // its value and the toast appears) lives in tests/e2e/options.spec.mjs.
  test("input.value is NOT cleared unconditionally before the result is known", () => {
    assert.doesNotMatch(
      body,
      /\}\)\.then\(\(next\)\s*=>\s*\{\s*input\.value\s*=\s*"";/,
      "input.value must not be cleared before checking whether the write actually succeeded",
    );
  });

  test("input.value is cleared on success and on an aborted (duplicate/cap) no-op, not on a genuine failure", () => {
    const successIdx = body.search(/if\s*\(\s*next\s*!==\s*undefined\s*\)\s*\{/);
    assert.ok(successIdx !== -1);
    const successBranch = body.slice(successIdx, body.indexOf("}", successIdx));
    assert.match(successBranch, /input\.value\s*=\s*""/, "the success branch must still clear the input");

    const failedToastIdx = body.indexOf("sync_save_failed");
    const failureBranchStart = body.lastIndexOf("else if", failedToastIdx);
    const failureBranchEnd = body.indexOf("}", failedToastIdx);
    const failureBranch = body.slice(failureBranchStart, failureBranchEnd);
    assert.doesNotMatch(failureBranch, /input\.value\s*=\s*""/, "the genuine-failure branch must NOT clear the input");
  });
});

describe("removeEntry: shows sync_save_failed when the delete write fails", () => {
  const body = getFunctionBody("function removeEntry(listKey, index)");

  test("calls showToast(t(\"sync_save_failed\", ...)) when next is undefined", () => {
    assert.match(body, /showToast\(t\("sync_save_failed",\s*_currentLang\)\)/);
  });

  test("still re-renders the list on a successful delete (next !== undefined)", () => {
    assert.match(body, /renderList\(containerId,\s*next,\s*listKey\)/);
  });

  // b5-3 audit fix #3: removeEntry had no equivalent to addEntry's `aborted`
  // distinction, so an out-of-range index (e.g. a fast double-click on the
  // same delete button for the last item: the first click's write already
  // shortens the list before the second click's pre-captured index is
  // looked up) had no deliberate no-op path to fall into — every undefined
  // result was treated as a genuine save failure.
  test("mutateFn has an early-return bounds check treated as a deliberate no-op, not a failure", () => {
    assert.match(
      body,
      /if\s*\(\s*index\s*<\s*0\s*\|\|\s*index\s*>=\s*list\.length\s*\)\s*\{\s*aborted\s*=\s*true;\s*return\s+undefined;\s*\}/,
      "removeEntry's mutateFn must treat an out-of-range index as an aborted no-op, mirroring addEntry's duplicate/cap early returns",
    );
  });

  test("the sync_save_failed toast fires only when mutateFn did NOT itself abort (out-of-range index)", () => {
    const failedToastIdx = body.indexOf("sync_save_failed");
    assert.ok(failedToastIdx !== -1);
    const before = body.slice(0, failedToastIdx);
    assert.match(before, /aborted/, "removeEntry must track an abort flag to distinguish a no-op from a genuine save failure");
  });
});
