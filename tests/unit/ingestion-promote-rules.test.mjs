/**
 * MUGA — Unit tests for tools/rule-ingestion/promote-rules.mjs
 *
 * Covers all requirements R1-R8 + import-smoke (T-27/T-28) +
 * review fixes FIX-6 through FIX-9.
 *
 * All I/O uses TEMP files — NEVER mutates tools/rules-source/params.json
 * or reads real domain-rules.json for mutation.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// FIX-9: import canonicalMessage from production source so test signer and
// production code agree on format by construction (no template-literal drift).
import { canonicalMessage } from "../../tools/rule-ingestion/orchestrate.mjs";

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
    `muga-promote-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(d, { recursive: true });
  return d;
}

/** Sign a canonical message with a private key, return base64url */
function signCanonical(canonical, privateKey) {
  return cryptoSign(null, Buffer.from(canonical, "utf8"), privateKey).toString(
    "base64url"
  );
}

/**
 * Build a promote-candidates.json artifact.
 * Uses canonicalMessage from orchestrate.mjs (FIX-9) so the test signer and
 * production agree on format by construction — no template-literal drift.
 *
 * @param {object} opts
 * @param {number}   opts.version
 * @param {string}   opts.published
 * @param {string[]} opts.params
 * @param {object}   opts.privateKey - node:crypto KeyObject for signing
 * @param {string}   [opts.sigOverride] - if provided, use this sig instead of real one
 * @returns {object} artifact
 */
function buildArtifact({ version, published, params, privateKey, sigOverride }) {
  const canonical = canonicalMessage(version, published, params);
  const sig = sigOverride !== undefined
    ? sigOverride
    : signCanonical(canonical, privateKey);
  return { version, published, params, sig };
}

/** Write artifact JSON to a temp dir */
function writeArtifact(dir, artifact) {
  const path = join(dir, "promote-candidates.json");
  writeFileSync(path, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  return path;
}

/** Write a params.json source file */
function writeParamsJson(dir, { version, published, params }) {
  const path = join(dir, "params.json");
  writeFileSync(
    path,
    JSON.stringify({ version, published, params }, null, 2) + "\n",
    "utf8"
  );
  return path;
}

/**
 * Write a normalized-store fixture.
 *
 * An EMPTY store is enough here: runPromote replaces the whole global list via
 * withGlobalParams, so the store's prior global entries never reach the output.
 * What matters is that a store exists at an INJECTED path -- promote now fails
 * closed if sourcePath is overridden while storePath is not, because the first
 * run of that retarget had `npm test` silently rewrite the repository's real
 * tools/rules-source/rules.json.
 */
function writeStore(dir) {
  const path = join(dir, "rules.json");
  writeFileSync(
    path,
    JSON.stringify({ schemaVersion: 1, projection: { scopes: {} }, entries: [] }, null, 2) + "\n",
    "utf8"
  );
  return path;
}

/** Write a domain-rules.json fixture */
function writeDomainRules(dir, rules) {
  const path = join(dir, "domain-rules.json");
  writeFileSync(path, JSON.stringify(rules, null, 2) + "\n", "utf8");
  return path;
}

// ── Shared test keypair ────────────────────────────────────────────────────────
const { privateKey: TEST_PRIV_KEY, publicKey: TEST_PUB_KEY } =
  generateKeyPairSync("ed25519");
const testPubKeyB64 = exportPubKeyBase64(TEST_PUB_KEY);
const TEST_TRUSTED_KEYS = [testPubKeyB64];

// ── Phase 1: T-01 — PromoteError class ───────────────────────────────────────

describe("PromoteError — class contract", () => {
  test("T-01: PromoteError is importable, has exitCode, extends Error", async () => {
    const { PromoteError } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );
    const err = new PromoteError("test message", 2);
    assert.strictEqual(err.exitCode, 2);
    assert.strictEqual(err.message, "test message");
    assert.ok(err instanceof Error, "PromoteError must extend Error");
    assert.ok(err instanceof PromoteError, "must be instanceof PromoteError");
  });
});

// ── Phase 1: T-03 — loadPreservedSet + computeMerge shape guard ──────────────

describe("Module shape — loadPreservedSet and computeMerge exports", () => {
  test("T-03: loadPreservedSet and computeMerge are exported functions", async () => {
    const { loadPreservedSet, computeMerge } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );
    assert.strictEqual(typeof loadPreservedSet, "function");
    assert.strictEqual(typeof computeMerge, "function");
  });
});

// ── Phase 2: T-05 — loadPreservedSet behavior ────────────────────────────────

describe("loadPreservedSet — union of preserveParams across domains", () => {
  test("T-05: unions all domain preserveParams, handles missing preserveParams", async () => {
    const { loadPreservedSet } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const domainRules = [
      { domain: "a.com", preserveParams: ["foo", "bar"] },
      { domain: "b.com", preserveParams: ["baz", "foo"] }, // foo duplicate
      { domain: "c.com" }, // no preserveParams — must not throw
    ];

    const result = loadPreservedSet(domainRules);
    assert.ok(result instanceof Set, "must return a Set");
    assert.ok(result.has("foo"), "must contain foo");
    assert.ok(result.has("bar"), "must contain bar");
    assert.ok(result.has("baz"), "must contain baz");
    assert.strictEqual(result.size, 3, "must deduplicate (foo appears once)");
  });
});

// ── Phase 2: T-07 — computeMerge behavior ────────────────────────────────────

describe("computeMerge — sort, dedup, change detection", () => {
  test("T-07a: sorted lexicographically", async () => {
    const { computeMerge } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );
    const { merged } = computeMerge(["z_param", "a_param"], ["m_param"]);
    assert.deepStrictEqual(merged, ["a_param", "m_param", "z_param"]);
  });

  test("T-07b: deduplicates via Set", async () => {
    const { computeMerge } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );
    const { merged } = computeMerge(["existing_param"], ["existing_param"]);
    assert.strictEqual(merged.length, 1);
    assert.deepStrictEqual(merged, ["existing_param"]);
  });

  test("T-07c: changed:false when merged equals current (all-collide/no-op)", async () => {
    const { computeMerge } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );
    const { changed } = computeMerge(["a", "b"], []);
    assert.strictEqual(changed, false);
  });

  test("T-07d: changed:true when new param added", async () => {
    const { computeMerge } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );
    const { changed, merged } = computeMerge(["a"], ["new_param"]);
    assert.strictEqual(changed, true);
    assert.ok(merged.includes("new_param"));
  });
});

