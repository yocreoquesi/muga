/**
 * MUGA — Unit tests for ingest.mjs robustness (#813).
 *
 * Covers:
 *   T-813-1: fetchRaw AbortController timeout — never-resolving fetch → ADAPTER_TIMEOUT error
 *   T-813-2: one adapter throws → other adapter still contributes params; failure recorded in stats
 *   T-813-3: all adapters throw → runIngestion rejects with all-failed error (exitCode:1)
 *   T-813-4: failed adapter appears in formatted ingest stats (report-formatter)
 *
 * All tests are network-free and use injectable fetchImpl / timeoutMs / adapters.
 * Follows the #782 established injection pattern (fetchImpl, adapters, quarantineDir).
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runIngestion } from "../../tools/rule-ingestion/ingest.mjs";
import { clearurls } from "../../tools/rule-ingestion/adapters/clearurls.mjs";
import { adguardTp } from "../../tools/rule-ingestion/adapters/adguard-tp.mjs";
import { formatQuarantineReport } from "../../tools/rule-ingestion/report-formatter.mjs";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const d = join(
    tmpdir(),
    `muga-ingest-robustness-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(d, { recursive: true });
  return d;
}

/** fetchImpl that returns canned content immediately */
function makeOkFetch(content = "") {
  return async () => ({ ok: true, text: async () => content });
}

/** Minimal adapter factory for test injection */
function makeAdapter({ id = "test", params = new Set(), fetchRaw } = {}) {
  return {
    id,
    name: `Test adapter ${id}`,
    license: "MIT",
    url: "https://example.com",
    fetchRaw: fetchRaw ?? (async () => ""),
    parse: () => ({ params, skipped: 0, affiliateExcluded: 0 }),
  };
}

// ── T-813-1: Fetch timeout ─────────────────────────────────────────────────────

describe("T-813-1 — fetch timeout via AbortController", () => {
  test("clearurls.fetchRaw: never-resolving fetchImpl → rejects with ADAPTER_TIMEOUT error", async () => {
    // A fetchImpl that returns a promise that never resolves — simulates a hung connection.
    const neverResolveFetch = () => new Promise(() => {});

    await assert.rejects(
      () => clearurls.fetchRaw({ fetchImpl: neverResolveFetch, timeoutMs: 50 }),
      (err) => {
        assert.ok(
          err.message.includes("ADAPTER_TIMEOUT"),
          `Expected ADAPTER_TIMEOUT in message, got: ${err.message}`
        );
        assert.ok(
          err.message.includes("clearurls"),
          `Expected adapter id 'clearurls' in message, got: ${err.message}`
        );
        return true;
      }
    );
  });

  test("adguard-tp.fetchRaw: never-resolving fetchImpl → rejects with ADAPTER_TIMEOUT error", async () => {
    const neverResolveFetch = () => new Promise(() => {});

    await assert.rejects(
      () => adguardTp.fetchRaw({ fetchImpl: neverResolveFetch, timeoutMs: 50 }),
      (err) => {
        assert.ok(
          err.message.includes("ADAPTER_TIMEOUT"),
          `Expected ADAPTER_TIMEOUT in message, got: ${err.message}`
        );
        assert.ok(
          err.message.includes("adguard-tp"),
          `Expected adapter id 'adguard-tp' in message, got: ${err.message}`
        );
        return true;
      }
    );
  });

  test("timeout message includes the configured timeout duration (ms)", async () => {
    const neverResolveFetch = () => new Promise(() => {});
    const timeoutMs = 75;

    await assert.rejects(
      () => clearurls.fetchRaw({ fetchImpl: neverResolveFetch, timeoutMs }),
      (err) => {
        assert.ok(
          err.message.includes(String(timeoutMs)),
          `Expected ${timeoutMs} in timeout message, got: ${err.message}`
        );
        return true;
      }
    );
  });

  test("successful fetch still works when timeout does not fire (no regression)", async () => {
    const goodFetch = makeOkFetch("rawtext");
    // Should resolve before the 5s timeout
    const result = await clearurls.fetchRaw({ fetchImpl: goodFetch, timeoutMs: 5000 });
    assert.equal(result, "rawtext");
  });
});

