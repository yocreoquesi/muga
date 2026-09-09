/**
 * MUGA — the "N+ tracking patterns" claim must be true (#1259)
 *
 * Run with: npm test
 *
 * Every user-facing surface claimed "450+ tracking patterns" while
 * TRACKING_PARAMS held 447. "450+" asserts AT LEAST 450, so the claim was
 * false by three, in all 7 locales, on the first screen of every install, and
 * in the docs site's meta description and structured data.
 *
 * The number was retyped by hand on each surface, which is why it drifted past
 * the real count without anyone noticing: nothing connected the sentence to
 * the list it describes. This test is that connection.
 *
 * Scope note: this pins the COUNT only. The wider copy question #1259 raises,
 * that "every URL" and "leaving none behind" state best-effort coverage as
 * absolute, is a separate call about product voice and is deliberately not
 * decided here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { TRACKING_PARAMS } from "../../src/lib/affiliates-data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const LOCALES_DIR = join(ROOT, "src/lib/locales");

/** Surfaces that state the count to a user. */
const SURFACES = [
  ...readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".mjs")).map((f) => `src/lib/locales/${f}`),
  "src/onboarding/onboarding.html",
  "docs/index.html",
  "docs/transparency.html",
];

/**
 * Finds every "AT LEAST N" claim in a surface.
 *
 * Matches the claim FORMS rather than bare numbers, because "at least" is the
 * part that can be false. A first version of this matched any 3-digit number
 * and flagged CSS font weights (600, 700), a max-width (631) and the issue
 * reference "#888" as overstated pattern counts. Those are not claims about
 * anything, and a test that cries wolf on them would have been turned off.
 *
 * The claim appears in four renderings across the 7 locales -- "440+",
 * "plus de 440", "oltre 440", "440以上" -- and in docs/index.html the digits and
 * the "+" are split across two HTML elements, so the "+" form tolerates markup
 * in between.
 */
function countClaims(text) {
  const forms = [
    /(\d{3})\s*(?:<[^>]+>\s*)*\+/g,     // 440+  and  440<span class="u">+</span>
    /(?:plus de|oltre|más de|mais de|mehr als)\s+(\d{3})/gi,
    /(\d{3})\s*以上/g,
  ];
  const found = [];
  for (const re of forms) {
    for (const m of text.matchAll(re)) found.push(Number(m[1]));
  }
  return found;
}

describe("#1259 — no surface claims more tracking patterns than exist", () => {

  const actual = TRACKING_PARAMS.length;

  test("TRACKING_PARAMS is a non-trivial list", () => {
    // Guards the assertions below: if this import ever resolved to an empty
    // array, every claim would trivially fail rather than silently pass, but
    // the failure would be confusing. Fail here first, with a clear reason.
    assert.ok(actual > 100, `expected a real param list, got ${actual}`);
  });

  for (const surface of SURFACES) {
    test(`${surface}: every "N+" pattern claim is <= ${actual}`, () => {
      const text = readFileSync(join(ROOT, surface), "utf8");
      const claims = countClaims(text);
      const overstated = [...new Set(claims)].filter((n) => n > actual);

      assert.deepEqual(
        overstated, [],
        `${surface} claims at least ${overstated.join(", ")} tracking patterns, but ` +
        `TRACKING_PARAMS holds ${actual}. A "N+" claim asserts AT LEAST N, so this ` +
        `sentence is false. Lower the number, or add params until it is true.`,
      );
    });
  }

  test("the claim is not so stale it undersells the list either", () => {
    // The opposite drift is not a lie, but it does mean the number stopped
    // tracking reality. 60 is wide enough to survive ordinary harvests without
    // churn, and narrow enough that a doubled list gets noticed.
    const en = readFileSync(join(ROOT, "src/lib/locales/en.mjs"), "utf8");
    const claims = countClaims(en);
    assert.ok(claims.length > 0, "en.mjs must still state a count");
    const stated = Math.max(...claims);
    assert.ok(
      actual - stated < 60,
      `en.mjs claims ${stated} but TRACKING_PARAMS holds ${actual}; the claim has ` +
      `fallen ${actual - stated} behind and should be raised.`,
    );
  });
});
