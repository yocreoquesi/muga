/**
 * MUGA — Unit tests for tools/rule-ingestion/pipeline.mjs
 *
 * Covers:
 *   R1-A/B/C — chain halt on ingest/orchestrate/promote failure
 *   R2-A/B   — noop true/false detection + return shape
 *   R3-A     — happy-path return shape (noop:false, written:true, merged, version)
 *   R4-A     — missing signingKeyPath → CliError exitCode:2, params untouched
 *
 * ALL I/O is injected via tmp dirs.
 * NEVER mutates tools/rules-source/params.json.
 * NEVER hits the network.
 * Uses a throw-away Ed25519 keypair generated at test-load time.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Export raw 32-byte Ed25519 public key as standard base64 (DER spki slice) */
function exportPubKeyBase64(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return der.slice(12).toString("base64");
}

/** Create a fresh temp directory per test invocation */
function makeTmpDir() {
  const d = join(
    tmpdir(),
    `muga-pipeline-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(d, { recursive: true });
  return d;
}

/** Write an Ed25519 PEM private key to disk and return the path */
function writeTmpPrivKey(dir, privateKey) {
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const path = join(dir, "test-key.pem");
  writeFileSync(path, pem, "utf8");
  return path;
}


/** Write a params.json source file to a given path */
function writeSourceParams(path, { version = 1, params = [] } = {}) {
  writeFileSync(
    path,
    JSON.stringify({ version, published: "2024-01-01T00:00:00.000Z", params }, null, 2) + "\n",
    "utf8"
  );
}

/** Write domain-rules.json with zero preserveParams entries */
function writeDomainRules(path) {
  writeFileSync(path, JSON.stringify([{ domain: "example.com", preserveParams: [] }], null, 2) + "\n", "utf8");
}

/**
 * Fake fetchImpl that returns canned adapter bytes (no network).
 * Returns content that each adapter's parse() can handle (plain string).
 */
function makeFakeFetch(content = "") {
  return async () => ({
    ok: true,
    text: async () => content,
  });
}

// ── Shared test keypair ────────────────────────────────────────────────────────

const { privateKey: TEST_PRIV_KEY, publicKey: TEST_PUB_KEY } =
  generateKeyPairSync("ed25519");
const testPubKeyB64 = exportPubKeyBase64(TEST_PUB_KEY);
const trustedKeys = [testPubKeyB64];

// ── Fixed "now" for deterministic freshness checks ─────────────────────────────
const TEST_NOW = new Date("2025-01-15T12:00:00.000Z");

// ── Shared injectable paths builder ───────────────────────────────────────────

/**
 * Build all injectable paths under a single tmp dir.
 * sourcePath gets a valid params.json written; domainRulesPath gets a valid rules file.
 */
function makeInjectedPaths(tmpDir, { sourceParams = [] } = {}) {
  const candidatesPath = join(tmpDir, "candidates.json");
  const promotePath = join(tmpDir, "promote", "promote-candidates.json");
  const reportPath = join(tmpDir, "quarantine-report.json");
  const sourcePath = join(tmpDir, "params.json");
  const domainRulesPath = join(tmpDir, "domain-rules.json");

  mkdirSync(join(tmpDir, "promote"), { recursive: true });
  writeSourceParams(sourcePath, { version: 1, params: sourceParams });
  writeDomainRules(domainRulesPath);

  return { candidatesPath, promotePath, reportPath, sourcePath, domainRulesPath };
}

// ── R1: Chain + exit propagation ──────────────────────────────────────────────

describe("R1 — Pipeline chain + exit propagation", () => {
  /**
   * R1-A: ingest fails → chain halts before orchestrate/promote.
   * We use an empty adapters list + a fetchImpl that throws to force ingest failure.
   * Actually, the cleanest approach: provide a fake adapter whose fetchRaw throws.
   */
  test("R1-A: ingest step throws → runPipeline rejects, orchestrate/promote never called", async () => {
    const { runPipeline } = await import("../../tools/rule-ingestion/pipeline.mjs");

    const tmpDir = makeTmpDir();
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);
    const { candidatesPath, promotePath, reportPath, sourcePath, domainRulesPath } =
      makeInjectedPaths(tmpDir);

    const ingestError = new Error("fake network failure");
    const badAdapter = {
      id: "bad",
      name: "Bad",
      license: "MIT",
      url: "https://example.com",
      fetchRaw: async () => { throw ingestError; },
      parse: () => ({ params: new Set(), skipped: 0, affiliateExcluded: 0 }),
    };

    let thrown = null;
    try {
      await runPipeline({
        adapters: [badAdapter],
        fetchImpl: makeFakeFetch(),
        candidatesPath,
        promotePath,
        reportPath,
        sourcePath,
        domainRulesPath,
        signingKeyPath: keyPath,
        trustedKeys,
        subtle: globalThis.crypto?.subtle,
        now: TEST_NOW,
        version: 1,
      });
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown !== null, "runPipeline must reject when ingest step throws");
    assert.ok(!existsSync(promotePath), "promote file must NOT be written when ingest fails");
  });

  test("R1-B: orchestrate step throws (bad key) → runPipeline rejects, promote never called", async () => {
    const { runPipeline } = await import("../../tools/rule-ingestion/pipeline.mjs");

    const tmpDir = makeTmpDir();
    // Use a non-existent key path so orchestrate-cli throws CliError(2)
    const missingKeyPath = join(tmpDir, "does-not-exist.pem");
    const { candidatesPath, promotePath, reportPath, sourcePath, domainRulesPath } =
      makeInjectedPaths(tmpDir);

    // Capture initial source content BEFORE running — regression guard mirrors R4-A:
    // if orchestrate throws, promote never runs, so params.json must be byte-for-byte identical.
    const initialContent = readFileSync(sourcePath, "utf8");

    // Provide a valid adapter so ingest succeeds (empty params list)
    const passAdapter = {
      id: "test",
      name: "Test",
      license: "MIT",
      url: "https://example.com",
      fetchRaw: async () => "",
      parse: () => ({ params: new Set(), skipped: 0, affiliateExcluded: 0 }),
    };

    let thrown = null;
    try {
      await runPipeline({
        adapters: [passAdapter],
        fetchImpl: makeFakeFetch(),
        candidatesPath,
        promotePath,
        reportPath,
        sourcePath,
        domainRulesPath,
        signingKeyPath: missingKeyPath,
        trustedKeys,
        subtle: globalThis.crypto?.subtle,
        now: TEST_NOW,
        version: 1,
      });
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown !== null, "runPipeline must reject when orchestrate step throws");
    // CliError from orchestrate should carry exitCode:2
    assert.strictEqual(thrown.exitCode, 2, "error from bad key must have exitCode:2");
    // Real regression guard: source params.json must be untouched because promote never ran
    assert.strictEqual(
      readFileSync(sourcePath, "utf8"),
      initialContent,
      "params.json must be untouched when orchestrate fails before promote"
    );
  });

  test("R1-C: promote step throws (wrong trustedKeys) → runPipeline rejects", async () => {
    const { runPipeline } = await import("../../tools/rule-ingestion/pipeline.mjs");

    const tmpDir = makeTmpDir();
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);
    const { candidatesPath, promotePath, reportPath, sourcePath, domainRulesPath } =
      makeInjectedPaths(tmpDir);

    const passAdapter = {
      id: "test",
      name: "Test",
      license: "MIT",
      url: "https://example.com",
      fetchRaw: async () => "",
      parse: () => ({ params: new Set(), skipped: 0, affiliateExcluded: 0 }),
    };

    // Pass a WRONG trustedKeys so promote's verify fails → PromoteError(2)
    const { privateKey: wrongKey, publicKey: wrongPub } = generateKeyPairSync("ed25519");
    const wrongTrustedKeys = [exportPubKeyBase64(wrongPub)];

    let thrown = null;
    try {
      await runPipeline({
        adapters: [passAdapter],
        fetchImpl: makeFakeFetch(),
        candidatesPath,
        promotePath,
        reportPath,
        sourcePath,
        domainRulesPath,
        signingKeyPath: keyPath,
        trustedKeys: wrongTrustedKeys,  // wrong key → verify fails
        subtle: globalThis.crypto?.subtle,
        now: TEST_NOW,
        version: 1,
      });
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown !== null, "runPipeline must reject when promote verify fails");
    assert.strictEqual(thrown.exitCode, 2, "PromoteError VERIFY_FAILED must have exitCode:2");
  });
});

// ── R2: No-op detection ────────────────────────────────────────────────────────

describe("R2 — No-op detection + return shape", () => {
  test("R2-A: promote returns noop:true → runPipeline returns {noop:true, written:false}", async () => {
    const { runPipeline } = await import("../../tools/rule-ingestion/pipeline.mjs");

    const tmpDir = makeTmpDir();
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);

    // Seed sourcePath with a param ALREADY containing what will be produced → noop.
    // NOTE on WHY noop:true here (NOT a simple corroboration pass):
    //   1. A single adapter produces a candidate with signals.length===1 < MIN_SIGNALS=2 →
    //      corroboration gate REJECTS it; promote artifact carries params:[].
    //   2. runPromote merges params:[] with the current source (already has "utm_source") →
    //      merged===["utm_source"]===current → NO change detected → noop:true.
    // This is a "nothing passed corroboration so nothing changed" noop, NOT a "param already
    // present" noop. The source seeding is required to make merged===current hold.
    const nooParams = ["utm_source"];
    const { candidatesPath, promotePath, reportPath, sourcePath, domainRulesPath } =
      makeInjectedPaths(tmpDir, { sourceParams: nooParams });

    // Adapter that parses "utm_source" out
    const passAdapter = {
      id: "adguard-tp",
      name: "AdGuard",
      license: "GPL-3.0",
      url: "https://example.com",
      fetchRaw: async () => "utm_source",
      parse: (raw) => ({ params: new Set(raw.trim().split("\n").filter(Boolean)), skipped: 0, affiliateExcluded: 0 }),
    };

    let result;
    try {
      result = await runPipeline({
        adapters: [passAdapter],
        fetchImpl: makeFakeFetch(),
        candidatesPath,
        promotePath,
        reportPath,
        sourcePath,
        domainRulesPath,
        signingKeyPath: keyPath,
        trustedKeys,
        subtle: globalThis.crypto?.subtle,
        now: TEST_NOW,
        version: 1,
      });
    } catch (err) {
      assert.fail(`runPipeline unexpectedly threw: ${err.message}`);
    }

    assert.strictEqual(result.noop, true, "result.noop must be true for noop run");
    assert.strictEqual(result.written, false, "result.written must be false for noop run");
  });

  test("R2-B: promote returns noop:false → runPipeline returns {noop:false, written:true}", async () => {
    const { runPipeline } = await import("../../tools/rule-ingestion/pipeline.mjs");

    const tmpDir = makeTmpDir();
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);

    // Source starts empty → any candidate produces a change → noop:false
    const { candidatesPath, promotePath, reportPath, sourcePath, domainRulesPath } =
      makeInjectedPaths(tmpDir, { sourceParams: [] });

    // Adapter producing "utm_source" with two signals (corroboration)
    const passAdapter = {
      id: "adguard-tp",
      name: "AdGuard",
      license: "GPL-3.0",
      url: "https://example.com",
      fetchRaw: async () => "utm_source",
      parse: (raw) => ({ params: new Set(raw.trim().split("\n").filter(Boolean)), skipped: 0, affiliateExcluded: 0 }),
    };
    // Second adapter also producing "utm_source" → two signals → passes corroboration
    const passAdapter2 = {
      id: "clearurls",
      name: "ClearURLs",
      license: "LGPL-3.0",
      url: "https://example.com",
      fetchRaw: async () => "utm_source",
      parse: (raw) => ({ params: new Set(raw.trim().split("\n").filter(Boolean)), skipped: 0, affiliateExcluded: 0 }),
    };

    let result;
    try {
      result = await runPipeline({
        adapters: [passAdapter, passAdapter2],
        fetchImpl: makeFakeFetch(),
        candidatesPath,
        promotePath,
        reportPath,
        sourcePath,
        domainRulesPath,
        signingKeyPath: keyPath,
        trustedKeys,
        subtle: globalThis.crypto?.subtle,
        now: TEST_NOW,
        version: 1,
      });
    } catch (err) {
      assert.fail(`runPipeline unexpectedly threw: ${err.message}`);
    }

    assert.strictEqual(result.noop, false, "result.noop must be false when params changed");
    assert.strictEqual(result.written, true, "result.written must be true when params changed");
  });
});

// ── R3: Happy-path return shape ────────────────────────────────────────────────

describe("R3 — Happy-path return shape", () => {
  test("R3-A: successful non-noop run → {noop:false, written:true, merged:Array, version:Number}", async () => {
    const { runPipeline } = await import("../../tools/rule-ingestion/pipeline.mjs");

    const tmpDir = makeTmpDir();
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);

    const { candidatesPath, promotePath, reportPath, sourcePath, domainRulesPath } =
      makeInjectedPaths(tmpDir, { sourceParams: [] });

    const passAdapter = {
      id: "adguard-tp",
      name: "AdGuard",
      license: "GPL-3.0",
      url: "https://example.com",
      fetchRaw: async () => "utm_source",
      parse: (raw) => ({ params: new Set(raw.trim().split("\n").filter(Boolean)), skipped: 0, affiliateExcluded: 0 }),
    };
    const passAdapter2 = {
      id: "clearurls",
      name: "ClearURLs",
      license: "LGPL-3.0",
      url: "https://example.com",
      fetchRaw: async () => "utm_source",
      parse: (raw) => ({ params: new Set(raw.trim().split("\n").filter(Boolean)), skipped: 0, affiliateExcluded: 0 }),
    };

    const result = await runPipeline({
      adapters: [passAdapter, passAdapter2],
      fetchImpl: makeFakeFetch(),
      candidatesPath,
      promotePath,
      reportPath,
      sourcePath,
      domainRulesPath,
      signingKeyPath: keyPath,
      trustedKeys,
      subtle: globalThis.crypto?.subtle,
      now: TEST_NOW,
      version: 1,
    });

    assert.strictEqual(result.noop, false, "noop must be false");
    assert.strictEqual(result.written, true, "written must be true");
    assert.ok(Array.isArray(result.merged), "merged must be an array");
    assert.ok(result.merged.length > 0, "merged must be non-empty");
    assert.ok(typeof result.version === "number", "version must be a number");
    assert.ok(Array.isArray(result.skipped), "skipped must be an array");
  });
});

// ── R4: Signing-key fail-closed ────────────────────────────────────────────────

describe("R4 — Signing-key fail-closed", () => {
  test("R4-A: missing signingKeyPath → throws before promote can write params.json", async () => {
    const { runPipeline } = await import("../../tools/rule-ingestion/pipeline.mjs");

    const tmpDir = makeTmpDir();
    const { candidatesPath, promotePath, reportPath, sourcePath, domainRulesPath } =
      makeInjectedPaths(tmpDir, { sourceParams: [] });

    // Read initial content to verify it is untouched after the rejection
    const initialContent = readFileSync(sourcePath, "utf8");

    const passAdapter = {
      id: "adguard-tp",
      name: "AdGuard",
      license: "GPL-3.0",
      url: "https://example.com",
      fetchRaw: async () => "utm_source",
      parse: (raw) => ({ params: new Set(raw.trim().split("\n").filter(Boolean)), skipped: 0, affiliateExcluded: 0 }),
    };
    const passAdapter2 = {
      id: "clearurls",
      name: "ClearURLs",
      license: "LGPL-3.0",
      url: "https://example.com",
      fetchRaw: async () => "utm_source",
      parse: (raw) => ({ params: new Set(raw.trim().split("\n").filter(Boolean)), skipped: 0, affiliateExcluded: 0 }),
    };

    // Explicitly remove the env fallback so pipeline can't sneak a key from env
    const savedEnvKey = process.env.MUGA_SIGNING_KEY_PATH;
    delete process.env.MUGA_SIGNING_KEY_PATH;

    let thrown = null;
    try {
      await runPipeline({
        adapters: [passAdapter, passAdapter2],
        fetchImpl: makeFakeFetch(),
        candidatesPath,
        promotePath,
        reportPath,
        sourcePath,
        domainRulesPath,
        signingKeyPath: undefined,  // no key
        trustedKeys,
        subtle: globalThis.crypto?.subtle,
        now: TEST_NOW,
        version: 1,
      });
    } catch (err) {
      thrown = err;
    } finally {
      if (savedEnvKey !== undefined) {
        process.env.MUGA_SIGNING_KEY_PATH = savedEnvKey;
      }
    }

    assert.ok(thrown !== null, "runPipeline must throw when signingKeyPath is missing");
    assert.strictEqual(
      thrown.exitCode,
      2,
      `error must have exitCode:2 (got ${thrown?.exitCode}) — message: ${thrown?.message}`
    );

    // sourcePath must be untouched
    const afterContent = readFileSync(sourcePath, "utf8");
    assert.strictEqual(
      afterContent,
      initialContent,
      "params.json must be untouched when key is missing"
    );
  });

  test("R4-A-b: falsy empty-string signingKeyPath → throws exitCode:2", async () => {
    const { runPipeline } = await import("../../tools/rule-ingestion/pipeline.mjs");

    const tmpDir = makeTmpDir();
    const { candidatesPath, promotePath, reportPath, sourcePath, domainRulesPath } =
      makeInjectedPaths(tmpDir, { sourceParams: [] });

    const savedEnvKey = process.env.MUGA_SIGNING_KEY_PATH;
    delete process.env.MUGA_SIGNING_KEY_PATH;

    let thrown = null;
    try {
      await runPipeline({
        adapters: [],
        fetchImpl: makeFakeFetch(),
        candidatesPath,
        promotePath,
        reportPath,
        sourcePath,
        domainRulesPath,
        signingKeyPath: "",  // empty string = falsy
        trustedKeys,
        subtle: globalThis.crypto?.subtle,
        now: TEST_NOW,
        version: 1,
      });
    } catch (err) {
      thrown = err;
    } finally {
      if (savedEnvKey !== undefined) {
        process.env.MUGA_SIGNING_KEY_PATH = savedEnvKey;
      }
    }

    assert.ok(thrown !== null, "must throw for empty-string signingKeyPath");
    assert.strictEqual(thrown.exitCode, 2, "exitCode must be 2 for missing key");
  });
});

// ── Wrapper shape assertion (CRITICAL TRAP guard) ─────────────────────────────

describe("Critical trap — candidates.json wrapper shape", () => {
  test("pipeline writes {generatedAt, adapters, candidateCount, candidates} wrapper before orchestrate", async () => {
    const { runPipeline } = await import("../../tools/rule-ingestion/pipeline.mjs");

    const tmpDir = makeTmpDir();
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);
    const { candidatesPath, promotePath, reportPath, sourcePath, domainRulesPath } =
      makeInjectedPaths(tmpDir, { sourceParams: [] });

    const passAdapter = {
      id: "adguard-tp",
      name: "AdGuard",
      license: "GPL-3.0",
      url: "https://example.com",
      fetchRaw: async () => "utm_source",
      parse: (raw) => ({ params: new Set(raw.trim().split("\n").filter(Boolean)), skipped: 0, affiliateExcluded: 0 }),
    };
    const passAdapter2 = {
      id: "clearurls",
      name: "ClearURLs",
      license: "LGPL-3.0",
      url: "https://example.com",
      fetchRaw: async () => "utm_source",
      parse: (raw) => ({ params: new Set(raw.trim().split("\n").filter(Boolean)), skipped: 0, affiliateExcluded: 0 }),
    };

    // Run pipeline (may succeed or fail — we only care the file was written with correct shape)
    try {
      await runPipeline({
        adapters: [passAdapter, passAdapter2],
        fetchImpl: makeFakeFetch(),
        candidatesPath,
        promotePath,
        reportPath,
        sourcePath,
        domainRulesPath,
        signingKeyPath: keyPath,
        trustedKeys,
        subtle: globalThis.crypto?.subtle,
        now: TEST_NOW,
        version: 1,
      });
    } catch {
      // We want to read candidatesPath even if the chain failed later
    }

    // candidatesPath must have the wrapper shape, NOT a bare array
    assert.ok(existsSync(candidatesPath), "candidatesPath must be written after ingest step");
    const written = JSON.parse(readFileSync(candidatesPath, "utf8"));
    assert.ok(typeof written.generatedAt === "string", "wrapper must have generatedAt string");
    assert.ok(Array.isArray(written.adapters), "wrapper must have adapters array");
    assert.ok(typeof written.candidateCount === "number", "wrapper must have candidateCount number");
    assert.ok(Array.isArray(written.candidates), "wrapper must have candidates array (not a bare array)");
    assert.ok(typeof written.stats === "object" && written.stats !== null, "wrapper must carry stats object");
    assert.ok(Array.isArray(written.stats.adapters), "wrapper stats must have adapters array");
  });
});

// ── R5: GITHUB_OUTPUT dual-emit ───────────────────────────────────────────────

describe("R5 — GITHUB_OUTPUT dual-emit", () => {
  test("R5-A: runCli appends noop=<bool>\\n to GITHUB_OUTPUT when env var is set", async () => {
    const { runCli } = await import("../../tools/rule-ingestion/pipeline.mjs");

    const tmpDir = makeTmpDir();
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);

    // Use the noop scenario: single adapter + source pre-seeded with the same param.
    // Corroboration gate quarantines the single-signal candidate → promote artifact has
    // params:[] → merges with current source (already has "utm_source") → noop:true.
    const { candidatesPath, promotePath, reportPath, sourcePath, domainRulesPath } =
      makeInjectedPaths(tmpDir, { sourceParams: ["utm_source"] });

    const passAdapter = {
      id: "adguard-tp",
      name: "AdGuard",
      license: "GPL-3.0",
      url: "https://example.com",
      fetchRaw: async () => "utm_source",
      parse: (raw) => ({ params: new Set(raw.trim().split("\n").filter(Boolean)), skipped: 0, affiliateExcluded: 0 }),
    };

    // Temp file for $GITHUB_OUTPUT; does not exist yet — appendFileSync will create it.
    const githubOutputPath = join(tmpDir, "github-output.txt");

    // Snapshot the REAL process.env.GITHUB_OUTPUT. GitHub Actions sets this on the
    // runner, so it is NOT necessarily undefined — the contract we verify is that
    // runCli({ env }) uses the INJECTED env and leaves process.env UNCHANGED.
    const priorGithubOutput = process.env.GITHUB_OUTPUT;

    // Inject a fake env that includes MUGA_SIGNING_KEY_PATH and GITHUB_OUTPUT.
    // We do NOT mutate process.env — that's the whole point of runCli({ env }).
    const fakeEnv = {
      MUGA_SIGNING_KEY_PATH: keyPath,
      GITHUB_OUTPUT: githubOutputPath,
    };

    let result;
    try {
      result = await runCli({
        env: fakeEnv,
        pipelineOpts: {
          adapters: [passAdapter],
          fetchImpl: makeFakeFetch(),
          candidatesPath,
          promotePath,
          reportPath,
          sourcePath,
          domainRulesPath,
          trustedKeys,
          subtle: globalThis.crypto?.subtle,
          now: TEST_NOW,
          version: 1,
        },
      });
    } catch (err) {
      assert.fail(`runCli unexpectedly threw: ${err.message}`);
    }

    // 1. runCli must return the pipeline result
    assert.ok(typeof result.noop === "boolean", "runCli must return result with noop field");

    // 2. GITHUB_OUTPUT file must have been appended with noop=<bool>\n
    assert.ok(existsSync(githubOutputPath), "GITHUB_OUTPUT file must exist after runCli");
    const ghOutputContent = readFileSync(githubOutputPath, "utf8");
    const expectedLine = `noop=${result.noop}\n`;
    assert.ok(
      ghOutputContent.includes(expectedLine),
      `GITHUB_OUTPUT must contain "${expectedLine.trim()}" but got: ${JSON.stringify(ghOutputContent)}`
    );

    // 3. runCli must NOT mutate process.env.GITHUB_OUTPUT (it uses the injected env
    //    only). Compare against the snapshot — robust whether the runner set it or not.
    assert.strictEqual(
      process.env.GITHUB_OUTPUT,
      priorGithubOutput,
      "runCli must not mutate process.env.GITHUB_OUTPUT (uses injected env only)"
    );
  });
});
