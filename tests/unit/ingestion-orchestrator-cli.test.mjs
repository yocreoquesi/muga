/**
 * MUGA — Unit tests for tools/rule-ingestion/orchestrate-cli.mjs
 *
 * Covers:
 *   - Signed artifact shape {version, published, params, sig} (R5-S1, R5-S2, R9-S1)
 *   - Params sorted + deduped; sig non-empty base64url; verifiable with test pubkey (R6-S1)
 *   - Empty auto-merge produces valid artifact with params:[] (R5-S2)
 *   - Audit sidecar write-always (R8-S1, R8-S2)
 *   - Missing signing key → throws / exit 2, no file written (R7-S1)
 *   - Valid run exits cleanly (R7-S2)
 *
 * All I/O is injected: candidatesPath, promotePath, reportPath, keyPath, now.
 * Tests NEVER touch the real promote/ dir.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { verifySignature } from "../../src/lib/remote-rules.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Export raw 32-byte Ed25519 public key as standard base64 (DER spki slice) */
function exportPubKeyBase64(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return der.slice(12).toString("base64");
}

/** Create a fresh temp directory per test group invocation */
function makeTmpDir() {
  const d = join(tmpdir(), `muga-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

/** Write a minimal candidates.json fixture to a temp dir and return its path.
 * Optional stats param adds a stats field to the report (for T-12 null-safe tests).
 */
function writeCandidatesFixture(dir, candidates, stats = undefined) {
  const path = join(dir, "candidates.json");
  const report = {
    generatedAt: "2024-01-01T00:00:00.000Z",
    candidateCount: candidates.length,
    candidates,
  };
  if (stats !== undefined) {
    report.stats = stats;
  }
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n", "utf8");
  return path;
}

/** Write an Ed25519 PEM private key to disk and return the path */
function writeTmpPrivKey(dir, privateKey) {
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const path = join(dir, "test-key.pem");
  writeFileSync(path, pem, "utf8");
  return path;
}

/**
 * Minimal valid candidate that passes all real gates.
 * Carries ≥2 signals because the real checkCorroborationGate default is minSignals: 2.
 */
function passCandidate(param) {
  return {
    param,
    signals: ["adguard-tp", "other-source"],
    entropy: null,
    crossSiteFrequency: null,
    firstSeenAt: "2024-01-01T00:00:00.000Z",
  };
}

/** Candidate that will be quarantined (signals:null → GATE2 rejects) */
function failCandidate(param) {
  return {
    param,
    signals: null,
    entropy: null,
    crossSiteFrequency: null,
    firstSeenAt: "2024-01-01T00:00:00.000Z",
  };
}

// ── Shared test keypair ────────────────────────────────────────────────────────
const { privateKey: TEST_PRIV_KEY, publicKey: TEST_PUB_KEY } =
  generateKeyPairSync("ed25519");
const testPubKeyB64 = exportPubKeyBase64(TEST_PUB_KEY);
const trustedKeys = [testPubKeyB64];

// ── T-15: CLI writes signed artifact shape ────────────────────────────────────

describe("R5/R9 — Signed artifact shape + verify", () => {
  test("R5-S1: signed artifact has exactly {version, published, params, sig} and sig verifies", async () => {
    // Lazy import to avoid import-time failures before module is created
    const { runOrchestrateCli } = await import(
      "../../tools/rule-ingestion/orchestrate-cli.mjs"
    );

    const tmpDir = makeTmpDir();
    const candidatesPath = writeCandidatesFixture(tmpDir, [
      passCandidate("utm_source"),
      passCandidate("fbclid"),
    ]);
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);
    const promotePath = join(tmpDir, "promote-candidates.json");
    const reportPath = join(tmpDir, "quarantine-report.json");

    await runOrchestrateCli({
      candidatesPath,
      promotePath,
      reportPath,
      version: 1,
      now: new Date("2024-01-01T00:00:00.000Z"),
      keyPath,
    });

    assert.ok(existsSync(promotePath), "promote file must be written");
    const artifact = JSON.parse(readFileSync(promotePath, "utf8"));

    // Exactly 4 keys
    const keys = Object.keys(artifact);
    assert.deepStrictEqual(keys.sort(), ["params", "published", "sig", "version"]);

    // params is sorted
    assert.deepStrictEqual(artifact.params, ["fbclid", "utm_source"]);

    // sig is non-empty base64url
    assert.ok(typeof artifact.sig === "string" && artifact.sig.length > 0, "sig must be non-empty string");
    assert.ok(!/[+/=]/.test(artifact.sig), "sig must be base64url (no +, /, = chars)");

    // published is injected now
    assert.strictEqual(artifact.published, "2024-01-01T00:00:00.000Z");

    // version
    assert.strictEqual(artifact.version, 1);

    // sig verifies with test pubkey using the REAL verifySignature
    const canonical = `${artifact.version}|${artifact.published}|${artifact.params.join(",")}`;
    const verified = await verifySignature(
      canonical,
      artifact.sig,
      trustedKeys,
      globalThis.crypto.subtle
    );
    assert.strictEqual(verified, true, "verifySignature must return true for correctly signed artifact");
  });

  test("R5-S2: empty auto-merge (all quarantined) → params:[] with valid sig", async () => {
    const { runOrchestrateCli } = await import(
      "../../tools/rule-ingestion/orchestrate-cli.mjs"
    );

    const tmpDir = makeTmpDir();
    const candidatesPath = writeCandidatesFixture(tmpDir, [
      failCandidate("bad-param"),
    ]);
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);
    const promotePath = join(tmpDir, "promote-candidates.json");
    const reportPath = join(tmpDir, "quarantine-report.json");

    await runOrchestrateCli({
      candidatesPath,
      promotePath,
      reportPath,
      version: 2,
      now: new Date("2024-06-01T00:00:00.000Z"),
      keyPath,
    });

    assert.ok(existsSync(promotePath), "promote file must be written even when all quarantined");
    const artifact = JSON.parse(readFileSync(promotePath, "utf8"));

    assert.deepStrictEqual(artifact.params, [], "empty autoMerge → params:[]");
    assert.ok(typeof artifact.sig === "string" && artifact.sig.length > 0, "sig must be present even for empty params");

    // Verify the empty-params signature
    const canonical = `${artifact.version}|${artifact.published}|${artifact.params.join(",")}`;
    const verified = await verifySignature(
      canonical,
      artifact.sig,
      trustedKeys,
      globalThis.crypto.subtle
    );
    assert.strictEqual(verified, true, "empty-params sig must verify");
  });
});

// ── T-16: Sidecar write-always ─────────────────────────────────────────────────

describe("R8 — Audit sidecar write-always", () => {
  test("R8-S1: mixed run → sidecar has full quarantine entries; promote has no rejectedBy", async () => {
    const { runOrchestrateCli } = await import(
      "../../tools/rule-ingestion/orchestrate-cli.mjs"
    );

    const tmpDir = makeTmpDir();
    const candidatesPath = writeCandidatesFixture(tmpDir, [
      passCandidate("utm_source"),
      failCandidate("bad-param"),
    ]);
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);
    const promotePath = join(tmpDir, "promote-candidates.json");
    const reportPath = join(tmpDir, "quarantine-report.json");

    await runOrchestrateCli({
      candidatesPath,
      promotePath,
      reportPath,
      version: 1,
      now: new Date("2024-01-01T00:00:00.000Z"),
      keyPath,
    });

    // Sidecar must exist
    assert.ok(existsSync(reportPath), "quarantine report must be written");
    const report = JSON.parse(readFileSync(reportPath, "utf8"));

    assert.ok("quarantine" in report, "sidecar must have quarantine key");
    assert.strictEqual(report.quarantine.length, 1, "sidecar must have 1 quarantined entry");
    assert.ok(report.quarantine[0].rejections, "quarantine entry must have rejections array");

    // Promote must NOT have rejectedBy or raw candidate fields
    const promote = JSON.parse(readFileSync(promotePath, "utf8"));
    assert.ok(!("rejectedBy" in promote), "promote must not contain rejectedBy");
    assert.ok(!("candidates" in promote), "promote must not contain candidates field");
    assert.ok(!("quarantine" in promote), "promote must not contain quarantine field");
  });

  test("R8-S2: all-pass run → sidecar written with quarantine:[]", async () => {
    const { runOrchestrateCli } = await import(
      "../../tools/rule-ingestion/orchestrate-cli.mjs"
    );

    const tmpDir = makeTmpDir();
    const candidatesPath = writeCandidatesFixture(tmpDir, [
      passCandidate("utm_source"),
    ]);
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);
    const promotePath = join(tmpDir, "promote-candidates.json");
    const reportPath = join(tmpDir, "quarantine-report.json");

    await runOrchestrateCli({
      candidatesPath,
      promotePath,
      reportPath,
      version: 1,
      now: new Date("2024-01-01T00:00:00.000Z"),
      keyPath,
    });

    assert.ok(existsSync(reportPath), "sidecar must exist even with no quarantine entries");
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.deepStrictEqual(report.quarantine, [], "sidecar quarantine must be [] when all pass");
  });
});

// ── T-17: CLI exit codes + key guard ─────────────────────────────────────────

describe("R7 — CLI exit codes + key guard", () => {
  test("R7-S1: missing keyPath → throws with exit code 2, no promote file written", async () => {
    const { runOrchestrateCli } = await import(
      "../../tools/rule-ingestion/orchestrate-cli.mjs"
    );

    const tmpDir = makeTmpDir();
    const candidatesPath = writeCandidatesFixture(tmpDir, [passCandidate("utm_source")]);
    const promotePath = join(tmpDir, "promote-candidates.json");
    const reportPath = join(tmpDir, "quarantine-report.json");

    // Env isolation: remove MUGA_SIGNING_KEY_PATH so the CLI cannot fall back to it.
    const savedEnvKey = process.env.MUGA_SIGNING_KEY_PATH;
    delete process.env.MUGA_SIGNING_KEY_PATH;

    let thrown = null;
    try {
      await runOrchestrateCli({
        candidatesPath,
        promotePath,
        reportPath,
        version: 1,
        now: new Date(),
        keyPath: undefined, // no key
      });
    } catch (err) {
      thrown = err;
    } finally {
      // Restore regardless of outcome.
      if (savedEnvKey !== undefined) {
        process.env.MUGA_SIGNING_KEY_PATH = savedEnvKey;
      }
    }

    assert.ok(thrown !== null, "runOrchestrateCli must throw when keyPath is missing");
    assert.strictEqual(thrown.exitCode, 2, "thrown error must have exitCode:2");
    assert.ok(!existsSync(promotePath), "promote file must NOT be written when key is missing");
  });

  test("R7-S1b: non-existent key file → throws with exit code 2", async () => {
    const { runOrchestrateCli } = await import(
      "../../tools/rule-ingestion/orchestrate-cli.mjs"
    );

    const tmpDir = makeTmpDir();
    const candidatesPath = writeCandidatesFixture(tmpDir, [passCandidate("utm_source")]);
    const promotePath = join(tmpDir, "promote-candidates.json");
    const reportPath = join(tmpDir, "quarantine-report.json");

    // Env isolation: remove MUGA_SIGNING_KEY_PATH so the CLI cannot fall back to it.
    const savedEnvKey = process.env.MUGA_SIGNING_KEY_PATH;
    delete process.env.MUGA_SIGNING_KEY_PATH;

    let thrown = null;
    try {
      await runOrchestrateCli({
        candidatesPath,
        promotePath,
        reportPath,
        version: 1,
        now: new Date(),
        keyPath: join(tmpDir, "does-not-exist.pem"),
      });
    } catch (err) {
      thrown = err;
    } finally {
      if (savedEnvKey !== undefined) {
        process.env.MUGA_SIGNING_KEY_PATH = savedEnvKey;
      }
    }

    assert.ok(thrown !== null, "runOrchestrateCli must throw when key file is missing");
    assert.strictEqual(thrown.exitCode, 2, "thrown error must have exitCode:2");
    assert.ok(!existsSync(promotePath), "promote file must NOT be written when key is missing");
  });

  test("R7-S2: valid run returns cleanly (no throw)", async () => {
    const { runOrchestrateCli } = await import(
      "../../tools/rule-ingestion/orchestrate-cli.mjs"
    );

    const tmpDir = makeTmpDir();
    const candidatesPath = writeCandidatesFixture(tmpDir, [passCandidate("utm_source")]);
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);
    const promotePath = join(tmpDir, "promote-candidates.json");
    const reportPath = join(tmpDir, "quarantine-report.json");

    let thrown = null;
    try {
      await runOrchestrateCli({
        candidatesPath,
        promotePath,
        reportPath,
        version: 1,
        now: new Date("2024-01-01T00:00:00.000Z"),
        keyPath,
      });
    } catch (err) {
      thrown = err;
    }

    assert.strictEqual(thrown, null, "valid run must not throw");
    assert.ok(existsSync(promotePath), "promote file must be written on success");
  });
});

// ── M2: Tamper-resistance — verifySignature must return false for tampered artifact ──

describe("R5/R6 — Tamper resistance (negative)", () => {
  test("tampered params → verifySignature returns false", async () => {
    const { runOrchestrateCli } = await import(
      "../../tools/rule-ingestion/orchestrate-cli.mjs"
    );

    const tmpDir = makeTmpDir();
    const candidatesPath = writeCandidatesFixture(tmpDir, [
      passCandidate("utm_source"),
      passCandidate("fbclid"),
    ]);
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);
    const promotePath = join(tmpDir, "promote-candidates.json");
    const reportPath = join(tmpDir, "quarantine-report.json");

    await runOrchestrateCli({
      candidatesPath,
      promotePath,
      reportPath,
      version: 1,
      now: new Date("2024-01-01T00:00:00.000Z"),
      keyPath,
    });

    const artifact = JSON.parse(readFileSync(promotePath, "utf8"));

    // Tamper: inject an extra param that was not part of the signed payload.
    const tamperedParams = [...artifact.params, "injected"];
    const tamperedCanonical = `${artifact.version}|${artifact.published}|${tamperedParams.join(",")}`;

    const result = await verifySignature(
      tamperedCanonical,
      artifact.sig,
      trustedKeys,
      globalThis.crypto.subtle
    );

    assert.strictEqual(result, false, "verifySignature must return false for tampered params");
  });
});

// ── n4: Malformed PEM → key-error exit code + no artifact written ─────────────

describe("R7 — Malformed PEM key guard", () => {
  test("n4: garbage PEM file → throws exitCode:2, no artifact written", async () => {
    const { runOrchestrateCli } = await import(
      "../../tools/rule-ingestion/orchestrate-cli.mjs"
    );

    const tmpDir = makeTmpDir();
    const candidatesPath = writeCandidatesFixture(tmpDir, [passCandidate("utm_source")]);
    const promotePath = join(tmpDir, "promote-candidates.json");
    const reportPath = join(tmpDir, "quarantine-report.json");

    // Write garbage content — not a valid PEM.
    const garbageKeyPath = join(tmpDir, "garbage-key.pem");
    writeFileSync(garbageKeyPath, "this is not a valid pem file\ngarbage content\n", "utf8");

    // Env isolation.
    const savedEnvKey = process.env.MUGA_SIGNING_KEY_PATH;
    delete process.env.MUGA_SIGNING_KEY_PATH;

    let thrown = null;
    try {
      await runOrchestrateCli({
        candidatesPath,
        promotePath,
        reportPath,
        version: 1,
        now: new Date(),
        keyPath: garbageKeyPath,
      });
    } catch (err) {
      thrown = err;
    } finally {
      if (savedEnvKey !== undefined) {
        process.env.MUGA_SIGNING_KEY_PATH = savedEnvKey;
      }
    }

    assert.ok(thrown !== null, "must throw for malformed PEM");
    assert.strictEqual(thrown.exitCode, 2, "malformed PEM must throw with exitCode:2");
    assert.ok(!existsSync(promotePath), "promote file must NOT be written for malformed PEM");
  });
});

// ── n2: MUGA_RULES_VERSION env path ───────────────────────────────────────────

describe("R4 — MUGA_RULES_VERSION env override", () => {
  test("n2a: MUGA_RULES_VERSION sets artifact version (no version param)", async () => {
    const { runOrchestrateCli } = await import(
      "../../tools/rule-ingestion/orchestrate-cli.mjs"
    );

    const tmpDir = makeTmpDir();
    const candidatesPath = writeCandidatesFixture(tmpDir, [passCandidate("utm_source")]);
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);
    const promotePath = join(tmpDir, "promote-candidates.json");
    const reportPath = join(tmpDir, "quarantine-report.json");

    const savedVersion = process.env.MUGA_RULES_VERSION;
    process.env.MUGA_RULES_VERSION = "42";
    try {
      await runOrchestrateCli({
        candidatesPath,
        promotePath,
        reportPath,
        // no version param — must come from env
        now: new Date("2024-01-01T00:00:00.000Z"),
        keyPath,
      });
    } finally {
      if (savedVersion !== undefined) {
        process.env.MUGA_RULES_VERSION = savedVersion;
      } else {
        delete process.env.MUGA_RULES_VERSION;
      }
    }

    const artifact = JSON.parse(readFileSync(promotePath, "utf8"));
    assert.strictEqual(artifact.version, 42, "artifact.version must come from MUGA_RULES_VERSION env var");
  });

  test("n2b: MUGA_RULES_VERSION non-integer → throws exitCode:1", async () => {
    const { runOrchestrateCli } = await import(
      "../../tools/rule-ingestion/orchestrate-cli.mjs"
    );

    const tmpDir = makeTmpDir();
    const candidatesPath = writeCandidatesFixture(tmpDir, [passCandidate("utm_source")]);
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);
    const promotePath = join(tmpDir, "promote-candidates.json");
    const reportPath = join(tmpDir, "quarantine-report.json");

    const savedVersion = process.env.MUGA_RULES_VERSION;
    process.env.MUGA_RULES_VERSION = "not-a-number";

    let thrown = null;
    try {
      await runOrchestrateCli({
        candidatesPath,
        promotePath,
        reportPath,
        now: new Date(),
        keyPath,
      });
    } catch (err) {
      thrown = err;
    } finally {
      if (savedVersion !== undefined) {
        process.env.MUGA_RULES_VERSION = savedVersion;
      } else {
        delete process.env.MUGA_RULES_VERSION;
      }
    }

    assert.ok(thrown !== null, "non-integer MUGA_RULES_VERSION must throw");
    assert.strictEqual(thrown.exitCode, 1, "MUGA_RULES_VERSION validation error must have exitCode:1");
  });
});

// ── T-12 (quarantine-surface #782): ingestStats null-safe copy ────────────────

describe("T-12 — ingestStats null-safe (quarantine-surface #782)", () => {
  const SAMPLE_STATS = {
    adapters: [
      { adapterId: "adguard-tp", admitted: 3, skipped: 1, affiliateExcluded: 0 },
      { adapterId: "clearurls", admitted: 2, skipped: 0, affiliateExcluded: 1 },
    ],
    merged: { emptyDropped: 0, total: 4 },
  };

  test("T-12a: candidates WITH stats → report.ingestStats deep-equals stats", async () => {
    const { runOrchestrateCli } = await import(
      "../../tools/rule-ingestion/orchestrate-cli.mjs"
    );

    const tmpDir = makeTmpDir();
    const candidatesPath = writeCandidatesFixture(tmpDir, [passCandidate("utm_source")], SAMPLE_STATS);
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);
    const promotePath = join(tmpDir, "promote-candidates.json");
    const reportPath = join(tmpDir, "quarantine-report.json");

    await runOrchestrateCli({
      candidatesPath,
      promotePath,
      reportPath,
      version: 1,
      now: new Date("2024-01-01T00:00:00.000Z"),
      keyPath,
    });

    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.ok("ingestStats" in report, "quarantine-report.json must have ingestStats field");
    assert.deepStrictEqual(report.ingestStats, SAMPLE_STATS, "ingestStats must deep-equal the stats from candidates.json");
  });

  test("T-12b: candidates WITHOUT stats → report.ingestStats === null (null-safe)", async () => {
    const { runOrchestrateCli } = await import(
      "../../tools/rule-ingestion/orchestrate-cli.mjs"
    );

    const tmpDir = makeTmpDir();
    // No stats passed → old-format candidates.json
    const candidatesPath = writeCandidatesFixture(tmpDir, [passCandidate("utm_source")]);
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);
    const promotePath = join(tmpDir, "promote-candidates.json");
    const reportPath = join(tmpDir, "quarantine-report.json");

    await runOrchestrateCli({
      candidatesPath,
      promotePath,
      reportPath,
      version: 1,
      now: new Date("2024-01-01T00:00:00.000Z"),
      keyPath,
    });

    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.ok("ingestStats" in report, "quarantine-report.json must have ingestStats field even when candidates.json has no stats");
    assert.strictEqual(report.ingestStats, null, "ingestStats must be null when candidates.json has no stats field");
  });
});

// ── #821-I1: Atomic write for promote-candidates.json ─────────────────────────

describe("#821-I1 — Atomic write: no .tmp sibling left after successful write", () => {
  test("promote artifact is written atomically (no .tmp file remains after success)", async () => {
    const { runOrchestrateCli } = await import(
      "../../tools/rule-ingestion/orchestrate-cli.mjs"
    );

    const tmpDir = makeTmpDir();
    const candidatesPath = writeCandidatesFixture(tmpDir, [passCandidate("utm_source")]);
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);
    const promotePath = join(tmpDir, "promote-candidates.json");
    const reportPath = join(tmpDir, "quarantine-report.json");

    await runOrchestrateCli({
      candidatesPath,
      promotePath,
      reportPath,
      version: 1,
      now: new Date("2024-01-01T00:00:00.000Z"),
      keyPath,
    });

    // Final file must exist
    assert.ok(existsSync(promotePath), "promote file must exist after write");
    // No .tmp sibling must remain (atomic: write to .tmp then rename)
    assert.ok(
      !existsSync(promotePath + ".tmp"),
      ".tmp sibling must NOT exist after atomic write completes"
    );
  });
});

// ── n3: Dedup at CLI boundary ─────────────────────────────────────────────────

describe("R4 — Dedup at CLI boundary", () => {
  test("n3: two passing candidates with same param → artifact.params contains it exactly once", async () => {
    const { runOrchestrateCli } = await import(
      "../../tools/rule-ingestion/orchestrate-cli.mjs"
    );

    const tmpDir = makeTmpDir();
    // Both candidates carry the same param — dedup must collapse them to one entry.
    const candidatesPath = writeCandidatesFixture(tmpDir, [
      passCandidate("utm_source"),
      passCandidate("utm_source"),
    ]);
    const keyPath = writeTmpPrivKey(tmpDir, TEST_PRIV_KEY);
    const promotePath = join(tmpDir, "promote-candidates.json");
    const reportPath = join(tmpDir, "quarantine-report.json");

    await runOrchestrateCli({
      candidatesPath,
      promotePath,
      reportPath,
      version: 1,
      now: new Date("2024-01-01T00:00:00.000Z"),
      keyPath,
    });

    const artifact = JSON.parse(readFileSync(promotePath, "utf8"));
    assert.deepStrictEqual(
      artifact.params,
      ["utm_source"],
      "duplicate params must be deduped to a single entry"
    );
  });
});
