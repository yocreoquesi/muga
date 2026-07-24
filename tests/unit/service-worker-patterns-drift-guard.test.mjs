/**
 * MUGA — Drift guard for source-string assertions in
 * tests/unit/service-worker-patterns.test.mjs (#706 follow-up).
 *
 * The audit (#706) flagged that the service-worker-patterns test file
 * relies heavily on `swSource.includes(...)` / `.indexOf(...)` / `.slice(...)`
 * / `.match(...)` to assert the existence of code in `service-worker.js`.
 * This pattern creates zombie code: dead functions and fields stay alive
 * because deleting them would break the assertions. A future contributor
 * who tries to clean up sees red tests and reintroduces the zombie "to
 * fix the test."
 *
 * This guard freezes the count of source-string assertions at the post-#706
 * baseline. New behavioral tests (no swSource manipulation) are always OK;
 * new source-string assertions require an explicit baseline bump in this
 * file along with a justification.
 *
 * If you legitimately need to add a new source-string assertion (rare —
 * prefer a behavioral test), update `MAX_SOURCE_STRING_ASSERTIONS` below
 * and document WHY in the commit message. The reviewer should push back
 * on every increment.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATTERNS_TEST_PATH = join(
  __dirname,
  "service-worker-patterns.test.mjs",
);

// Baseline count after #706 cleanup. Decrement is always allowed
// (behavioral migration of an existing assertion). Increment requires a
// human override of this constant + commit-message rationale.
// 70 → 71 (#739): added ONE source-string match guarding the new
// mugaPerDevicePrefs cache-invalidation branch in the onChanged listener.
// service-worker.js cannot be imported in Node (top-level chrome.* calls), so
// a single regex match is the least-brittle available regression for it.
// 71 → 72 (Update now / FORCE_FETCH_REMOTE_RULES): added ONE source-string
// guard confirming the SW defines the new message handler. The (a)/(b)/(c)
// gate coverage itself is a behavioral test against a pure
// forceFetchRemoteRules() mirror function, not a source-string assertion.
// 72 → 74 (cookie-consent-accept Slice 2a): added TWO source-string guards
// confirming the getPrefs handler imports settings-schema.js's
// isCookieConsentModeActive and computes the modeActive gate-wiring field
// from it. service-worker.js still cannot be imported in Node, so this
// stays source-text until a future SW behavioral-harness migration.
const MAX_SOURCE_STRING_ASSERTIONS = 74;

const SOURCE_STRING_PATTERN = /swSource\.(includes|indexOf|slice|match)\(/g;

describe("#706 — source-string assertion drift guard", () => {
  test(`service-worker-patterns.test.mjs has at most ${MAX_SOURCE_STRING_ASSERTIONS} swSource.* assertions`, () => {
    const source = readFileSync(PATTERNS_TEST_PATH, "utf8");
    const matches = source.match(SOURCE_STRING_PATTERN) || [];
    assert.ok(
      matches.length <= MAX_SOURCE_STRING_ASSERTIONS,
      `service-worker-patterns.test.mjs has ${matches.length} swSource.{includes,indexOf,slice,match}() calls, ` +
        `but the post-#706 baseline is ${MAX_SOURCE_STRING_ASSERTIONS}. ` +
        `New source-string assertions create zombie code (#706). ` +
        `Prefer a behavioral test. If a new source-string assertion is genuinely the right tool, ` +
        `update MAX_SOURCE_STRING_ASSERTIONS in this file and explain the rationale in the commit.`,
    );
  });

  test("the drift guard's baseline does not silently outpace the actual count", () => {
    // Reverse check: if MAX is raised but the file shrinks, the constant
    // is now wrong and someone forgot to drop it back down. This isn't
    // load-bearing — just keeps the baseline honest as cleanups land.
    const source = readFileSync(PATTERNS_TEST_PATH, "utf8");
    const matches = source.match(SOURCE_STRING_PATTERN) || [];
    const slack = MAX_SOURCE_STRING_ASSERTIONS - matches.length;
    assert.ok(
      slack <= 5,
      `Baseline (${MAX_SOURCE_STRING_ASSERTIONS}) is ${slack} above the actual count (${matches.length}). ` +
        `If a recent PR migrated source-string assertions to behavioral tests, ` +
        `lower MAX_SOURCE_STRING_ASSERTIONS to ${matches.length} to keep the guard tight.`,
    );
  });
});
