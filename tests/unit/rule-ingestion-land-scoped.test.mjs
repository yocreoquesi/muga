/**
 * MUGA — `land-scoped.mjs` tests (Slice 2 PR B, rules-scope-normalization)
 *
 * `land-scoped.mjs` is the manual, reviewed landing step for a
 * `quarantine-report.json`'s `scopedAutoMerge[]` (design D2, ADR-0008 Path A).
 * All I/O is injectable so these tests never touch the filesystem or the real
 * committed store — the end-to-end filesystem proof lives in the PR's apply
 * evidence (B.19), not here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { runLandScoped } from "../../tools/rule-ingestion/land-scoped.mjs";
import { GLOBAL_SCOPE, ACTIONS, withScopedFacts } from "../../tools/rules-store.mjs";

const baseStore = () => ({
  schemaVersion: 1,
  entries: [],
  projection: { scopes: {} },
});

function harness({ report }) {
  const written = [];
  const store = baseStore();
  const result = runLandScoped({
    reportPath: "unused-because-readReport-is-injected",
    readReport: () => report,
    loadStoreImpl: () => store,
    writeAllImpl: (nextStore) => written.push(nextStore),
  });
  return { result, written };
}

test("an empty scopedAutoMerge is a no-op: exit clean, nothing written", () => {
  const { result, written } = harness({ report: { scopedAutoMerge: [] } });
  assert.equal(result.written, false);
  assert.equal(result.landed, 0);
  assert.deepEqual(written, []);
});

test("a report with no scopedAutoMerge key at all is also a no-op", () => {
  const { result, written } = harness({ report: {} });
  assert.equal(result.written, false);
  assert.deepEqual(written, []);
});

test("a valid scoped candidate lands into scopedFacts and writeAll is called once", () => {
  const { result, written } = harness({
    report: {
      scopedAutoMerge: [
        { param: "si", scope: "youtube.com", signals: ["adguard-tp"], firstSeenAt: "2026-09-01T00:00:00.000Z" },
      ],
    },
  });
  assert.equal(result.written, true);
  assert.equal(result.landed, 1);
  assert.equal(written.length, 1);
  const [nextStore] = written;
  assert.equal(nextStore.scopedFacts.length, 1);
  assert.equal(nextStore.scopedFacts[0].scope, "youtube.com");
  assert.equal(nextStore.scopedFacts[0].param, "si");
  assert.equal(nextStore.scopedFacts[0].action, ACTIONS.STRIP);
  assert.deepEqual(nextStore.scopedFacts[0].provenance.signals, ["adguard-tp"]);
});

test("a candidate carrying scope: \"*\" is refused — nothing written", () => {
  assert.throws(() =>
    harness({
      report: { scopedAutoMerge: [{ param: "x", scope: GLOBAL_SCOPE, signals: ["adguard-tp"] }] },
    })
  );
});

test("a candidate missing a host scope is refused — nothing written", () => {
  assert.throws(() =>
    harness({
      report: { scopedAutoMerge: [{ param: "x", signals: ["adguard-tp"] }] },
    })
  );
});

test("a candidate with a malformed (empty) param is refused via the store's own validation", () => {
  assert.throws(() =>
    harness({
      report: { scopedAutoMerge: [{ param: "", scope: "a.com", signals: ["adguard-tp"] }] },
    })
  );
});

test("refusal never calls writeAllImpl — fail closed, not partially applied", () => {
  const written = [];
  const store = baseStore();
  assert.throws(() =>
    runLandScoped({
      reportPath: "unused",
      readReport: () => ({ scopedAutoMerge: [{ param: "x", scope: GLOBAL_SCOPE }] }),
      loadStoreImpl: () => store,
      writeAllImpl: (s) => written.push(s),
    })
  );
  assert.deepEqual(written, []);
});

// -- #1239: the weekly summary is a REACHABLE input for this tool --------------
//
// land-scoped.mjs reads a report FILE, but on the weekly run that file is
// gitignored, never uploaded, and destroyed with the runner. The rendered
// summary (which reaches a human in the PR body) is therefore the only
// surviving copy of the candidates. This test closes the loop end to end:
// whatever formatQuarantineReport() renders must parse straight back into an
// input this tool accepts. If the two shapes ever drift, #1239 silently
// reopens -- the facts stay visible but stop being landable.

test("#1239: the rendered weekly summary parses back into a report this tool lands", async () => {
  const { formatQuarantineReport } = await import("../../tools/rule-ingestion/report-formatter.mjs");

  const candidate = {
    param: "si",
    scope: "youtube.com",
    signals: ["adguard-tp", "clearurls"],
    firstSeenAt: "2025-01-01T00:00:00.000Z",
  };

  const md = formatQuarantineReport({
    generatedAt: "2025-01-15T12:00:00.000Z",
    autoMergeCount: 0,
    quarantineCount: 0,
    ingestStats: null,
    quarantine: [],
    scopedAutoMerge: [candidate],
    scopedAutoMergeCount: 1,
  });

  const fenced = md.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(fenced, "the summary must carry a fenced landing block");

  const { result, written } = harness({ report: JSON.parse(fenced[1]) });

  assert.equal(result.written, true, "the surfaced block must be landable as-is");
  assert.equal(result.landed, 1);
  assert.equal(written.length, 1);
  const [nextStore] = written;
  assert.equal(nextStore.scopedFacts.length, 1);
  assert.equal(nextStore.scopedFacts[0].scope, "youtube.com", "the host scope must survive the round trip");
  assert.equal(nextStore.scopedFacts[0].param, "si");
  assert.equal(nextStore.scopedFacts[0].action, ACTIONS.STRIP);
  assert.deepEqual(
    nextStore.scopedFacts[0].provenance.signals,
    ["adguard-tp", "clearurls"],
    "the corroborating signals must survive the round trip, not just the pair"
  );
});

// ── #1229: landing is automatic, so it has to report whether it MOVED ────────
//
// The weekly workflow re-offers every gate-admitted fact, not just the new
// ones — the quarantine is gitignored and rebuilt from upstream on every run.
// So "did this run do anything" cannot mean "did it run": it has to mean "did
// the store change", or every week would commit an identical store and re-sign
// the payload for nothing.
//
// It also has to be reported separately from the pipeline's own `noop`, which
// measures the GLOBAL param list. The two paths move independently, and gating
// the commit on the global signal alone would mean scoped facts never land in
// any week with no new global params.

function harnessWith({ report, initialFacts = [] }) {
  const written = [];
  const store = withScopedFacts(baseStore(), initialFacts);
  const result = runLandScoped({
    reportPath: "unused-because-readReport-is-injected",
    readReport: () => report,
    loadStoreImpl: () => store,
    writeAllImpl: (nextStore) => written.push(nextStore),
  });
  return { result, written };
}

const LANDED = {
  scope: "tiktok.com",
  param: "_r",
  action: ACTIONS.STRIP,
  provenance: { signals: ["adguard-tp"], firstSeenAt: "2026-09-01T00:00:00.000Z", admittedAt: "2026-09-08T00:00:00.000Z" },
};

test("re-offering a fact the store already holds does not write at all", () => {
  const { result, written } = harnessWith({
    initialFacts: [LANDED],
    report: {
      scopedAutoMerge: [
        { param: "_r", scope: "tiktok.com", signals: ["adguard-tp"], firstSeenAt: "2026-09-01T00:00:00.000Z" },
      ],
    },
  });

  assert.equal(result.changed, false, "the store did not move, so nothing should be written");
  assert.equal(result.written, false);
  assert.equal(result.added, 0);
  assert.equal(result.landed, 1, "the fact was still offered — landed counts offers, not changes");
  assert.deepEqual(written, [], "an unchanged store must never reach writeAll");
});

test("a genuinely new fact reports changed and counts what was added", () => {
  const { result, written } = harnessWith({
    initialFacts: [LANDED],
    report: {
      scopedAutoMerge: [
        { param: "_r", scope: "tiktok.com", signals: ["adguard-tp"] },
        { param: "igsh", scope: "instagram.com", signals: ["adguard-tp"] },
      ],
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.written, true);
  assert.equal(result.added, 1, "one of the two offered facts was new");
  assert.equal(result.landed, 2);
  assert.equal(written.length, 1);
  assert.equal(written[0].scopedFacts.length, 2);
});

test("an empty report reports changed:false, not just written:false", () => {
  // The workflow routes on `changed`; a shape that only set `written` would
  // leave that signal undefined and the step's output empty.
  const { result } = harnessWith({ report: { scopedAutoMerge: [] } });
  assert.equal(result.changed, false);
  assert.equal(result.added, 0);
});

test("a new SIGNAL on an already-landed fact counts as a change", () => {
  // Nothing is added to the segment, but the provenance moved, so the store
  // moved — and a store that changed must be committed or the next run's drift
  // check blames an innocent PR.
  const { result, written } = harnessWith({
    initialFacts: [LANDED],
    report: {
      scopedAutoMerge: [{ param: "_r", scope: "tiktok.com", signals: ["clearurls"] }],
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.added, 0, "no new fact, but the existing one gained corroboration");
  assert.equal(written.length, 1);
  assert.deepEqual(written[0].scopedFacts[0].provenance.signals, ["adguard-tp", "clearurls"]);
});

// ── #1229: what the gates admit is not what the payload can carry ────────────
//
// The EPIC C gates and the publication contract are different tests, on
// purpose. Gate 1 guards against known affiliate PROGRAMS and documents that it
// deliberately does not consume the broader AFFILIATE_PARAM_GUARD;
// REMOTE_PARAM_DENYLIST is not consulted at ingestion at all. Harmless while a
// person stood in that gap — not harmless once landing is automatic, because
// `sign-rules.mjs` refuses the WHOLE payload on any of these and the weekly run
// would publish nothing.
//
// Measured against the live quarantine: of 1608 gate-admitted scoped facts, 150
// are unpublishable — 36 affiliate names, 18 denylisted names and 8 pairs
// colliding with the host's own preserveParams.

test("an affiliate param is dropped, however upstream anchored it", () => {
  // The referral protection is what must not bend. `aff_id` on an affiliate
  // host is a real case from the live data (get.surfshark.net, tradingview.com):
  // upstream calls it a tracker, MUGA calls it someone's credit.
  const { result, written } = harnessWith({
    report: {
      scopedAutoMerge: [
        { param: "aff_id", scope: "get.surfshark.net", signals: ["adguard-tp"] },
        { param: "si", scope: "youtube.com", signals: ["adguard-tp"] },
      ],
    },
  });

  assert.equal(result.added, 1, "only the non-affiliate fact may land");
  assert.deepEqual(
    written[0].scopedFacts.map((f) => f.param),
    ["si"],
  );
});

test("a denylisted param is dropped — a scope does not make it functional-safe", () => {
  // `action` is in REMOTE_PARAM_DENYLIST and reached the gates anchored to a
  // real host in the live data. It is load-bearing on any site.
  const { result, written } = harnessWith({
    report: {
      scopedAutoMerge: [
        { param: "action", scope: "stripchat.com", signals: ["adguard-tp"] },
        { param: "si", scope: "youtube.com", signals: ["adguard-tp"] },
      ],
    },
  });

  assert.equal(result.added, 1);
  assert.deepEqual(written[0].scopedFacts.map((f) => f.param), ["si"]);
});

test("a fact colliding with the host's OWN preserveParams is dropped", () => {
  // youtube.com declares `v`. Upstream may call it a tracker there; the host's
  // own entry wins, and it wins through a suffix walk so spelling the host with
  // a subdomain does not bypass it.
  const { result } = harnessWith({
    report: {
      scopedAutoMerge: [
        { param: "v", scope: "www.youtube.com", signals: ["adguard-tp"] },
      ],
    },
  });

  assert.equal(result.changed, false, "nothing publishable, so nothing lands");
  assert.equal(result.added, 0);
});

test("dropping the unpublishable ones does NOT refuse the run", () => {
  // The posture that matters for an unattended weekly job: one bad fact among
  // many is ordinary at this volume, and refusing over it would mean the
  // pipeline publishes nothing at all.
  const { result, written } = harnessWith({
    report: {
      scopedAutoMerge: [
        { param: "aff_id", scope: "get.surfshark.net", signals: ["adguard-tp"] },
        { param: "action", scope: "stripchat.com", signals: ["adguard-tp"] },
        { param: "si", scope: "youtube.com", signals: ["adguard-tp"] },
        { param: "igsh", scope: "instagram.com", signals: ["adguard-tp"] },
      ],
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.added, 2);
  assert.deepEqual(written[0].scopedFacts.map((f) => f.param), ["igsh", "si"]);
});

test("a report of ONLY unpublishable facts is a clean no-op, not a throw", () => {
  const { result, written } = harnessWith({
    report: {
      scopedAutoMerge: [{ param: "aff_id", scope: "get.surfshark.net", signals: ["adguard-tp"] }],
    },
  });

  assert.equal(result.changed, false);
  assert.equal(result.written, false);
  assert.deepEqual(written, []);
});

test("a candidate with no host scope STILL refuses the run", () => {
  // The filter must not have softened the refusals. A candidate with no scope
  // means the report itself is malformed, which is a different kind of problem
  // from upstream naming a param MUGA knows better about.
  assert.throws(
    () =>
      harnessWith({
        report: { scopedAutoMerge: [{ param: "si", signals: ["adguard-tp"] }] },
      }),
    /no host scope/,
  );
});
