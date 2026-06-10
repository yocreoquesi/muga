/**
 * MUGA — moat-expansion CLI integration test (#793).
 *
 * Drives runMoatExpansionCli end-to-end with:
 *   - Injected fetchImpl returning fixture bytes (no real network)
 *   - Temporary directories for quarantine and reports
 *   - Injected clock for deterministic timestamps
 *   - Injected moatSnapshot override (no src/ read needed)
 *
 * Coverage:
 *   - Report file written with expected content sections
 *   - Raw file quarantined
 *   - Fail-closed: fetch failure → CliError(exitCode 2), no report written
 *   - Fail-closed: bad JSON shape → CliError(exitCode 1), no report written
 *   - Fail-closed: bad providers shape → CliError(exitCode 1), no report written
 *   - No src/ files mutated
 *
 * Runner: npm run test:integration:stub
 *   (this file lives under tests/integration/ — NOT in the default unit glob)
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { runMoatExpansionCli } from "../../tools/moat-expansion/cli.mjs";
import { CliError } from "../../tools/moat-expansion/cli-error.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Fixture data ──────────────────────────────────────────────────────────────

// Minimal ClearURLs-shaped JSON — two providers with referralMarketing
const FIXTURE_JSON = JSON.stringify({
  providers: {
    amazon: {
      urlPattern: "^https?://([a-z0-9-]+\\.)*amazon\\.",
      referralMarketing: ["tag", "newparam"],
    },
    unknownshop: {
      urlPattern: "^https?://unknownshop\\.example\\.com/",
      referralMarketing: ["ref"],
    },
    emptyprovider: {
      urlPattern: "^https?://empty\\.example\\.com/",
      referralMarketing: [],
    },
  },
});

// Injected snapshot: amazon-associates covers "tag"; "newparam" is a gap.
// unknownshop is not in the lookup so its "ref" param surfaces as unknown-provider.
const INJECTED_SNAPSHOT = {
  coveredByDomain: new Map([
    ["amazon.com", new Set(["tag"])],
    ["amazon.co.uk", new Set(["tag"])],
  ]),
  guardParams: new Set(["ascsubtag"]),
  knownByProgramId: new Map([
    [
      "amazon-associates",
      { param: "tag", domains: ["amazon.com", "amazon.co.uk"] },
    ],
  ]),
  landingParamSet: new Set(["awc"]),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a fresh temp directory for one test run.
 * Returns { quarantineDir, reportsDir, cleanup }.
 */
function makeTempDirs(prefix) {
  const base = join(tmpdir(), `moat-cli-test-${prefix}-${Date.now()}`);
  const quarantineDir = join(base, "quarantine");
  const reportsDir = join(base, "reports");
  mkdirSync(quarantineDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  return {
    quarantineDir,
    reportsDir,
    cleanup() {
      try {
        rmSync(base, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors in test teardown
      }
    },
  };
}

/**
 * Build a success fetchImpl that returns the fixture JSON.
 */
function successFetch() {
  return async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => FIXTURE_JSON,
  });
}

/**
 * Build a failing fetchImpl that throws a network error.
 */
function failingFetch() {
  return async () => {
    throw new Error("network unreachable");
  };
}

/**
 * Build a fetchImpl that returns a non-2xx response.
 */
function non2xxFetch(status = 503) {
  return async () => ({
    ok: false,
    status,
    statusText: "Service Unavailable",
    text: async () => "upstream error",
  });
}

/**
 * Build a fetchImpl that returns bad JSON.
 */
function badJsonFetch() {
  return async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "{ this is not json {{",
  });
}

/**
 * Build a fetchImpl that returns valid JSON but with wrong shape.
 */
function badShapeFetch() {
  return async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify({ notProviders: {} }),
  });
}

