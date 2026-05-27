/**
 * MUGA — rules-manifest.json sync invariant (TA-3)
 *
 * Asserts that the committed src/rules/rules-manifest.json is structurally
 * consistent with the live affiliates.js source. Drift is caught at npm test
 * time so a forgotten `npm run compile:rules` doesn't silently ship stale data.
 *
 * Compares all structural fields of the v2 manifest: version + manifestVersion,
 * tracking length, prefix_rules length, all category keys, path_strip_rules
 * shape, and path_affiliate_rules shape. The manifest is byte-deterministic
 * (no timestamps or SHAs) so deepEqual against a freshly-built manifest is exact.
 *
 * Run with: node --test tests/unit/rules-manifest-sync.test.mjs
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { TRACKING_PARAMS, TRACKING_PREFIXES } from "../../src/lib/affiliates.js";
import { buildManifest } from "../../tools/generate-rules.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MANIFEST_PATH = join(__dirname, "../../src/rules/rules-manifest.json");
const VALID_CATEGORIES = new Set(["utm", "ads", "email", "social", "platform_noise", "generic"]);

// ── TA-3: Structural assertions ───────────────────────────────────────────────

describe("rules-manifest.json — structural integrity (TA-3)", () => {
  test("src/rules/rules-manifest.json exists and is valid JSON", () => {
    let raw;
    try {
      raw = readFileSync(MANIFEST_PATH, "utf8");
    } catch (err) {
      assert.fail(`rules-manifest.json not found at ${MANIFEST_PATH} — run npm run compile:rules`);
    }
    assert.doesNotThrow(() => JSON.parse(raw), "rules-manifest.json must be valid JSON");
  });

  test("version equals 2", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    assert.equal(manifest.version, 2, "version must be integer 2");
    assert.equal(manifest.manifestVersion, 2, "manifestVersion must be 2");
  });

  test("tracking length equals TRACKING_PARAMS.length", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    assert.equal(
      manifest.tracking.length,
      TRACKING_PARAMS.length,
      `tracking[] has ${manifest.tracking.length} entries but TRACKING_PARAMS has ${TRACKING_PARAMS.length}`
    );
  });

  test("every tracking[].category is one of the 6 known taxonomy keys", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    for (const entry of manifest.tracking) {
      assert.ok(
        VALID_CATEGORIES.has(entry.category),
        `tracking entry "${entry.param}" has invalid category "${entry.category}"`
      );
    }
  });

  test("path_strip_rules and path_affiliate_rules are arrays with required per-entry shape", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    assert.ok(Array.isArray(manifest.path_strip_rules), "path_strip_rules must be array");
    assert.ok(manifest.path_strip_rules.length >= 1, "path_strip_rules must have at least 1 entry");
    assert.ok(Array.isArray(manifest.path_affiliate_rules), "path_affiliate_rules must be array");
    assert.ok(manifest.path_affiliate_rules.length >= 1, "path_affiliate_rules must have at least 1 entry");
    for (const r of manifest.path_strip_rules) {
      assert.ok(typeof r.domain === "string", "strip entry must have domain string");
      assert.ok(typeof r.domainPattern === "string", "strip entry must have domainPattern string");
      assert.ok(Array.isArray(r.pathPatterns), "strip entry must have pathPatterns array");
      assert.ok(Array.isArray(r.replacements), "strip entry must have replacements array");
      assert.equal(r.pathPatterns.length, r.replacements.length, "pathPatterns and replacements must be same length");
    }
    for (const r of manifest.path_affiliate_rules) {
      assert.ok(typeof r.domain === "string", "affiliate entry must have domain string");
      assert.ok(Array.isArray(r.referralPaths), "affiliate entry must have referralPaths array");
      assert.ok(typeof r.injectPath === "string", "affiliate entry must have injectPath string");
      assert.ok(typeof r.injectParam === "string", "affiliate entry must have injectParam string");
      assert.ok(typeof r.injectValue === "string", "affiliate entry must have injectValue string");
    }
    assert.ok(!("path_rules" in manifest), "v1 path_rules key must be removed in v2");
  });

  test("prefix_rules length equals TRACKING_PREFIXES.length", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    assert.equal(
      manifest.prefix_rules.length,
      TRACKING_PREFIXES.length,
      `prefix_rules[] has ${manifest.prefix_rules.length} entries but TRACKING_PREFIXES has ${TRACKING_PREFIXES.length}`
    );
  });

  // ── #642: each prefix_rules entry carries a non-empty `note` field that
  //          matches the inline // comment in src/lib/affiliates.js. The note
  //          is the only human-readable documentation of what each prefix
  //          tracks, so its presence is load-bearing for the manifest's
  //          "documentation-grade" promise.
  test("every prefix_rules entry has a non-empty note field (#642)", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    for (const entry of manifest.prefix_rules) {
      assert.ok(
        typeof entry.note === "string" && entry.note.length > 0,
        `prefix_rules entry "${entry.prefix}" is missing a non-empty note field`
      );
    }
  });

  test("each prefix note matches the inline // comment in affiliates.js (#642)", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    const affiliatesSource = readFileSync(
      join(__dirname, "../../src/lib/affiliates.js"),
      "utf8",
    );
    const blockMatch = affiliatesSource.match(
      /export\s+const\s+TRACKING_PREFIXES\s*=\s*\[([\s\S]*?)\];/,
    );
    assert.ok(blockMatch, "TRACKING_PREFIXES block not found in affiliates.js");
    const lineRe = /^\s*"([^"]+)"\s*,\s*\/\/\s*(.+?)\s*$/gm;
    const sourceNotes = new Map();
    let m;
    while ((m = lineRe.exec(blockMatch[1])) !== null) {
      sourceNotes.set(m[1], m[2]);
    }
    for (const entry of manifest.prefix_rules) {
      const sourceNote = sourceNotes.get(entry.prefix);
      assert.equal(
        entry.note,
        sourceNote,
        `prefix_rules note for "${entry.prefix}" diverges from the inline comment in affiliates.js — run npm run compile:rules`,
      );
    }
  });
});

// ── Sync check: committed manifest matches freshly-built manifest ─────────────

describe("rules-manifest.json — sync with live affiliates.js source", () => {
  test("committed manifest is deeply equal to buildManifest() output", () => {
    const committed = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    const rebuilt = buildManifest();

    assert.deepEqual(
      committed,
      rebuilt,
      "committed rules-manifest.json is out of sync with affiliates.js — run npm run compile:rules"
    );
  });
});
