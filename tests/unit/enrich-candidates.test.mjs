/**
 * MUGA — Behavioral unit tests for tools/rule-ingestion/enrich-candidates.mjs (#798)
 *
 * Covers spec Domain candidate-enrichment (all 4 requirements) and Domain tests:
 *   - aggregateDiscovered: CSF deduplication, entropy accumulation, empty artifacts
 *   - enrichCandidates: entropy mean, crossSiteFrequency, null passthrough, absent param
 *   - readVerifiedArtifacts: injected verify stub (happy path, sig-fail, JSON-parse-fail)
 *
 * Fixture values (computed from tests/fixtures/discovered/):
 *   artifact-a.json:
 *     fbclid  → first_seen_on: "ads.example.com",  value_entropy: 3.2
 *     utm_source → first_seen_on: "shop.example.com", value_entropy: 2.8
 *   artifact-b.json:
 *     fbclid  → first_seen_on: "news.example.com", value_entropy: 4.1
 *     utm_source → first_seen_on: "shop.example.com", value_entropy: 3.6
 *   artifact-no-entropy.json:
 *     ref     → first_seen_on: "legacy.example.com", no value_entropy
 *
 * Expected aggregated values:
 *   fbclid:     CSF = 2 (ads.example.com + news.example.com), entropy = (3.2 + 4.1) / 2 = 3.65
 *   utm_source: CSF = 1 (shop.example.com deduplicated), entropy = (2.8 + 3.6) / 2 = 3.2
 *   ref:        CSF = 1 (legacy.example.com), entropy = null (no value_entropy in artifact)
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import {
  aggregateDiscovered,
  enrichCandidates,
  readVerifiedArtifacts,
} from "../../tools/rule-ingestion/enrich-candidates.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Fixture loading helpers
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(__dirname, "../fixtures/discovered");

function loadFixture(name) {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));
}

/** Create a fresh temp directory for each readVerifiedArtifacts test */
function makeTmpDir() {
  const d = join(
    tmpdir(),
    `muga-enrich-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(d, { recursive: true });
  return d;
}

/** Write a JSON file into a temp dir */
function writeTmpJson(dir, name, obj) {
  writeFileSync(join(dir, name), JSON.stringify(obj, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Section A — aggregateDiscovered (pure function)
// ---------------------------------------------------------------------------

describe("aggregateDiscovered — CSF deduplication and entropy accumulation", () => {
  test("returns a Map with an entry for each param seen across artifacts", () => {
    const artifactA = loadFixture("artifact-a.json");
    const artifactB = loadFixture("artifact-b.json");
    const map = aggregateDiscovered([artifactA, artifactB]);

    assert.ok(map instanceof Map, "aggregateDiscovered must return a Map");
    assert.ok(map.has("fbclid"), "Map must have fbclid entry");
    assert.ok(map.has("utm_source"), "Map must have utm_source entry");
  });

  test("fbclid: CSF = 2 — distinct hostnames across artifact-a and artifact-b", () => {
    const artifactA = loadFixture("artifact-a.json");
    const artifactB = loadFixture("artifact-b.json");
    const map = aggregateDiscovered([artifactA, artifactB]);

    const entry = map.get("fbclid");
    assert.ok(entry, "fbclid entry must exist");
    assert.ok(entry.hosts instanceof Set, "entry.hosts must be a Set");
    assert.strictEqual(entry.hosts.size, 2, "fbclid must have CSF 2 (ads.example.com + news.example.com)");
  });

  test("utm_source: CSF = 1 — shop.example.com deduplicated across both artifacts", () => {
    const artifactA = loadFixture("artifact-a.json");
    const artifactB = loadFixture("artifact-b.json");
    const map = aggregateDiscovered([artifactA, artifactB]);

    const entry = map.get("utm_source");
    assert.ok(entry, "utm_source entry must exist");
    assert.strictEqual(
      entry.hosts.size,
      1,
      "utm_source must have CSF 1 (shop.example.com appears in both artifacts but is deduplicated)"
    );
  });

  test("fbclid: entropy accumulator sums 3.2 + 4.1 with entCount = 2", () => {
    const artifactA = loadFixture("artifact-a.json");
    const artifactB = loadFixture("artifact-b.json");
    const map = aggregateDiscovered([artifactA, artifactB]);

    const entry = map.get("fbclid");
    assert.ok(entry, "fbclid entry must exist");
    assert.strictEqual(entry.entCount, 2, "entCount must be 2 (both artifacts have value_entropy)");
    assert.ok(
      Math.abs(entry.entSum - (3.2 + 4.1)) < 1e-9,
      `entSum must equal 3.2 + 4.1 = 7.3, got ${entry.entSum}`
    );
  });

  test("artifact without value_entropy: entCount stays 0 for that param", () => {
    const noEntropy = loadFixture("artifact-no-entropy.json");
    const map = aggregateDiscovered([noEntropy]);

    const entry = map.get("ref");
    assert.ok(entry, "ref entry must exist");
    assert.strictEqual(entry.entCount, 0, "entCount must be 0 when no value_entropy field present");
  });

  test("anti-poison: param present in two artifacts, value_entropy in only one — mean uses only the present value", () => {
    const withEntropy = {
      discovered_at: "2026-05-01T00:00:00Z",
      crawler_version: "abc1234",
      corpus: ["one.example.com"],
      candidates: [
        { param: "track_id", first_seen_on: "one.example.com", injected_by: "wrapper-x", occurrence_count: 2, value_entropy: 3.8 },
      ],
      signature: "ab".repeat(64),
    };
    const withoutEntropy = {
      discovered_at: "2026-05-08T00:00:00Z",
      crawler_version: "def5678",
      corpus: ["two.example.com"],
      candidates: [
        { param: "track_id", first_seen_on: "two.example.com", injected_by: "wrapper-y", occurrence_count: 1 },
      ],
      signature: "cd".repeat(64),
    };
    const map = aggregateDiscovered([withEntropy, withoutEntropy]);

    const entry = map.get("track_id");
    assert.ok(entry, "track_id entry must exist");
    assert.strictEqual(entry.hosts.size, 2, "CSF must count both hostnames");
    assert.strictEqual(entry.entCount, 1, "entropy count must ignore the artifact lacking value_entropy");
    assert.ok(
      Math.abs(entry.entSum - 3.8) < 1e-9,
      `mean source must be 3.8 alone — the field-less mention must not halve it (entSum ${entry.entSum})`
    );
  });

  test("empty artifacts array returns empty Map without throwing", () => {
    assert.doesNotThrow(() => {
      const map = aggregateDiscovered([]);
      assert.ok(map instanceof Map, "must return a Map");
      assert.strictEqual(map.size, 0, "Map must be empty");
    });
  });

  test("artifacts with empty candidates arrays produce no entries", () => {
    const emptyArtifact = {
      discovered_at: "2026-05-01T00:00:00Z",
      crawler_version: "abc1234",
      corpus: ["example.com"],
      candidates: [],
      signature: "ab".repeat(64),
    };
    const map = aggregateDiscovered([emptyArtifact]);
    assert.strictEqual(map.size, 0, "Map must be empty for artifact with no candidates");
  });
});

// ---------------------------------------------------------------------------
// Section B — enrichCandidates (pure function)
// ---------------------------------------------------------------------------

describe("enrichCandidates — entropy mean and crossSiteFrequency from aggregate", () => {
  test("fbclid: entropy = 3.65 (mean of 3.2 and 4.1)", () => {
    const artifactA = loadFixture("artifact-a.json");
    const artifactB = loadFixture("artifact-b.json");
    const artifacts = [artifactA, artifactB];
    const candidates = [
      { param: "fbclid", signals: ["adguard-tp"], entropy: null, crossSiteFrequency: null, firstSeenAt: "2026-01-01T00:00:00Z" },
    ];
    const enriched = enrichCandidates(candidates, artifacts);

    assert.strictEqual(enriched.length, 1, "enriched must have same length as input");
    const c = enriched[0];
    assert.ok(
      Math.abs(c.entropy - 3.65) < 1e-9,
      `fbclid entropy must be 3.65, got ${c.entropy}`
    );
  });

  test("utm_source: crossSiteFrequency = 1 (deduplicated)", () => {
    const artifactA = loadFixture("artifact-a.json");
    const artifactB = loadFixture("artifact-b.json");
    const artifacts = [artifactA, artifactB];
    const candidates = [
      { param: "utm_source", signals: ["adguard-tp"], entropy: null, crossSiteFrequency: null, firstSeenAt: "2026-01-01T00:00:00Z" },
    ];
    const enriched = enrichCandidates(candidates, artifacts);

    assert.strictEqual(enriched[0].crossSiteFrequency, 1, "utm_source CSF must be 1 (deduped)");
  });

  test("utm_source: entropy = 3.2 (mean of 2.8 and 3.6)", () => {
    const artifactA = loadFixture("artifact-a.json");
    const artifactB = loadFixture("artifact-b.json");
    const artifacts = [artifactA, artifactB];
    const candidates = [
      { param: "utm_source", signals: ["adguard-tp"], entropy: null, crossSiteFrequency: null, firstSeenAt: "2026-01-01T00:00:00Z" },
    ];
    const enriched = enrichCandidates(candidates, artifacts);

    assert.ok(
      Math.abs(enriched[0].entropy - 3.2) < 1e-9,
      `utm_source entropy must be 3.2, got ${enriched[0].entropy}`
    );
  });

  test("ref: entropy = null when no value_entropy in any artifact mentioning it", () => {
    const noEntropy = loadFixture("artifact-no-entropy.json");
    const artifacts = [noEntropy];
    const candidates = [
      { param: "ref", signals: ["adguard-tp"], entropy: null, crossSiteFrequency: null, firstSeenAt: "2026-01-01T00:00:00Z" },
    ];
    const enriched = enrichCandidates(candidates, artifacts);

    assert.strictEqual(enriched[0].entropy, null, "entropy must be null when no value_entropy present");
  });

  test("ref: crossSiteFrequency = 1 even without value_entropy", () => {
    const noEntropy = loadFixture("artifact-no-entropy.json");
    const artifacts = [noEntropy];
    const candidates = [
      { param: "ref", signals: ["adguard-tp"], entropy: null, crossSiteFrequency: null, firstSeenAt: "2026-01-01T00:00:00Z" },
    ];
    const enriched = enrichCandidates(candidates, artifacts);

    assert.strictEqual(enriched[0].crossSiteFrequency, 1, "CSF must still be 1 for ref even without value_entropy");
  });

  test("param absent from all artifacts → entropy: null, crossSiteFrequency: null", () => {
    const artifactA = loadFixture("artifact-a.json");
    const artifacts = [artifactA];
    const candidates = [
      { param: "unknown_param_xyz", signals: ["adguard-tp"], entropy: null, crossSiteFrequency: null, firstSeenAt: "2026-01-01T00:00:00Z" },
    ];
    const enriched = enrichCandidates(candidates, artifacts);

    assert.strictEqual(enriched[0].entropy, null, "entropy must be null for absent param");
    assert.strictEqual(enriched[0].crossSiteFrequency, null, "crossSiteFrequency must be null for absent param");
  });

  test("empty artifacts array → all candidates remain null/null", () => {
    const candidates = [
      { param: "fbclid", signals: ["adguard-tp"], entropy: null, crossSiteFrequency: null, firstSeenAt: "2026-01-01T00:00:00Z" },
    ];
    const enriched = enrichCandidates(candidates, []);

    assert.strictEqual(enriched[0].entropy, null, "entropy must be null with empty artifacts");
    assert.strictEqual(enriched[0].crossSiteFrequency, null, "crossSiteFrequency must be null with empty artifacts");
  });

  test("returns a new array — does not mutate original candidates", () => {
    const artifactA = loadFixture("artifact-a.json");
    const original = { param: "fbclid", signals: ["adguard-tp"], entropy: null, crossSiteFrequency: null, firstSeenAt: "2026-01-01T00:00:00Z" };
    const candidates = [original];
    const enriched = enrichCandidates(candidates, [artifactA]);

    assert.notStrictEqual(enriched, candidates, "must return a new array");
    assert.notStrictEqual(enriched[0], original, "must return new candidate objects");
    assert.strictEqual(original.entropy, null, "original must not be mutated");
    assert.strictEqual(original.crossSiteFrequency, null, "original must not be mutated");
  });

  test("multiple candidates are all enriched independently", () => {
    const artifactA = loadFixture("artifact-a.json");
    const artifactB = loadFixture("artifact-b.json");
    const artifacts = [artifactA, artifactB];
    const candidates = [
      { param: "fbclid", signals: ["adguard-tp"], entropy: null, crossSiteFrequency: null, firstSeenAt: "2026-01-01T00:00:00Z" },
      { param: "utm_source", signals: ["adguard-tp"], entropy: null, crossSiteFrequency: null, firstSeenAt: "2026-01-01T00:00:00Z" },
    ];
    const enriched = enrichCandidates(candidates, artifacts);

    assert.strictEqual(enriched.length, 2);
    assert.ok(enriched[0].entropy !== null, "fbclid entropy must be populated");
    assert.ok(enriched[1].entropy !== null, "utm_source entropy must be populated");
    assert.strictEqual(enriched[0].crossSiteFrequency, 2, "fbclid CSF must be 2");
    assert.strictEqual(enriched[1].crossSiteFrequency, 1, "utm_source CSF must be 1");
  });
});

// ---------------------------------------------------------------------------
// Section C — readVerifiedArtifacts (thin I/O wrapper)
// ---------------------------------------------------------------------------

describe("readVerifiedArtifacts — thin fs wrapper with injectable verify", () => {
  test("happy path: reads all JSON files and returns verified artifacts", () => {
    const dir = makeTmpDir();
    const artifact = {
      discovered_at: "2026-05-01T00:00:00Z",
      crawler_version: "abc1234",
      corpus: ["example.com"],
      candidates: [
        {
          param: "fbclid",
          first_seen_on: "example.com",
          injected_by: "meta-pixel",
          occurrence_count: 5,
          value_entropy: 2.5,
        },
      ],
      signature: "ab".repeat(64),
    };
    writeTmpJson(dir, "artifact-ok.json", artifact);

    // Inject a verify stub that always succeeds
    const verifyStub = () => ({ ok: true, code: "OK" });
    const results = readVerifiedArtifacts(dir, { verify: verifyStub });

    assert.ok(Array.isArray(results), "must return an array");
    assert.strictEqual(results.length, 1, "must return 1 artifact");
    assert.strictEqual(results[0].crawler_version, "abc1234");
  });

  test("empty dir returns empty array without throwing", () => {
    const dir = makeTmpDir();
    const verifyStub = () => ({ ok: true, code: "OK" });

    assert.doesNotThrow(() => {
      const results = readVerifiedArtifacts(dir, { verify: verifyStub });
      assert.deepStrictEqual(results, [], "must return empty array for empty dir");
    });
  });

  test("non-JSON files are ignored (only *.json files are read)", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "readme.txt"), "ignored", "utf8");
    writeFileSync(join(dir, "notes.md"), "also ignored", "utf8");

    const verifyStub = () => ({ ok: true, code: "OK" });
    const results = readVerifiedArtifacts(dir, { verify: verifyStub });
    assert.deepStrictEqual(results, []);
  });

  test("JSON parse failure: warns and skips the file (does NOT throw or abort)", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "malformed.json"), "{ invalid json !!!", "utf8");

    const verifyStub = () => ({ ok: true, code: "OK" });

    // Should not throw — malformed JSON must be skipped with a warning
    assert.doesNotThrow(() => {
      const results = readVerifiedArtifacts(dir, { verify: verifyStub });
      assert.deepStrictEqual(results, [], "malformed file must be skipped → empty result");
    });
  });

  test("verify failure (sig tamper): throws CliError (fail-closed, exit 3)", () => {
    const dir = makeTmpDir();
    const artifact = {
      discovered_at: "2026-05-01T00:00:00Z",
      crawler_version: "abc1234",
      corpus: ["example.com"],
      candidates: [],
      signature: "ab".repeat(64),
    };
    writeTmpJson(dir, "tampered.json", artifact);

    // Inject a verify stub that always fails (simulates signature mismatch)
    const verifyStub = () => ({ ok: false, code: "ERR_SIGNATURE_INVALID" });

    assert.throws(
      () => readVerifiedArtifacts(dir, { verify: verifyStub }),
      (err) => {
        assert.ok(err instanceof Error, "must throw an Error");
        assert.ok(
          err.exitCode === 3 || (err.message && err.message.includes("3")),
          `CliError must have exitCode 3 or mention exit 3, got exitCode=${err.exitCode}`
        );
        return true;
      },
      "readVerifiedArtifacts must throw (fail-closed) on verify failure"
    );
  });

  test("one valid + one tampered: throws on tampered before processing continues", () => {
    const dir = makeTmpDir();
    const validArtifact = {
      discovered_at: "2026-05-01T00:00:00Z",
      crawler_version: "abc1234",
      corpus: ["example.com"],
      candidates: [],
      signature: "ab".repeat(64),
    };
    writeTmpJson(dir, "valid.json", validArtifact);
    writeTmpJson(dir, "tampered.json", { ...validArtifact, crawler_version: "bad0000" });

    const verifyStub = (artifact) => {
      // Fail on the tampered artifact
      if (artifact.crawler_version === "bad0000") {
        return { ok: false, code: "ERR_SIGNATURE_INVALID" };
      }
      return { ok: true, code: "OK" };
    };

    assert.throws(
      () => readVerifiedArtifacts(dir, { verify: verifyStub }),
      /exit.*3|exitCode.*3/i,
      "must throw CliError on any verify failure"
    );
  });

  test("one valid + one malformed JSON: returns valid, skips malformed (no throw)", () => {
    const dir = makeTmpDir();
    const validArtifact = {
      discovered_at: "2026-05-01T00:00:00Z",
      crawler_version: "abc1234",
      corpus: ["good.example.com"],
      candidates: [],
      signature: "ab".repeat(64),
    };
    writeTmpJson(dir, "valid.json", validArtifact);
    writeFileSync(join(dir, "bad.json"), "not json!!!", "utf8");

    const verifyStub = () => ({ ok: true, code: "OK" });

    assert.doesNotThrow(() => {
      const results = readVerifiedArtifacts(dir, { verify: verifyStub });
      assert.strictEqual(results.length, 1, "must return only the valid artifact");
      assert.strictEqual(results[0].corpus[0], "good.example.com");
    });
  });
});
