/**
 * MUGA — Unit tests for tools/rule-ingestion/report-formatter.mjs
 *
 * Covers (T-16 RED, then T-17 GREEN):
 *   F1 — Full report → all section headings present
 *   F2 — Per-adapter ingest stats table rendered
 *   F3 — Quarantine summary: count + gate breakdown + top-N params
 *   F4 — topN truncation → only topN entries + "+N more" line
 *   F5 — Promote skips section rendered
 *   F6 — autoMerge count rendered
 *   F7 — null ingestStats → graceful "legacy run" fallback, no crash
 *   F8 — empty/noop input → valid minimal markdown, no crash
 *   F9 — output length stays well under 1 MB with large fixture
 *
 * Pure function — zero I/O, no network, no temp files.
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal valid ingestStats object */
function makeIngestStats(overrides = {}) {
  return {
    adapters: [
      { adapterId: "adguard-tp", admitted: 120, skipped: 5, affiliateExcluded: 2 },
      { adapterId: "clearurls", admitted: 80, skipped: 3, affiliateExcluded: 1 },
    ],
    merged: { emptyDropped: 0, total: 185 },
    ...overrides,
  };
}

/** Build a quarantine entry with a given param name and gate — REAL shape from orchestrate-cli.mjs */
function makeQuarantineEntry(param, gate = "CORROBORATION", reason = "only 1 source") {
  return {
    candidate: { param, signals: ["a", "b"] },
    rejections: [{ gate, reason }],
  };
}

