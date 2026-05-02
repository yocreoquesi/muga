/**
 * MUGA — Experimental shape-based param classifier tests (#544).
 *
 * Adds a multi-signal heuristic that strips parameters whose VALUE SHAPE
 * matches a tracker pattern. ALL FOUR signals must hit:
 *
 *   1. Param key matches a known suspicious-prefix pattern
 *      (`*_id`, `*clid`, `*_token`, `*_uid`, `*_session`)
 *   2. Value length > 16
 *   3. Value Shannon entropy > 4.0
 *   4. Value charset matches base64 / hex / uuid
 *
 * False-positive risk is real (auth tokens, session IDs LOOK like trackers),
 * so the heuristic ships behind `prefs.experimentalParamClassesEnabled`,
 * default false — flag OFF means byte-identical behaviour to #530 baseline.
 *
 * A small allowlist of well-known auth / oauth / session keys is ALWAYS
 * exempt, even when the four-signal match fires — these never make it into
 * `stripParams` regardless of value shape.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  classify,
  classifyByShape,
  SHAPE_SUSPICIOUS_KEY_PATTERNS,
  SHAPE_VALUE_LENGTH_MIN,
  SHAPE_VALUE_ENTROPY_MIN,
  SHAPE_KEY_ALLOWLIST,
} from "../../src/lib/param-classifier.js";

describe("classifyByShape — exports and thresholds", () => {
  test("exports the four signal thresholds and the allowlist", () => {
    assert.ok(Array.isArray(SHAPE_SUSPICIOUS_KEY_PATTERNS) && SHAPE_SUSPICIOUS_KEY_PATTERNS.length >= 5,
      "SHAPE_SUSPICIOUS_KEY_PATTERNS should expose the suspicious-prefix list");
    assert.equal(SHAPE_VALUE_LENGTH_MIN, 16, "value length threshold ships at >16");
    assert.equal(SHAPE_VALUE_ENTROPY_MIN, 4.0, "value entropy threshold ships at >4.0");
    assert.ok(SHAPE_KEY_ALLOWLIST instanceof Set, "SHAPE_KEY_ALLOWLIST is a Set for O(1) lookup");
    for (const k of [
      "state", "code", "nonce", "csrf", "csrf_token", "_csrf",
      "oauth_token", "oauth_verifier", "access_token", "refresh_token",
      "id_token", "session_id", "sessionid", "jsessionid", "phpsessid",
      "sid", "aspsessionid",
    ]) {
      assert.ok(
        SHAPE_KEY_ALLOWLIST.has(k.toLowerCase()),
        `SHAPE_KEY_ALLOWLIST must include ${k}`,
      );
    }
  });
});

// ── Flag OFF — heuristic must NOT fire ──────────────────────────────────────

describe("classifyByShape — flag OFF (baseline preservation)", () => {
  test("returns empty stripParams when flag is undefined (default)", () => {
    const r = classifyByShape(
      "https://example.com/?click_id=AbCdEfGhIjKlMnOp123456789",
      {},
    );
    assert.deepEqual(r.stripParams, []);
  });

  test("returns empty stripParams when flag is false", () => {
    const r = classifyByShape(
      "https://example.com/?click_id=AbCdEfGhIjKlMnOp123456789",
      { experimentalParamClassesEnabled: false },
    );
    assert.deepEqual(r.stripParams, []);
  });

  test("classify() does NOT include shape hits when flag OFF", () => {
    // No anchor tracker, just a tracker-shaped param. Without the flag,
    // classify() returns empty (this is the #530 baseline behaviour).
    const r = classify(
      "https://example.com/?click_id=AbCdEfGhIjKlMnOp123456789",
      {},
    );
    assert.deepEqual(r.stripParams, []);
  });
});

// ── Flag ON — positive cases ────────────────────────────────────────────────

describe("classifyByShape — flag ON, positive matches", () => {
  const prefs = { experimentalParamClassesEnabled: true };

  test("strips click_id (matches *clid + base64 + length + entropy)", () => {
    const r = classifyByShape(
      "https://example.com/?click_id=AbCdEf12GhIj34KlMnOpQrStUv",
      prefs,
    );
    assert.ok(r.stripParams.includes("click_id"));
  });

  test("strips ad_uid (matches *_uid + hex)", () => {
    const r = classifyByShape(
      "https://example.com/?ad_uid=deadbeefcafe1234567890abcdef0123",
      prefs,
    );
    assert.ok(r.stripParams.includes("ad_uid"));
  });

  test("strips affiliate_id (matches *_id + base64)", () => {
    const r = classifyByShape(
      "https://example.com/?affiliate_id=Xa9PqRsTuVwXyZ012345678ab",
      prefs,
    );
    assert.ok(r.stripParams.includes("affiliate_id"));
  });

  test("strips visitor_uid (matches *_uid + uuid shape)", () => {
    const r = classifyByShape(
      "https://example.com/?visitor_uid=550e8400-e29b-41d4-a716-446655440000",
      prefs,
    );
    assert.ok(r.stripParams.includes("visitor_uid"));
  });

  test("strips tracker_session (matches *_session + base64)", () => {
    const r = classifyByShape(
      "https://example.com/?tracker_session=Q2FtcGFpZ25BYjMyMTIzNDU2Nzg5",
      prefs,
    );
    assert.ok(r.stripParams.includes("tracker_session"));
  });

  test("classify() merges shape hits into stripParams when flag ON", () => {
    // No anchor tracker required — shape hits stand on their own.
    const r = classify(
      "https://example.com/?click_id=AbCdEf12GhIj34KlMnOpQrStUv",
      { experimentalParamClassesEnabled: true },
    );
    assert.ok(r.stripParams.includes("click_id"),
      "classify() should surface shape-only hits when the flag is ON");
  });
});

// ── Flag ON — negative controls (auth/session shapes preserved) ────────────

describe("classifyByShape — flag ON, allowlist preserves auth/session keys", () => {
  const prefs = { experimentalParamClassesEnabled: true };

  test("preserves oauth state value", () => {
    const r = classifyByShape(
      "https://example.com/?state=oauth-csrf-state-value-12345abcdef",
      prefs,
    );
    assert.ok(!r.stripParams.includes("state"));
  });

  test("preserves oauth code value", () => {
    const r = classifyByShape(
      "https://example.com/?code=abcdef123456789012345678",
      prefs,
    );
    assert.ok(!r.stripParams.includes("code"));
  });

  test("preserves session_id", () => {
    const r = classifyByShape(
      "https://example.com/?session_id=PHPSESSIDabc1234567890XYZ",
      prefs,
    );
    assert.ok(!r.stripParams.includes("session_id"));
  });

  test("preserves id_token (JWT-shaped)", () => {
    const r = classifyByShape(
      "https://example.com/?id_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef",
      prefs,
    );
    assert.ok(!r.stripParams.includes("id_token"));
  });

  test("preserves csrf_token", () => {
    const r = classifyByShape(
      "https://example.com/?csrf_token=AbCdEf12GhIj34KlMnOpQrStUv",
      prefs,
    );
    assert.ok(!r.stripParams.includes("csrf_token"));
  });

  test("preserves access_token / refresh_token", () => {
    const r1 = classifyByShape(
      "https://example.com/?access_token=AbCdEf12GhIj34KlMnOpQrStUv",
      prefs,
    );
    const r2 = classifyByShape(
      "https://example.com/?refresh_token=AbCdEf12GhIj34KlMnOpQrStUv",
      prefs,
    );
    assert.ok(!r1.stripParams.includes("access_token"));
    assert.ok(!r2.stripParams.includes("refresh_token"));
  });
});

// ── Flag ON — multi-signal gating: each signal can veto a strip ────────────

describe("classifyByShape — flag ON, multi-signal gating", () => {
  const prefs = { experimentalParamClassesEnabled: true };

  test("short value (<= 16 chars) NOT stripped even if other signals match", () => {
    const r = classifyByShape(
      "https://example.com/?click_id=AbC123XyZ",
      prefs,
    );
    assert.ok(!r.stripParams.includes("click_id"));
  });

  test("low-entropy value NOT stripped even if other signals match", () => {
    const r = classifyByShape(
      "https://example.com/?click_id=aaaaaaaaaaaaaaaaaaaaaaa",
      prefs,
    );
    assert.ok(!r.stripParams.includes("click_id"));
  });

  test("non-suspicious key prefix NOT stripped", () => {
    const r = classifyByShape(
      "https://example.com/?title=AbCdEf12GhIj34KlMnOpQrStUv",
      prefs,
    );
    assert.ok(!r.stripParams.includes("title"));
  });

  test("non-base64/hex/uuid charset NOT stripped (human-readable value)", () => {
    const r = classifyByShape(
      "https://example.com/?article_id=My Article Title goes here",
      prefs,
    );
    assert.ok(!r.stripParams.includes("article_id"));
  });
});

// ── Defensive ─────────────────────────────────────────────────────────────────

describe("classifyByShape — defensive", () => {
  test("malformed URL → empty result, no throw", () => {
    const r = classifyByShape("not a url", { experimentalParamClassesEnabled: true });
    assert.deepEqual(r.stripParams, []);
  });

  test("null/undefined URL → empty result", () => {
    const r1 = classifyByShape(null, { experimentalParamClassesEnabled: true });
    const r2 = classifyByShape(undefined, { experimentalParamClassesEnabled: true });
    assert.deepEqual(r1.stripParams, []);
    assert.deepEqual(r2.stripParams, []);
  });

  test("affiliate precedence — affiliate param NOT stripped even when shape matches", () => {
    // If the host advertises this key as an affiliate param, shape never wins.
    const r = classifyByShape(
      "https://example.com/?affiliate_id=Xa9PqRsTuVwXyZ012345678ab",
      {
        experimentalParamClassesEnabled: true,
        _affiliateParamSet: new Set(["affiliate_id"]),
      },
    );
    assert.ok(!r.stripParams.includes("affiliate_id"));
  });
});
