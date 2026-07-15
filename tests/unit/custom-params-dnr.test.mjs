/**
 * MUGA — Unit tests for syncCustomParamsDNR() (#1104)
 *
 * The service worker has no behavioral unit harness (chrome.* bindings at
 * module scope — see the same note in tests/unit/allowlist-dnr.test.mjs and
 * tests/unit/dnr-consent-gate.test.mjs), so this file follows that
 * established pattern: a pure extraction of the sync algorithm exercised
 * against a fake declarativeNetRequest facade, plus a source guard confirming
 * the production service-worker.js actually carries the empty-guard fix.
 *
 * Bug (#1104): when every entry in customParams fails the format filter
 * (`/^[a-zA-Z0-9_.-]+$/`), `normalized` resolves to an empty array, and the
 * old code unconditionally registered a DNR rule with
 * `removeParams: normalized` — i.e. `removeParams: []`. That is a no-op /
 * invalid rule that pollutes the dynamic rule table for no purpose. The fix
 * mirrors the empty-guard pattern already used by remote-rules.js's
 * mergeIntoCache() (#923): an empty resolved param list is treated exactly
 * like "no customParams at all" — remove any stale rule, add nothing.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { DNR_CUSTOM_PARAMS_RULE_ID } from "../../src/lib/dnr-ids.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const swSource = readFileSync(
  join(__dirname, "../../src/background/service-worker.js"),
  "utf8"
);

// ── Pure implementation under test ───────────────────────────────────────────
//
// Mirrors the FIXED syncCustomParamsDNR() in service-worker.js exactly (same
// filter/normalize logic, same rule shape, same empty-guard), wired to a fake
// DNR facade so the exact calls can be asserted without a browser.

async function syncCustomParamsDNRLogic(customParams, dnrApi) {
  if (!customParams || customParams.length === 0) {
    await dnrApi.updateDynamicRules({
      removeRuleIds: [DNR_CUSTOM_PARAMS_RULE_ID],
      addRules: [],
    });
    return;
  }
  const normalized = customParams
    .filter(p => /^[a-zA-Z0-9_.-]+$/.test(p.trim()))
    .map(p => p.trim().toLowerCase());

  if (normalized.length === 0) {
    await dnrApi.updateDynamicRules({
      removeRuleIds: [DNR_CUSTOM_PARAMS_RULE_ID],
      addRules: [],
    });
    return;
  }

  await dnrApi.updateDynamicRules({
    removeRuleIds: [DNR_CUSTOM_PARAMS_RULE_ID],
    addRules: [{
      id: DNR_CUSTOM_PARAMS_RULE_ID,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { transform: { queryTransform: { removeParams: normalized } } },
      },
      condition: { urlFilter: "*", resourceTypes: ["main_frame"] },
    }],
  });
}

function makeFakeDnr() {
  const calls = [];
  return {
    calls,
    updateDynamicRules(opts) {
      calls.push(structuredClone(opts));
      return Promise.resolve();
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("syncCustomParamsDNR — empty resolved param list is a no-op registration guard (#1104)", () => {
  test("all-invalid customParams (fail the format filter) → remove-only update, no addRules", async () => {
    const dnr = makeFakeDnr();
    await syncCustomParamsDNRLogic(["!!!", "###", "  "], dnr);

    assert.strictEqual(dnr.calls.length, 1);
    const call = dnr.calls[0];
    assert.deepEqual(call.removeRuleIds, [DNR_CUSTOM_PARAMS_RULE_ID]);
    assert.deepEqual(call.addRules, [], "must not register a rule with an empty removeParams transform");
  });

  test("mixed valid + invalid customParams → rule registered with only the valid, normalized entries", async () => {
    const dnr = makeFakeDnr();
    await syncCustomParamsDNRLogic(["Valid_Param", "!!!invalid"], dnr);

    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, 1);
    assert.deepEqual(call.addRules[0].action.redirect.transform.queryTransform.removeParams, ["valid_param"]);
  });

  test("empty array customParams → remove-only update (pre-existing behavior, unchanged)", async () => {
    const dnr = makeFakeDnr();
    await syncCustomParamsDNRLogic([], dnr);

    const call = dnr.calls[0];
    assert.deepEqual(call.addRules, []);
  });

  test("null/undefined customParams → remove-only update (pre-existing behavior, unchanged)", async () => {
    const dnr = makeFakeDnr();
    await syncCustomParamsDNRLogic(undefined, dnr);

    const call = dnr.calls[0];
    assert.deepEqual(call.addRules, []);
  });
});

// ── Source-level guard: verify the production SW carries the empty-guard ────
//
// The service worker cannot be imported in Node (chrome.* at module scope),
// so — same as tests/unit/allowlist-dnr.test.mjs — a region is extracted once
// and checked for the empty-post-filter guard that prevents registering a DNR
// rule with an empty removeParams transform.

describe("syncCustomParamsDNR — production source guard (#1104)", () => {
  const fnStart = swSource.indexOf("async function syncCustomParamsDNR(");
  const fnEnd = swSource.indexOf("\n}\n", fnStart);
  const fnBlock = swSource.slice(fnStart, fnEnd);

  test("syncCustomParamsDNR is present in service-worker.js", () => {
    assert.ok(fnStart !== -1, "syncCustomParamsDNR function not found in service-worker.js");
  });

  test("guards against registering a rule when the normalized param list is empty", () => {
    assert.ok(
      /normalized\.length\s*===\s*0/.test(fnBlock),
      "syncCustomParamsDNR must skip rule registration when the post-filter normalized param list is empty (#1104)"
    );
  });
});
