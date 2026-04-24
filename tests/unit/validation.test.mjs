/**
 * MUGA — Unit tests for src/lib/validation.js
 *
 * Verifies isValidListEntry covers all documented formats and rejects
 * invalid input. These tests use the shared module directly so any
 * change to validation logic is immediately caught here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { isValidListEntry } from "../../src/lib/validation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALIDATION_SOURCE = readFileSync(
  join(__dirname, "../../src/lib/validation.js"),
  "utf8"
);
const SW_SOURCE = readFileSync(
  join(__dirname, "../../src/background/service-worker.js"),
  "utf8"
);
const OPTIONS_SOURCE = readFileSync(
  join(__dirname, "../../src/options/options.js"),
  "utf8"
);

// ── Module exports ───────────────────────────────────────────────────────────

describe("validation.js — module shape", () => {
  test("exports isValidListEntry as a named export", () => {
    assert.ok(
      VALIDATION_SOURCE.includes("export function isValidListEntry("),
      "isValidListEntry must be a named export"
    );
  });

  test("service-worker imports isValidListEntry from lib/validation.js", () => {
    assert.ok(
      SW_SOURCE.includes('from "../lib/validation.js"'),
      "SW must import from lib/validation.js instead of defining locally"
    );
    assert.ok(
      !SW_SOURCE.includes("function isValidListEntry("),
      "SW must not contain a local isValidListEntry definition"
    );
  });

  test("options.js imports isValidListEntry from lib/validation.js", () => {
    assert.ok(
      OPTIONS_SOURCE.includes('from "../lib/validation.js"'),
      "options.js must import from lib/validation.js instead of defining locally"
    );
    assert.ok(
      !OPTIONS_SOURCE.includes("function isValidListEntry("),
      "options.js must not contain a local isValidListEntry definition"
    );
  });
});

// ── Valid entries ────────────────────────────────────────────────────────────

describe("isValidListEntry — valid formats", () => {
  test("accepts plain domain", () => {
    assert.ok(isValidListEntry("amazon.es"));
    assert.ok(isValidListEntry("booking.com"));
    assert.ok(isValidListEntry("sub.domain.co.uk"));
  });

  test("accepts domain::disabled", () => {
    assert.ok(isValidListEntry("amazon.es::disabled"));
    assert.ok(isValidListEntry("example.com::disabled"));
  });

  test("accepts domain::param::value", () => {
    assert.ok(isValidListEntry("amazon.es::tag::youtuber-21"));
    assert.ok(isValidListEntry("booking.com::aid::12345"));
    assert.ok(isValidListEntry("shop.example.com::ref::abc"));
  });

  test("accepts single-label domain", () => {
    assert.ok(isValidListEntry("localhost"));
  });

  test("accepts domain with digits", () => {
    assert.ok(isValidListEntry("example123.com"));
  });
});

// ── Invalid entries ──────────────────────────────────────────────────────────

describe("isValidListEntry — invalid formats", () => {
  test("rejects empty string", () => {
    assert.ok(!isValidListEntry(""));
  });

  test("rejects non-string types", () => {
    assert.ok(!isValidListEntry(null));
    assert.ok(!isValidListEntry(undefined));
    assert.ok(!isValidListEntry(42));
    assert.ok(!isValidListEntry([]));
    assert.ok(!isValidListEntry({}));
  });

  test("rejects string longer than 500 chars", () => {
    assert.ok(!isValidListEntry("a".repeat(501)));
  });

  test("rejects domain with special characters", () => {
    assert.ok(!isValidListEntry("amazon.es<script>"));
    assert.ok(!isValidListEntry("amazon.es;drop"));
    assert.ok(!isValidListEntry("amazon es"));
    assert.ok(!isValidListEntry("amazon.es!"));
  });

  test("rejects 2-part entry that isn't ::disabled", () => {
    assert.ok(!isValidListEntry("amazon.es::tag"));
    assert.ok(!isValidListEntry("amazon.es::something"));
    assert.ok(!isValidListEntry("amazon.es::enabled"));
  });

  test("rejects 3-part entry with empty param", () => {
    assert.ok(!isValidListEntry("amazon.es::::value"));
  });

  test("rejects 3-part entry with empty value", () => {
    assert.ok(!isValidListEntry("amazon.es::tag::"));
  });

  test("rejects 4+ parts", () => {
    assert.ok(!isValidListEntry("a::b::c::d"));
    assert.ok(!isValidListEntry("a::b::c::d::e"));
  });

  test("rejects param=value format (old format, no domain prefix)", () => {
    assert.ok(!isValidListEntry("tag=youtuber-21"));
    assert.ok(!isValidListEntry("aff=other-99"));
  });
});

// ── Boundary conditions ──────────────────────────────────────────────────────

describe("isValidListEntry — boundary conditions", () => {
  test("accepts entry at exactly 500 chars", () => {
    // Domain of 500 chars is the boundary — must be accepted
    const domain = "a".repeat(497) + ".es"; // 500 chars total
    assert.ok(isValidListEntry(domain));
  });

  test("rejects entry at exactly 501 chars", () => {
    const domain = "a".repeat(498) + ".es"; // 501 chars total
    assert.ok(!isValidListEntry(domain));
  });
});
