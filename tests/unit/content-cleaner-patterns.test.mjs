/**
 * MUGA — Tests for content script patterns (cleaner.js)
 *
 * Verifies rewrite loop eviction strategy and MutationObserver optimization
 * by reading source code patterns.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cleanerSource = readFileSync(join(__dirname, "../../src/content/cleaner.js"), "utf8");

// ── Rewrite loop eviction ────────────────────────────────────────────────────

describe("Rewrite loop — time-based eviction", () => {
  test("evicts stale entries older than 2s", () => {
    assert.ok(
      cleanerSource.includes("now - val.firstTs > 2000"),
      "should delete entries older than 2000ms"
    );
  });

  test("starts eviction scan at a reasonable threshold", () => {
    assert.ok(
      cleanerSource.includes("_rewriteLog.size > 50"),
      "should trigger eviction scan when map exceeds 50 entries"
    );
  });

  test("keeps safety cap at 200 entries after eviction", () => {
    assert.ok(
      cleanerSource.includes("_rewriteLog.size > 200"),
      "should bulk-clear as safety net if still over 200 after eviction"
    );
  });

  test("does not bulk-clear as first resort", () => {
    // The eviction loop (delete stale) should appear BEFORE the safety-cap clear
    const evictPos = cleanerSource.indexOf("now - val.firstTs > 2000");
    const clearPos = cleanerSource.indexOf("_rewriteLog.size > 200");
    assert.ok(evictPos < clearPos, "time-based eviction should run before safety-cap clear");
  });
});

// ── MutationObserver ping blocking optimization ──────────────────────────────

describe("MutationObserver — ping blocking debounce", () => {
  test("handles attribute changes immediately (not batched)", () => {
    // Attribute ping removal must be synchronous to prevent clicks
    // before the next animation frame
    const observerBlock = cleanerSource.slice(
      cleanerSource.indexOf("new MutationObserver"),
      cleanerSource.indexOf("observer.observe")
    );
    const attrCheckPos = observerBlock.indexOf('"attributes"');
    const rafPos = observerBlock.indexOf("requestAnimationFrame");
    assert.ok(
      attrCheckPos < rafPos,
      "attribute removal should happen before rAF batching"
    );
  });

  test("batches childList mutations via requestAnimationFrame", () => {
    assert.ok(
      cleanerSource.includes("requestAnimationFrame"),
      "should use rAF to batch new-node ping removal"
    );
  });

  test("deduplicates rAF calls", () => {
    assert.ok(
      cleanerSource.includes("_pingBatchId"),
      "should track pending rAF to avoid duplicate scheduling"
    );
  });
});