// ── T-813-2: Per-adapter isolation ────────────────────────────────────────────

describe("T-813-2 — per-adapter isolation: one fails, others still contribute", () => {
  test("failing adapter's error is recorded in stats.adapters[]; other adapter params still returned", async () => {
    const quarantineDir = makeTmpDir();

    const failingAdapter = makeAdapter({
      id: "failing",
      fetchRaw: async () => { throw new Error("network down"); },
    });

    const okAdapter = makeAdapter({
      id: "ok-adapter",
      params: new Set(["utm_source", "gclid"]),
    });

    const { candidates, stats } = await runIngestion({
      adapters: [failingAdapter, okAdapter],
      fetchImpl: makeOkFetch(),
      quarantineDir,
    });

    // Failing adapter must be recorded in stats with status:failed + error message
    const failedStat = stats.adapters.find((a) => a.adapterId === "failing");
    assert.ok(failedStat, "stats.adapters must include an entry for the failing adapter");
    assert.equal(failedStat.status, "failed", "failed adapter must have status:'failed'");
    assert.ok(
      typeof failedStat.error === "string" && failedStat.error.length > 0,
      "failed adapter must record the error message"
    );
    assert.equal(failedStat.admitted ?? 0, 0, "failed adapter must have 0 admitted params");

    // OK adapter's params must still be in the output (merged into candidates)
    const okStat = stats.adapters.find((a) => a.adapterId === "ok-adapter");
    assert.ok(okStat, "stats.adapters must include an entry for the ok adapter");
    assert.equal(okStat.status, "ok", "successful adapter must have status:'ok'");
    assert.ok(okStat.admitted > 0, "successful adapter must record non-zero admitted params");

    // The ok adapter's params must feed into candidates
    const paramNames = candidates.map((c) => c.param ?? c.candidate?.param ?? c);
    assert.ok(
      paramNames.length > 0 || candidates.length > 0,
      "candidates array must be non-empty when at least one adapter succeeded"
    );
  });

  test("failing adapter does NOT silently skip — stats entry is always present", async () => {
    const quarantineDir = makeTmpDir();

    const failingAdapter = makeAdapter({
      id: "adapter-a",
      fetchRaw: async () => { throw new Error("timeout"); },
    });

    const { stats } = await runIngestion({
      adapters: [failingAdapter, makeAdapter({ id: "adapter-b", params: new Set(["x"]) })],
      fetchImpl: makeOkFetch(),
      quarantineDir,
    });

    // Both adapters must appear in stats — failure is recorded, not silently dropped
    assert.equal(stats.adapters.length, 2, "stats must have one entry per adapter regardless of failure");
  });

  test("partial failure: stats.failedAdapters count matches number of failed adapters", async () => {
    const quarantineDir = makeTmpDir();

    const fail1 = makeAdapter({ id: "fail-1", fetchRaw: async () => { throw new Error("err"); } });
    const fail2 = makeAdapter({ id: "fail-2", fetchRaw: async () => { throw new Error("err"); } });
    const ok1 = makeAdapter({ id: "ok-1", params: new Set(["param_a"]) });

    const { stats } = await runIngestion({
      adapters: [fail1, fail2, ok1],
      fetchImpl: makeOkFetch(),
      quarantineDir,
    });

    assert.equal(
      stats.failedAdapters,
      2,
      `stats.failedAdapters must be 2, got ${stats.failedAdapters}`
    );
  });
});

// ── T-813-3: All adapters failed → hard failure ────────────────────────────────