// ── Phase 3: T-09 — runPromote valid merge (A1) ───────────────────────────────

describe("runPromote — valid merge (A1)", () => {
  test("T-09: valid merge: written:true, version bumped, published=injected now, sorted params", async () => {
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const nowDate = new Date("2026-06-01T12:00:00.000Z");

    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["new_param", "another_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });
    const domainRulesPath = writeDomainRules(tmpDir, [
      { domain: "example.com", preserveParams: ["safe_keep"] },
    ]);

    const result = await runPromote({
      promotePath,
      sourcePath,
      storePath: writeStore(tmpDir),
      domainRulesPath,
      trustedKeys: TEST_TRUSTED_KEYS,
      subtle: globalThis.crypto.subtle,
      now: nowDate,
    });

    assert.strictEqual(result.verified, true);
    assert.strictEqual(result.written, true);
    assert.strictEqual(result.noop, false);
    assert.strictEqual(result.version, 4);
    assert.strictEqual(result.published, "2026-06-01T12:00:00.000Z");

    // Params sorted and merged
    assert.deepStrictEqual(result.merged, [
      "another_param",
      "existing_param",
      "new_param",
    ]);

    // File bytes contain the expected JSON with trailing newline
    const written = JSON.parse(readFileSync(sourcePath, "utf8"));
    assert.strictEqual(written.version, 4);
    assert.strictEqual(written.published, "2026-06-01T12:00:00.000Z");
    assert.deepStrictEqual(written.params, [
      "another_param",
      "existing_param",
      "new_param",
    ]);

    // Trailing newline
    const raw = readFileSync(sourcePath, "utf8");
    assert.ok(raw.endsWith("\n"), "params.json must end with \\n");
  });
});

// ── Phase 3: T-10 — tampered sig → fail-closed (A2) ─────────────────────────

describe("runPromote — tampered sig → fail-closed (A2)", () => {
  test("T-10: mutated sig → PromoteError exitCode 2, bytes unchanged", async () => {
    const { runPromote, PromoteError } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();

    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["new_param"],
      privateKey: TEST_PRIV_KEY,
      sigOverride: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    const bytesBefore = readFileSync(sourcePath, "utf8");

    await assert.rejects(
      () =>
        runPromote({
          promotePath,
          sourcePath,
          storePath: writeStore(tmpDir),
          domainRulesPath,
          trustedKeys: TEST_TRUSTED_KEYS,
          subtle: globalThis.crypto.subtle,
          now: new Date("2026-06-01T12:00:00.000Z"),
        }),
      (err) => {
        assert.ok(err instanceof PromoteError, "must be PromoteError");
        assert.strictEqual(err.exitCode, 2);
        return true;
      }
    );

    const bytesAfter = readFileSync(sourcePath, "utf8");
    assert.strictEqual(bytesBefore, bytesAfter, "params.json bytes must be unchanged");
  });
});

// ── Phase 3: T-11 — missing/null sig → fail-closed (A2b) ────────────────────

describe("runPromote — missing sig → fail-closed (A2b)", () => {
  test("T-11: sig:null → PromoteError exitCode 2, bytes unchanged", async () => {
    const { runPromote, PromoteError } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();

    // Build artifact without valid sig
    const artifact = { version: 3, published: "2026-05-01T00:00:00.000Z", params: ["new_param"], sig: null };
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    const bytesBefore = readFileSync(sourcePath, "utf8");

    await assert.rejects(
      () =>
        runPromote({
          promotePath,
          sourcePath,
          storePath: writeStore(tmpDir),
          domainRulesPath,
          trustedKeys: TEST_TRUSTED_KEYS,
          subtle: globalThis.crypto.subtle,
          now: new Date("2026-06-01T12:00:00.000Z"),
        }),
      (err) => {
        assert.ok(err instanceof PromoteError, "must be PromoteError");
        assert.strictEqual(err.exitCode, 2);
        return true;
      }
    );

    const bytesAfter = readFileSync(sourcePath, "utf8");
    assert.strictEqual(bytesBefore, bytesAfter, "params.json bytes must be unchanged");
  });
});

// ── Phase 3: T-12 — malformed source params.json → exitCode 1 ────────────────

describe("runPromote — malformed source params.json", () => {
  test("T-12a: non-JSON source → PromoteError exitCode 1", async () => {
    const { runPromote, PromoteError } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["new_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);

    // Write non-JSON to source
    const sourcePath = join(tmpDir, "params.json");
    writeFileSync(sourcePath, "NOT VALID JSON", "utf8");

    const domainRulesPath = writeDomainRules(tmpDir, []);

    await assert.rejects(
      () =>
        runPromote({
          promotePath,
          sourcePath,
          storePath: writeStore(tmpDir),
          domainRulesPath,
          trustedKeys: TEST_TRUSTED_KEYS,
          subtle: globalThis.crypto.subtle,
          now: new Date("2026-06-01T12:00:00.000Z"),
        }),
      (err) => {
        assert.ok(err instanceof PromoteError, "must be PromoteError");
        assert.strictEqual(err.exitCode, 1);
        return true;
      }
    );
  });

  test("T-12b: non-integer version in source → PromoteError exitCode 1", async () => {
    const { runPromote, PromoteError } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["new_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);

    // Write source with non-integer version
    const sourcePath = join(tmpDir, "params.json");
    writeFileSync(
      sourcePath,
      JSON.stringify({ version: "not-a-number", published: "2026-04-01T00:00:00.000Z", params: [] }, null, 2) + "\n",
      "utf8"
    );

    const domainRulesPath = writeDomainRules(tmpDir, []);

    await assert.rejects(
      () =>
        runPromote({
          promotePath,
          sourcePath,
          storePath: writeStore(tmpDir),
          domainRulesPath,
          trustedKeys: TEST_TRUSTED_KEYS,
          subtle: globalThis.crypto.subtle,
          now: new Date("2026-06-01T12:00:00.000Z"),
        }),
      (err) => {
        assert.ok(err instanceof PromoteError, "must be PromoteError");
        assert.strictEqual(err.exitCode, 1);
        return true;
      }
    );
  });
});

// ── Phase 3: T-13 — missing files → exitCode 3 ───────────────────────────────

describe("runPromote — missing files → exitCode 3", () => {
  test("T-13a: missing promote artifact → PromoteError exitCode 3", async () => {
    const { runPromote, PromoteError } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    await assert.rejects(
      () =>
        runPromote({
          promotePath: join(tmpDir, "does-not-exist.json"),
          sourcePath,
          storePath: writeStore(tmpDir),
          domainRulesPath,
          trustedKeys: TEST_TRUSTED_KEYS,
          subtle: globalThis.crypto.subtle,
          now: new Date("2026-06-01T12:00:00.000Z"),
        }),
      (err) => {
        assert.ok(err instanceof PromoteError, "must be PromoteError");
        assert.strictEqual(err.exitCode, 3);
        return true;
      }
    );
  });

  test("T-13b: missing source params.json → PromoteError exitCode 3", async () => {
    const { runPromote, PromoteError } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["new_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const domainRulesPath = writeDomainRules(tmpDir, []);

    await assert.rejects(
      () =>
        runPromote({
          promotePath,
          sourcePath: join(tmpDir, "does-not-exist-params.json"),
          storePath: writeStore(tmpDir),
          domainRulesPath,
          trustedKeys: TEST_TRUSTED_KEYS,
          subtle: globalThis.crypto.subtle,
          now: new Date("2026-06-01T12:00:00.000Z"),
        }),
      (err) => {
        assert.ok(err instanceof PromoteError, "must be PromoteError");
        assert.strictEqual(err.exitCode, 3);
        return true;
      }
    );
  });
});

// ── Phase 4: T-15 — stale artifact → exitCode 1 ──────────────────────────────

describe("runPromote — stale artifact (STALE_DAYS=180)", () => {
  test("T-15: artifact.published older than 180 days → PromoteError exitCode 1, bytes unchanged", async () => {
    const { runPromote, PromoteError } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");
    // 181 days before now — stale
    const staleDate = new Date(now.getTime() - 181 * 864e5);

    const artifact = buildArtifact({
      version: 3,
      published: staleDate.toISOString(),
      params: ["new_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    const bytesBefore = readFileSync(sourcePath, "utf8");

    await assert.rejects(
      () =>
        runPromote({
          promotePath,
          sourcePath,
          storePath: writeStore(tmpDir),
          domainRulesPath,
          trustedKeys: TEST_TRUSTED_KEYS,
          subtle: globalThis.crypto.subtle,
          now,
        }),
      (err) => {
        assert.ok(err instanceof PromoteError, "must be PromoteError");
        assert.strictEqual(err.exitCode, 1);
        return true;
      }
    );

    const bytesAfter = readFileSync(sourcePath, "utf8");
    assert.strictEqual(bytesBefore, bytesAfter, "params.json bytes must be unchanged");
  });
});

// ── Phase 4: T-16 — collision skip+log (A3) ──────────────────────────────────

describe("runPromote — preserveParams collision skip (A3)", () => {
  test("T-16: collider_param skipped, new_clean_param merges", async () => {
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["collider_param", "new_clean_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });
    const domainRulesPath = writeDomainRules(tmpDir, [
      { domain: "example.com", preserveParams: ["collider_param"] },
    ]);

    const result = await runPromote({
      promotePath,
      sourcePath,
      storePath: writeStore(tmpDir),
      domainRulesPath,
      trustedKeys: TEST_TRUSTED_KEYS,
      subtle: globalThis.crypto.subtle,
      now,
    });

    // collider_param must be in skipped
    assert.ok(
      result.skipped.some((s) => s.param === "collider_param"),
      "collider_param must be in skipped"
    );

    // collider_param must NOT be in merged
    assert.ok(!result.merged.includes("collider_param"), "collider_param must not be in merged");

    // new_clean_param must be in merged
    assert.ok(result.merged.includes("new_clean_param"), "new_clean_param must be in merged");

    // File written
    assert.strictEqual(result.written, true);
    const written = JSON.parse(readFileSync(sourcePath, "utf8"));
    assert.ok(!written.params.includes("collider_param"));
    assert.ok(written.params.includes("new_clean_param"));
  });
});

// ── Phase 4: T-17 — union across two domains ─────────────────────────────────

describe("runPromote — preserveParams union across multiple domains", () => {
  test("T-17: both domain-scoped params skipped, safe_param merges", async () => {
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["a_param", "b_param", "safe_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });
    const domainRulesPath = writeDomainRules(tmpDir, [
      { domain: "a.com", preserveParams: ["a_param"] },
      { domain: "b.com", preserveParams: ["b_param"] },
    ]);

    const result = await runPromote({
      promotePath,
      sourcePath,
      storePath: writeStore(tmpDir),
      domainRulesPath,
      trustedKeys: TEST_TRUSTED_KEYS,
      subtle: globalThis.crypto.subtle,
      now,
    });

    assert.ok(result.skipped.some((s) => s.param === "a_param"), "a_param must be skipped");
    assert.ok(result.skipped.some((s) => s.param === "b_param"), "b_param must be skipped");
    assert.ok(!result.merged.includes("a_param"), "a_param must not be in merged");
    assert.ok(!result.merged.includes("b_param"), "b_param must not be in merged");
    assert.ok(result.merged.includes("safe_param"), "safe_param must be in merged");
  });
});

// ── Phase 4: T-18 — ALL params collide → noop (R2-S3) ───────────────────────

describe("runPromote — ALL promoted params collide → noop", () => {
  test("T-18: all params in preservedSet → noop:true, written:false, bytes unchanged", async () => {
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["collider_a", "collider_b"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });
    const domainRulesPath = writeDomainRules(tmpDir, [
      { domain: "a.com", preserveParams: ["collider_a", "collider_b"] },
    ]);

    const bytesBefore = readFileSync(sourcePath, "utf8");

    const result = await runPromote({
      promotePath,
      sourcePath,
      storePath: writeStore(tmpDir),
      domainRulesPath,
      trustedKeys: TEST_TRUSTED_KEYS,
      subtle: globalThis.crypto.subtle,
      now,
    });

    assert.strictEqual(result.noop, true);
    assert.strictEqual(result.written, false);
    assert.strictEqual(result.verified, true);

    const bytesAfter = readFileSync(sourcePath, "utf8");
    assert.strictEqual(bytesBefore, bytesAfter, "params.json bytes must be unchanged");
  });
});

// ── Phase 5: T-20 — idempotent no-op (A4) ────────────────────────────────────

describe("runPromote — idempotent no-op (A4)", () => {
  test("T-20: second run with same artifact → noop:true, written:false", async () => {
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["new_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    // First run — should write
    const first = await runPromote({
      promotePath,
      sourcePath,
      storePath: writeStore(tmpDir),
      domainRulesPath,
      trustedKeys: TEST_TRUSTED_KEYS,
      subtle: globalThis.crypto.subtle,
      now,
    });
    assert.strictEqual(first.written, true, "first run must write");

    // Second run — same artifact, same source (now updated from first run)
    // We need to re-sign with the new state's canonical to make it idempotent
    // But the artifact is the same signed one — the params are already in source
    // so computeMerge should return changed:false
    const second = await runPromote({
      promotePath,
      sourcePath,
      storePath: writeStore(tmpDir),
      domainRulesPath,
      trustedKeys: TEST_TRUSTED_KEYS,
      subtle: globalThis.crypto.subtle,
      now,
    });

    assert.strictEqual(second.noop, true, "second run must be noop");
    assert.strictEqual(second.written, false, "second run must not write");
    assert.strictEqual(second.version, first.version, "version must not change on noop");
  });
});

// ── Phase 5: T-21 — version monotonicity ─────────────────────────────────────

describe("runPromote — version monotonicity", () => {
  test("T-21: version = current+1; stale artifact version still proceeds", async () => {
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    // artifact.version (3) <= current.version (5) — stale, but should still proceed
    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["brand_new_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 5,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    const result = await runPromote({
      promotePath,
      sourcePath,
      storePath: writeStore(tmpDir),
      domainRulesPath,
      trustedKeys: TEST_TRUSTED_KEYS,
      subtle: globalThis.crypto.subtle,
      now,
    });

    assert.strictEqual(result.written, true);
    // newVersion = current.version(5) + 1 = 6, NOT artifact.version+1
    assert.strictEqual(result.version, 6, "version must be current+1=6");
    assert.ok(Number.isInteger(result.version), "version must be integer");

    const written = JSON.parse(readFileSync(sourcePath, "utf8"));
    assert.strictEqual(written.version, 6);
  });
});

// ── Phase 6: T-23 — exit code 0 on merge and no-op ──────────────────────────

describe("runPromote — exit codes R7-S1/S2", () => {
  test("T-23a: success merge → no throw, written:true", async () => {
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["fresh_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: [],
    });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    const result = await runPromote({
      promotePath,
      sourcePath,
      storePath: writeStore(tmpDir),
      domainRulesPath,
      trustedKeys: TEST_TRUSTED_KEYS,
      subtle: globalThis.crypto.subtle,
      now: new Date("2026-06-01T12:00:00.000Z"),
    });

    assert.strictEqual(result.written, true);
    assert.strictEqual(result.noop, false);
  });

  test("T-23b: success no-op → no throw, noop:true", async () => {
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    // Artifact with params already in source
    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["already_there"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["already_there"],
    });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    const result = await runPromote({
      promotePath,
      sourcePath,
      storePath: writeStore(tmpDir),
      domainRulesPath,
      trustedKeys: TEST_TRUSTED_KEYS,
      subtle: globalThis.crypto.subtle,
      now: new Date("2026-06-01T12:00:00.000Z"),
    });

    assert.strictEqual(result.noop, true);
    assert.strictEqual(result.written, false);
  });
});

// ── Phase 7: T-25 — package.json promote:rules script ────────────────────────

describe("package.json — promote:rules script", () => {
  test("T-25: package.json scripts contains promote:rules key", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    assert.ok(
      Object.prototype.hasOwnProperty.call(pkg.scripts, "promote:rules"),
      "package.json scripts must have promote:rules"
    );
    assert.ok(
      pkg.scripts["promote:rules"].includes("promote-rules.mjs"),
      "promote:rules must point to promote-rules.mjs"
    );
  });
});

// ── FIX-6: future-dated artifact (beyond CLOCK_SKEW_TOLERANCE_MS) → exit 1 ───

describe("runPromote — future-dated artifact bypass (FIX-6)", () => {
  test("FIX-6a: artifact published 2 days in the future → PromoteError exitCode 1, bytes unchanged", async () => {
    const { runPromote, PromoteError } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");
    // 2 days (172 800 000 ms) > CLOCK_SKEW_TOLERANCE_MS (86 400 000 ms)
    const futurePublished = new Date(now.getTime() + 2 * 864e5).toISOString();

    const artifact = buildArtifact({
      version: 3,
      published: futurePublished,
      params: ["future_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    const bytesBefore = readFileSync(sourcePath, "utf8");

    await assert.rejects(
      () =>
        runPromote({
          promotePath,
          sourcePath,
          storePath: writeStore(tmpDir),
          domainRulesPath,
          trustedKeys: TEST_TRUSTED_KEYS,
          subtle: globalThis.crypto.subtle,
          now,
        }),
      (err) => {
        assert.ok(err instanceof PromoteError, "must be PromoteError");
        assert.strictEqual(err.exitCode, 1, "must be exitCode 1 (validation)");
        return true;
      }
    );

    const bytesAfter = readFileSync(sourcePath, "utf8");
    assert.strictEqual(bytesBefore, bytesAfter, "params.json bytes must be unchanged");
  });

  test("FIX-6b: artifact published exactly at CLOCK_SKEW_TOLERANCE_MS boundary is accepted (within tolerance)", async () => {
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");
    // Exactly at tolerance boundary: publishedMs - now === CLOCK_SKEW_TOLERANCE_MS
    // The check is STRICTLY GREATER THAN tolerance, so boundary itself is accepted.
    const boundaryPublished = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    const artifact = buildArtifact({
      version: 3,
      published: boundaryPublished,
      params: ["boundary_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: [],
    });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    // Must NOT throw — exactly at tolerance is still within the window
    const result = await runPromote({
      promotePath,
      sourcePath,
      storePath: writeStore(tmpDir),
      domainRulesPath,
      trustedKeys: TEST_TRUSTED_KEYS,
      subtle: globalThis.crypto.subtle,
      now,
    });
    assert.strictEqual(result.verified, true);
  });
});

// ── FIX-7: domain-rules.json fail-CLOSED ─────────────────────────────────────

describe("runPromote — domain-rules.json fail-CLOSED (FIX-7)", () => {
  test("FIX-7a: missing domainRulesPath → PromoteError exitCode 3, bytes unchanged", async () => {
    const { runPromote, PromoteError } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["new_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });

    const bytesBefore = readFileSync(sourcePath, "utf8");

    await assert.rejects(
      () =>
        runPromote({
          promotePath,
          sourcePath,
          storePath: writeStore(tmpDir),
          domainRulesPath: join(tmpDir, "domain-rules-does-not-exist.json"),
          trustedKeys: TEST_TRUSTED_KEYS,
          subtle: globalThis.crypto.subtle,
          now,
        }),
      (err) => {
        assert.ok(err instanceof PromoteError, "must be PromoteError");
        assert.strictEqual(err.exitCode, 3, "missing domain-rules.json must be exitCode 3 (I/O)");
        return true;
      }
    );

    const bytesAfter = readFileSync(sourcePath, "utf8");
    assert.strictEqual(bytesBefore, bytesAfter, "params.json bytes must be unchanged");
  });

  test("FIX-7b: domainRulesPath contains non-array JSON → PromoteError exitCode 1, bytes unchanged", async () => {
    const { runPromote, PromoteError } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["new_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });

    // domain-rules.json contains a plain object — NOT an array
    const domainRulesPath = join(tmpDir, "domain-rules.json");
    writeFileSync(
      domainRulesPath,
      JSON.stringify({ notAnArray: true }, null, 2) + "\n",
      "utf8"
    );

    const bytesBefore = readFileSync(sourcePath, "utf8");

    await assert.rejects(
      () =>
        runPromote({
          promotePath,
          sourcePath,
          storePath: writeStore(tmpDir),
          domainRulesPath,
          trustedKeys: TEST_TRUSTED_KEYS,
          subtle: globalThis.crypto.subtle,
          now,
        }),
      (err) => {
        assert.ok(err instanceof PromoteError, "must be PromoteError");
        assert.strictEqual(err.exitCode, 1, "non-array domain-rules.json must be exitCode 1 (validation)");
        return true;
      }
    );

    const bytesAfter = readFileSync(sourcePath, "utf8");
    assert.strictEqual(bytesBefore, bytesAfter, "params.json bytes must be unchanged");
  });
});

// ── FIX-8: non-string params elements → exit 1, no write ─────────────────────

describe("runPromote — non-string params in artifact (FIX-8)", () => {
  test("FIX-8: artifact params contains non-string (signed with correct sig) → PromoteError exitCode 1, bytes unchanged", async () => {
    const { runPromote, PromoteError } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    // Build canonical and sign with the ACTUAL params (including non-string),
    // so the signature is valid for this exact params array. The schema check
    // for non-string elements must fire BEFORE the signature check (per the
    // artifact validation order in promote-rules.mjs step 2), meaning the
    // test MUST result in exitCode 1 (not 2) even if the sig were valid.
    const paramsWithNonString = ["good_param", 123, "another_good"];
    // Manually build the canonical as orchestrate.mjs would if it received strings
    // (the production schema check runs before sig verification, so we just need
    // the exit code — the sig validity is irrelevant here, but we sign anyway
    // to keep the test honest about the ordering).
    const canonical = canonicalMessage(3, "2026-05-01T00:00:00.000Z", paramsWithNonString.map(String));
    const sig = signCanonical(canonical, TEST_PRIV_KEY);

    const artifact = { version: 3, published: "2026-05-01T00:00:00.000Z", params: paramsWithNonString, sig };
    const promotePath = join(tmpDir, "promote-candidates.json");
    writeFileSync(promotePath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    const bytesBefore = readFileSync(sourcePath, "utf8");

    await assert.rejects(
      () =>
        runPromote({
          promotePath,
          sourcePath,
          storePath: writeStore(tmpDir),
          domainRulesPath,
          trustedKeys: TEST_TRUSTED_KEYS,
          subtle: globalThis.crypto.subtle,
          now,
        }),
      (err) => {
        assert.ok(err instanceof PromoteError, "must be PromoteError");
        assert.strictEqual(err.exitCode, 1, "non-string params must be exitCode 1 (schema validation)");
        return true;
      }
    );

    const bytesAfter = readFileSync(sourcePath, "utf8");
    assert.strictEqual(bytesBefore, bytesAfter, "params.json bytes must be unchanged");
  });
});

// ── FIX-5: idempotency vs unsorted source ─────────────────────────────────────

describe("runPromote — idempotency with unsorted source params (FIX-5)", () => {
  test("FIX-5: hand-unsorted source with same content as sorted merged → noop:true (no spurious write)", async () => {
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    // Artifact promotes "already_there" — which is already in source but unsorted
    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["already_there"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);

    // Source params deliberately unsorted: ["z_param", "already_there"]
    // The merged sorted result would be ["already_there", "z_param"] —
    // same set, just sorted. Without FIX-5, this would report changed:true
    // because currentParams["z_param","already_there"] !== merged["already_there","z_param"].
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["z_param", "already_there"],
    });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    const result = await runPromote({
      promotePath,
      sourcePath,
      storePath: writeStore(tmpDir),
      domainRulesPath,
      trustedKeys: TEST_TRUSTED_KEYS,
      subtle: globalThis.crypto.subtle,
      now,
    });

    assert.strictEqual(result.noop, true, "must be noop — no new params added");
    assert.strictEqual(result.written, false, "must not write — same content, just pre-sorted");
  });
});

// ── #821-I2: Param format validation at promote boundary ──────────────────────

describe("#821-I2 — Param format validation at promote boundary", () => {
  test("I2-a: param failing PARAM_FORMAT_RE (contains space) → PromoteError exitCode 1, bytes unchanged", async () => {
    const { runPromote, PromoteError } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    // "bad param" has a space — fails PARAM_FORMAT_RE /^[a-zA-Z0-9_.\-]+$/
    const badParams = ["bad param", "good_param"];
    const canonical = canonicalMessage(3, "2026-05-01T00:00:00.000Z", badParams);
    const sig = cryptoSign(null, Buffer.from(canonical, "utf8"), TEST_PRIV_KEY).toString("base64url");
    const artifact = { version: 3, published: "2026-05-01T00:00:00.000Z", params: badParams, sig };
    const promotePath = join(tmpDir, "promote-candidates.json");
    writeFileSync(promotePath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });
    const domainRulesPath = writeDomainRules(tmpDir, []);
    const bytesBefore = readFileSync(sourcePath, "utf8");

    await assert.rejects(
      () => runPromote({ promotePath, sourcePath, storePath: writeStore(tmpDir), domainRulesPath, trustedKeys: TEST_TRUSTED_KEYS, subtle: globalThis.crypto.subtle, now }),
      (err) => {
        assert.ok(err instanceof PromoteError, "must be PromoteError");
        assert.strictEqual(err.exitCode, 1, "bad format param → exitCode 1");
        return true;
      }
    );
    assert.strictEqual(readFileSync(sourcePath, "utf8"), bytesBefore, "params.json must be unchanged");
  });

  test("I2-b: param exceeding MAX_PARAM_LEN (>64 chars) → PromoteError exitCode 1, bytes unchanged", async () => {
    const { runPromote, PromoteError } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    const overLongParam = "a".repeat(65); // 65 chars > MAX_PARAM_LEN (64)
    const badParams = [overLongParam];
    const canonical = canonicalMessage(3, "2026-05-01T00:00:00.000Z", badParams);
    const sig = cryptoSign(null, Buffer.from(canonical, "utf8"), TEST_PRIV_KEY).toString("base64url");
    const artifact = { version: 3, published: "2026-05-01T00:00:00.000Z", params: badParams, sig };
    const promotePath = join(tmpDir, "promote-candidates.json");
    writeFileSync(promotePath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

    const sourcePath = writeParamsJson(tmpDir, { version: 3, published: "2026-04-01T00:00:00.000Z", params: [] });
    const domainRulesPath = writeDomainRules(tmpDir, []);
    const bytesBefore = readFileSync(sourcePath, "utf8");

    await assert.rejects(
      () => runPromote({ promotePath, sourcePath, storePath: writeStore(tmpDir), domainRulesPath, trustedKeys: TEST_TRUSTED_KEYS, subtle: globalThis.crypto.subtle, now }),
      (err) => {
        assert.ok(err instanceof PromoteError, "must be PromoteError");
        assert.strictEqual(err.exitCode, 1, "over-long param → exitCode 1");
        return true;
      }
    );
    assert.strictEqual(readFileSync(sourcePath, "utf8"), bytesBefore, "params.json must be unchanged");
  });

  test("I2-c: param in REMOTE_PARAM_DENYLIST → skipped (not thrown), absent from merged (issue #898)", async () => {
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    // "q" is in REMOTE_PARAM_DENYLIST
    const params = ["q"];
    const canonical = canonicalMessage(3, "2026-05-01T00:00:00.000Z", params);
    const sig = cryptoSign(null, Buffer.from(canonical, "utf8"), TEST_PRIV_KEY).toString("base64url");
    const artifact = { version: 3, published: "2026-05-01T00:00:00.000Z", params, sig };
    const promotePath = join(tmpDir, "promote-candidates.json");
    writeFileSync(promotePath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

    const sourcePath = writeParamsJson(tmpDir, { version: 3, published: "2026-04-01T00:00:00.000Z", params: [] });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    // Must NOT throw — denylist hit is now a skip, not a fatal error (#898)
    const result = await runPromote({
      promotePath, sourcePath, storePath: writeStore(tmpDir), domainRulesPath,
      trustedKeys: TEST_TRUSTED_KEYS, subtle: globalThis.crypto.subtle, now,
    });

    // "q" must be in skipped with reason REMOTE_PARAM_DENYLIST
    assert.ok(
      result.skipped.some((s) => s.param === "q" && s.reason === "REMOTE_PARAM_DENYLIST"),
      'skipped must contain { param: "q", reason: "REMOTE_PARAM_DENYLIST" }'
    );
    // "q" must NOT be in merged (never promoted)
    assert.ok(!result.merged.includes("q"), '"q" must not be in merged');
  });

  test("I2-d: param in AFFILIATE_PARAM_GUARD → skipped (not thrown), absent from merged (issue #898)", async () => {
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    // "campid" is in AFFILIATE_PARAM_GUARD (eBay) and NOT in REMOTE_PARAM_DENYLIST,
    // so the AFFILIATE_PARAM_GUARD branch is exercised exclusively.
    const params = ["campid"];
    const canonical = canonicalMessage(3, "2026-05-01T00:00:00.000Z", params);
    const sig = cryptoSign(null, Buffer.from(canonical, "utf8"), TEST_PRIV_KEY).toString("base64url");
    const artifact = { version: 3, published: "2026-05-01T00:00:00.000Z", params, sig };
    const promotePath = join(tmpDir, "promote-candidates.json");
    writeFileSync(promotePath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

    const sourcePath = writeParamsJson(tmpDir, { version: 3, published: "2026-04-01T00:00:00.000Z", params: [] });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    // Must NOT throw — affiliate guard hit is now a skip, not a fatal error (#898)
    const result = await runPromote({
      promotePath, sourcePath, storePath: writeStore(tmpDir), domainRulesPath,
      trustedKeys: TEST_TRUSTED_KEYS, subtle: globalThis.crypto.subtle, now,
    });

    // "campid" must be in skipped with reason AFFILIATE_PARAM_GUARD
    assert.ok(
      result.skipped.some((s) => s.param === "campid" && s.reason === "AFFILIATE_PARAM_GUARD"),
      'skipped must contain { param: "campid", reason: "AFFILIATE_PARAM_GUARD" }'
    );
    // "campid" must NOT be in merged (never promoted)
    assert.ok(!result.merged.includes("campid"), '"campid" must not be in merged');
  });

  test("T-898: guard param (clickid) + denylist param (q) + valid tracker → promote succeeds, guard/denylist absent from artifact, valid param promoted", async () => {
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    // clickid is in AFFILIATE_PARAM_GUARD; q is in REMOTE_PARAM_DENYLIST; utm_content is a valid tracker
    const params = ["clickid", "q", "utm_content"];
    const canonical = canonicalMessage(3, "2026-05-01T00:00:00.000Z", params);
    const sig = cryptoSign(null, Buffer.from(canonical, "utf8"), TEST_PRIV_KEY).toString("base64url");
    const artifact = { version: 3, published: "2026-05-01T00:00:00.000Z", params, sig };
    const promotePath = join(tmpDir, "promote-candidates.json");
    writeFileSync(promotePath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

    const sourcePath = writeParamsJson(tmpDir, { version: 3, published: "2026-04-01T00:00:00.000Z", params: [] });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    // Must NOT throw — guard/denylist hits are skipped; valid params are promoted
    const result = await runPromote({
      promotePath, sourcePath, storePath: writeStore(tmpDir), domainRulesPath,
      trustedKeys: TEST_TRUSTED_KEYS, subtle: globalThis.crypto.subtle, now,
    });

    // Run must succeed (written:true because utm_content is new)
    assert.strictEqual(result.verified, true, "must be verified");
    assert.strictEqual(result.written, true, "must write (utm_content is new)");

    // Guard/denylist params must be in skipped, not in merged
    assert.ok(
      result.skipped.some((s) => s.param === "clickid" && s.reason === "AFFILIATE_PARAM_GUARD"),
      'skipped must contain { param: "clickid", reason: "AFFILIATE_PARAM_GUARD" }'
    );
    assert.ok(
      result.skipped.some((s) => s.param === "q" && s.reason === "REMOTE_PARAM_DENYLIST"),
      'skipped must contain { param: "q", reason: "REMOTE_PARAM_DENYLIST" }'
    );
    assert.ok(!result.merged.includes("clickid"), '"clickid" must not be in merged');
    assert.ok(!result.merged.includes("q"), '"q" must not be in merged');

    // Valid tracker param must be promoted
    assert.ok(result.merged.includes("utm_content"), '"utm_content" must be in merged');

    // Written artifact must not contain guard/denylist params
    const { readFileSync } = await import("node:fs");
    const written = JSON.parse(readFileSync(sourcePath, "utf8"));
    assert.ok(!written.params.includes("clickid"), "written artifact must not contain clickid");
    assert.ok(!written.params.includes("q"), "written artifact must not contain q");
    assert.ok(written.params.includes("utm_content"), "written artifact must contain utm_content");
  });
});

// ── #821-I3: Validate `published` in promote source schema ────────────────────

describe("#821-I3 — Validate `published` in source params.json schema", () => {
  test("I3-a: source params.json missing `published` field → PromoteError exitCode 1, bytes unchanged", async () => {
    const { runPromote, PromoteError } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["new_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);

    // Source without `published` field
    const sourcePath = join(tmpDir, "params.json");
    writeFileSync(
      sourcePath,
      JSON.stringify({ version: 3, params: ["existing_param"] }, null, 2) + "\n",
      "utf8"
    );
    const domainRulesPath = writeDomainRules(tmpDir, []);
    const bytesBefore = readFileSync(sourcePath, "utf8");

    await assert.rejects(
      () => runPromote({ promotePath, sourcePath, storePath: writeStore(tmpDir), domainRulesPath, trustedKeys: TEST_TRUSTED_KEYS, subtle: globalThis.crypto.subtle, now }),
      (err) => {
        assert.ok(err instanceof PromoteError, "must be PromoteError");
        assert.strictEqual(err.exitCode, 1, "missing published in source → exitCode 1 (SCHEMA_ERROR)");
        return true;
      }
    );
    assert.strictEqual(readFileSync(sourcePath, "utf8"), bytesBefore, "params.json must be unchanged");
  });

  test("I3-b: source params.json with non-string `published` → PromoteError exitCode 1", async () => {
    const { runPromote, PromoteError } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["new_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);

    // Source with published as a number (not string)
    const sourcePath = join(tmpDir, "params.json");
    writeFileSync(
      sourcePath,
      JSON.stringify({ version: 3, published: 12345, params: ["existing_param"] }, null, 2) + "\n",
      "utf8"
    );
    const domainRulesPath = writeDomainRules(tmpDir, []);

    await assert.rejects(
      () => runPromote({ promotePath, sourcePath, storePath: writeStore(tmpDir), domainRulesPath, trustedKeys: TEST_TRUSTED_KEYS, subtle: globalThis.crypto.subtle, now }),
      (err) => {
        assert.ok(err instanceof PromoteError, "must be PromoteError");
        assert.strictEqual(err.exitCode, 1, "non-string published in source → exitCode 1");
        return true;
      }
    );
  });

  test("I3-c: valid source with string `published` proceeds normally", async () => {
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");

    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["new_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: [],
    });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    // Must not throw — valid published field
    const result = await runPromote({
      promotePath, sourcePath, storePath: writeStore(tmpDir), domainRulesPath,
      trustedKeys: TEST_TRUSTED_KEYS, subtle: globalThis.crypto.subtle, now,
    });
    assert.strictEqual(result.verified, true, "valid source must proceed to verify");
    assert.strictEqual(result.written, true, "valid source must write result");
  });
});

// ── Phase 8: T-27 — import-smoke regression test ─────────────────────────────

describe("Import smoke — promote-rules.mjs under Node (D1 mitigation)", () => {
  test("T-27: all named exports importable; end-to-end runPromote under Node", async () => {
    const { runPromote, loadPreservedSet, computeMerge, PromoteError } =
      await import("../../tools/rule-ingestion/promote-rules.mjs");

    // All named exports present
    assert.strictEqual(typeof runPromote, "function");
    assert.strictEqual(typeof loadPreservedSet, "function");
    assert.strictEqual(typeof computeMerge, "function");
    assert.ok(PromoteError.prototype instanceof Error);

    // End-to-end runPromote with real globalThis.crypto.subtle
    const tmpDir = makeTmpDir();
    const now = new Date("2026-06-01T12:00:00.000Z");
    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["smoke_test_param"],
      privateKey: TEST_PRIV_KEY,
    });
    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: [],
    });
    const domainRulesPath = writeDomainRules(tmpDir, []);

    const result = await runPromote({
      promotePath,
      sourcePath,
      storePath: writeStore(tmpDir),
      domainRulesPath,
      trustedKeys: TEST_TRUSTED_KEYS,
      subtle: globalThis.crypto.subtle,
      now,
    });

    assert.strictEqual(result.verified, true, "smoke test: verified must be true");
  });
});

// ── Store retargeting: params.json is a PROJECTION, not a source ──────────────

describe("runPromote — writes the normalized store, not just the artifact", () => {
  test("the store is updated at the INJECTED path and the artifact matches it", async () => {
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );
    const { parseStore, emitParams } = await import("../../tools/rules-store.mjs");

    const tmpDir = makeTmpDir();
    const promotePath = writeArtifact(
      tmpDir,
      buildArtifact({
        version: 3,
        published: "2026-05-01T00:00:00.000Z",
        params: ["new_param"],
        privateKey: TEST_PRIV_KEY,
      })
    );
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });
    const storePath = writeStore(tmpDir);

    const result = await runPromote({
      promotePath,
      sourcePath,
      storePath,
      domainRulesPath: writeDomainRules(tmpDir, [
        { domain: "example.com", preserveParams: ["safe_keep"] },
      ]),
      trustedKeys: TEST_TRUSTED_KEYS,
      subtle: globalThis.crypto.subtle,
      now: new Date("2026-06-01T12:00:00.000Z"),
    });

    assert.strictEqual(result.written, true);

    // The store must carry the merged list...
    const store = parseStore(readFileSync(storePath, "utf8"));
    assert.deepEqual(emitParams(store), result.merged);

    // ...and params.json must be exactly its projection. If these two ever
    // disagree, the next drift test fails on drift THIS job introduced.
    const artifact = JSON.parse(readFileSync(sourcePath, "utf8"));
    assert.deepEqual(artifact.params, emitParams(store));
  });

  test("host-scoped entries in the store survive a global-list promotion", async () => {
    // withGlobalParams must replace ONLY the global axis. Rebuilding the store
    // from the artifacts would be equivalent today and silent data loss the
    // moment Slice 2 adds a host-scoped strip.
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );
    const { parseStore } = await import("../../tools/rules-store.mjs");

    const tmpDir = makeTmpDir();
    const storePath = join(tmpDir, "rules.json");
    writeFileSync(
      storePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          projection: { scopes: { "example.com": { emitStripParams: false, note: "n" } } },
          entries: [{ scope: "example.com", param: "safe_keep", action: "preserve" }],
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    await runPromote({
      promotePath: writeArtifact(
        tmpDir,
        buildArtifact({
          version: 3,
          published: "2026-05-01T00:00:00.000Z",
          params: ["new_param"],
          privateKey: TEST_PRIV_KEY,
        })
      ),
      sourcePath: writeParamsJson(tmpDir, {
        version: 3,
        published: "2026-04-01T00:00:00.000Z",
        params: ["existing_param"],
      }),
      storePath,
      domainRulesPath: writeDomainRules(tmpDir, [
        { domain: "example.com", preserveParams: ["safe_keep"] },
      ]),
      trustedKeys: TEST_TRUSTED_KEYS,
      subtle: globalThis.crypto.subtle,
      now: new Date("2026-06-01T12:00:00.000Z"),
    });

    const store = parseStore(readFileSync(storePath, "utf8"));
    const hostEntries = store.entries.filter((e) => e.scope === "example.com");
    assert.deepEqual(hostEntries, [
      { scope: "example.com", param: "safe_keep", action: "preserve" },
    ]);
  });

  test("an overridden sourcePath with a default storePath is refused", async () => {
    // The regression that made this guard necessary: the first run of this
    // retarget against the existing suite had `npm test` silently rewrite the
    // REPOSITORY's tools/rules-source/rules.json, because every test injected
    // sourcePath into a tmpdir and left storePath at its default.
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    await assert.rejects(
      () =>
        runPromote({
          promotePath: writeArtifact(
            tmpDir,
            buildArtifact({
              version: 3,
              published: "2026-05-01T00:00:00.000Z",
              params: ["new_param"],
              privateKey: TEST_PRIV_KEY,
            })
          ),
          sourcePath: writeParamsJson(tmpDir, {
            version: 3,
            published: "2026-04-01T00:00:00.000Z",
            params: ["existing_param"],
          }),
          // storePath deliberately omitted
          domainRulesPath: writeDomainRules(tmpDir, [
            { domain: "example.com", preserveParams: ["safe_keep"] },
          ]),
          trustedKeys: TEST_TRUSTED_KEYS,
          subtle: globalThis.crypto.subtle,
          now: new Date("2026-06-01T12:00:00.000Z"),
        }),
      (err) => err.message.includes("CONFIG_ERROR") && err.exitCode === 2
    );
  });

  test("a bad signature writes NEITHER the store NOR the artifact", async () => {
    // Fail-closed must survive the retarget: verification still happens before
    // any write, and now there are two files that must both stay untouched.
    const { runPromote } = await import(
      "../../tools/rule-ingestion/promote-rules.mjs"
    );

    const tmpDir = makeTmpDir();
    const artifact = buildArtifact({
      version: 3,
      published: "2026-05-01T00:00:00.000Z",
      params: ["new_param"],
      privateKey: TEST_PRIV_KEY,
    });
    artifact.sig = "AAAA" + artifact.sig.slice(4);

    const promotePath = writeArtifact(tmpDir, artifact);
    const sourcePath = writeParamsJson(tmpDir, {
      version: 3,
      published: "2026-04-01T00:00:00.000Z",
      params: ["existing_param"],
    });
    const storePath = writeStore(tmpDir);

    const storeBefore = readFileSync(storePath, "utf8");
    const sourceBefore = readFileSync(sourcePath, "utf8");

    await assert.rejects(() =>
      runPromote({
        promotePath,
        sourcePath,
        storePath,
        domainRulesPath: writeDomainRules(tmpDir, [
          { domain: "example.com", preserveParams: ["safe_keep"] },
        ]),
        trustedKeys: TEST_TRUSTED_KEYS,
        subtle: globalThis.crypto.subtle,
        now: new Date("2026-06-01T12:00:00.000Z"),
      })
    );

    assert.strictEqual(readFileSync(storePath, "utf8"), storeBefore, "store was written despite a bad signature");
    assert.strictEqual(readFileSync(sourcePath, "utf8"), sourceBefore, "params.json was written despite a bad signature");
  });
});
