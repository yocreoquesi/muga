/**
 * MUGA — tools/canary-report.mjs pure-logic unit tests (#1129).
 *
 * Covers decideDrift's threshold behavior (below/at/above, inconclusive
 * always ignored, multiple CMPs tracked independently) and
 * formatIssueBody's deterministic rendering. Importing tools/canary-report.mjs
 * must never execute its CLI (no gh/network calls) — see the entry-guard
 * smoke test at the bottom, which is what makes this file safe to run in
 * the normal `npm test` gate.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decideDrift, formatIssueBody } from "../../tools/canary-report.mjs";

// ── decideDrift — threshold behavior ──────────────────────────────────────

describe("canary-report — decideDrift threshold behavior", () => {
  test("below threshold: 1 fail (default threshold 2) is not drift", () => {
    const results = [
      { cmp: "onetrust", url: "https://a.example", status: "fail" },
      { cmp: "onetrust", url: "https://b.example", status: "pass" },
    ];
    const drift = decideDrift(results);
    assert.equal(drift.onetrust.inDrift, false);
    assert.equal(drift.onetrust.failCount, 1);
  });

  test("at threshold: exactly 2 fails (default threshold 2) IS drift", () => {
    const results = [
      { cmp: "onetrust", url: "https://a.example", status: "fail" },
      { cmp: "onetrust", url: "https://b.example", status: "fail" },
    ];
    const drift = decideDrift(results);
    assert.equal(drift.onetrust.inDrift, true);
    assert.equal(drift.onetrust.failCount, 2);
  });

  test("above threshold: 3 fails is drift", () => {
    const results = [
      { cmp: "sourcepoint", url: "https://a.example", status: "fail" },
      { cmp: "sourcepoint", url: "https://b.example", status: "fail" },
      { cmp: "sourcepoint", url: "https://c.example", status: "fail" },
    ];
    const drift = decideDrift(results);
    assert.equal(drift.sourcepoint.inDrift, true);
    assert.equal(drift.sourcepoint.failCount, 3);
  });

  test("custom threshold: 2 fails is NOT drift when threshold is 3", () => {
    const results = [
      { cmp: "didomi", url: "https://a.example", status: "fail" },
      { cmp: "didomi", url: "https://b.example", status: "fail" },
    ];
    const drift = decideDrift(results, { threshold: 3 });
    assert.equal(drift.didomi.inDrift, false);
  });

  test("custom threshold: 1 fail IS drift when threshold is 1", () => {
    const results = [{ cmp: "cookiebot", url: "https://a.example", status: "fail" }];
    const drift = decideDrift(results, { threshold: 1 });
    assert.equal(drift.cookiebot.inDrift, true);
  });

  test("inconclusive results never count toward drift, even many of them", () => {
    const results = [
      { cmp: "cookieyes", url: "https://a.example", status: "inconclusive" },
      { cmp: "cookieyes", url: "https://b.example", status: "inconclusive" },
      { cmp: "cookieyes", url: "https://c.example", status: "inconclusive" },
    ];
    const drift = decideDrift(results);
    assert.equal(drift.cookieyes.inDrift, false);
    assert.equal(drift.cookieyes.failCount, 0);
    assert.equal(drift.cookieyes.inconclusiveCount, 3);
  });

  test("a CMP with only pass/inconclusive results is healthy", () => {
    const results = [
      { cmp: "usercentrics", url: "https://a.example", status: "pass" },
      { cmp: "usercentrics", url: "https://b.example", status: "inconclusive" },
    ];
    const drift = decideDrift(results);
    assert.equal(drift.usercentrics.inDrift, false);
    assert.equal(drift.usercentrics.passCount, 1);
    assert.equal(drift.usercentrics.inconclusiveCount, 1);
  });

  test("mixed CMPs are tracked independently — one drifting does not affect another", () => {
    const results = [
      { cmp: "onetrust", url: "https://a.example", status: "fail" },
      { cmp: "onetrust", url: "https://b.example", status: "fail" },
      { cmp: "didomi", url: "https://c.example", status: "pass" },
      { cmp: "didomi", url: "https://d.example", status: "inconclusive" },
    ];
    const drift = decideDrift(results);
    assert.equal(drift.onetrust.inDrift, true);
    assert.equal(drift.didomi.inDrift, false);
  });

  test("empty results produce an empty map, no throw", () => {
    assert.deepEqual(decideDrift([]), {});
  });

  test("malformed entries (missing cmp, bad status) are skipped, never counted as fail", () => {
    const results = [
      { url: "https://a.example", status: "fail" }, // missing cmp
      { cmp: "onetrust", url: "https://b.example", status: "not-a-real-status" },
      null,
      "not-an-object",
      { cmp: "onetrust", url: "https://c.example", status: "fail" },
    ];
    const drift = decideDrift(results);
    assert.equal(drift.onetrust.failCount, 1);
    assert.equal(drift.onetrust.inDrift, false);
  });

  test("non-array input is treated as no results", () => {
    assert.deepEqual(decideDrift(null), {});
    assert.deepEqual(decideDrift(undefined), {});
    assert.deepEqual(decideDrift("garbage"), {});
  });

  test("each CMP's sites array preserves url/status/detail for every entry", () => {
    const results = [
      { cmp: "onetrust", url: "https://a.example", status: "fail", detail: "still visible" },
    ];
    const drift = decideDrift(results);
    assert.deepEqual(drift.onetrust.sites, [{ url: "https://a.example", status: "fail", detail: "still visible" }]);
  });
});

// ── formatIssueBody — deterministic rendering ─────────────────────────────

describe("canary-report — formatIssueBody", () => {
  const driftDetail = {
    inDrift: true,
    failCount: 2,
    passCount: 0,
    inconclusiveCount: 0,
    sites: [
      { url: "https://a.example", status: "fail", detail: "still visible" },
      { url: "https://b.example", status: "fail", detail: "still visible" },
    ],
  };

  test("includes the CMP name, timestamp, and fail/pass/inconclusive counts", () => {
    const body = formatIssueBody("onetrust", driftDetail, "2026-07-16T03:00:00Z");
    assert.match(body, /onetrust/);
    assert.match(body, /2026-07-16T03:00:00Z/);
    assert.match(body, /2 of its canary site\(s\)/);
    assert.match(body, /0 pass, 0 inconclusive/);
  });

  test("renders one table row per site with url, status, detail", () => {
    const body = formatIssueBody("onetrust", driftDetail, "2026-07-16T03:00:00Z");
    assert.match(body, /\| https:\/\/a\.example \| fail \| still visible \|/);
    assert.match(body, /\| https:\/\/b\.example \| fail \| still visible \|/);
  });

  test("never calls Date.now() / new Date() internally — identical timestamp in, identical timestamp out", () => {
    const bodyA = formatIssueBody("onetrust", driftDetail, "FIXED-TIMESTAMP-1");
    const bodyB = formatIssueBody("onetrust", driftDetail, "FIXED-TIMESTAMP-1");
    assert.equal(bodyA, bodyB);
    assert.match(bodyA, /FIXED-TIMESTAMP-1/);
  });

  test("mentions the non-blocking nature of the alarm", () => {
    const body = formatIssueBody("didomi", driftDetail, "t");
    assert.match(body, /NON-BLOCKING/);
  });

  test("is stable/deterministic given the same input (no randomness)", () => {
    const body1 = formatIssueBody("cookiebot", driftDetail, "2026-01-01T00:00:00Z");
    const body2 = formatIssueBody("cookiebot", driftDetail, "2026-01-01T00:00:00Z");
    assert.equal(body1, body2);
  });
});

// ── Import safety: the CLI must never run on import ───────────────────────

describe("canary-report — importing the module never triggers CLI/gh/network calls", () => {
  test("module loads and exports the pure functions without side effects", async () => {
    // If importing this module ever executed runCanaryReportCli() at
    // top-level, this test process would attempt to shell out to `gh` and
    // either hang, throw, or (worse) silently no-op in a way that hides a
    // real regression. The import at the top of this file already proves
    // this is safe; this test just asserts the shape of what got exported.
    const mod = await import("../../tools/canary-report.mjs");
    assert.equal(typeof mod.decideDrift, "function");
    assert.equal(typeof mod.formatIssueBody, "function");
    assert.equal(typeof mod.runCanaryReportCli, "function");
  });
});
