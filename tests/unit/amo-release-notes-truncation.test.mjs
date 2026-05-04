/**
 * MUGA: AMO release_notes truncation invariant
 *
 * Mozilla's Add-ons API rejects version submissions whose release_notes
 * exceed 3000 characters with `WebExtError: Submission failed (2): Bad
 * Request`. v1.13.0 hit exactly this — the CHANGELOG slice was 4938 chars
 * and the AMO upload silently failed under `continue-on-error: true`.
 *
 * truncateForAmo() is the single chokepoint that enforces the cap before
 * the bytes ever leave CI. These tests pin its contract so a future
 * "improvement" to release notes formatting can't reintroduce the bug.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  truncateForAmo,
  AMO_RELEASE_NOTES_HARD_LIMIT,
} from "../../tools/amo-build-metadata.mjs";

describe("AMO release_notes — truncation contract", () => {
  test("short input is returned unchanged (modulo trailing whitespace)", () => {
    const input = "Bug fixes and improvements.";
    assert.equal(truncateForAmo(input, "1.0.0"), input);
  });

  test("input at the budget boundary is returned unchanged", () => {
    const input = "x".repeat(2900);
    assert.equal(truncateForAmo(input, "1.0.0"), input);
  });

  test("oversized input is truncated below the AMO 3000-char hard limit", () => {
    const input = "x".repeat(10000);
    const out = truncateForAmo(input, "1.13.0");
    assert.ok(
      out.length < AMO_RELEASE_NOTES_HARD_LIMIT,
      `expected < ${AMO_RELEASE_NOTES_HARD_LIMIT}, got ${out.length}`,
    );
  });

  test("truncated output ends with a link to the GitHub Release tag for the version", () => {
    const input = "line\n".repeat(2000);
    const out = truncateForAmo(input, "1.13.0");
    assert.match(
      out,
      /https:\/\/github\.com\/yocreoquesi\/muga\/releases\/tag\/v1\.13\.0$/,
    );
  });

  test("realistic v1.13.0-shaped CHANGELOG (4938 chars) stays under the AMO cap", () => {
    // Realistic shape: many short bulleted lines, like the actual v1.13.0
    // entry that broke the upload. The exact text doesn't matter — what
    // matters is the size and the line-break density.
    const input =
      "PRD #529 first wave — adaptive URL coverage expansion.\n" +
      "- bullet line about a feature with file paths and issue refs (#530)\n".repeat(80);
    assert.ok(input.length > 3000, "test fixture must exceed the AMO cap to be meaningful");
    const out = truncateForAmo(input, "1.13.0");
    assert.ok(out.length < AMO_RELEASE_NOTES_HARD_LIMIT);
    assert.match(out, /releases\/tag\/v1\.13\.0$/);
  });

  test("truncates at a newline boundary when one is available within budget", () => {
    const input = "first paragraph.\n" + "x".repeat(5000);
    const out = truncateForAmo(input, "9.9.9");
    // Should preserve "first paragraph." intact, not slice mid-word.
    assert.ok(out.startsWith("first paragraph."));
  });
});
