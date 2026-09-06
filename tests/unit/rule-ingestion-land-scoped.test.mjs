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
import { GLOBAL_SCOPE, ACTIONS } from "../../tools/rules-store.mjs";

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