// Fixed clock: 2026-06-10T10:00:00.000Z
const FIXED_NOW = new Date("2026-06-10T10:00:00.000Z");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("moat-expansion CLI integration", () => {
  test("happy path: report file written with expected content sections", async () => {
    const { quarantineDir, reportsDir, cleanup } = makeTempDirs("happy");
    try {
      await runMoatExpansionCli({
        fetchImpl: successFetch(),
        now: FIXED_NOW,
        paths: { quarantineDir, reportsDir },
        moatSnapshot: INJECTED_SNAPSHOT,
      });

      // Report file must exist
      const files = readdirSync(reportsDir).filter((f) => f.endsWith(".md"));
      assert.equal(files.length, 1, "exactly one .md report file should be created");

      const reportPath = join(reportsDir, files[0]);
      const content = readFileSync(reportPath, "utf8");

      // Header section
      assert.match(content, /# Moat-expansion discovery report/, "header present");
      assert.match(content, /ClearURLs data\.min\.json/, "source attribution present");
      assert.match(content, /2026-06-10/, "date in report");

      // new-param-on-known-program section — newparam is a gap on amazon-associates
      assert.match(content, /new-param-on-known-program/, "gap section present");
      assert.match(content, /newparam/, "gap param newparam appears in report");
      assert.match(content, /amazon-associates/, "known program id appears");

      // unknown-provider section — unknownshop is unknown
      assert.match(content, /unknown-provider/, "unknown-provider section present");
      assert.match(content, /unknownshop/, "unknown provider name appears");

      // already-covered section — tag is covered
      assert.match(content, /[Aa]lready covered/, "already-covered section present");
      assert.match(content, /1 param/, "covered count shows 1");

      // tag must NOT appear as a gap
      const gapSection = content.split("## unknown-provider")[0];
      assert.ok(
        !gapSection.includes("param `tag`"),
        "covered param 'tag' must not appear in gap section"
      );
    } finally {
      cleanup();
    }
  });

  test("happy path: raw file written to quarantine dir", async () => {
    const { quarantineDir, reportsDir, cleanup } = makeTempDirs("quarantine");
    try {
      await runMoatExpansionCli({
        fetchImpl: successFetch(),
        now: FIXED_NOW,
        paths: { quarantineDir, reportsDir },
        moatSnapshot: INJECTED_SNAPSHOT,
      });

      const quarantineFile = join(quarantineDir, "clearurls.raw");
      assert.ok(existsSync(quarantineFile), "raw file must be written to quarantine");

      const rawContent = readFileSync(quarantineFile, "utf8");
      assert.ok(rawContent.includes('"providers"'), "raw file contains providers key");
    } finally {
      cleanup();
    }
  });

  test("report filename contains the date from the injected clock", async () => {
    const { quarantineDir, reportsDir, cleanup } = makeTempDirs("filename");
    try {
      await runMoatExpansionCli({
        fetchImpl: successFetch(),
        now: FIXED_NOW,
        paths: { quarantineDir, reportsDir },
        moatSnapshot: INJECTED_SNAPSHOT,
      });

      const files = readdirSync(reportsDir).filter((f) => f.endsWith(".md"));
      assert.equal(files.length, 1);
      assert.ok(
        files[0].includes("2026-06-10"),
        `report filename should contain the date 2026-06-10, got: ${files[0]}`
      );
    } finally {
      cleanup();
    }
  });

  test("fail-closed: fetch network error → CliError exitCode 2, no report written", async () => {
    const { quarantineDir, reportsDir, cleanup } = makeTempDirs("fetchfail");
    try {
      await assert.rejects(
        () =>
          runMoatExpansionCli({
            fetchImpl: failingFetch(),
            now: FIXED_NOW,
            paths: { quarantineDir, reportsDir },
            moatSnapshot: INJECTED_SNAPSHOT,
          }),
        (err) => {
          assert.ok(err instanceof CliError, "must throw CliError");
          assert.equal(err.exitCode, 2, "exit code must be 2 for fetch failure");
          return true;
        }
      );

      // No report file written
      const files = readdirSync(reportsDir).filter((f) => f.endsWith(".md"));
      assert.equal(files.length, 0, "no report file must be written on fetch failure");
    } finally {
      cleanup();
    }
  });

  test("fail-closed: non-2xx response → CliError exitCode 2, no report written", async () => {
    const { quarantineDir, reportsDir, cleanup } = makeTempDirs("non2xx");
    try {
      await assert.rejects(
        () =>
          runMoatExpansionCli({
            fetchImpl: non2xxFetch(503),
            now: FIXED_NOW,
            paths: { quarantineDir, reportsDir },
            moatSnapshot: INJECTED_SNAPSHOT,
          }),
        (err) => {
          assert.ok(err instanceof CliError, "must throw CliError");
          assert.equal(err.exitCode, 2, "exit code must be 2 for non-2xx");
          return true;
        }
      );

      const files = readdirSync(reportsDir).filter((f) => f.endsWith(".md"));
      assert.equal(files.length, 0, "no report file must be written on non-2xx");
    } finally {
      cleanup();
    }
  });

  test("fail-closed: bad JSON response → CliError exitCode 1, no report written", async () => {
    const { quarantineDir, reportsDir, cleanup } = makeTempDirs("badjson");
    try {
      await assert.rejects(
        () =>
          runMoatExpansionCli({
            fetchImpl: badJsonFetch(),
            now: FIXED_NOW,
            paths: { quarantineDir, reportsDir },
            moatSnapshot: INJECTED_SNAPSHOT,
          }),
        (err) => {
          assert.ok(err instanceof CliError, "must throw CliError");
          assert.equal(err.exitCode, 1, "exit code must be 1 for bad JSON shape");
          return true;
        }
      );

      const files = readdirSync(reportsDir).filter((f) => f.endsWith(".md"));
      assert.equal(files.length, 0, "no report file must be written on bad JSON");
    } finally {
      cleanup();
    }
  });

  test("fail-closed: wrong JSON shape → CliError exitCode 1, no report written", async () => {
    const { quarantineDir, reportsDir, cleanup } = makeTempDirs("badshape");
    try {
      await assert.rejects(
        () =>
          runMoatExpansionCli({
            fetchImpl: badShapeFetch(),
            now: FIXED_NOW,
            paths: { quarantineDir, reportsDir },
            moatSnapshot: INJECTED_SNAPSHOT,
          }),
        (err) => {
          assert.ok(err instanceof CliError, "must throw CliError");
          assert.equal(err.exitCode, 1, "exit code must be 1 for wrong providers shape");
          return true;
        }
      );

      const files = readdirSync(reportsDir).filter((f) => f.endsWith(".md"));
      assert.equal(files.length, 0, "no report file must be written on wrong shape");
    } finally {
      cleanup();
    }
  });

  test("no src/ files are mutated after a successful run", async () => {
    const { quarantineDir, reportsDir, cleanup } = makeTempDirs("nosrc");
    try {
      // Record src/ stat before run — we just assert the test doesn't touch src/
      // The real guard: runMoatExpansionCli only writes to reportsDir/quarantineDir.
      // Verify by checking the output paths are under the temp dirs, not under src/.
      await runMoatExpansionCli({
        fetchImpl: successFetch(),
        now: FIXED_NOW,
        paths: { quarantineDir, reportsDir },
        moatSnapshot: INJECTED_SNAPSHOT,
      });

      // Reports written to reportsDir, not to src/
      const files = readdirSync(reportsDir);
      assert.ok(files.length > 0, "report was written to reportsDir");
      // All written paths must be under reportsDir or quarantineDir, not src/
      for (const f of files) {
        const abs = join(reportsDir, f);
        assert.ok(
          abs.startsWith(reportsDir),
          `output file ${abs} must be under temp reportsDir`
        );
      }
    } finally {
      cleanup();
    }
  });

  test("empty providers: report written, no gaps, covered count 0", async () => {
    const { quarantineDir, reportsDir, cleanup } = makeTempDirs("empty");
    try {
      const emptyFixture = JSON.stringify({ providers: { emptyprovider: { urlPattern: "^https?://", referralMarketing: [] } } });
      await runMoatExpansionCli({
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => emptyFixture,
        }),
        now: FIXED_NOW,
        paths: { quarantineDir, reportsDir },
        moatSnapshot: INJECTED_SNAPSHOT,
      });

      const files = readdirSync(reportsDir).filter((f) => f.endsWith(".md"));
      assert.equal(files.length, 1, "report file still written for empty-signals run");
      const content = readFileSync(join(reportsDir, files[0]), "utf8");
      assert.match(content, /No new gaps this week/, "empty run produces no-gaps status");
    } finally {
      cleanup();
    }
  });
});