describe("T-813-3 — all adapters failed → runIngestion rejects with exitCode:1", () => {
  test("all adapters throw → runIngestion rejects (does not silently return empty)", async () => {
    const quarantineDir = makeTmpDir();

    const fail1 = makeAdapter({ id: "fail-1", fetchRaw: async () => { throw new Error("err1"); } });
    const fail2 = makeAdapter({ id: "fail-2", fetchRaw: async () => { throw new Error("err2"); } });

    await assert.rejects(
      () => runIngestion({ adapters: [fail1, fail2], fetchImpl: makeOkFetch(), quarantineDir }),
      (err) => {
        assert.ok(err !== null, "must throw when all adapters fail");
        return true;
      }
    );
  });

  test("all-adapters-failed error has exitCode:1 (validation failure, not infra)", async () => {
    const quarantineDir = makeTmpDir();

    const fail1 = makeAdapter({ id: "fail-1", fetchRaw: async () => { throw new Error("err1"); } });
    const fail2 = makeAdapter({ id: "fail-2", fetchRaw: async () => { throw new Error("err2"); } });

    let thrown = null;
    try {
      await runIngestion({ adapters: [fail1, fail2], fetchImpl: makeOkFetch(), quarantineDir });
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown !== null, "must throw");
    assert.equal(
      thrown.exitCode,
      1,
      `all-adapters-failed error must have exitCode:1, got ${thrown?.exitCode}`
    );
  });

  test("all-adapters-failed error message names the condition clearly", async () => {
    const quarantineDir = makeTmpDir();

    const fail1 = makeAdapter({ id: "fail-1", fetchRaw: async () => { throw new Error("err1"); } });

    let thrown = null;
    try {
      await runIngestion({ adapters: [fail1], fetchImpl: makeOkFetch(), quarantineDir });
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown !== null, "must throw");
    assert.ok(
      thrown.message.toLowerCase().includes("all") &&
      thrown.message.toLowerCase().includes("adapter"),
      `error message must mention 'all adapters', got: ${thrown.message}`
    );
  });

  test("single adapter ok → runIngestion resolves (partial failure is NOT a hard failure)", async () => {
    const quarantineDir = makeTmpDir();

    const fail1 = makeAdapter({ id: "fail-1", fetchRaw: async () => { throw new Error("err"); } });
    const ok1 = makeAdapter({ id: "ok-1", params: new Set(["utm_source"]) });

    // Must NOT throw — partial failure is surfaced in stats but pipeline continues
    const result = await runIngestion({
      adapters: [fail1, ok1],
      fetchImpl: makeOkFetch(),
      quarantineDir,
    });

    assert.ok(result.candidates !== undefined, "must return candidates when at least one adapter ok");
    assert.ok(result.stats !== undefined, "must return stats when at least one adapter ok");
  });
});

// ── T-813-4: Failed adapter surfacing in report-formatter ─────────────────────

describe("T-813-4 — failed adapter appears in formatted report output", () => {
  /**
   * Build a minimal quarantine-report.json shape that includes ingestStats
   * with a failed adapter entry. This is the shape written by orchestrate-cli
   * and read by format-surface / formatQuarantineReport.
   */
  function makeReportWithFailedAdapter() {
    return {
      generatedAt: "2025-01-15T12:00:00.000Z",
      quarantineCount: 0,
      quarantine: [],
      autoMergeCount: 0,
      ingestStats: {
        adapters: [
          {
            adapterId: "clearurls",
            status: "failed",
            error: "ADAPTER_TIMEOUT: clearurls after 30000ms",
            admitted: 0,
            skipped: 0,
            affiliateExcluded: 0,
          },
          {
            adapterId: "adguard-tp",
            status: "ok",
            admitted: 5,
            skipped: 2,
            affiliateExcluded: 0,
          },
        ],
        merged: { total: 0, emptyDropped: 0 },
        failedAdapters: 1,
      },
    };
  }

  test("formatQuarantineReport includes failed adapter in ingest stats table", () => {
    const report = makeReportWithFailedAdapter();
    const md = formatQuarantineReport(report);

    assert.ok(md.includes("clearurls"), "report must mention the failed adapter id");
    assert.ok(md.includes("failed") || md.includes("FAILED"), "report must indicate adapter failure");
  });

  test("formatQuarantineReport includes the error message for failed adapters", () => {
    const report = makeReportWithFailedAdapter();
    const md = formatQuarantineReport(report);

    assert.ok(
      md.includes("ADAPTER_TIMEOUT") || md.includes("clearurls after"),
      `report must include the timeout error in the output. Got:\n${md}`
    );
  });

  test("formatQuarantineReport still renders ok adapter stats alongside failed ones", () => {
    const report = makeReportWithFailedAdapter();
    const md = formatQuarantineReport(report);

    assert.ok(md.includes("adguard-tp"), "successful adapter must also appear in stats table");
    assert.ok(md.includes("5"), "admitted count for ok adapter must appear");
  });

  test("all-adapters-failed: failedAdapters count visible in report when > 0", () => {
    const report = makeReportWithFailedAdapter();
    const md = formatQuarantineReport(report);

    // The report must surface that an adapter failed — pattern covers "1 failed" / "failedAdapters: 1" etc.
    assert.ok(
      md.includes("1") && (md.includes("failed") || md.includes("FAILED")),
      `report must surface failed adapter count. Got:\n${md.slice(0, 500)}`
    );
  });
});

