/**
 * MUGA — missing-translations smoke test (#361)
 *
 * Validates the diff tool's output format. Uses the live TRANSLATIONS
 * for the structural shape checks, not a fixture, because the tool's
 * value is precisely about producing stable output for the live data.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { missingKeys, formatReport } from "../../tools/missing-translations.mjs";

describe("missing-translations — missingKeys()", () => {
  test("returns an array", () => {
    assert.ok(Array.isArray(missingKeys("pt")));
    assert.ok(Array.isArray(missingKeys("de")));
  });

  test("returns deterministically (idempotent — same input, same output)", () => {
    const a = missingKeys("pt");
    const b = missingKeys("pt");
    assert.deepEqual(a, b);
  });

  test("returns no entries for the EN baseline (every key has en)", () => {
    // Reuses the same logic but against EN — should never report missing.
    // The completeness test (#359) enforces this floor; this is a
    // double-check that missingKeys treats EN consistently.
    const en = missingKeys("en");
    assert.equal(en.length, 0);
  });

  test("unknown locale returns ALL keys (no entry for that locale anywhere)", () => {
    const fake = missingKeys("xx");
    // Must report every key, since no entry has an "xx" slot.
    assert.ok(fake.length > 0);
  });
});

describe("missing-translations — formatReport()", () => {
  test("returns a non-empty markdown string for PT", () => {
    const out = formatReport("pt");
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
    assert.ok(out.startsWith("# PT translations needed"));
  });

  test("returns a non-empty markdown string for DE", () => {
    const out = formatReport("de");
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
    assert.ok(out.startsWith("# DE translations needed"));
  });

  test("output is deterministic across calls", () => {
    const a = formatReport("pt");
    const b = formatReport("pt");
    assert.equal(a, b);
  });

  test("output mentions the regenerate command", () => {
    const out = formatReport("pt");
    assert.ok(out.includes("node tools/missing-translations.mjs pt"));
  });

  test("output does NOT contain unresolved template placeholders", () => {
    const out = formatReport("pt");
    assert.ok(!out.includes("${langLabel}"), "Found unresolved ${langLabel} placeholder");
    assert.ok(!out.includes("${lang}"), "Found unresolved ${lang} placeholder");
  });
});
