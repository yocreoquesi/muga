/**
 * MUGA — Source adapter + ingestion tests for rule-ingestion (#773).
 *
 * Covers the AdGuard TP adapter (delegates to the shared $removeparam parser),
 * the registry (only AdGuard enabled; DuckDuckGo recorded as excluded), and the
 * runIngestion flow with injected fetch + a temp quarantine dir (no network, no
 * real FS layout).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { adguardTp } from "../../tools/rule-ingestion/adapters/adguard-tp.mjs";
import {
  ENABLED_ADAPTERS,
  EXCLUDED_SOURCES,
} from "../../tools/rule-ingestion/adapters/index.mjs";
import { runIngestion } from "../../tools/rule-ingestion/ingest.mjs";
import { parseRemoveparamRules } from "../../tools/import-upstream.mjs";

const SAMPLE_ADGUARD = [
  "! Title: AdGuard URL Tracking filter",
  "[Adblock Plus 2.0]",
  "$removeparam=utm_source",
  "$removeparam=fbclid|gclid",
  "$removeparam=/^utm_/", // regex spec — skipped by the parser
  "||example.com^$removeparam=msclkid",
].join("\n");

test("adguardTp adapter has the expected identity + license", () => {
  assert.equal(adguardTp.id, "adguard-tp");
  assert.equal(adguardTp.license, "GPL-3.0");
  assert.match(adguardTp.url, /adtidy\.org/);
});

test("adguardTp.parse extracts literal params and skips regex specs", () => {
  // After T-06: adguardTp.parse returns { params, skipped, affiliateExcluded }
  const result = adguardTp.parse(SAMPLE_ADGUARD);
  const params = result.params;
  assert.ok(params instanceof Set);
  assert.ok(params.has("utm_source"));
  assert.ok(params.has("fbclid"));
  assert.ok(params.has("gclid"));
  assert.ok(params.has("msclkid"));
  // The /^utm_/ regex spec must NOT leak in as a literal.
  assert.ok(!params.has("/^utm_/"));
});

// ── T-03 (quarantine-surface #782): adguard parse shape ─────────────────────

test("T-03: adguardTp.parse returns { params, skipped, affiliateExcluded: 0 } shape", () => {
  const result = adguardTp.parse(SAMPLE_ADGUARD);
  // Must be an object with params Set
  assert.ok(result.params instanceof Set, "params must be a Set");
  // SAMPLE_ADGUARD has one regex spec ($removeparam=/^utm_/) → skipped >= 1
  assert.ok(typeof result.skipped === "number", "skipped must be a number");
  assert.ok(result.skipped >= 1, `expected skipped >= 1 (regex spec), got ${result.skipped}`);
  // adguard has no affiliate concept → affiliateExcluded === 0
  assert.equal(result.affiliateExcluded, 0, "affiliateExcluded must be 0 for adguard-tp");
});

// ── T-04 (quarantine-surface #782): parseRemoveparamRules shape ─────────────

test("T-04: parseRemoveparamRules returns { params, skipped } not a bare Set", () => {
  const result = parseRemoveparamRules(SAMPLE_ADGUARD);
  // Must be { params: Set, skipped: number } — NOT a bare Set
  assert.ok(!(result instanceof Set), "parseRemoveparamRules must return an object, not a bare Set");
  assert.ok(result.params instanceof Set, "result.params must be a Set");
  assert.ok(typeof result.skipped === "number", "result.skipped must be a number");
  assert.ok(result.params.has("utm_source"), "utm_source must be in params");
  assert.ok(result.params.has("fbclid"), "fbclid must be in params");
  assert.ok(result.skipped >= 1, `expected skipped >= 1 (regex spec), got ${result.skipped}`);
});

test("registry enables AdGuard TP and ClearURLs (two independent signal sources for GATE 2, #776)", () => {
  assert.deepEqual(
    ENABLED_ADAPTERS.map((a) => a.id),
    ["adguard-tp", "clearurls"],
  );
});

test("DuckDuckGo is recorded as a deliberately excluded source", () => {
  const ddg = EXCLUDED_SOURCES.find((s) => s.id === "duckduckgo");
  assert.ok(ddg, "duckduckgo must be in EXCLUDED_SOURCES");
  assert.match(ddg.license, /NC|NonCommercial|BY-NC/i);
});

test("runIngestion quarantines raw bytes and returns merged candidates", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "muga-ingest-"));
  try {
    const fakeAdapter = {
      id: "adguard-tp",
      name: "fake",
      license: "GPL-3.0",
      url: "https://example.test/list.txt",
      parse: adguardTp.parse,
      async fetchRaw() {
        return SAMPLE_ADGUARD;
      },
    };

    // After T-11: runIngestion returns { candidates, stats }
    const result = await runIngestion({
      adapters: [fakeAdapter],
      quarantineDir: dir,
      now: "2026-05-31T00:00:00.000Z",
    });

    // Raw bytes were quarantined verbatim (never returned to the caller).
    const rawPath = resolve(dir, "adguard-tp.raw");
    assert.ok(existsSync(rawPath), "raw download must be quarantined");
    assert.equal(readFileSync(rawPath, "utf8"), SAMPLE_ADGUARD);

    // Candidates carry adguard-tp provenance.
    const candidates = result.candidates;
    const names = candidates.map((c) => c.param);
    assert.ok(names.includes("fbclid"));
    assert.ok(names.includes("utm_source"));
    for (const c of candidates) {
      assert.deepEqual(c.signals, ["adguard-tp"]);
      assert.equal(c.firstSeenAt, "2026-05-31T00:00:00.000Z");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runIngestion injects fetch into fetchRaw (no real network)", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "muga-ingest-"));
  try {
    let sawInjectedFetch = false;
    const fakeFetch = async () => {
      sawInjectedFetch = true;
      return { ok: true, async text() { return SAMPLE_ADGUARD; } };
    };
    const netAdapter = {
      id: "adguard-tp",
      name: "fake",
      license: "GPL-3.0",
      url: "https://example.test/list.txt",
      parse: adguardTp.parse,
      fetchRaw: adguardTp.fetchRaw,
    };

    // After T-11: runIngestion returns { candidates, stats }
    const result = await runIngestion({
      adapters: [netAdapter],
      fetchImpl: fakeFetch,
      quarantineDir: dir,
      now: "2026-05-31T00:00:00.000Z",
    });

    assert.ok(sawInjectedFetch, "fetchRaw must use the injected fetch");
    assert.ok(result.candidates.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── T-10 (quarantine-surface #782): runIngestion stats aggregation ────────────

test("T-10: runIngestion aggregates stats from adapters", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "muga-ingest-stats-"));
  try {
    // Two fake adapters with known return shapes
    const fakeAdapterA = {
      id: "adapter-a",
      name: "Fake A",
      license: "test",
      url: "https://example.test/a",
      parse() {
        return { params: new Set(["p1", "p2", "p3"]), skipped: 1, affiliateExcluded: 0 };
      },
      async fetchRaw() { return "raw-a"; },
    };
    const fakeAdapterB = {
      id: "adapter-b",
      name: "Fake B",
      license: "test",
      url: "https://example.test/b",
      parse() {
        return { params: new Set(["p4", "p5"]), skipped: 0, affiliateExcluded: 1 };
      },
      async fetchRaw() { return "raw-b"; },
    };

    const result = await runIngestion({
      adapters: [fakeAdapterA, fakeAdapterB],
      quarantineDir: dir,
      now: "2026-05-31T00:00:00.000Z",
    });

    // result must have candidates array
    assert.ok(Array.isArray(result.candidates), "result.candidates must be an array");

    // result must have stats object
    assert.ok(result.stats, "result.stats must exist");
    assert.ok(Array.isArray(result.stats.adapters), "result.stats.adapters must be an array");
    assert.equal(result.stats.adapters.length, 2, "stats.adapters must have 2 entries");

    // adapter-a stats
    const statsA = result.stats.adapters.find((s) => s.adapterId === "adapter-a");
    assert.ok(statsA, "stats for adapter-a must exist");
    assert.equal(statsA.admitted, 3, "adapter-a admitted must be 3 (params.size)");
    assert.equal(statsA.skipped, 1, "adapter-a skipped must be 1");
    assert.equal(statsA.affiliateExcluded, 0, "adapter-a affiliateExcluded must be 0");

    // adapter-b stats
    const statsB = result.stats.adapters.find((s) => s.adapterId === "adapter-b");
    assert.ok(statsB, "stats for adapter-b must exist");
    assert.equal(statsB.admitted, 2, "adapter-b admitted must be 2 (params.size)");
    assert.equal(statsB.skipped, 0, "adapter-b skipped must be 0");
    assert.equal(statsB.affiliateExcluded, 1, "adapter-b affiliateExcluded must be 1");

    // merged stats
    assert.ok(result.stats.merged, "result.stats.merged must exist");
    assert.equal(typeof result.stats.merged.emptyDropped, "number", "merged.emptyDropped must be a number");
    assert.equal(result.stats.merged.total, result.candidates.length, "merged.total must equal candidates.length");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── FIX-2 (quarantine-surface PR1 review): bare-Set adapter throws clearly ────

test("FIX-2: runIngestion throws a clear TypeError naming the adapter when parse() returns a bare Set", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "muga-ingest-bare-set-"));
  try {
    const bareSetAdapter = {
      id: "bad-adapter",
      name: "Bad",
      license: "test",
      url: "https://example.test/bad",
      parse() {
        // Intentionally wrong: returns a bare Set instead of { params: Set, ... }
        return new Set(["p1", "p2"]);
      },
      async fetchRaw() { return "raw-bad"; },
    };

    await assert.rejects(
      () => runIngestion({ adapters: [bareSetAdapter], quarantineDir: dir }),
      (err) => {
        assert.ok(err instanceof TypeError, "must throw a TypeError");
        assert.ok(
          err.message.includes("bad-adapter"),
          `error message must name the adapter id; got: ${err.message}`
        );
        return true;
      },
      "runIngestion must throw a clear contract error when parse() returns a bare Set"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
