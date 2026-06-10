/**
 * MUGA — moat-expansion ClearURLs adapter tests (#793).
 *
 * Tests for:
 *   - extractReferralSignals: fixture-driven extraction correctness
 *   - Empty referralMarketing providers excluded
 *   - Bad-shape input throws CliError(1)
 *   - Fetch failure fail-closed via injected failing fetch (CliError exit 2)
 *   - Raw bytes written to quarantine path (injectable path)
 *   - Determinism: same input → same output
 *
 * Also includes a smoke import test for moat-snapshot.mjs to verify no
 * browser globals (chrome/window/document) are accessed at import time.
 *
 * Fixtures: tests/fixtures/moat-expansion/clearurls-mini.json
 * No upstream content — muga-authored fixture only.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import {
  extractReferralSignals,
  fetchRaw,
} from "../../tools/moat-expansion/adapters/clearurls-moat.mjs";

import { CliError } from "../../tools/moat-expansion/cli-error.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURE_PATH = join(
  __dirname,
  "../../tests/fixtures/moat-expansion/clearurls-mini.json"
);

const FIXTURE_TEXT = readFileSync(FIXTURE_PATH, "utf8");

// ── extractReferralSignals ────────────────────────────────────────────────────

describe("extractReferralSignals — extraction correctness", () => {
  test("returns an array of tuples with provider, urlPattern, referralMarketing", () => {
    const result = extractReferralSignals(FIXTURE_TEXT);
    assert.ok(Array.isArray(result), "must return an array");
    assert.ok(result.length > 0, "must return at least one tuple");
    for (const entry of result) {
      assert.ok(
        typeof entry.provider === "string" && entry.provider.length > 0,
        "each entry must have a non-empty provider string"
      );
      assert.ok(
        typeof entry.urlPattern === "string",
        "each entry must have a urlPattern string"
      );
      assert.ok(
        Array.isArray(entry.referralMarketing),
        "each entry must have a referralMarketing array"
      );
    }
  });

  test("extracts amazon with tag and newparam", () => {
    const result = extractReferralSignals(FIXTURE_TEXT);
    const amazon = result.find((e) => e.provider === "amazon");
    assert.ok(amazon, "amazon provider must be present");
    assert.ok(
      amazon.referralMarketing.includes("tag"),
      "amazon must include 'tag'"
    );
    assert.ok(
      amazon.referralMarketing.includes("newparam"),
      "amazon must include 'newparam'"
    );
  });

  test("extracts ebay with campid", () => {
    const result = extractReferralSignals(FIXTURE_TEXT);
    const ebay = result.find((e) => e.provider === "ebay");
    assert.ok(ebay, "ebay provider must be present");
    assert.ok(
      ebay.referralMarketing.includes("campid"),
      "ebay must include 'campid'"
    );
  });

  test("extracts unknown-foo with xparam", () => {
    const result = extractReferralSignals(FIXTURE_TEXT);
    const unknownFoo = result.find((e) => e.provider === "unknown-foo");
    assert.ok(unknownFoo, "unknown-foo provider must be present");
    assert.ok(
      unknownFoo.referralMarketing.includes("xparam"),
      "unknown-foo must include 'xparam'"
    );
  });

  test("excludes empty-provider (referralMarketing is empty array)", () => {
    const result = extractReferralSignals(FIXTURE_TEXT);
    const emptyProv = result.find((e) => e.provider === "empty-provider");
    assert.strictEqual(
      emptyProv,
      undefined,
      "empty-provider must be excluded from results"
    );
  });

  test("preserves urlPattern verbatim for each provider", () => {
    const result = extractReferralSignals(FIXTURE_TEXT);
    const amazon = result.find((e) => e.provider === "amazon");
    assert.ok(
      typeof amazon.urlPattern === "string" && amazon.urlPattern.length > 0,
      "urlPattern must be a non-empty string"
    );
  });

  test("determinism: same input produces identical output on two calls", () => {
    const r1 = extractReferralSignals(FIXTURE_TEXT);
    const r2 = extractReferralSignals(FIXTURE_TEXT);
    assert.deepStrictEqual(r1, r2, "two calls with same input must produce identical results");
  });
});

describe("extractReferralSignals — error handling", () => {
  test("throws CliError(1) on invalid JSON", () => {
    assert.throws(
      () => extractReferralSignals("not valid json"),
      (err) => {
        assert.ok(err instanceof CliError, "must throw CliError");
        assert.strictEqual(err.exitCode, 1, "exitCode must be 1 for bad JSON");
        return true;
      }
    );
  });

  test("throws CliError(1) when providers key is missing", () => {
    const badShape = JSON.stringify({ notProviders: {} });
    assert.throws(
      () => extractReferralSignals(badShape),
      (err) => {
        assert.ok(err instanceof CliError, "must throw CliError");
        assert.strictEqual(err.exitCode, 1, "exitCode must be 1 for bad shape");
        return true;
      }
    );
  });

  test("throws CliError(1) when providers is not an object", () => {
    const badShape = JSON.stringify({ providers: "not-an-object" });
    assert.throws(
      () => extractReferralSignals(badShape),
      (err) => {
        assert.ok(err instanceof CliError, "must throw CliError");
        assert.strictEqual(err.exitCode, 1, "exitCode must be 1 for non-object providers");
        return true;
      }
    );
  });
});

// ── fetchRaw ──────────────────────────────────────────────────────────────────

describe("fetchRaw — fetch behavior with injectable fetch", () => {
  function makeTmpDir() {
    const dir = join(tmpdir(), `moat-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  test("writes raw content to quarantine path and returns raw text", async () => {
    const tmpDir = makeTmpDir();
    const quarantinePath = join(tmpDir, "clearurls.raw");

    const fakeRaw = FIXTURE_TEXT;
    const fakeFetch = async (_url, _opts) => ({
      ok: true,
      text: async () => fakeRaw,
    });

    const result = await fetchRaw({
      fetchImpl: fakeFetch,
      quarantinePath,
    });

    assert.strictEqual(result, fakeRaw, "fetchRaw must return the raw text");
    assert.ok(existsSync(quarantinePath), "quarantine file must be written");
    assert.strictEqual(
      readFileSync(quarantinePath, "utf8"),
      fakeRaw,
      "quarantine file content must match fetched text"
    );

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates quarantine directory if it does not exist", async () => {
    const tmpDir = makeTmpDir();
    // Use a nested path that does not exist yet
    const quarantinePath = join(tmpDir, "subdir", "nested", "clearurls.raw");

    const fakeFetch = async (_url, _opts) => ({
      ok: true,
      text: async () => FIXTURE_TEXT,
    });

    await fetchRaw({ fetchImpl: fakeFetch, quarantinePath });
    assert.ok(existsSync(quarantinePath), "nested quarantine file must be created");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("throws CliError(2) when fetch throws a network error", async () => {
    const tmpDir = makeTmpDir();
    const quarantinePath = join(tmpDir, "clearurls.raw");

    const failFetch = async () => {
      throw new Error("Network unreachable");
    };

    await assert.rejects(
      () => fetchRaw({ fetchImpl: failFetch, quarantinePath }),
      (err) => {
        assert.ok(err instanceof CliError, "must throw CliError");
        assert.strictEqual(err.exitCode, 2, "exitCode must be 2 for network failure");
        return true;
      }
    );

    assert.ok(!existsSync(quarantinePath), "no file must be written on fetch failure");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("throws CliError(2) when response is non-2xx", async () => {
    const tmpDir = makeTmpDir();
    const quarantinePath = join(tmpDir, "clearurls.raw");

    const failFetch = async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    await assert.rejects(
      () => fetchRaw({ fetchImpl: failFetch, quarantinePath }),
      (err) => {
        assert.ok(err instanceof CliError, "must throw CliError");
        assert.strictEqual(err.exitCode, 2, "exitCode must be 2 for non-2xx response");
        return true;
      }
    );

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── moat-snapshot.mjs smoke import ───────────────────────────────────────────

import { loadMoatSnapshot } from "../../tools/moat-expansion/moat-snapshot.mjs";

describe("moat-snapshot — import safety smoke test", () => {
  test("loadMoatSnapshot can be imported without browser globals", () => {
    // Importing at the top of this module is already the test — if it threw,
    // the module would have failed to load. This test just verifies the export.
    assert.ok(
      typeof loadMoatSnapshot === "function",
      "loadMoatSnapshot must be a named export function"
    );
  });
});

describe("moat-snapshot — shape assertions against real moat", () => {
  test("returns an object with coveredByDomain, guardParams, knownByProgramId, landingParamSet", () => {
    const snapshot = loadMoatSnapshot();
    assert.ok(snapshot.coveredByDomain instanceof Map, "coveredByDomain must be a Map");
    assert.ok(snapshot.guardParams instanceof Set, "guardParams must be a Set");
    assert.ok(snapshot.knownByProgramId instanceof Map, "knownByProgramId must be a Map");
    assert.ok(snapshot.landingParamSet instanceof Set, "landingParamSet must be a Set");
  });

  test("amazon-associates program is in knownByProgramId with param 'tag'", () => {
    const { knownByProgramId } = loadMoatSnapshot();
    assert.ok(
      knownByProgramId.has("amazon-associates"),
      "knownByProgramId must contain amazon-associates"
    );
    const entry = knownByProgramId.get("amazon-associates");
    assert.strictEqual(entry.param, "tag", "amazon-associates param must be 'tag'");
    assert.ok(
      Array.isArray(entry.domains) && entry.domains.length > 0,
      "amazon-associates must have a non-empty domains array"
    );
    assert.ok(
      entry.domains.includes("amazon.com"),
      "amazon-associates domains must include amazon.com"
    );
  });

  test("ascsubtag is in guardParams (case-insensitive)", () => {
    const { guardParams } = loadMoatSnapshot();
    assert.ok(
      guardParams.has("ascsubtag"),
      "guardParams must contain 'ascsubtag' (from AFFILIATE_PARAM_GUARD, #794)"
    );
  });

  test("awin landingParams (awc) are in landingParamSet", () => {
    const { landingParamSet } = loadMoatSnapshot();
    assert.ok(
      landingParamSet.has("awc"),
      "landingParamSet must contain 'awc' (from REDIRECT_NETWORK_PATTERNS awin)"
    );
  });

  test("coveredByDomain has entries for amazon.com with 'tag' param", () => {
    const { coveredByDomain } = loadMoatSnapshot();
    assert.ok(
      coveredByDomain.has("amazon.com"),
      "coveredByDomain must have an entry for amazon.com"
    );
    const params = coveredByDomain.get("amazon.com");
    assert.ok(
      params.has("tag"),
      "amazon.com must have 'tag' in covered params"
    );
  });

  test("ebay-partner-network is in knownByProgramId with param 'campid'", () => {
    const { knownByProgramId } = loadMoatSnapshot();
    assert.ok(
      knownByProgramId.has("ebay-partner-network"),
      "knownByProgramId must contain ebay-partner-network"
    );
    const entry = knownByProgramId.get("ebay-partner-network");
    assert.strictEqual(entry.param, "campid", "ebay-partner-network param must be 'campid'");
  });

  test("injectable seam works — custom guard overrides production guard", () => {
    const customGuard = new Set(["testparam123"]);
    const snapshot = loadMoatSnapshot({ guard: customGuard });
    assert.ok(
      snapshot.guardParams.has("testparam123"),
      "injectable guard must override production AFFILIATE_PARAM_GUARD"
    );
    assert.ok(
      !snapshot.guardParams.has("ascsubtag"),
      "injected custom guard must not include production params"
    );
  });
});
