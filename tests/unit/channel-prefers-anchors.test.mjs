/**
 * MUGA — #1344: the channel prefers a param's own anchors over a global entry
 *
 * Context: `parseRemoveparamRules`' design correction C1 folds a host-anchored
 * removeparam name into the global candidate pool by design (tools/import-
 * upstream.mjs), and C1 is still right — remeasured, "anchored implies not
 * global" would drop 88% of the payload. But #1229 gave the channel
 * `scoped[]`, so "not global" for a host-anchored param now means RELOCATED,
 * not dropped. #1342 fixed the leaked half of this (a param already removed
 * from the bundled TRACKING_PARAMS but still published globally); what was
 * left is the pipeline's own standing habit of anchoring a param in
 * `domain-rules.json` while continuing to publish it globally in the SAME
 * run, which shadows the very fact it just landed.
 *
 * `computeAnchorPreference` (tools/build-rules-store.mjs) closes that: a
 * param qualifies when it is absent from the bundled TRACKING_PARAMS and
 * present in at least one host's plain `stripParams` — DERIVED from the
 * store's own entries every time this runs, never a hardcoded list, so a
 * future writer moving another param off TRACKING_PARAMS is picked up
 * automatically. A qualifying param relocates only if its own scoped facts
 * survive the existing publish-budget fit; otherwise it stays global. It can
 * never lose both.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  ACTIONS,
  GLOBAL_SCOPE,
  makeEntry,
  withGlobalParams,
  withScopedFacts,
} from "../../tools/rules-store.mjs";
import {
  computeAnchorPreference,
  PUBLISH_PAYLOAD_BUDGET_BYTES,
  PARAMS_PATH,
} from "../../tools/build-rules-store.mjs";
import { TRACKING_PARAMS } from "../../src/lib/affiliates-data.js";
import { AFFILIATE_PARAM_GUARD, REMOTE_PARAM_DENYLIST } from "../../src/lib/remote-rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const TRACKING_SET = new Set(TRACKING_PARAMS);

/** A minimal params.json-shaped text, enough to size the byte budget. */
const FIXTURE_PARAMS_TEXT = JSON.stringify({
  version: 1,
  published: "2026-01-01T00:00:00.000Z",
});

/** One global strip entry plus, optionally, one host-anchored strip entry. */
function withAnchor(param, hosts) {
  return hosts.map((host) => makeEntry({ scope: host, param, action: ACTIONS.STRIP }));
}

function baseStore(globalParams, anchors = {}) {
  const entries = [
    ...globalParams.map((param) => makeEntry({ scope: GLOBAL_SCOPE, param, action: ACTIONS.STRIP })),
  ];
  for (const [param, hosts] of Object.entries(anchors)) {
    entries.push(...withAnchor(param, hosts));
  }
  return { schemaVersion: 1, entries, projection: { scopes: {} } };
}

// ── The ten named params, against the REAL committed store (post-fix) ────

describe("#1344 — the ten host-anchored params #1342 could not reach", () => {
  const TEN = [
    "igsh",
    "mibextid",
    "smid",
    "campaign",
    "crid",
    "igshid",
    "n_cid",
    "ocid",
    "share_id",
    "trk",
  ];

  const params = JSON.parse(readFileSync(PARAMS_PATH, "utf8"));
  const globalSet = new Set(params.params);
  const scopedByParam = new Map((params.scoped ?? []).map((f) => [f.param, f.hosts]));

  for (const param of TEN) {
    test(`"${param}" is no longer in the published global list`, () => {
      assert.ok(
        !globalSet.has(param),
        `"${param}" is still in tools/rules-source/params.json's global params — it should have ` +
          "relocated to its own anchors (#1344)"
      );
    });

    test(`"${param}"'s anchored facts ARE in the published scoped section`, () => {
      const hosts = scopedByParam.get(param);
      assert.ok(
        hosts && hosts.length > 0,
        `"${param}" has no scoped facts in the published payload — relocating it without its ` +
          "own coverage would strip it nowhere (#1344's safety property)"
      );
    });
  }

  test("none of the ten are in the bundled TRACKING_PARAMS (still correctly anchored, not reverted)", () => {
    const leaked = TEN.filter((p) => TRACKING_SET.has(p));
    assert.deepEqual(leaked, [], `these came back into TRACKING_PARAMS: ${leaked.join(", ")}`);
  });
});

