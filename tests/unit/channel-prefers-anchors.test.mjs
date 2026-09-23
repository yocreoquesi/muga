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
 * store's own entries every time this runs, never a hardcoded list.
 *
 * ── The orphan-protection revision ──────────────────────────────────────
 *
 * A first version of this fix protected only the CANDIDATES ("does my own
 * record survive the budget fit"). That is necessary but not sufficient: the
 * publish budget's own accounting (`fitScopedToBudget`, deliberately
 * conservative — see its own comments) can sit within a few dozen bytes of
 * ITS OWN ceiling against a big enough committed store, because there is
 * always a bigger backlog of facts than fits. Admitting a candidate's
 * record can push the strict alphabetical cutoff earlier and silently evict
 * some UNRELATED already-published param's fact — an ORPHANED fact
 * (`countOrphanedFacts`): covered by neither channel, even though it was
 * covered a moment ago.
 *
 * Measured directly against the real committed store UNDER THE OLD 50 KB
 * budget (what shipped before v3.1.0 had the fleet): relocating even just
 * the ten named below evicted 14 unrelated params (16 facts) — `wpset wref
 * wtime x_hk x_imp xadid xcust xdm_c xdm_e xdm_p xhuserid xid_param_2 xmktid
 * xmt` — because relocating a param never reduces ITS OWN orphan risk (it is
 * covered by global before, by scoped after — net zero) while a saturated
 * budget's conservative accounting has no room to spare. Every one of the 62
 * candidates deferred at that budget, and the orphan count stayed exactly
 * where it already was (8).
 *
 * 2026-09-23: the publish budget raised to 384 KB (see
 * `PUBLISH_PAYLOAD_BUDGET_BYTES`'s own docblock — release, then adoption,
 * then this number) gave the mechanism the headroom the 50 KB ceiling never
 * had, and `node tools/build-rules-store.mjs --prefer-anchors` has applied
 * it: against the real committed store, all 62 candidates relocated
 * cleanly, with room to spare and the orphan count untouched (still 0). The
 * saturation scenario above is no longer today's truth — none of the 62 is
 * even a candidate any more, since none is a global param to begin with —
 * but the invariant it protects still matters whenever a future backlog
 * grows to fill whatever budget is current. So the "unprotected relocation
 * evicts a neighbour" evidence below is reproduced against a synthetic
 * saturated 50 KB ceiling, reconstructing the pre-relocation global list for
 * the ten it names, rather than depending on the (now roomy, and now
 * post-relocation) real budget and store.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  ACTIONS,
  GLOBAL_SCOPE,
  emitParams,
  emitScoped,
  makeEntry,
  parseStore,
  withGlobalParams,
  withScopedFacts,
} from "../../tools/rules-store.mjs";
import {
  computeAnchorPreference,
  countOrphanedFacts,
  PUBLISH_PAYLOAD_BUDGET_BYTES,
  PARAMS_PATH,
  STORE_PATH,
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

const loadRealStore = () => parseStore(readFileSync(STORE_PATH, "utf8"));
const realParamsText = () => readFileSync(PARAMS_PATH, "utf8");

// ── The whole-payload invariant: the orphan count must never rise ────────
//
// This is the test that would have caught the first version's regression —
// it is about the WHOLE payload, not any one param, and it is checked
// against the REAL committed store, not a synthetic one.

describe("#1344 — the orphan count must never rise", () => {
  test("running computeAnchorPreference against the real committed store never increases orphans", () => {
    const store = loadRealStore();
    const result = computeAnchorPreference(store, realParamsText());

    assert.ok(
      result.orphansAfter <= result.orphansBefore,
      `orphaned facts rose from ${result.orphansBefore} to ${result.orphansAfter} — a relocation ` +
        "evicted more already-published coverage than it added"
    );
  });

  test("orphansBefore matches an independent count over the real store's own scopedFacts", () => {
    // Recomputes the same count a different way — directly from
    // scopedFacts[], never via computeAnchorPreference's internals — so this
    // does not just check the function against itself.
    const store = loadRealStore();
    const globalParams = JSON.parse(realParamsText()).params;
    const publishedParams = new Set((JSON.parse(realParamsText()).scoped ?? []).map((f) => f.param));

    const independent = countOrphanedFacts(store, globalParams, publishedParams);
    const result = computeAnchorPreference(store, realParamsText());

    assert.equal(result.orphansBefore, independent);
  });

  test("#1344 has been applied: re-running against the real committed store is a safe no-op", () => {
    // The concrete, current finding: `node tools/build-rules-store.mjs
    // --prefer-anchors` has already relocated all 62 qualifying candidates
    // (2026-09-23, against the 384 KB budget). None of them is a global
    // param any more, so none qualifies as a candidate on a fresh run —
    // exactly the idempotence `runPreferAnchors`'s own docblock promises.
    // This pins that finding so a future change to the store, the budget,
    // or the mechanism has to re-examine it rather than silently drift.
    const store = loadRealStore();
    const result = computeAnchorPreference(store, realParamsText());

    assert.deepEqual(result.relocated, []);
    assert.deepEqual(result.stayedGlobalForBudget, []);
    assert.equal(result.orphansBefore, 0);
    assert.equal(result.orphansAfter, result.orphansBefore);
  });

  test("relocating just the ten #1228 params, unprotected, under a saturated 50 KB budget WOULD have evicted 13 unrelated params", () => {
    // Direct evidence for the docblock's claim, computed independently of
    // computeAnchorPreference's admission logic (this simulates the naive,
    // unprotected relocation the first version of this fix shipped, and
    // shows exactly why it was wrong). The real committed store no longer
    // saturates the current 384 KB budget, AND the ten named below have
    // themselves already relocated (they are no longer in the published
    // global list at all) — so this test reconstructs the pre-relocation
    // shape it needs: the ten put BACK into the global list (as they stood
    // before #1344 relocated them), fit against a fixed, budget-independent
    // 50 KB ceiling — the same size the channel published under before
    // v3.1.0 had the fleet — rather than the (now roomy) real
    // `PUBLISH_PAYLOAD_BUDGET_BYTES`.
    const store = loadRealStore();
    const current = JSON.parse(realParamsText());
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
    assert.ok(
      TEN.every((p) => !current.params.includes(p)),
      "fixture assumption: the ten have already relocated out of the published global list"
    );
    const globalParams = [...current.params, ...TEN];
    // The FULL pool the real mechanism draws from (`emitScoped`, ~1068
    // facts) — not `current.scoped` (the published subset). Using the
    // smaller one here would silently hide the eviction this test exists to
    // demonstrate.
    const scoped = emitScoped(store);
    const SATURATED_BUDGET = 50 * 1024;

    function fit(params) {
      const bare = { ...current, params };
      delete bare.scoped;
      const baseBytes = JSON.stringify(bare).length;
      const globalSet = new Set(params);
      const publishable = scoped.filter((f) => !globalSet.has(f.param));
      let used = baseBytes + 512; // SCOPED_SECTION_OVERHEAD_BYTES, mirrored here on purpose —
      // this test's whole point is to be an INDEPENDENT check of the real
      // mechanism's behavior, not a call into it.
      const published = [];
      for (const f of publishable) {
        const cost = JSON.stringify(f).length + 2;
        if (used + cost > SATURATED_BUDGET) break;
        used += cost;
        published.push(f);
      }
      return new Set(published.map((f) => f.param));
    }

    const before = fit(globalParams);
    const after = fit(globalParams.filter((p) => !TEN.includes(p)));

    const evicted = [...before].filter((p) => !after.has(p) && !TEN.includes(p));
    // The property is "an unprotected relocation evicts a neighbour", not a
    // count: the exact number moves with every unrelated store change (13 on
    // 2026-09-23, 14 before the #1344 relocation shortened the global list).
    assert.ok(
      evicted.length > 0,
      "expected an unprotected relocation of the ten to evict at least one unrelated param " +
        "under a saturated 50 KB budget, got none"
    );
  });
});

// ── The ten named params: relocated ───────────────────────────────────────
//
// #1342 could not reach these ten under the old 50 KB budget (every
// candidate deferred to protect a neighbour). The 384 KB budget removed that
// ceiling, and `node tools/build-rules-store.mjs --prefer-anchors` has
// applied the relocation: each of the ten left the published global list and
// now strips only at the hosts `domain-rules.json` anchors it to.

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
  const scopedParamSet = new Set((params.scoped ?? []).map((f) => f.param));

  for (const param of TEN) {
    test(`"${param}" is no longer a global entry — it left the published global list`, () => {
      assert.ok(
        !globalSet.has(param),
        `"${param}" is still in the published global list — the relocation was not applied`
      );
    });

    test(`"${param}" still strips somewhere — it publishes as a scoped fact instead`, () => {
      // The property that actually matters: it never lost coverage, it just
      // moved from the blanket global rule to its own anchors.
      assert.ok(
        scopedParamSet.has(param),
        `"${param}" left the global list without publishing as a scoped fact — it strips nowhere`
      );
    });

    test(`"${param}" is a no-op candidate on a fresh run — already relocated, not re-offered`, () => {
      const store = loadRealStore();
      const result = computeAnchorPreference(store, realParamsText());
      assert.ok(
        !result.relocated.includes(param) && !result.stayedGlobalForBudget.includes(param),
        `"${param}" was re-offered by a fresh run — it should no longer be a global param at all`
      );
    });
  }

  test("none of the ten are in the bundled TRACKING_PARAMS (still correctly anchored in domain-rules.json)", () => {
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

  test("a host-anchored param absent from TRACKING_PARAMS relocates when nothing competes for the budget", () => {
    const param = "muga_test_anchor_only";
    assert.ok(!TRACKING_SET.has(param), "fixture assumption: not a real built-in");

    const store = withScopedFacts(baseStore([param], { [param]: ["example.com"] }), [
      { scope: "example.com", param, action: ACTIONS.STRIP },
    ]);

    const result = computeAnchorPreference(store, FIXTURE_PARAMS_TEXT);

    assert.deepEqual(result.relocated, [param]);
    assert.deepEqual(result.stayedGlobalForBudget, []);
    assert.equal(result.orphansAfter, result.orphansBefore);

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

// ── The safety property: never lose both, and never orphan a neighbour ───

describe("#1344 — safety property: a relocation must not cost MORE coverage than it gains", () => {
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
    assert.equal(result.orphansAfter, result.orphansBefore);

    // And the property that actually matters: the param still strips
    // SOMEWHERE. It never left the global list, so it is never covered by
    // neither channel.
    const stillGlobal = result.store.entries.some(
      (e) => e.scope === GLOBAL_SCOPE && e.param === param && e.action === ACTIONS.STRIP
    );
    assert.ok(stillGlobal, "a param that failed to relocate must remain in the global list");
  });

  test("a small qualifying param relocates fine when nothing else competes for the budget", () => {
    // Contrast case: one host, tiny payload, no neighbours — proves the
    // tight-budget test above is what blocked the twelve-host param, not
    // some other bug.
    const param = "muga_test_fits";
    const store = withScopedFacts(baseStore([param], { [param]: ["example.com"] }), [
      { scope: "example.com", param, action: ACTIONS.STRIP },
    ]);

    const roomyText = JSON.stringify({ version: 1, published: "2026-01-01T00:00:00.000Z" });
    const result = computeAnchorPreference(store, roomyText);

    assert.deepEqual(result.relocated, [param]);
    assert.deepEqual(result.stayedGlobalForBudget, []);
    assert.equal(result.orphansAfter, result.orphansBefore);
  });

  test("a candidate defers when relocating it would evict an already-published NEIGHBOUR's fact", () => {
    // The property the first version of this fix missed: the per-candidate
    // check alone ("does MY record survive") is not enough. Here the
    // candidate's OWN record would survive in isolation — proven by the
    // first assertion below, run with the neighbour absent — but with the
    // neighbour present, admitting the candidate would push the neighbour's
    // already-published fact out of the budget fit. That must block the
    // relocation, not just log it.
    const param = "aaa_test_evicts_neighbour";
    const neighbour = "zzz_test_already_published_neighbour";
    assert.ok(!TRACKING_SET.has(param) && !TRACKING_SET.has(neighbour));

    const withoutNeighbour = withScopedFacts(baseStore([param], { [param]: ["a.example"] }), [
      { scope: "a.example", param, action: ACTIONS.STRIP },
    ]);
    const withNeighbour = withScopedFacts(withoutNeighbour, [
      { scope: "b.example", param: neighbour, action: ACTIONS.STRIP },
    ]);

    // Binary-search, ON THE CROWDED STORE ITSELF, the tightest budget (via
    // padding) at which the candidate still relocates despite the neighbour
    // occupying room — i.e. the exact boundary where admitting the candidate
    // stops being possible without touching the neighbour. Derived at test
    // time rather than hardcoded, so this does not silently stop testing
    // anything if the module's byte accounting ever changes shape.
    //
    // Searching on the SOLO store instead would find a tighter boundary than
    // this one (the neighbour's longer name costs more bytes than the
    // candidate's, so the crowded store's own transition sits at a looser
    // padding) and land past the point where the neighbour itself stops
    // fitting the baseline — which would test a different, uninteresting
    // case ("nothing fits any more") rather than the one this test is for.
    const textFor = (paddingLen) =>
      JSON.stringify({
        version: 1,
        published: "2026-01-01T00:00:00.000Z",
        padding: "x".repeat(Math.max(0, paddingLen)),
      });

    // At a large enough budget (384 KB), searching the padding range all the
    // way up to PUBLISH_PAYLOAD_BUDGET_BYTES stops being safe: past a
    // certain padding the BASELINE itself (candidate still global, so only
    // the neighbour's own record is competing for room) stops fitting the
    // neighbour — `orphansBefore` flips from 0 to 1 — and once that has
    // already happened, relocating the candidate no longer makes coverage
    // any WORSE (it was already broken), so `relocated` flips back to 1
    // before finally hitting 0 again at total exhaustion. That reentrant
    // region is real (the admission rule's own "do not make it worse, not
    // zero-eviction" design — see computeAnchorPreference's docblock) but it
    // is not what this test is for: it wants the boundary where the
    // candidate defers specifically because relocating it would evict a
    // neighbour that was STILL published a moment ago. So the search range
    // is bounded above by the tightest padding at which the baseline is
    // still clean, found the same way, first.
    let orphanLo = 0;
    let orphanHi = PUBLISH_PAYLOAD_BUDGET_BYTES;
    // The bisection is only meaningful between a clean and a broken
    // endpoint; say so instead of returning a silent, meaningless bound.
    assert.equal(
      computeAnchorPreference(withNeighbour, textFor(orphanLo)).orphansBefore,
      0,
      "fixture assumption: with no padding the baseline must orphan nothing"
    );
    assert.ok(
      computeAnchorPreference(withNeighbour, textFor(orphanHi)).orphansBefore > 0,
      "fixture assumption: padding the whole budget must orphan the neighbour in the baseline"
    );
    while (orphanHi - orphanLo > 1) {
      const mid = Math.floor((orphanLo + orphanHi) / 2);
      const stillClean = computeAnchorPreference(withNeighbour, textFor(mid)).orphansBefore === 0;
      if (stillClean) orphanLo = mid;
      else orphanHi = mid;
    }

    let lo = 0;
    let hi = orphanLo;
    // Invariant during the search: padding=lo relocates the candidate even
    // WITH the neighbour present; padding=hi does not.
    assert.equal(
      computeAnchorPreference(withNeighbour, textFor(lo)).relocated.length,
      1,
      "fixture assumption: the loosest padding must relocate the candidate even with the neighbour present"
    );
    assert.equal(
      computeAnchorPreference(withNeighbour, textFor(hi)).relocated.length,
      0,
      "fixture assumption: the tightest still-clean padding must not relocate the candidate"
    );
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const fits = computeAnchorPreference(withNeighbour, textFor(mid)).relocated.length === 1;
      if (fits) lo = mid;
      else hi = mid;
    }
    // `hi` is the tightest still-clean padding at which the candidate stops
    // relocating in the crowded store — the boundary this test exists to
    // exercise.
    const boundaryPadding = hi;

    const soloResult = computeAnchorPreference(withoutNeighbour, textFor(boundaryPadding));
    assert.equal(
      soloResult.relocated.length,
      1,
      "the candidate's own record must still fit at this exact padding when nothing competes for " +
        "it — proving the neighbour, not raw budget exhaustion, is what blocks it below"
    );

    const crowdedResult = computeAnchorPreference(withNeighbour, textFor(boundaryPadding));
    assert.equal(
      crowdedResult.orphansBefore,
      0,
      "fixture assumption: the neighbour's fact must still be published at baseline here — " +
        "otherwise this is testing raw exhaustion, not a neighbour eviction"
    );

    assert.deepEqual(
      crowdedResult.relocated,
      [],
      "the candidate must defer once a neighbour's already-published fact is competing for the " +
        "same tight room — its own record fitting ALONE is not enough"
    );
    assert.deepEqual(crowdedResult.stayedGlobalForBudget, [param]);
    assert.equal(
      crowdedResult.orphansAfter,
      crowdedResult.orphansBefore,
      "deferring must leave the orphan count exactly where it was — the neighbour's coverage " +
        "must survive untouched"
    );
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

// ── T3 — re-running --prefer-anchors undoes the ingest circularity ───────
//
// `parseRemoveparamRules`'s design correction C1 folds a host-anchored name
// back into promote's GLOBAL candidate pool on every run, by design. So a
// param this module already relocated (out of `params[]`, anchored in
// `entries[]`, published via `scopedFacts[]`) comes right back the next time
// `promote-rules.mjs` merges upstream's candidates — `withGlobalParams` below
// stands in for exactly that merge. Run 35921813206 reproduced this for real:
// promote re-added all 62 of #1344's relocations and the unit test gate
// failed. `computeAnchorPreference` derives its candidates from the store on
// every run, never a hardcoded list, so simply running it again — which is
// what auto-ingest-rules.yml's new `--prefer-anchors` step does after
// promote and land-scoped — relocates the param right back out.

describe("T3 (#1344) — a param promote re-globalizes is relocated back out on the next run", () => {
  test("re-adding a relocated, host-anchored param to the global list and re-running relocates it out again", () => {
    const param = "igsh";
    const host = "instagram.com";

    // The post-relocation state: `param` is anchored and scoped, not global.
    const relocatedStore = withScopedFacts(baseStore([], { [param]: [host] }), [
      { scope: host, param, action: ACTIONS.STRIP },
    ]);
    assert.ok(
      !emitParams(relocatedStore).includes(param),
      "fixture setup: the param must start OUT of the global list"
    );

    // The bug: promote's merge re-adds it because C1 offers it as a candidate
    // again — modeled here as withGlobalParams over the untouched entries.
    const reGlobalizedStore = withGlobalParams(relocatedStore, [
      ...emitParams(relocatedStore),
      param,
    ]);
    assert.ok(
      emitParams(reGlobalizedStore).includes(param),
      "reproduces run 35921813206: the param is back in the global list"
    );

    // The fix: re-running --prefer-anchors (computeAnchorPreference) sees the
    // param is still host-anchored and not TRACKING_PARAMS/NEVER_RELOCATE, so
    // it relocates it back out, exactly as it would a first-time candidate.
    const result = computeAnchorPreference(reGlobalizedStore, FIXTURE_PARAMS_TEXT);

    assert.deepEqual(result.relocated, [param]);
    assert.ok(
      !emitParams(result.store).includes(param),
      "the param must be out of the global list again after --prefer-anchors"
    );
    assert.equal(result.orphansAfter, result.orphansBefore, "orphans must not rise");
    assert.equal(result.orphansAfter, 0);

    // Idempotent: running it a second time on the already-fixed store is a
    // true no-op, matching runPreferAnchors's "writes nothing" contract.
    const again = computeAnchorPreference(result.store, FIXTURE_PARAMS_TEXT);
    assert.deepEqual(again.relocated, []);
    assert.deepEqual(again.store, result.store);
  });
});
