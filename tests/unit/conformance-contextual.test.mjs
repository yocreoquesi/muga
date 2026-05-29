/**
 * MUGA — CAPS-Contextual conformance harness (issue #543).
 *
 * Drives every vector in caps-spec/test-vectors/contextual.json through
 * MUGA's processUrl and asserts that:
 *
 *   - every param listed in expected.preservedParams IS present in the
 *     cleaned URL with the expected value (the affiliate / creator-referral
 *     contract), and
 *   - every param listed in expected.removedParams is NOT present in the
 *     cleaned URL (the bounded-scope strip contract).
 *
 * Only those two contracts are asserted: the spec's `decision` array and
 * `notes` are validator-internal metadata that MUGA's processUrl does not
 * surface at all (it returns a cleaned URL string + summary). Asserting on
 * them would tie this harness to a specific implementation strategy rather
 * than to the observable behaviour the spec defines for adopters.
 *
 * If any vector fails here, MUGA does NOT conform at the Contextual level
 * and the README badge / CONFORMANCE.md must NOT claim it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { processUrl } from "../../src/lib/cleaner.js";
import { PREF_DEFAULTS } from "../../src/lib/storage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = join(__dirname, "..", "..", "tests", "rules-vectors", "contextual.json");
const VECTORS = JSON.parse(readFileSync(VECTORS_PATH, "utf8"));

function paramsOf(urlString) {
  // Parse with the URL API; fall back to the raw string if parsing fails.
  try {
    const u = new URL(urlString);
    return u.searchParams;
  } catch {
    return new URLSearchParams();
  }
}

for (const vector of VECTORS) {
  test(`CAPS-Contextual: ${vector.name}`, () => {
    const result = processUrl(vector.input.url, PREF_DEFAULTS);
    const params = paramsOf(result.cleanUrl);

    for (const expected of vector.expected.preservedParams ?? []) {
      const actual = params.get(expected.name);
      assert.equal(
        actual,
        expected.value,
        `[${vector.name}] preservedParams: expected ${expected.name}=${JSON.stringify(expected.value)} in cleaned URL, got ${JSON.stringify(actual)}.\n  cleanUrl=${result.cleanUrl}\n  citation=${vector.citation}`,
      );
    }

    for (const removed of vector.expected.removedParams ?? []) {
      assert.equal(
        params.has(removed.name),
        false,
        `[${vector.name}] removedParams: ${removed.name} should be stripped, but cleaned URL still has it.\n  cleanUrl=${result.cleanUrl}\n  citation=${vector.citation}`,
      );
    }

    // Network-redirect short-circuit (SPEC §3.2 step 6): when the host is a
    // wrapper, the contextual rule MUST NOT fire. The vector's expected
    // preserved/removed are both empty, so the loops above are vacuous; this
    // extra assertion makes the conformance claim genuine by requiring that
    // every PARAM_PAIRS-listed param present in the input survives.
    if (vector.name === "network-redirect-host-bypasses-contextual") {
      const inputParams = paramsOf(vector.input.url);
      const PAIRS_LOWER = ["pid", "icid", "icmp", "cmp", "nlid", "soc_src"];
      for (const name of inputParams.keys()) {
        if (!PAIRS_LOWER.includes(name.toLowerCase())) continue;
        assert.equal(
          params.has(name),
          true,
          `[${vector.name}] network-redirect short-circuit: ${name} must survive on wrapper hosts (the bounded-scope rule MUST short-circuit per SPEC §3.2 step 6).\n  cleanUrl=${result.cleanUrl}`,
        );
      }
    }
  });
}
