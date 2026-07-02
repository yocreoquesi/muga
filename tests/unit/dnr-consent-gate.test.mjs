/**
 * MUGA — Unit tests for applyDnrState() consent-gate fix (#810)
 *
 * Behavioral tests using a fake chrome.declarativeNetRequest facade.
 * Verifies that:
 *   1. Gate closed (onboardingDone:false) → ALL declared rulesets disabled
 *   2. Gate closed (enabled:false) → ALL declared rulesets disabled
 *   3. Gate open + ampRedirect:false + unwrapRedirects:true → amp_redirect disabled,
 *      wrapper_unwrap + tracking_params enabled
 *   4. MV2 shape (manifest with only tracking_params) → only tracking_params referenced
 *
 * Approach: extract applyDnrState as a pure function via dependency injection —
 * the production function is tightly coupled to the SW module. We test the logic
 * by replicating the algorithm here against a fake chrome facade.  This keeps
 * tests behavioral and decoupled from source string contents per ADR-#824.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const swSource = readFileSync(
  join(__dirname, "../../src/background/service-worker.js"),
  "utf8"
);

// ── Pure implementation under test ───────────────────────────────────────────
//
// applyDnrStateLogic is a side-effect-free extraction of the consent-gate
// algorithm.  The production service-worker.js calls the same algorithm wired
// to chrome.declarativeNetRequest; here we pass a fake facade so we can assert
// the exact calls made without spinning up a browser.
//
// @param {object} prefs - Extension preferences (enabled, dnrEnabled,
//   onboardingDone, ampRedirect, unwrapRedirects)
// @param {string[]} declaredIds - Ruleset IDs declared in the manifest
//   (simulates chrome.runtime.getManifest().declarative_net_request.rule_resources)
// @param {{ updateEnabledRulesets: Function }} dnrApi - Fake DNR API
async function applyDnrStateLogic(prefs, declaredIds, dnrApi) {
  const gateOpen = prefs.enabled && prefs.dnrEnabled && prefs.onboardingDone;

  if (!gateOpen) {
    // Gate closed: disable ALL declared rulesets
    if (declaredIds.length > 0) {
      await dnrApi.updateEnabledRulesets({
        disableRulesetIds: declaredIds,
      });
    }
    return;
  }

  // Gate open: selectively enable/disable based on per-feature prefs
  const enableRulesetIds = [];
  const disableRulesetIds = [];

  for (const id of declaredIds) {
    if (id === "tracking_params") {
      enableRulesetIds.push(id);
    } else if (id === "amazon_path_canonical") {
      // Mirrors production: always-on when the gate is open (#903).
      enableRulesetIds.push(id);
    } else if (id === "amp_redirect") {
      if (prefs.ampRedirect) {
        enableRulesetIds.push(id);
      } else {
        disableRulesetIds.push(id);
      }
    } else if (id === "wrapper_unwrap") {
      if (prefs.unwrapRedirects) {
        enableRulesetIds.push(id);
      } else {
        disableRulesetIds.push(id);
      }
    } else {
      // Mirrors production: unmanaged declared rulesets keep the manifest
      // default (enabled) and surface a warning — see service-worker.js.
      enableRulesetIds.push(id);
    }
  }

  await dnrApi.updateEnabledRulesets({
    enableRulesetIds,
    disableRulesetIds,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFakeDnr() {
  const calls = [];
  return {
    calls,
    updateEnabledRulesets(opts) {
      calls.push(structuredClone(opts));
      return Promise.resolve();
    },
  };
}

const MV3_IDS = ["tracking_params", "amp_redirect", "wrapper_unwrap", "amazon_path_canonical"];
const MV2_IDS = ["tracking_params"];

const BASE_PREFS_OPEN = {
  enabled: true,
  dnrEnabled: true,
  onboardingDone: true,
  ampRedirect: true,
  unwrapRedirects: true,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("applyDnrState — gate closed: onboardingDone:false", () => {
  test("all MV3 declared rulesets appear in disableRulesetIds", async () => {
    const dnr = makeFakeDnr();
    const prefs = { ...BASE_PREFS_OPEN, onboardingDone: false };
    await applyDnrStateLogic(prefs, MV3_IDS, dnr);

    assert.strictEqual(dnr.calls.length, 1, "updateEnabledRulesets must be called once");
    const call = dnr.calls[0];
    assert.ok(
      Array.isArray(call.disableRulesetIds),
      "disableRulesetIds must be present"
    );
    for (const id of MV3_IDS) {
      assert.ok(
        call.disableRulesetIds.includes(id),
        `${id} must be in disableRulesetIds when gate is closed (onboardingDone:false)`
      );
    }
  });

  test("no ruleset ends up in enableRulesetIds when gate is closed", async () => {
    const dnr = makeFakeDnr();
    const prefs = { ...BASE_PREFS_OPEN, onboardingDone: false };
    await applyDnrStateLogic(prefs, MV3_IDS, dnr);
    const call = dnr.calls[0];
    assert.ok(
      !call.enableRulesetIds || call.enableRulesetIds.length === 0,
      "enableRulesetIds must be absent or empty when gate is closed"
    );
  });
});

describe("applyDnrState — gate closed: enabled:false", () => {
  test("all MV3 declared rulesets appear in disableRulesetIds", async () => {
    const dnr = makeFakeDnr();
    const prefs = { ...BASE_PREFS_OPEN, enabled: false };
    await applyDnrStateLogic(prefs, MV3_IDS, dnr);

    assert.strictEqual(dnr.calls.length, 1, "updateEnabledRulesets must be called once");
    const call = dnr.calls[0];
    for (const id of MV3_IDS) {
      assert.ok(
        call.disableRulesetIds.includes(id),
        `${id} must be in disableRulesetIds when enabled:false`
      );
    }
  });

  test("amp_redirect and wrapper_unwrap must NOT stay enabled when extension is disabled", async () => {
    const dnr = makeFakeDnr();
    const prefs = { ...BASE_PREFS_OPEN, enabled: false };
    await applyDnrStateLogic(prefs, MV3_IDS, dnr);
    const call = dnr.calls[0];
    assert.ok(
      call.disableRulesetIds.includes("amp_redirect"),
      "amp_redirect must be explicitly disabled when extension is disabled (#810 regression)"
    );
    assert.ok(
      call.disableRulesetIds.includes("wrapper_unwrap"),
      "wrapper_unwrap must be explicitly disabled when extension is disabled (#810 regression)"
    );
  });
});

describe("applyDnrState — gate closed: dnrEnabled:false", () => {
  test("all MV3 declared rulesets appear in disableRulesetIds", async () => {
    const dnr = makeFakeDnr();
    const prefs = { ...BASE_PREFS_OPEN, dnrEnabled: false };
    await applyDnrStateLogic(prefs, MV3_IDS, dnr);

    assert.strictEqual(dnr.calls.length, 1, "updateEnabledRulesets must be called once");
    const call = dnr.calls[0];
    for (const id of MV3_IDS) {
      assert.ok(
        call.disableRulesetIds.includes(id),
        `${id} must be in disableRulesetIds when dnrEnabled:false`
      );
    }
    assert.ok(
      !call.enableRulesetIds || call.enableRulesetIds.length === 0,
      "nothing may be enabled while the DNR subsystem is off"
    );
  });
});

describe("applyDnrState — gate open with per-feature pref toggles", () => {
  test("all prefs ON → all three IDs in enableRulesetIds, none disabled", async () => {
    const dnr = makeFakeDnr();
    await applyDnrStateLogic(BASE_PREFS_OPEN, MV3_IDS, dnr);

    assert.strictEqual(dnr.calls.length, 1);
    const call = dnr.calls[0];
    assert.ok(call.enableRulesetIds.includes("tracking_params"), "tracking_params must be enabled");
    assert.ok(call.enableRulesetIds.includes("amp_redirect"), "amp_redirect must be enabled when ampRedirect:true");
    assert.ok(call.enableRulesetIds.includes("wrapper_unwrap"), "wrapper_unwrap must be enabled when unwrapRedirects:true");
    assert.strictEqual(
      (call.disableRulesetIds || []).length,
      0,
      "disableRulesetIds must be empty when all prefs are on"
    );
  });

  test("ampRedirect:false → amp_redirect disabled, others enabled", async () => {
    const dnr = makeFakeDnr();
    const prefs = { ...BASE_PREFS_OPEN, ampRedirect: false };
    await applyDnrStateLogic(prefs, MV3_IDS, dnr);

    const call = dnr.calls[0];
    assert.ok(
      call.disableRulesetIds.includes("amp_redirect"),
      "amp_redirect must be in disableRulesetIds when ampRedirect:false"
    );
    assert.ok(
      call.enableRulesetIds.includes("tracking_params"),
      "tracking_params must still be enabled"
    );
    assert.ok(
      call.enableRulesetIds.includes("wrapper_unwrap"),
      "wrapper_unwrap must still be enabled when unwrapRedirects:true"
    );
  });

  test("unwrapRedirects:false → wrapper_unwrap disabled, others enabled", async () => {
    const dnr = makeFakeDnr();
    const prefs = { ...BASE_PREFS_OPEN, unwrapRedirects: false };
    await applyDnrStateLogic(prefs, MV3_IDS, dnr);

    const call = dnr.calls[0];
    assert.ok(
      call.disableRulesetIds.includes("wrapper_unwrap"),
      "wrapper_unwrap must be in disableRulesetIds when unwrapRedirects:false"
    );
    assert.ok(
      call.enableRulesetIds.includes("tracking_params"),
      "tracking_params must still be enabled"
    );
    assert.ok(
      call.enableRulesetIds.includes("amp_redirect"),
      "amp_redirect must still be enabled when ampRedirect:true"
    );
  });

  test("ampRedirect:false + unwrapRedirects:true → amp_redirect disabled, wrapper_unwrap + tracking_params enabled", async () => {
    const dnr = makeFakeDnr();
    const prefs = { ...BASE_PREFS_OPEN, ampRedirect: false, unwrapRedirects: true };
    await applyDnrStateLogic(prefs, MV3_IDS, dnr);

    const call = dnr.calls[0];
    assert.ok(
      call.disableRulesetIds.includes("amp_redirect"),
      "amp_redirect must be disabled"
    );
    assert.ok(
      call.enableRulesetIds.includes("wrapper_unwrap"),
      "wrapper_unwrap must be enabled"
    );
    assert.ok(
      call.enableRulesetIds.includes("tracking_params"),
      "tracking_params must be enabled"
    );
  });

  test("ampRedirect:false + unwrapRedirects:false → both extra rulesets disabled", async () => {
    const dnr = makeFakeDnr();
    const prefs = { ...BASE_PREFS_OPEN, ampRedirect: false, unwrapRedirects: false };
    await applyDnrStateLogic(prefs, MV3_IDS, dnr);

    const call = dnr.calls[0];
    assert.ok(call.disableRulesetIds.includes("amp_redirect"), "amp_redirect must be disabled");
    assert.ok(call.disableRulesetIds.includes("wrapper_unwrap"), "wrapper_unwrap must be disabled");
    assert.ok(call.enableRulesetIds.includes("tracking_params"), "tracking_params must still be enabled");
  });
});

describe("applyDnrState — amazon_path_canonical (#903)", () => {
  test("gate open → amazon_path_canonical is always enabled, like tracking_params", async () => {
    const dnr = makeFakeDnr();
    await applyDnrStateLogic(BASE_PREFS_OPEN, MV3_IDS, dnr);

    const call = dnr.calls[0];
    assert.ok(
      call.enableRulesetIds.includes("amazon_path_canonical"),
      "amazon_path_canonical must be enabled when the consent gate is open"
    );
  });

  test("gate open + ampRedirect:false + unwrapRedirects:false → amazon_path_canonical stays enabled", async () => {
    const dnr = makeFakeDnr();
    const prefs = { ...BASE_PREFS_OPEN, ampRedirect: false, unwrapRedirects: false };
    await applyDnrStateLogic(prefs, MV3_IDS, dnr);

    const call = dnr.calls[0];
    assert.ok(
      call.enableRulesetIds.includes("amazon_path_canonical"),
      "amazon_path_canonical has no per-feature pref (yet) — it must stay enabled regardless of other toggles"
    );
    assert.ok(
      !(call.disableRulesetIds || []).includes("amazon_path_canonical"),
      "amazon_path_canonical must never be disabled while the gate is open"
    );
  });

  test("gate closed (onboardingDone:false) → amazon_path_canonical is disabled with all other rulesets", async () => {
    const dnr = makeFakeDnr();
    const prefs = { ...BASE_PREFS_OPEN, onboardingDone: false };
    await applyDnrStateLogic(prefs, MV3_IDS, dnr);

    const call = dnr.calls[0];
    assert.ok(
      call.disableRulesetIds.includes("amazon_path_canonical"),
      "amazon_path_canonical must be disabled when the consent gate is closed (#810 regression class)"
    );
  });
});

describe("applyDnrState — MV2 parity: only declared IDs are touched", () => {
  test("MV2 manifest (tracking_params only): gate closed disables only tracking_params", async () => {
    const dnr = makeFakeDnr();
    const prefs = { ...BASE_PREFS_OPEN, onboardingDone: false };
    await applyDnrStateLogic(prefs, MV2_IDS, dnr);

    const call = dnr.calls[0];
    assert.deepEqual(
      call.disableRulesetIds,
      ["tracking_params"],
      "only tracking_params must be in disableRulesetIds for MV2"
    );
    assert.ok(
      !(call.disableRulesetIds || []).includes("amp_redirect"),
      "amp_redirect must NOT appear for MV2 manifest (not declared)"
    );
    assert.ok(
      !(call.disableRulesetIds || []).includes("wrapper_unwrap"),
      "wrapper_unwrap must NOT appear for MV2 manifest (not declared)"
    );
  });

  test("MV2 manifest (tracking_params only): gate open enables only tracking_params", async () => {
    const dnr = makeFakeDnr();
    await applyDnrStateLogic(BASE_PREFS_OPEN, MV2_IDS, dnr);

    const call = dnr.calls[0];
    assert.deepEqual(
      call.enableRulesetIds,
      ["tracking_params"],
      "only tracking_params must be enabled for MV2"
    );
    assert.ok(
      !(call.enableRulesetIds || []).includes("amp_redirect"),
      "amp_redirect must NOT appear for MV2 manifest"
    );
    assert.ok(
      !(call.enableRulesetIds || []).includes("wrapper_unwrap"),
      "wrapper_unwrap must NOT appear for MV2 manifest"
    );
  });

  test("MV2 manifest: no unknown IDs are referenced regardless of pref values", async () => {
    const dnr = makeFakeDnr();
    // Even with ampRedirect:false and unwrapRedirects:false, MV2 must not
    // reference undeclared IDs — that would cause Firefox to reject the call
    await applyDnrStateLogic(
      { ...BASE_PREFS_OPEN, ampRedirect: false, unwrapRedirects: false },
      MV2_IDS,
      dnr
    );
    const call = dnr.calls[0];
    const allReferenced = [
      ...(call.enableRulesetIds || []),
      ...(call.disableRulesetIds || []),
    ];
    for (const id of allReferenced) {
      assert.ok(
        MV2_IDS.includes(id),
        `ID "${id}" must not be referenced for MV2 — it is not declared in manifest.v2.json`
      );
    }
  });
});

// ── Source-level guards: verify the production SW was updated ────────────────
//
// These are intentionally thin source guards — we verify the production code
// calls getManifest() to derive declared IDs and touches the new prefs.
// Full behavioral coverage is above via the algorithm extraction.

describe("service-worker.js source guards — #810 fix present", () => {
  test("applyDnrState reads declared IDs from getManifest() (not a hardcoded list)", () => {
    assert.ok(
      swSource.includes("getManifest()"),
      "applyDnrState must derive declared ruleset IDs from chrome.runtime.getManifest()"
    );
  });

  test("applyDnrState references ampRedirect pref", () => {
    const applyFnStart = swSource.indexOf("async function applyDnrState(");
    assert.ok(applyFnStart !== -1, "applyDnrState must exist in SW");
    // Use 2600 chars — the function grew with comments after the #810 fix
    // and the #903 amazon_path_canonical branch
    const applyFnBlock = swSource.slice(applyFnStart, applyFnStart + 2600);
    assert.ok(
      applyFnBlock.includes("ampRedirect"),
      "applyDnrState must check prefs.ampRedirect to gate amp_redirect ruleset"
    );
  });

  test("applyDnrState references unwrapRedirects pref", () => {
    const applyFnStart = swSource.indexOf("async function applyDnrState(");
    assert.ok(applyFnStart !== -1, "applyDnrState must exist in SW");
    // Use 2600 chars — the function grew with comments after the #810 fix
    // and the #903 amazon_path_canonical branch
    const applyFnBlock = swSource.slice(applyFnStart, applyFnStart + 2600);
    assert.ok(
      applyFnBlock.includes("unwrapRedirects"),
      "applyDnrState must check prefs.unwrapRedirects to gate wrapper_unwrap ruleset"
    );
  });

  test("storage listener re-triggers applyDnrState on ampRedirect changes", () => {
    // Find the sync-area storage listener block and confirm it watches ampRedirect.
    // Use 2500 chars — the condition is ~2076 chars into the listener body.
    const storageListenerIdx = swSource.lastIndexOf("chrome.storage.onChanged.addListener");
    assert.ok(storageListenerIdx !== -1, "storage onChanged listener must exist");
    const listenerBlock = swSource.slice(storageListenerIdx, storageListenerIdx + 2500);
    assert.ok(
      listenerBlock.includes("ampRedirect"),
      "storage listener must include ampRedirect in the condition that calls applyDnrState"
    );
  });

  test("storage listener re-triggers applyDnrState on unwrapRedirects changes", () => {
    const storageListenerIdx = swSource.lastIndexOf("chrome.storage.onChanged.addListener");
    assert.ok(storageListenerIdx !== -1, "storage onChanged listener must exist");
    const listenerBlock = swSource.slice(storageListenerIdx, storageListenerIdx + 2500);
    assert.ok(
      listenerBlock.includes("unwrapRedirects"),
      "storage listener must include unwrapRedirects in the condition that calls applyDnrState"
    );
  });
});

// ── #921: gate-closed branch must also clear the dynamic remote-params rule ──
//
// The service worker has no behavioral unit harness (Chrome API bindings at
// module scope), so this is a source guard. It genuinely fails against the
// pre-fix source: before #921 the gate-closed branch disabled the static
// rulesets and cleared rule 1000 but never removed dynamic rule 1001, so a
// disabled / non-consented extension kept stripping params via rule 1001.
//
// Single source read (regex match) to stay within the #824 source-grep ratchet;
// all further assertions run against the extracted region, not the raw source.

describe("service-worker.js source guard — #921 remote-params rule (1001) gated", () => {
  // Extract applyDnrState + the reconcile helper defined immediately after it.
  const applyRegion =
    swSource.match(/async function applyDnrState\([\s\S]{0,4500}/)?.[0] ?? "";
  const gateClosed = applyRegion.slice(applyRegion.indexOf("Gate closed:"));

  test("applyDnrState region was located", () => {
    assert.ok(applyRegion.length > 0, "applyDnrState must exist in the service worker");
    assert.ok(applyRegion.includes("Gate closed:"), "applyDnrState must have a gate-closed branch");
  });

  test("gate-closed branch removes rule 1001 (DNR_REMOTE_PARAMS_RULE_ID) via removeRuleIds", () => {
    assert.ok(
      gateClosed.includes("updateDynamicRules") &&
        gateClosed.includes("DNR_REMOTE_PARAMS_RULE_ID") &&
        gateClosed.includes("removeRuleIds"),
      "gate-closed branch must clear dynamic rule 1001 so a disabled/non-consented extension stops stripping params (#921)"
    );
  });

  test("gate-open path re-applies rule 1001 from the cached payload", () => {
    // A close→open cycle (or a time-gated weekly fetch) must restore rule 1001;
    // the gate-open branch calls a helper that rebuilds it from cached params.
    assert.ok(
      applyRegion.includes("reconcileRemoteDnrRule"),
      "gate-open branch must reconcile rule 1001 via reconcileRemoteDnrRule"
    );
    assert.ok(
      applyRegion.includes("buildRemoteDnrRule"),
      "gate-open reconciliation must rebuild rule 1001 from cached params via buildRemoteDnrRule"
    );
  });
});
