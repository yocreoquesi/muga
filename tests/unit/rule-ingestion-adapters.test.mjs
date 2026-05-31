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
  const params = adguardTp.parse(SAMPLE_ADGUARD);
  assert.ok(params instanceof Set);
  assert.ok(params.has("utm_source"));
  assert.ok(params.has("fbclid"));
  assert.ok(params.has("gclid"));
  assert.ok(params.has("msclkid"));
  // The /^utm_/ regex spec must NOT leak in as a literal.
  assert.ok(!params.has("/^utm_/"));
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

    const candidates = await runIngestion({
      adapters: [fakeAdapter],
      quarantineDir: dir,
      now: "2026-05-31T00:00:00.000Z",
    });

    // Raw bytes were quarantined verbatim (never returned to the caller).
    const rawPath = resolve(dir, "adguard-tp.raw");
    assert.ok(existsSync(rawPath), "raw download must be quarantined");
    assert.equal(readFileSync(rawPath, "utf8"), SAMPLE_ADGUARD);

    // Candidates carry adguard-tp provenance.
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

    const candidates = await runIngestion({
      adapters: [netAdapter],
      fetchImpl: fakeFetch,
      quarantineDir: dir,
      now: "2026-05-31T00:00:00.000Z",
    });

    assert.ok(sawInjectedFetch, "fetchRaw must use the injected fetch");
    assert.ok(candidates.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