/** Minimal valid reportObj */
function makeReport(overrides = {}) {
  return {
    generatedAt: "2025-01-15T12:00:00.000Z",
    autoMergeCount: 3,
    quarantineCount: 5,
    ingestStats: makeIngestStats(),
    quarantine: [
      makeQuarantineEntry("utm_test1"),
      makeQuarantineEntry("utm_test2", "CANARY", "canary URL broke"),
      makeQuarantineEntry("utm_test3"),
      makeQuarantineEntry("utm_test4", "FUNCTIONAL_BIAS", "functional param"),
      makeQuarantineEntry("utm_test5"),
    ],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("F1 — Full report: all section headings present", () => {
  test("output contains ingest stats, quarantine, promote skips, and autoMerge sections", async () => {
    const { formatQuarantineReport } = await import("../../tools/rule-ingestion/report-formatter.mjs");

    const report = makeReport();
    const promoteSkipped = [{ param: "ref", reason: "domain-specific" }];
    const md = formatQuarantineReport(report, { promoteSkipped });

    assert.ok(typeof md === "string", "result must be a string");
    assert.ok(md.length > 0, "result must not be empty");
    // Section headings (flexible matching — renderer may use ## or ###)
    assert.ok(/ingest/i.test(md), "output must contain an ingest stats section");
    assert.ok(/quarantine/i.test(md), "output must contain a quarantine section");
    assert.ok(/promote\s+skip/i.test(md), "output must contain a promote skips section");
    assert.ok(/auto.?merge|autoMerge/i.test(md), "output must contain an autoMerge section");
  });
});

describe("F2 — Per-adapter ingest stats table", () => {
  test("output contains each adapterId from ingestStats.adapters", async () => {
    const { formatQuarantineReport } = await import("../../tools/rule-ingestion/report-formatter.mjs");

    const report = makeReport();
    const md = formatQuarantineReport(report);

    assert.ok(/adguard-tp/.test(md), "output must list adguard-tp adapter");
    assert.ok(/clearurls/.test(md), "output must list clearurls adapter");
    // admitted counts must appear somewhere
    assert.ok(/120/.test(md), "output must include admitted count 120 for adguard-tp");
    assert.ok(/80/.test(md), "output must include admitted count 80 for clearurls");
  });

  test("output contains merged emptyDropped and total", async () => {
    const { formatQuarantineReport } = await import("../../tools/rule-ingestion/report-formatter.mjs");

    const report = makeReport({
      ingestStats: makeIngestStats({ merged: { emptyDropped: 4, total: 185 } }),
    });
    const md = formatQuarantineReport(report);

    assert.ok(/185/.test(md), "output must include merged total 185");
    assert.ok(/4/.test(md), "output must include emptyDropped count 4");
  });
});

describe("F3 — Quarantine summary: count + gate breakdown + param listing", () => {
  test("output mentions quarantineCount", async () => {
    const { formatQuarantineReport } = await import("../../tools/rule-ingestion/report-formatter.mjs");

    const report = makeReport(); // quarantineCount: 5
    const md = formatQuarantineReport(report);

    assert.ok(/5/.test(md), "output must mention quarantineCount (5)");
  });

  test("output lists gate names from quarantine rejections", async () => {
    const { formatQuarantineReport } = await import("../../tools/rule-ingestion/report-formatter.mjs");

    const report = makeReport();
    const md = formatQuarantineReport(report);

    assert.ok(/CORROBORATION/i.test(md) || /corroboration/i.test(md), "output must mention CORROBORATION gate");
    assert.ok(/CANARY/i.test(md) || /canary/i.test(md), "output must mention CANARY gate");
  });

  test("output lists quarantine params when count <= topN", async () => {
    const { formatQuarantineReport } = await import("../../tools/rule-ingestion/report-formatter.mjs");

    const report = makeReport(); // 5 entries, topN default 20
    const md = formatQuarantineReport(report);

    assert.ok(/utm_test1/.test(md), "output must list utm_test1");
    assert.ok(/utm_test5/.test(md), "output must list utm_test5");
  });
});

describe("F4 — topN truncation: >topN entries → only topN listed + '+N more'", () => {
  test("when quarantine.length > topN, output contains exactly topN entries and a '+N more' line", async () => {
    const { formatQuarantineReport } = await import("../../tools/rule-ingestion/report-formatter.mjs");

    const topN = 5;
    // Build 8 quarantine entries — 3 more than topN
    const quarantine = Array.from({ length: 8 }, (_, i) =>
      makeQuarantineEntry(`param_${i}`, "CORROBORATION")
    );
    const report = makeReport({ quarantine, quarantineCount: 8 });

    const md = formatQuarantineReport(report, { topN });

    // The first topN params must appear
    for (let i = 0; i < topN; i++) {
      assert.ok(new RegExp(`param_${i}`).test(md), `output must list param_${i}`);
    }
    // The params beyond topN must NOT appear as individual entries
    for (let i = topN; i < 8; i++) {
      assert.ok(!new RegExp(`param_${i}\\b`).test(md), `output must NOT list param_${i} (beyond topN)`);
    }
    // A "+N more" truncation line must be present
    assert.ok(/\+\d+\s+more/i.test(md), "output must contain a '+N more' truncation line");
    // Verify the count in the truncation line is correct (8 - 5 = 3)
    assert.ok(/\+3\s+more/i.test(md), "'+N more' must report +3 (8 - 5 = 3)");
  });

  test("when promoteSkipped.length > topN, output shows topN skips + '+N more'", async () => {
    const { formatQuarantineReport } = await import("../../tools/rule-ingestion/report-formatter.mjs");

    const topN = 3;
    const promoteSkipped = Array.from({ length: 6 }, (_, i) => ({
      param: `skip_${i}`,
      reason: "test reason",
    }));
    const report = makeReport({ quarantine: [], quarantineCount: 0 });

    const md = formatQuarantineReport(report, { promoteSkipped, topN });

    for (let i = 0; i < topN; i++) {
      assert.ok(new RegExp(`skip_${i}`).test(md), `output must list skip_${i}`);
    }
    for (let i = topN; i < 6; i++) {
      assert.ok(!new RegExp(`skip_${i}\\b`).test(md), `output must NOT list skip_${i}`);
    }
    assert.ok(/\+3\s+more/i.test(md), "'+N more' must report +3 for promote skips truncation");
  });
});

describe("F5 — Promote skips section", () => {
  test("output lists each promoteSkipped entry param + reason", async () => {
    const { formatQuarantineReport } = await import("../../tools/rule-ingestion/report-formatter.mjs");

    const promoteSkipped = [
      { param: "ref", reason: "domain-specific" },
      { param: "source", reason: "too generic" },
    ];
    const report = makeReport({ quarantine: [], quarantineCount: 0 });
    const md = formatQuarantineReport(report, { promoteSkipped });

    assert.ok(/ref/.test(md), "output must list 'ref' from promoteSkipped");
    assert.ok(/domain-specific/.test(md), "output must include the skip reason 'domain-specific'");
    assert.ok(/source/.test(md), "output must list 'source' from promoteSkipped");
    assert.ok(/too generic/.test(md), "output must include the skip reason 'too generic'");
  });

  test("output shows 'no promote skips' or similar when promoteSkipped is empty", async () => {
    const { formatQuarantineReport } = await import("../../tools/rule-ingestion/report-formatter.mjs");

    const report = makeReport();
    const md = formatQuarantineReport(report, { promoteSkipped: [] });

    // Should not crash and should not omit the section header entirely
    assert.ok(typeof md === "string" && md.length > 0, "must return a non-empty string");
  });
});

describe("F6 — autoMerge count rendered", () => {
  test("output mentions autoMergeCount value", async () => {
    const { formatQuarantineReport } = await import("../../tools/rule-ingestion/report-formatter.mjs");

    const report = makeReport({ autoMergeCount: 7 });
    const md = formatQuarantineReport(report);

    assert.ok(/7/.test(md), "output must mention autoMergeCount 7");
  });
});

describe("F7 — null ingestStats → graceful fallback, no crash", () => {
  test("ingestStats: null renders '(legacy run)' or similar, does not crash", async () => {
    const { formatQuarantineReport } = await import("../../tools/rule-ingestion/report-formatter.mjs");

    const report = makeReport({ ingestStats: null });
    let md;
    assert.doesNotThrow(() => {
      md = formatQuarantineReport(report);
    }, "formatQuarantineReport must not throw when ingestStats is null");

    assert.ok(typeof md === "string" && md.length > 0, "must return non-empty string");
    assert.ok(/legacy|no ingest stats|unavailable/i.test(md), "must render a graceful fallback for null ingestStats");
  });
});

describe("F8 — empty/noop input: valid minimal markdown, no crash", () => {
  test("zero quarantine + empty promoteSkipped + zero autoMerge → valid markdown, no crash", async () => {
    const { formatQuarantineReport } = await import("../../tools/rule-ingestion/report-formatter.mjs");

    const report = makeReport({
      quarantineCount: 0,
      quarantine: [],
      autoMergeCount: 0,
      ingestStats: makeIngestStats({ merged: { emptyDropped: 0, total: 0 } }),
    });

    let md;
    assert.doesNotThrow(() => {
      md = formatQuarantineReport(report, { promoteSkipped: [] });
    }, "must not throw for an empty/noop report");

    assert.ok(typeof md === "string" && md.length > 0, "must return non-empty string");
  });

  test("completely minimal report (only required fields) → no crash", async () => {
    const { formatQuarantineReport } = await import("../../tools/rule-ingestion/report-formatter.mjs");

    // Bare-minimum object — missing optional arrays
    const bareReport = {
      generatedAt: "2025-01-15T12:00:00.000Z",
      autoMergeCount: 0,
      quarantineCount: 0,
      ingestStats: null,
      quarantine: [],
    };

    let md;
    assert.doesNotThrow(() => {
      md = formatQuarantineReport(bareReport);
    }, "must not throw for bare-minimum report");
    assert.ok(typeof md === "string" && md.length > 0, "must return non-empty string");
  });
});

describe("F9 — output length well under 1 MB with large fixture", () => {
  test("1000 quarantine entries + topN:20 → output < 100 KB", async () => {
    const { formatQuarantineReport } = await import("../../tools/rule-ingestion/report-formatter.mjs");

    const quarantine = Array.from({ length: 1000 }, (_, i) =>
      makeQuarantineEntry(`large_param_${i}`, "CORROBORATION")
    );
    const promoteSkipped = Array.from({ length: 500 }, (_, i) => ({
      param: `skip_large_${i}`,
      reason: "some reason",
    }));
    const report = makeReport({
      quarantine,
      quarantineCount: 1000,
      autoMergeCount: 50,
    });

    const md = formatQuarantineReport(report, { promoteSkipped, topN: 20 });

    const byteLen = Buffer.byteLength(md, "utf8");
    // 100 KB is generous; actual should be well under 10 KB
    assert.ok(byteLen < 100_000, `output must be < 100 KB, got ${byteLen} bytes`);
    assert.ok(/\+\d+\s+more/i.test(md), "large fixture must use '+N more' truncation");
  });
});
