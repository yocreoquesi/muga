/**
 * Unit tests for the pure reducer in tools/probe-cmp-surface.mjs
 * (summarizeSurfaceResults). The browser-driving part is a maintainer probe,
 * not CI — only the pure per-adapter verdict logic is unit-tested here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { summarizeSurfaceResults } from "../../tools/probe-cmp-surface.mjs";

describe("summarizeSurfaceResults — per-adapter reject-API surface verdict", () => {
  test("a site exposing the reject method as a function -> CONFIRMED", () => {
    const out = summarizeSurfaceResults([
      { adapterId: "onetrust", globalType: "object", methodType: "function" },
    ]);
    assert.deepEqual(out, [{ adapterId: "onetrust", verdict: "CONFIRMED" }]);
  });

  test("ANY confirming site wins even if earlier sites failed (fallback across sites)", () => {
    const out = summarizeSurfaceResults([
      { adapterId: "usercentrics", globalType: "undefined", methodType: "undefined" },
      { adapterId: "usercentrics", globalType: "object", methodType: "function" },
    ]);
    assert.deepEqual(out, [{ adapterId: "usercentrics", verdict: "CONFIRMED" }]);
  });

  test("global present but method absent -> GLOBAL_ONLY (possible partial drift)", () => {
    const out = summarizeSurfaceResults([
      { adapterId: "cookiebot", globalType: "object", methodType: "undefined" },
    ]);
    assert.deepEqual(out, [{ adapterId: "cookiebot", verdict: "GLOBAL_ONLY" }]);
  });

  test("nothing loaded (SDK never appeared) -> UNCONFIRMED", () => {
    const out = summarizeSurfaceResults([
      { adapterId: "didomi", globalType: "undefined", methodType: "undefined" },
    ]);
    assert.deepEqual(out, [{ adapterId: "didomi", verdict: "UNCONFIRMED" }]);
  });

  test("aggregates multiple adapters independently", () => {
    const out = summarizeSurfaceResults([
      { adapterId: "onetrust", globalType: "object", methodType: "function" },
      { adapterId: "sourcepoint", globalType: "function", methodType: "function" },
      { adapterId: "usercentrics", globalType: "undefined", methodType: "undefined" },
    ]);
    const byId = Object.fromEntries(out.map((o) => [o.adapterId, o.verdict]));
    assert.equal(byId.onetrust, "CONFIRMED");
    assert.equal(byId.sourcepoint, "CONFIRMED");
    assert.equal(byId.usercentrics, "UNCONFIRMED");
  });

  test("malformed / empty input never throws and yields nothing", () => {
    assert.doesNotThrow(() => summarizeSurfaceResults(null));
    assert.doesNotThrow(() => summarizeSurfaceResults(undefined));
    assert.doesNotThrow(() => summarizeSurfaceResults([null, 42, "x", {}]));
    assert.deepEqual(summarizeSurfaceResults([]), []);
    assert.deepEqual(summarizeSurfaceResults([{ noAdapterId: true }]), []);
  });
});
