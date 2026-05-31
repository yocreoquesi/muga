/**
 * MUGA — Unit tests for evaluateCanary (tools/affiliate-safety/evaluate.mjs).
 *
 * Pure break-evaluation tests using synthetic canaries and a fake processUrlFn.
 * No live deps — fully deterministic. Covers the shared semantics that both the
 * affiliate-canary runner and GATE 3 (#777) depend on.
 *
 * RED first: evaluate.mjs does not exist at write time → all 7 cases fail on import.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluateCanary } from "../../tools/affiliate-safety/evaluate.mjs";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** A minimal preserve-style canary fixture used across most tests. */
const makeCanary = (overrides = {}) => ({
  name: "synthetic-test",
  url: "https://example.com/p?k=v",
  prefs: {},
  mustSurvive: { k: "v" },
  mustStrip: [],
  ...overrides,
});

/**
 * A fake processUrlFn that returns the URL unchanged (every param preserved).
 * Used to prove "no failures when nothing breaks."
 */
const identityFn = (url, _prefs) => ({ cleanUrl: url });

/**
 * A fake processUrlFn that strips ALL query params from the URL.
 * Used to simulate a stripping cleaner.
 */
const stripAllFn = (_url, _prefs) => ({ cleanUrl: "https://example.com/p" });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("evaluateCanary — held (no breaks)", () => {
  test("returns empty array when mustSurvive param is intact", () => {
    const canary = makeCanary();
    const result = evaluateCanary(canary, identityFn);
    assert.deepEqual(result, []);
  });
});

describe("evaluateCanary — one mustSurvive break", () => {
  test("returns exactly 1 failure with correct shape when processUrlFn strips the param", () => {
    const canary = makeCanary({ mustSurvive: { k: "v" } });
    const result = evaluateCanary(canary, stripAllFn);
    assert.equal(result.length, 1);
    const [f] = result;
    assert.equal(f.name, "synthetic-test");
    assert.equal(f.kind, "preserve");
    // reason format: `${param} expected "${value}", got "${got}"`
    assert.ok(f.reason.includes("k expected"), `reason must mention the param: got "${f.reason}"`);
  });
});

describe("evaluateCanary — two mustSurvive breaks (collect-all)", () => {
  test("returns 2 failures when processUrlFn strips both params (no short-circuit)", () => {
    const canary = makeCanary({
      url: "https://example.com/p?a=1&b=2",
      mustSurvive: { a: "1", b: "2" },
    });
    const result = evaluateCanary(canary, stripAllFn);
    assert.equal(result.length, 2, "must collect ALL param failures, not short-circuit on first");
  });
});

describe("evaluateCanary — mustStrip violation", () => {
  test("returns failure when mustStrip param is still present after cleaning", () => {
    // identityFn preserves everything, so mustStrip params will remain → violation
    const canary = makeCanary({
      url: "https://example.com/p?k=v&noise=1",
      mustSurvive: {},
      mustStrip: ["noise"],
    });
    const result = evaluateCanary(canary, identityFn);
    assert.equal(result.length, 1);
    const [f] = result;
    assert.equal(f.kind, "preserve");
    assert.ok(
      f.reason.includes("should have been stripped"),
      `reason must say "should have been stripped", got: "${f.reason}"`
    );
  });
});

describe("evaluateCanary — processUrlFn throws", () => {
  test("returns single failure with kind:preserve and reason matching /processUrl threw:/", () => {
    const throwingFn = () => { throw new Error("boom"); };
    const canary = makeCanary();
    const result = evaluateCanary(canary, throwingFn);
    assert.equal(result.length, 1, "a throw must yield exactly one failure, not crash");
    const [f] = result;
    assert.equal(f.kind, "preserve");
    assert.match(f.reason, /processUrl threw:/);
  });
});

describe("evaluateCanary — extraRemoteParams injected", () => {
  test("processUrlFn receives merged remoteParams containing the extra param", () => {
    let capturedPrefs = null;
    const capturingFn = (url, prefs) => {
      capturedPrefs = prefs;
      return { cleanUrl: url };
    };
    const canary = makeCanary();
    evaluateCanary(canary, capturingFn, ["extra-param"]);
    assert.ok(capturedPrefs !== null, "processUrlFn must be called");
    assert.ok(
      Array.isArray(capturedPrefs.remoteParams),
      "prefs.remoteParams must be an array"
    );
    assert.ok(
      capturedPrefs.remoteParams.includes("extra-param"),
      `extra-param must appear in remoteParams; got: ${JSON.stringify(capturedPrefs.remoteParams)}`
    );
  });
});

describe("evaluateCanary — canary prefs.remoteParams merged with extraRemoteParams", () => {
  test("both existing and extra remoteParams are present in the merged array", () => {
    let capturedPrefs = null;
    const capturingFn = (url, prefs) => {
      capturedPrefs = prefs;
      return { cleanUrl: url };
    };
    const canary = makeCanary({
      prefs: { remoteParams: ["existing"] },
    });
    evaluateCanary(canary, capturingFn, ["extra"]);
    assert.ok(
      capturedPrefs.remoteParams.includes("existing"),
      "original canary remoteParams must be preserved in merge"
    );
    assert.ok(
      capturedPrefs.remoteParams.includes("extra"),
      "extra remoteParams must be merged in"
    );
  });
});