// ── T-813-5: Null-payload fetch robustness (#813 follow-up) ───────────────────
//
// Reproduces the crash described in the review finding: a fetchImpl whose
// res.text() resolves to null previously caused writeFileSync(path, null, "utf8")
// to throw a TypeError, which was re-thrown by the `instanceof TypeError` proxy
// (crashing the whole run with exitCode: undefined instead of recording failure).
//
// After the fix: the null-payload is caught BEFORE writeFileSync is called
// (ADAPTER_BAD_PAYLOAD guard), the adapter is recorded as failed, the loop
// continues, and other adapters still contribute their params.

describe("T-813-5 — null-payload fetch → records as failed, no crash", () => {
  /** A fetchImpl whose res.text() resolves to null (simulates upstream garbage) */
  function makeNullTextFetch() {
    return async () => ({ ok: true, text: async () => null });
  }

  /**
   * Adapter whose fetchRaw delegates to fetchImpl and returns whatever text() gives.
   * This is the minimal repro: fetchRaw gets null and returns it, triggering the bug.
   */
  function makeNullPayloadAdapter(id = "null-fetch") {
    return {
      id,
      name: `Null-payload adapter ${id}`,
      license: "MIT",
      url: "https://example.com",
      fetchRaw: async ({ fetchImpl }) => {
        const res = await fetchImpl();
        return await res.text();   // returns null
      },
      parse: () => ({ params: new Set(["should-not-reach"]), skipped: 0, affiliateExcluded: 0 }),
    };
  }

  test("fetchImpl returning { ok:true, text: async () => null } → adapter recorded failed, no crash", async () => {
    const quarantineDir = makeTmpDir();

    const nullAdapter = makeNullPayloadAdapter("null-fetch");

    // Must NOT throw — the adapter failure is recorded, not re-thrown.
    let thrown = null;
    let _result = null;
    try {
      _result = await runIngestion({
        adapters: [nullAdapter],
        fetchImpl: makeNullTextFetch(),
        quarantineDir,
      });
    } catch (err) {
      thrown = err;
    }

    // Single adapter failed → all-adapters-failed → throws with exitCode:1
    // (that is the correct hard-failure path, not a re-thrown TypeError crash)
    // The key invariant: exitCode must be defined (1) — not undefined as in the bug.
    assert.ok(
      thrown !== null,
      "single-adapter null-payload → all-adapters-failed → must throw (exitCode:1 path)"
    );
    assert.strictEqual(
      thrown.exitCode,
      1,
      `all-adapters-failed error must have exitCode:1, not undefined — got: ${thrown?.exitCode}, message: ${thrown?.message}`
    );
  });

  test("null-payload adapter recorded as failed; other (ok) adapter still ingests its params", async () => {
    const quarantineDir = makeTmpDir();

    const nullAdapter = makeNullPayloadAdapter("null-fetch");
    const okAdapter = makeAdapter({
      id: "ok-adapter",
      params: new Set(["utm_source", "gclid"]),
    });

    // Must NOT throw — the null-fetch adapter fails but ok-adapter succeeds.
    const { candidates, stats } = await runIngestion({
      adapters: [nullAdapter, okAdapter],
      fetchImpl: makeNullTextFetch(),
      quarantineDir,
    });

    // null-fetch adapter must appear as failed
    const nullStat = stats.adapters.find((a) => a.adapterId === "null-fetch");
    assert.ok(nullStat, "null-fetch adapter must have a stats entry");
    assert.strictEqual(nullStat.status, "failed", "null-fetch adapter must be recorded as failed");
    assert.ok(
      typeof nullStat.error === "string" && nullStat.error.length > 0,
      "null-fetch adapter must record a non-empty error string"
    );
    assert.ok(
      nullStat.error.includes("ADAPTER_BAD_PAYLOAD") || nullStat.error.includes("null"),
      `null-fetch error must mention ADAPTER_BAD_PAYLOAD or null; got: ${nullStat.error}`
    );

    // ok-adapter must still contribute params
    const okStat = stats.adapters.find((a) => a.adapterId === "ok-adapter");
    assert.ok(okStat, "ok-adapter must have a stats entry");
    assert.strictEqual(okStat.status, "ok", "ok-adapter must succeed");
    assert.ok(okStat.admitted > 0, "ok-adapter must admit its params");

    // candidates must include ok-adapter's output
    assert.ok(candidates.length > 0, "candidates must be non-empty when ok-adapter contributed");

    // failedAdapters count must be 1
    assert.strictEqual(stats.failedAdapters, 1, "failedAdapters must be 1");
  });
});

