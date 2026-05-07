/**
 * MUGA: Relative-time formatting tests (#453, B20 Group A)
 *
 * Tests formatRelativeTime(fetchedAt, lang) for all 5 time branches
 * across English and Spanish locales.
 *
 * The function is extracted to src/lib/relative-time.js for testability,
 * mirroring the mode-label.js pattern (pure function, no DOM globals).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatRelativeTime } from "../../src/lib/relative-time.js";

const NOW = Date.now();

/** Returns a timestamp N milliseconds in the past. */
function msAgo(ms) {
  return NOW - ms;
}

describe("formatRelativeTime — en locale", () => {
  test("returns null-safe dash for null/undefined input", () => {
    assert.strictEqual(formatRelativeTime(null, "en"), "—");
    assert.strictEqual(formatRelativeTime(undefined, "en"), "—");
    assert.strictEqual(formatRelativeTime(0, "en"), "—");
  });

  test("'just now' for < 2 minutes ago", () => {
    const result = formatRelativeTime(msAgo(60_000), "en"); // 1 minute ago
    assert.strictEqual(result, "just now");
  });

  test("'N minutes ago' for 2–59 minutes ago", () => {
    const result5 = formatRelativeTime(msAgo(5 * 60_000), "en"); // 5 minutes ago
    assert.strictEqual(result5, "5 minutes ago");

    const result30 = formatRelativeTime(msAgo(30 * 60_000), "en"); // 30 minutes ago
    assert.strictEqual(result30, "30 minutes ago");
  });

  test("'N hours ago' for 1–23 hours ago", () => {
    const result3 = formatRelativeTime(msAgo(3 * 3600_000), "en"); // 3 hours ago
    assert.strictEqual(result3, "3 hours ago");
  });

  test("'yesterday' for 24–47 hours ago", () => {
    const result = formatRelativeTime(msAgo(30 * 3600_000), "en"); // 30 hours ago
    assert.strictEqual(result, "yesterday");
  });

  test("'N days ago' for 48+ hours ago", () => {
    const result3 = formatRelativeTime(msAgo(3 * 24 * 3600_000), "en"); // 3 days ago
    assert.strictEqual(result3, "3 days ago");
  });
});

describe("formatRelativeTime — es locale", () => {
  test("'hace un momento' for < 2 minutes ago", () => {
    const result = formatRelativeTime(msAgo(60_000), "es");
    assert.strictEqual(result, "hace un momento");
  });

  test("'hace N minutos' for 2–59 minutes ago", () => {
    const result = formatRelativeTime(msAgo(10 * 60_000), "es"); // 10 minutes ago
    assert.strictEqual(result, "hace 10 minutos");
  });

  test("'hace N horas' for 1–23 hours ago", () => {
    const result = formatRelativeTime(msAgo(5 * 3600_000), "es"); // 5 hours ago
    assert.strictEqual(result, "hace 5 horas");
  });

  test("'ayer' for 24–47 hours ago", () => {
    const result = formatRelativeTime(msAgo(36 * 3600_000), "es"); // 36 hours ago
    assert.strictEqual(result, "ayer");
  });

  test("'hace N días' for 48+ hours ago", () => {
    const result = formatRelativeTime(msAgo(4 * 24 * 3600_000), "es"); // 4 days ago
    assert.strictEqual(result, "hace 4 días");
  });
});
