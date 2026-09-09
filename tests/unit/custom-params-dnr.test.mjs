/**
 * MUGA — Unit tests for syncCustomParamsDNR() (#1104, #1266 item 5, #1268)
 *
 * This file used to say it "Mirrors the FIXED syncCustomParamsDNR() in
 * service-worker.js exactly" — a hand-written reimplementation with no
 * generator and no structural check tying it to the original, plus a
 * `swSource.indexOf`/`.slice` source-region guard scraping production text
 * for the empty-guard fix. Both are the exact debt #1268 is about: a mirror
 * that drifts keeps passing while shipped behaviour changes, and a source
 * scrape only proves a string is present, not that the function behaves.
 *
 * `syncCustomParamsDNR` moved to src/background/dnr-sync.js (#1266 item 5),
 * which is importable in Node with a stubbed `chrome`. So this file now
 * imports the REAL function and exercises it directly — no mirror, no source
 * scrape, and every assertion below runs against the shipped implementation.
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

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { DNR_CUSTOM_PARAMS_RULE_ID } from "../../src/lib/dnr-ids.js";

// ── Stub chrome BEFORE importing dnr-sync.js ─────────────────────────────────
//
// dnr-sync.js reads `globalThis.chrome` lazily (hasDNR() / the sync functions
// themselves), so the stub just needs to exist before the calls run — but it
// must exist before the module's exported functions are invoked, so it is
// installed here, synchronously, before the dynamic import below.

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

let fakeDnr;
let syncCustomParamsDNR;

before(async () => {
  globalThis.chrome = {
    declarativeNetRequest: {
      updateDynamicRules: (opts) => fakeDnr.updateDynamicRules(opts),
    },
  };
  ({ syncCustomParamsDNR } = await import("../../src/background/dnr-sync.js"));
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("syncCustomParamsDNR — empty resolved param list is a no-op registration guard (#1104)", () => {
  test("all-invalid customParams (fail the format filter) → remove-only update, no addRules", async () => {
    fakeDnr = makeFakeDnr();
    await syncCustomParamsDNR(["!!!", "###", "  "]);

    assert.strictEqual(fakeDnr.calls.length, 1);
    const call = fakeDnr.calls[0];
    assert.deepEqual(call.removeRuleIds, [DNR_CUSTOM_PARAMS_RULE_ID]);
    assert.deepEqual(call.addRules, [], "must not register a rule with an empty removeParams transform");
  });

  test("mixed valid + invalid customParams → rule registered with only the valid, normalized entries", async () => {
    fakeDnr = makeFakeDnr();
    await syncCustomParamsDNR(["Valid_Param", "!!!invalid"]);

    const call = fakeDnr.calls[0];
    assert.strictEqual(call.addRules.length, 1);
    assert.deepEqual(call.addRules[0].action.redirect.transform.queryTransform.removeParams, ["valid_param"]);
  });

  test("empty array customParams → remove-only update (pre-existing behavior, unchanged)", async () => {
    fakeDnr = makeFakeDnr();
    await syncCustomParamsDNR([]);

    const call = fakeDnr.calls[0];
    assert.deepEqual(call.addRules, []);
  });

  test("null/undefined customParams → remove-only update (pre-existing behavior, unchanged)", async () => {
    fakeDnr = makeFakeDnr();
    await syncCustomParamsDNR(undefined);

    const call = fakeDnr.calls[0];
    assert.deepEqual(call.addRules, []);
  });
});