// ── T-813-6: AdapterContractError sentinel re-throw still works ───────────────
//
// Verifies that true programming-contract violations (parse() returning garbage)
// still bubble up immediately (not recorded as transient failures).
// This is the updated FIX-2 behavior: sentinel path, not `instanceof TypeError`.

// ── Slice 2 (rules-scope-normalization): scopedParams adapter contract ────────
// A.15/A.16/A.18: when an adapter reports `scopedParams`, ingest.mjs must
// validate its shape (array of {param, scope}) and surface a per-adapter
// `scopedAdmitted` stat — read defensively (?? 0) so old-shaped stats keep
// working unmodified.

describe("A.15/A.16/A.18 — scopedParams adapter contract + scopedAdmitted stat", () => {
  test("well-formed scopedParams flows into stats as scopedAdmitted", async () => {
    const quarantineDir = makeTmpDir();

    const scopedAdapter = makeAdapter({ id: "adguard-tp", params: new Set(["fbclid"]) });
    scopedAdapter.parse = () => ({
      params: new Set(["fbclid"]),
      skipped: 0,
      affiliateExcluded: 0,
      scopedParams: [
        { param: "si", scope: "youtube.com" },
        { param: "igshid", scope: "instagram.com" },
      ],
    });

    const { stats } = await runIngestion({
      adapters: [scopedAdapter],
      fetchImpl: makeOkFetch(),
      quarantineDir,
    });

    const stat = stats.adapters.find((a) => a.adapterId === "adguard-tp");
    assert.ok(stat, "adapter stat entry must exist");
    assert.equal(stat.scopedAdmitted, 2, "scopedAdmitted must count scopedParams entries");
  });

  test("adapter with no scopedParams field defaults scopedAdmitted to 0 (backward compatible)", async () => {
    const quarantineDir = makeTmpDir();

    const plainAdapter = makeAdapter({ id: "clearurls", params: new Set(["gclid"]) });

    const { stats } = await runIngestion({
      adapters: [plainAdapter],
      fetchImpl: makeOkFetch(),
      quarantineDir,
    });

    const stat = stats.adapters.find((a) => a.adapterId === "clearurls");
    assert.ok(stat, "adapter stat entry must exist");
    assert.equal(stat.scopedAdmitted, 0, "scopedAdmitted must default to 0 when absent");
  });

  test("malformed scopedParams (not an array) throws AdapterContractError", async () => {
    const quarantineDir = makeTmpDir();

    const badAdapter = makeAdapter({ id: "bad-scoped", params: new Set(["x"]) });
    badAdapter.parse = () => ({
      params: new Set(["x"]),
      skipped: 0,
      affiliateExcluded: 0,
      scopedParams: "not-an-array",
    });

    await assert.rejects(
      () => runIngestion({ adapters: [badAdapter], quarantineDir }),
      (err) => {
        assert.strictEqual(err.code, "ADAPTER_CONTRACT");
        assert.ok(err.message.includes("bad-scoped"));
        return true;
      },
    );
  });

  test("malformed scopedParams entry (missing scope field) throws AdapterContractError", async () => {
    const quarantineDir = makeTmpDir();

    const badAdapter = makeAdapter({ id: "bad-scoped-entry", params: new Set(["x"]) });
    badAdapter.parse = () => ({
      params: new Set(["x"]),
      skipped: 0,
      affiliateExcluded: 0,
      scopedParams: [{ param: "si" }], // missing `scope`
    });

    await assert.rejects(
      () => runIngestion({ adapters: [badAdapter], quarantineDir }),
      (err) => {
        assert.strictEqual(err.code, "ADAPTER_CONTRACT");
        assert.ok(err.message.includes("bad-scoped-entry"));
        return true;
      },
    );
  });

  test("malformed scopedParams entry (missing param field) throws AdapterContractError", async () => {
    const quarantineDir = makeTmpDir();

    const badAdapter = makeAdapter({ id: "bad-scoped-entry-2", params: new Set(["x"]) });
    badAdapter.parse = () => ({
      params: new Set(["x"]),
      skipped: 0,
      affiliateExcluded: 0,
      scopedParams: [{ scope: "youtube.com" }], // missing `param`
    });

    await assert.rejects(
      () => runIngestion({ adapters: [badAdapter], quarantineDir }),
      (err) => {
        assert.strictEqual(err.code, "ADAPTER_CONTRACT");
        assert.ok(err.message.includes("bad-scoped-entry-2"));
        return true;
      },
    );
  });
});

