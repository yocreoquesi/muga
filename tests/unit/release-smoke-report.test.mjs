/**
 * MUGA — tools/release-smoke-report.mjs pure-logic unit tests
 * (release-smoke-battery).
 *
 * Covers summarizeRelease's READY/BLOCKED/UNVERIFIED boundaries, per-CMP
 * independence, the absent-CMP => UNVERIFIED default, and mixed inputs;
 * plus formatReleaseTable's deterministic rendering. Importing
 * tools/release-smoke-report.mjs must never read the filesystem or call
 * process.exit — see the entry-guard smoke test at the bottom, which is
 * what makes this file safe to run in the normal `npm test` gate.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { summarizeRelease, formatReleaseTable, RELEASE_CMPS } from "../../tools/release-smoke-report.mjs";

// ── summarizeRelease — READY boundary ─────────────────────────────────────

describe("release-smoke-report — summarizeRelease READY boundary", () => {
  test("1 pass, 0 fail is READY", () => {
    const summary = summarizeRelease([{ cmp: "onetrust", url: "https://a.example", status: "pass" }]);
    assert.equal(summary.onetrust.verdict, "READY");
    assert.equal(summary.onetrust.passCount, 1);
    assert.equal(summary.onetrust.failCount, 0);
  });

  test("multiple passes, 0 fail is still READY", () => {
    const summary = summarizeRelease([
      { cmp: "cookiebot", url: "https://a.example", status: "pass" },
      { cmp: "cookiebot", url: "https://b.example", status: "pass" },
    ]);
    assert.equal(summary.cookiebot.verdict, "READY");
    assert.equal(summary.cookiebot.passCount, 2);
  });

  test("pass + inconclusive (0 fail) is READY — inconclusive does not downgrade a confirmed pass", () => {
    const summary = summarizeRelease([
      { cmp: "didomi", url: "https://a.example", status: "pass" },
      { cmp: "didomi", url: "https://b.example", status: "inconclusive" },
    ]);
    assert.equal(summary.didomi.verdict, "READY");
  });
});

// ── summarizeRelease — BLOCKED boundary ───────────────────────────────────

describe("release-smoke-report — summarizeRelease BLOCKED boundary", () => {
  test("1 fail (0 pass) is BLOCKED", () => {
    const summary = summarizeRelease([{ cmp: "cookieyes", url: "https://a.example", status: "fail" }]);
    assert.equal(summary.cookieyes.verdict, "BLOCKED");
    assert.equal(summary.cookieyes.failCount, 1);
  });

  test("any fail is BLOCKED even alongside passes — fail always wins", () => {
    const summary = summarizeRelease([
      { cmp: "sourcepoint", url: "https://a.example", status: "pass" },
      { cmp: "sourcepoint", url: "https://b.example", status: "fail" },
    ]);
    assert.equal(summary.sourcepoint.verdict, "BLOCKED");
    assert.equal(summary.sourcepoint.passCount, 1);
    assert.equal(summary.sourcepoint.failCount, 1);
  });

  test("fail + inconclusive (0 pass) is BLOCKED", () => {
    const summary = summarizeRelease([
      { cmp: "usercentrics", url: "https://a.example", status: "fail" },
      { cmp: "usercentrics", url: "https://b.example", status: "inconclusive" },
    ]);
    assert.equal(summary.usercentrics.verdict, "BLOCKED");
  });
});

// ── summarizeRelease — UNVERIFIED boundary ────────────────────────────────

describe("release-smoke-report — summarizeRelease UNVERIFIED boundary", () => {
  test("only inconclusive results is UNVERIFIED", () => {
    const summary = summarizeRelease([
      { cmp: "onetrust", url: "https://a.example", status: "inconclusive" },
      { cmp: "onetrust", url: "https://b.example", status: "inconclusive" },
    ]);
    assert.equal(summary.onetrust.verdict, "UNVERIFIED");
    assert.equal(summary.onetrust.passCount, 0);
    assert.equal(summary.onetrust.failCount, 0);
    assert.equal(summary.onetrust.inconclusiveCount, 2);
  });

  test("absent CMP (no results at all) is UNVERIFIED", () => {
    const summary = summarizeRelease([{ cmp: "onetrust", url: "https://a.example", status: "pass" }]);
    // cookiebot never appears in the results array at all.
    assert.equal(summary.cookiebot.verdict, "UNVERIFIED");
    assert.equal(summary.cookiebot.passCount, 0);
    assert.equal(summary.cookiebot.failCount, 0);
    assert.equal(summary.cookiebot.inconclusiveCount, 0);
    assert.deepEqual(summary.cookiebot.sites, []);
  });

  test("empty results array: all 6 CMPs are UNVERIFIED", () => {
    const summary = summarizeRelease([]);
    for (const cmp of RELEASE_CMPS) {
      assert.equal(summary[cmp].verdict, "UNVERIFIED");
    }
  });

  test("non-array input is treated as no results — all 6 CMPs UNVERIFIED, no throw", () => {
    for (const bad of [null, undefined, "garbage", 42]) {
      const summary = summarizeRelease(bad);
      for (const cmp of RELEASE_CMPS) {
        assert.equal(summary[cmp].verdict, "UNVERIFIED");
      }
    }
  });
});

// ── summarizeRelease — per-CMP independence + malformed input ─────────────

describe("release-smoke-report — per-CMP independence and malformed entries", () => {
  test("one CMP BLOCKED does not affect another CMP's READY verdict", () => {
    const summary = summarizeRelease([
      { cmp: "onetrust", url: "https://a.example", status: "fail" },
      { cmp: "didomi", url: "https://b.example", status: "pass" },
    ]);
    assert.equal(summary.onetrust.verdict, "BLOCKED");
    assert.equal(summary.didomi.verdict, "READY");
  });

  test("all 6 CMPs mixed: one of each verdict plus one fully absent", () => {
    const summary = summarizeRelease([
      { cmp: "onetrust", url: "https://a.example", status: "pass" },
      { cmp: "cookiebot", url: "https://b.example", status: "fail" },
      { cmp: "didomi", url: "https://c.example", status: "inconclusive" },
      { cmp: "cookieyes", url: "https://d.example", status: "pass" },
      { cmp: "cookieyes", url: "https://e.example", status: "fail" },
    ]);
    assert.equal(summary.onetrust.verdict, "READY");
    assert.equal(summary.cookiebot.verdict, "BLOCKED");
    assert.equal(summary.didomi.verdict, "UNVERIFIED");
    assert.equal(summary.cookieyes.verdict, "BLOCKED");
    assert.equal(summary.sourcepoint.verdict, "UNVERIFIED");
    assert.equal(summary.usercentrics.verdict, "UNVERIFIED");
  });

  test("malformed entries (missing cmp, bad status, null, non-object) are skipped, never counted", () => {
    const summary = summarizeRelease([
      { url: "https://a.example", status: "fail" }, // missing cmp
      { cmp: "onetrust", url: "https://b.example", status: "not-a-real-status" },
      null,
      "not-an-object",
      42,
      { cmp: "onetrust", url: "https://c.example", status: "pass" },
    ]);
    assert.equal(summary.onetrust.verdict, "READY");
    assert.equal(summary.onetrust.passCount, 1);
    assert.equal(summary.onetrust.failCount, 0);
  });

  test("an unknown CMP id not in RELEASE_CMPS is still tracked defensively", () => {
    const summary = summarizeRelease([{ cmp: "future-cmp", url: "https://a.example", status: "pass" }]);
    assert.equal(summary["future-cmp"].verdict, "READY");
    // The 6 known CMPs are still all present and UNVERIFIED.
    for (const cmp of RELEASE_CMPS) {
      assert.equal(summary[cmp].verdict, "UNVERIFIED");
    }
  });

  test("each CMP's sites array preserves url/status/detail for every entry", () => {
    const summary = summarizeRelease([
      { cmp: "onetrust", url: "https://a.example", status: "fail", detail: "banner still visible" },
    ]);
    assert.deepEqual(summary.onetrust.sites, [
      { url: "https://a.example", status: "fail", detail: "banner still visible" },
    ]);
  });
});

// ── formatReleaseTable ─────────────────────────────────────────────────────

describe("release-smoke-report — formatReleaseTable", () => {
  test("renders a header row and one row per RELEASE_CMPS entry, in canonical order", () => {
    const summary = summarizeRelease([]);
    const table = formatReleaseTable(summary);
    const lines = table.split("\n");
    assert.match(lines[0], /CMP/);
    assert.match(lines[0], /Verdict/);
    // Body rows appear in RELEASE_CMPS order (header + separator take the first 2 lines).
    RELEASE_CMPS.forEach((cmp, i) => {
      assert.match(lines[2 + i], new RegExp(`^${cmp}\\s`));
    });
  });

  test("includes each CMP's verdict and counts", () => {
    const summary = summarizeRelease([
      { cmp: "onetrust", url: "https://a.example", status: "pass" },
      { cmp: "cookiebot", url: "https://b.example", status: "fail" },
    ]);
    const table = formatReleaseTable(summary);
    assert.match(table, /onetrust\s+\|\s+READY/);
    assert.match(table, /cookiebot\s+\|\s+BLOCKED/);
  });

  test("appends unknown extra CMP keys after the 6 canonical rows, sorted", () => {
    const summary = summarizeRelease([{ cmp: "zzz-future", url: "https://a.example", status: "pass" }]);
    const table = formatReleaseTable(summary);
    const lines = table.split("\n").filter((l) => l.trim().length > 0);
    // Last content row should be the extra CMP, not one of the 6 canonical ones.
    assert.match(lines[lines.length - 1], /zzz-future/);
  });

  test("is deterministic given the same input", () => {
    const summary = summarizeRelease([{ cmp: "didomi", url: "https://a.example", status: "pass" }]);
    assert.equal(formatReleaseTable(summary), formatReleaseTable(summary));
  });

  test("handles a null/undefined summary without throwing", () => {
    assert.doesNotThrow(() => formatReleaseTable(null));
    assert.doesNotThrow(() => formatReleaseTable(undefined));
  });
});

// ── Import safety: the CLI must never run on import ───────────────────────

describe("release-smoke-report — importing the module never triggers CLI/filesystem/exit calls", () => {
  test("module loads and exports the pure functions without side effects", async () => {
    // If importing this module ever executed runReleaseSmokeReportCli() at
    // top-level, this test process would attempt to read
    // test-results/canary-results.json and call process.exit — either
    // hiding a real regression or killing the test runner outright. The
    // import at the top of this file already proves this is safe; this
    // test just asserts the shape of what got exported.
    const mod = await import("../../tools/release-smoke-report.mjs");
    assert.equal(typeof mod.summarizeRelease, "function");
    assert.equal(typeof mod.formatReleaseTable, "function");
    assert.equal(typeof mod.runReleaseSmokeReportCli, "function");
    assert.ok(Array.isArray(mod.RELEASE_CMPS));
    assert.equal(mod.RELEASE_CMPS.length, 8);
  });
});