// ── The predicate ──────────────────────────────────────────────────────

describe("#1344 — the predicate: absent from TRACKING_PARAMS AND host-anchored", () => {
  test("a param still in TRACKING_PARAMS is untouched even if it is also host-anchored", () => {
    const builtin = TRACKING_PARAMS[0];
    const store = withScopedFacts(
      baseStore([builtin], { [builtin]: ["example.com"] }),
      [{ scope: "example.com", param: builtin, action: ACTIONS.STRIP }]
    );

    const result = computeAnchorPreference(store, FIXTURE_PARAMS_TEXT);

    assert.deepEqual(result.relocated, []);
    assert.deepEqual(result.stayedGlobalForBudget, []);
    assert.deepEqual(result.store, store, "a built-in param must not be touched at all");
  });

  test("a global param with no host anchor anywhere is untouched", () => {
    const store = baseStore(["plain_global_param"]);
    const result = computeAnchorPreference(store, FIXTURE_PARAMS_TEXT);

    assert.deepEqual(result.relocated, []);
    assert.deepEqual(result.store, store);
  });

  test("a host-anchored param absent from TRACKING_PARAMS relocates when its facts fit", () => {
    const param = "muga_test_anchor_only";
    assert.ok(!TRACKING_SET.has(param), "fixture assumption: not a real built-in");

    const store = withScopedFacts(baseStore([param], { [param]: ["example.com"] }), [
      { scope: "example.com", param, action: ACTIONS.STRIP },
    ]);

    const result = computeAnchorPreference(store, FIXTURE_PARAMS_TEXT);

    assert.deepEqual(result.relocated, [param]);
    assert.deepEqual(result.stayedGlobalForBudget, []);

    const rebuilt = withGlobalParams(store, []);
    assert.deepEqual(result.store, rebuilt, "only the global entry for the param should be removed");
  });

  test("a path-scoped anchor (pathPrefixes) does not count as a host anchor", () => {
    // ADR-0010 decision 5: path predicates are bundled-only and never carry a
    // plain stripParams shape. This predicate must read only plain host
    // anchors, or it would try to relocate a param the channel cannot express
    // at anything smaller than global.
    const param = "muga_test_path_only";
    const store = {
      schemaVersion: 1,
      entries: [
        makeEntry({ scope: GLOBAL_SCOPE, param, action: ACTIONS.STRIP }),
        makeEntry({
          scope: "example.com",
          param,
          action: ACTIONS.STRIP,
          pathPrefixes: ["/search"],
        }),
      ],
      projection: { scopes: {} },
    };

    const result = computeAnchorPreference(store, FIXTURE_PARAMS_TEXT);

    assert.deepEqual(result.relocated, []);
    assert.deepEqual(result.store, store);
  });
});

// ── The safety property: never lose both ─────────────────────────────────

