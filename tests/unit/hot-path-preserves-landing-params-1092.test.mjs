/**
 * MUGA — Regression + invariant guard for #1092 (audit-2026-07).
 *
 * The five synchronous content-script strip copies (main-world history
 * defuser, DOM link rewriters, window.name defuser) share the HOT_PATH_STRIP
 * subset. Three redirect-network ATTRIBUTION params — irclickid (Impact),
 * cjevent (CJ), awc (Awin) — were in that subset, so the sync path deleted
 * them with NO landing/referrer gate. But they are `landingParams` in
 * REDIRECT_NETWORK_PATTERNS, are excluded from TRACKING_PARAMS, and the async
 * engine (processUrl) PRESERVES them. A merchant SPA that calls
 * history.replaceState during hydration — before the affiliate script reads
 * location.search — would have its attribution destroyed by the sync copy,
 * violating the never-strip-affiliate promise (ADR-0005 / #815).
 *
 * INVARIANT: the hot-path sync strip set must never contain a param the async
 * engine treats as a preservable attribution param. This test pins that
 * invariant against the SOURCE OF TRUTH (REDIRECT_NETWORK_PATTERNS), so a
 * future network whose landingParams accidentally land in the strip table
 * fails here instead of silently destroying commissions in the wild.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { HOT_PATH_STRIP, stripHotPathQuery } from "../../src/lib/hot-path-strip.js";
import { REDIRECT_NETWORK_PATTERNS } from "../../src/lib/redirect-networks.js";

const landingParamUnion = new Set(
  REDIRECT_NETWORK_PATTERNS.flatMap((n) => n.landingParams).map((p) => p.toLowerCase()),
);

describe("#1092 — hot-path sync strip never deletes a preservable attribution param", () => {
  test("HOT_PATH_STRIP is disjoint from the redirect-network landingParams union", () => {
    const overlap = [...HOT_PATH_STRIP].filter((p) => landingParamUnion.has(p.toLowerCase()));
    assert.deepEqual(
      overlap,
      [],
      `hot-path sync strip must not contain attribution params the async engine preserves; found: ${JSON.stringify(overlap)}`,
    );
  });

  test("stripHotPathQuery preserves irclickid/cjevent/awc while still stripping utm_source", () => {
    for (const attribution of ["irclickid", "cjevent", "awc"]) {
      const raw = `https://merchant.example/p?${attribution}=abc-123&utm_source=news`;
      const cleaned = stripHotPathQuery(raw);
      const params = new URL(cleaned).searchParams;
      assert.equal(
        params.get(attribution),
        "abc-123",
        `${attribution} (a redirect-network landing param) must survive the sync hot-path strip`,
      );
      assert.equal(params.has("utm_source"), false, "an actual tracking param must still be stripped");
    }
  });
});
