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
});

describe("removeEntry: shows sync_save_failed when the delete write fails", () => {
  const body = getFunctionBody("function removeEntry(listKey, index)");

  test("calls showToast(t(\"sync_save_failed\", ...)) when next is undefined", () => {
    assert.match(body, /showToast\(t\("sync_save_failed",\s*_currentLang\)\)/);
  });

  test("still re-renders the list on a successful delete (next !== undefined)", () => {
    assert.match(body, /renderList\(containerId,\s*next,\s*listKey\)/);
  });
});