describe("T-813-6 — AdapterContractError sentinel still re-throws for true contract violations", () => {
  test("parse() returning null → throws with code ADAPTER_CONTRACT (not recorded as failed)", async () => {
    const quarantineDir = makeTmpDir();

    const contractViolator = {
      id: "contract-violator",
      name: "Contract violator",
      license: "MIT",
      url: "https://example.com",
      fetchRaw: async () => "valid-raw",
      parse: () => null,  // programming contract violation: must return { params: Set, ... }
    };

    await assert.rejects(
      () => runIngestion({ adapters: [contractViolator], quarantineDir }),
      (err) => {
        assert.strictEqual(
          err.code,
          "ADAPTER_CONTRACT",
          `must re-throw with code ADAPTER_CONTRACT; got code=${err.code}, message=${err.message}`
        );
        assert.ok(
          err.message.includes("contract-violator"),
          `error must name the adapter id; got: ${err.message}`
        );
        return true;
      }
    );
  });

  test("parse() returning a bare Set → throws with code ADAPTER_CONTRACT", async () => {
    const quarantineDir = makeTmpDir();

    const bareSetAdapter = {
      id: "bare-set-adapter",
      name: "Bare set",
      license: "MIT",
      url: "https://example.com",
      fetchRaw: async () => "valid-raw",
      parse: () => new Set(["p1", "p2"]),  // missing { params } wrapper
    };

    await assert.rejects(
      () => runIngestion({ adapters: [bareSetAdapter], quarantineDir }),
      (err) => {
        assert.strictEqual(err.code, "ADAPTER_CONTRACT");
        assert.ok(err.message.includes("bare-set-adapter"));
        return true;
      }
    );
  });
});
