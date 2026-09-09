/**
 * MUGA — the publish smoke check actually checks something (#1267)
 *
 * `publish-rules.yml` verified its own publish with `curl --head`: a request
 * that asks whether the URL answers and nothing more. A publish that landed a
 * broken or stale payload passed by construction, because a 200 on the wrong
 * bytes is indistinguishable from a 200 on the right ones. This is the check
 * that should have caught #1251, where the workflow published nothing for
 * months while reporting green.
 *
 * The issue also read the job's targeting as wrong -- verifying "the previous
 * publish, never the one it just triggered". It is not. A run that publishes
 * opens a PR that `--auto` merges minutes later, so it cannot verify an
 * endpoint that has not changed yet; that PR's merge re-enters the workflow,
 * finds nothing to publish, and that pass does the checking. The workflow
 * comment has documented this all along. The defect was depth, not aim, and
 * these tests pin the depth.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { comparePayloads } from "../../tools/verify-published-params.mjs";

/** A published payload in the shape docs/rules/v1/params.json ships. */
function payload(overrides = {}) {
  return {
    version: 7,
    published: "2026-09-01T00:00:00.000Z",
    params: ["utm_source", "fbclid", "gclid"],
    sig: "c2lnbmF0dXJlLWJhc2U2NHVybA",
    ...overrides,
  };
}

describe("comparePayloads — the live endpoint matches what was published", () => {
  test("an identical payload reports no problems", () => {
    assert.deepStrictEqual(comparePayloads(payload(), payload()), []);
  });

  test("`published` may differ without failing the check", () => {
    // Only version, sig and non-emptiness are load-bearing. Failing on a
    // timestamp would make the gate noisy, and a noisy gate gets disabled.
    const live = payload({ published: "2026-09-02T12:00:00.000Z" });
    assert.deepStrictEqual(comparePayloads(live, payload()), []);
  });
});

describe("comparePayloads — a broken payload fails (#1267 closes-against)", () => {
  test("a stale version is caught, and the message names both sides", () => {
    const problems = comparePayloads(payload({ version: 6 }), payload({ version: 7 }));
    assert.strictEqual(problems.length, 1);
    assert.match(problems[0], /^version:/);
    assert.match(problems[0], /6/);
    assert.match(problems[0], /7/,
      "an on-call reader needs both numbers, not just the fact that they differ");
  });

  test("tampered bytes are caught by the signature even at the same version", () => {
    // The case a version check alone would miss: same version number, different
    // content. `sig` covers the payload, so this is what makes the gate real.
    const live = payload({ params: ["utm_source"], sig: "ZGlmZmVyZW50LXNpZ25hdHVyZQ" });
    const problems = comparePayloads(live, payload());
    assert.ok(problems.some((p) => p.startsWith("sig:")));
  });

  test("an empty param list is caught even when correctly signed", () => {
    // Not redundant with the signature: a payload can be validly signed and
    // still useless, and "valid but empty" is exactly what a broken generator
    // produces. Signed emptiness is the failure that looks most like success.
    const empty = payload({ params: [] });
    const problems = comparePayloads(empty, empty);
    assert.deepStrictEqual(problems, ["params: the live payload carries no parameters"]);
  });

  test("a missing params array is caught", () => {
    const broken = payload({ params: undefined });
    assert.ok(comparePayloads(broken, broken).some((p) => p.startsWith("params:")));
  });

  test("every failing field is reported, not just the first", () => {
    // A gate that stops at the first problem makes an incident take two runs
    // to understand.
    const live = payload({ version: 1, sig: "b3RoZXI", params: [] });
    const problems = comparePayloads(live, payload());
    assert.strictEqual(problems.length, 3, `expected all three, got: ${problems.join(" | ")}`);
  });
});

describe("comparePayloads — malformed input", () => {
  test("a non-object live payload fails rather than throwing", () => {
    // The endpoint serving an HTML error page parses to a string or throws
    // upstream; either way the check must fail, never crash into a green run.
    for (const bad of [null, undefined, "not json", 42]) {
      assert.deepStrictEqual(
        comparePayloads(bad, payload()),
        ["live payload is not an object"]
      );
    }
  });

  test("a non-object committed payload fails rather than throwing", () => {
    assert.deepStrictEqual(
      comparePayloads(payload(), null),
      ["committed payload is not an object"]
    );
  });
});
