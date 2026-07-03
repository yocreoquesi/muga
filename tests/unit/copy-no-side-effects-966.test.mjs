/**
 * MUGA — #966: copy actions must not mutate stats, session history, or the
 * attribution ledger.
 *
 * Before this fix the popup History copy affordances reprocessed the entry via
 * PROCESS_URL with only `skipNotify: true`. In handleProcessUrl, `skipStats`
 * gated ONLY incrementStat; appendHistory and pushAttributionAndPersist ran
 * unconditionally. So copying an already-counted URL inflated "URLs cleaned",
 * prepended a DUPLICATE session-history row (evicting real entries from the
 * 10-item buffer), and pushed a duplicate ledger event.
 *
 * The fix threads a `skipSideEffects` flag end-to-end: the popup sets it, the
 * PROCESS_URL handler forwards it, and handleProcessUrl gates ALL side effects
 * (stats, domain stats, history, cleaned/passthrough/affiliate logging, and the
 * ledger push) behind it — while still computing the clean URL for the response.
 *
 * service-worker.js and popup.js are browser-only (top-level chrome.*), so we
 * pin the wiring via source inspection, the established pattern for this module
 * (see sw-robustness-833.test.mjs, popup-copy-safe-history.test.mjs).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const SW_SOURCE = readFileSync(resolve(root, "src/background/service-worker.js"), "utf8");
const POPUP_SOURCE = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");

describe("#966 — copy-safe reprocessing skips all side effects", () => {

  test("popup sends skipSideEffects:true on the copy-safe PROCESS_URL", () => {
    assert.ok(
      /type:\s*"PROCESS_URL"[^}]*skipSideEffects:\s*true/.test(POPUP_SOURCE),
      "getCopySafeCleanUrl must send skipSideEffects:true",
    );
  });

  test("handleProcessUrl accepts a skipSideEffects option", () => {
    assert.ok(
      /async function handleProcessUrl\(rawUrl,\s*\{[^}]*skipSideEffects\s*=\s*false/.test(SW_SOURCE),
      "handleProcessUrl must destructure a skipSideEffects option (default false)",
    );
  });

  test("PROCESS_URL handler forwards message.skipSideEffects", () => {
    assert.ok(
      /handleProcessUrl\(message\.url,\s*\{[^}]*skipSideEffects:\s*!!message\.skipSideEffects/.test(SW_SOURCE),
      "the PROCESS_URL message handler must thread skipSideEffects through",
    );
  });

  test("stats increment is gated by both skipStats and skipSideEffects", () => {
    assert.ok(
      SW_SOURCE.includes("if (!skipStats && !skipSideEffects) {"),
      "urlsCleaned/junkRemoved stats must be gated by !skipStats && !skipSideEffects",
    );
  });

  test("appendHistory is gated behind !skipSideEffects", () => {
    // The history write must sit inside a `if (!skipSideEffects)` block.
    const idx = SW_SOURCE.indexOf("await appendHistory(");
    assert.ok(idx !== -1, "appendHistory call must exist");
    const before = SW_SOURCE.slice(Math.max(0, idx - 200), idx);
    assert.ok(
      before.includes("if (!skipSideEffects) {"),
      "appendHistory must be guarded by a !skipSideEffects block",
    );
  });

  test("the attribution ledger push is gated behind !skipSideEffects", () => {
    const idx = SW_SOURCE.indexOf("pushAttributionAndPersist(rawUrl, result, prefs, referrer)");
    assert.ok(idx !== -1, "pushAttributionAndPersist call must exist");
    const before = SW_SOURCE.slice(Math.max(0, idx - 220), idx);
    assert.ok(
      before.includes("if (!skipSideEffects) {"),
      "pushAttributionAndPersist must be guarded by a !skipSideEffects block",
    );
  });

  test("referralsSpotted is not bumped on a copy", () => {
    // Targets the detected_foreign branch INSIDE handleProcessUrl. (A separate
    // INCREMENT_STAT message handler also bumps referralsSpotted; that path is
    // navigation-driven and out of scope, so match the guarded block directly.)
    assert.ok(
      /if \(!skipSideEffects\) \{\s*incrementStat\("referralsSpotted"\)/.test(SW_SOURCE),
      "the handleProcessUrl detected_foreign branch must gate referralsSpotted behind !skipSideEffects",
    );
  });

  test("the selection-copy product behavior is unchanged (still counts once)", () => {
    // Out of scope for #966: copying a text selection of URLs still tallies one
    // cleaned event. Guard against an accidental regression that silences it.
    assert.ok(
      /if \(anyChanged\) incrementStat\("urlsCleaned"\)/.test(SW_SOURCE),
      "selection-copy must keep its single incrementStat(urlsCleaned)",
    );
  });
});