describe("#1344 — safety property: a qualifying param whose facts do not fit stays global", () => {
  test("a param whose relocation would overflow the budget stays global, unrelocated", () => {
    const param = "muga_test_overflow";
    assert.ok(!TRACKING_SET.has(param));

    // Twelve hosts is enough real payload weight that, against a budget sized
    // for almost nothing, the relocated record cannot possibly fit.
    const hosts = Array.from({ length: 12 }, (_, i) => `muga-test-host-${i}.example`);
    const store = withScopedFacts(baseStore([param], { [param]: hosts }), [
      { scope: "muga-test-host-0.example", param, action: ACTIONS.STRIP },
      ...hosts.slice(1).map((scope) => ({ scope, param, action: ACTIONS.STRIP })),
    ]);

    // A tiny budget: the store's own module constant is 50 KB, but this test
    // exercises the pure decision function directly against a budget so small
    // that not even the trimmed base payload fits the scoped record. We reach
    // it by shrinking PUBLISH_PAYLOAD_BUDGET_BYTES's effect through an
    // artificially long `published` timestamp instead of importing a private
    // budget override, keeping this test against the real exported surface.
    const hugeText = JSON.stringify({
      version: 1,
      published: "2026-01-01T00:00:00.000Z",
      // Padding pushes baseBytes close enough to the real 50 KB budget that
      // twelve hosts' worth of scoped-fact bytes cannot fit in what remains.
      padding: "x".repeat(PUBLISH_PAYLOAD_BUDGET_BYTES - 200),
    });

    const result = computeAnchorPreference(store, hugeText);

    assert.deepEqual(
      result.relocated,
      [],
      "the param must not relocate when its own facts cannot fit the remaining budget"
    );
    assert.deepEqual(
      result.stayedGlobalForBudget,
      [param],
      "it must be reported as having stayed global for budget reasons, not silently dropped"
    );
    assert.deepEqual(
      result.store,
      store,
      "the store must be untouched — the param is neither relocated nor otherwise altered"
    );

    // And the property that actually matters: the param still strips
    // SOMEWHERE. It never left the global list, so it is never covered by
    // neither channel.
    const stillGlobal = result.store.entries.some(
      (e) => e.scope === GLOBAL_SCOPE && e.param === param && e.action === ACTIONS.STRIP
    );
    assert.ok(stillGlobal, "a param that failed to relocate must remain in the global list");
  });

  test("a small qualifying param relocates fine against the same tight budget", () => {
    // Contrast case: one host, tiny payload — proves the tight budget above
    // is what blocked the twelve-host param, not some other bug.
    const param = "muga_test_fits";
    const store = withScopedFacts(baseStore([param], { [param]: ["example.com"] }), [
      { scope: "example.com", param, action: ACTIONS.STRIP },
    ]);

    const roomyText = JSON.stringify({ version: 1, published: "2026-01-01T00:00:00.000Z" });
    const result = computeAnchorPreference(store, roomyText);

    assert.deepEqual(result.relocated, [param]);
    assert.deepEqual(result.stayedGlobalForBudget, []);
  });
});

// ── Gates unchanged: a guard/denylist member is never relocated ─────────

describe("#1344 — AFFILIATE_PARAM_GUARD / REMOTE_PARAM_DENYLIST members are never relocated", () => {
  test("a guard member that (hypothetically) qualifies stays global, not special-cased into moving", () => {
    const [param] = AFFILIATE_PARAM_GUARD;
    const store = withScopedFacts(baseStore([param], { [param]: ["example.com"] }), [
      { scope: "example.com", param, action: ACTIONS.STRIP },
    ]);

    const result = computeAnchorPreference(store, FIXTURE_PARAMS_TEXT);

    assert.deepEqual(result.relocated, []);
    assert.deepEqual(result.store, store, "a guard member must not be touched at all");
  });

  test("a denylist member that (hypothetically) qualifies stays global, not special-cased into moving", () => {
    const [param] = REMOTE_PARAM_DENYLIST;
    const store = withScopedFacts(baseStore([param], { [param]: ["example.com"] }), [
      { scope: "example.com", param, action: ACTIONS.STRIP },
    ]);

    const result = computeAnchorPreference(store, FIXTURE_PARAMS_TEXT);

    assert.deepEqual(result.relocated, []);
    assert.deepEqual(result.store, store, "a denylist member must not be touched at all");
  });

  test("no committed guard or denylist member is in the published global list post-#1344", () => {
    // Defense-in-depth against the real data: sign-rules.mjs already refuses
    // to sign one of these, but the projection itself should never try.
    const params = JSON.parse(readFileSync(join(ROOT, "tools", "rules-source", "params.json"), "utf8"));
    const forbidden = new Set(
      [...AFFILIATE_PARAM_GUARD, ...REMOTE_PARAM_DENYLIST].map((p) => p.toLowerCase())
    );
    const leaked = params.params.filter((p) => forbidden.has(p.toLowerCase()));
    assert.deepEqual(leaked, [], `guard/denylist member(s) in the published global list: ${leaked.join(", ")}`);
  });
});
