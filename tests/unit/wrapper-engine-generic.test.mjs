/**
 * MUGA — Unit tests for the generic wrapper code path (issue #531).
 *
 * Run with: npm test
 *
 * The generic wrapper path fires ONLY when no explicit per-host entry in
 * WRAPPERS matches `detectWrapper`. It looks for a small allowlist of
 * conventional redirect-style query parameter keys
 * (GENERIC_WRAPPER_PARAMS = ["url", "u", "redirect", "dest", "target"])
 * and validates that the value decodes to a well-formed http(s) URL on a
 * DIFFERENT host than the wrapper itself.
 *
 * Safety guards covered (all MUST suppress unwrap):
 *   - Same effective host (with `www.` stripped) → OAuth/return-to flow safe.
 *   - Auth/checkout-shape destination paths (/oauth, /auth, /sso, /callback,
 *     /login, /signin, /checkout, /payment, /pay, /saml, /authorize).
 *   - Non-http(s) destination protocols (javascript:, data:, mailto:, file:).
 *   - Malformed destinations (must not throw).
 *   - Destination URL > 2000 chars (length cap consistent with rest of repo).
 *
 * Precedence:
 *   - Explicit-over-generic: a host already in WRAPPERS (e.g. l.facebook.com) keeps
 *     its tested behavior even if it also carries `?url=` — the generic path
 *     never overrides an explicit wrapper.
 *   - Unknown hosts with a generic redirect param → unwrap via generic path.
 *
 * Returned shape from the generic path (compatible with WRAPPERS entries):
 *   { id: "generic-<paramName>", isGeneric: true,
 *     hostPatterns: [<hostMatched>], pathPatterns: null, extract: <fn> }
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  unwrap,
  detectWrapper,
  GENERIC_WRAPPER_PARAMS,
} from "../../src/lib/wrapper-engine.js";

// ---------------------------------------------------------------------------
// Constant export
// ---------------------------------------------------------------------------
describe("Wrapper Engine — GENERIC_WRAPPER_PARAMS export", () => {
  test("exports the five canonical redirect-style keys in order", () => {
    assert.deepEqual(GENERIC_WRAPPER_PARAMS, [
      "url",
      "u",
      "redirect",
      "dest",
      "target",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Positive cases — each generic key on an unknown host
// ---------------------------------------------------------------------------
describe("Wrapper Engine — generic path positive cases", () => {
  for (const key of ["url", "u", "redirect", "dest", "target"]) {
    test(`unwraps unknown-host wrapper using ?${key}= → different domain`, () => {
      const dest = "https://merchant.example.com/product/42";
      const input = `https://unknown-redirector.test/go?${key}=${encodeURIComponent(dest)}`;
      const result = unwrap(input);
      assert.ok(result, `expected unwrap result for key ${key}`);
      assert.equal(result.unwrapped, dest);
      assert.equal(result.hops, 1);
      assert.deepEqual(result.networks, [`generic-${key}`]);
    });
  }

  test("detectWrapper returns a generic entry for unknown host with ?url=", () => {
    const input =
      "https://unknown-redirector.test/path?url=" +
      encodeURIComponent("https://merchant.example.com/p");
    const w = detectWrapper(input);
    assert.ok(w, "expected a wrapper entry");
    assert.equal(w.id, "generic-url");
    assert.equal(w.isGeneric, true);
    assert.deepEqual(w.hostPatterns, ["unknown-redirector.test"]);
    assert.equal(w.pathPatterns, null);
    assert.equal(typeof w.extract, "function");
  });

  test("unwraps when generic key coexists with other tracking params", () => {
    const dest = "https://merchant.example.com/p";
    const input =
      "https://unknown-redirector.test/go?utm_source=foo&url=" +
      encodeURIComponent(dest) +
      "&clickid=xyz";
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
    assert.deepEqual(result.networks, ["generic-url"]);
  });
});

// ---------------------------------------------------------------------------
// Safety guard — same-host destinations (OAuth return-to / login flow safe)
// ---------------------------------------------------------------------------
describe("Wrapper Engine — generic path same-host guard", () => {
  test("does NOT unwrap when destination shares the wrapper host", () => {
    const dest = "https://example.com/dashboard";
    const input =
      "https://example.com/redirect?url=" + encodeURIComponent(dest);
    assert.equal(unwrap(input), null);
    assert.equal(detectWrapper(input), null);
  });

  test("does NOT unwrap when www. differs only by prefix (effective same host)", () => {
    const dest = "https://example.com/path";
    const input =
      "https://www.example.com/r?url=" + encodeURIComponent(dest);
    assert.equal(unwrap(input), null);
    assert.equal(detectWrapper(input), null);
  });

  test("same-host check is case-insensitive", () => {
    const dest = "https://Example.COM/path";
    const input =
      "https://example.com/r?url=" + encodeURIComponent(dest);
    assert.equal(unwrap(input), null);
  });
});

// ---------------------------------------------------------------------------
// Safety guard — auth/checkout-shape destination paths
// ---------------------------------------------------------------------------
describe("Wrapper Engine — generic path auth/checkout path guard", () => {
  const AUTH_PATHS = [
    "/oauth",
    "/oauth2",
    "/auth",
    "/sso",
    "/callback",
    "/login",
    "/signin",
    "/checkout",
    "/payment",
    "/pay",
    "/saml",
    "/authorize",
  ];

  for (const p of AUTH_PATHS) {
    test(`does NOT unwrap destination path ${p}`, () => {
      const dest = `https://merchant.example.com${p}/return?id=42`;
      const input =
        "https://unknown-redirector.test/go?url=" + encodeURIComponent(dest);
      assert.equal(unwrap(input), null, `${p} should be blocked`);
    });
  }

  test("path containing /oauth as substring (not at boundary) is also blocked", () => {
    // Conservative: any path containing the auth fragment is treated as risky.
    const dest = "https://merchant.example.com/api/oauth2/exchange";
    const input =
      "https://unknown-redirector.test/go?url=" + encodeURIComponent(dest);
    assert.equal(unwrap(input), null);
  });
});

// ---------------------------------------------------------------------------
// Safety guard — non-http(s) destination protocols
// ---------------------------------------------------------------------------
describe("Wrapper Engine — generic path non-http(s) guard", () => {
  const HOSTILE = [
    "javascript:alert(1)",
    "data:text/html,<script>x</script>",
    "mailto:a@b.com",
    "file:///etc/passwd",
  ];

  for (const dest of HOSTILE) {
    test(`does NOT unwrap destination scheme: ${dest.split(":")[0]}:`, () => {
      const input =
        "https://unknown-redirector.test/go?url=" + encodeURIComponent(dest);
      assert.equal(unwrap(input), null);
    });
  }
});

// ---------------------------------------------------------------------------
// Safety guard — malformed destinations
// ---------------------------------------------------------------------------
describe("Wrapper Engine — generic path malformed guard", () => {
  test("does NOT throw and returns null on malformed destination", () => {
    const input = "https://unknown-redirector.test/go?url=not-a-url";
    assert.doesNotThrow(() => unwrap(input));
    assert.equal(unwrap(input), null);
  });

  test("does NOT unwrap empty value", () => {
    const input = "https://unknown-redirector.test/go?url=";
    assert.equal(unwrap(input), null);
  });
});

// ---------------------------------------------------------------------------
// Safety guard — destination length cap
// ---------------------------------------------------------------------------
describe("Wrapper Engine — generic path length-cap guard", () => {
  test("does NOT unwrap when destination exceeds 2000 chars", () => {
    const tail = "a".repeat(2100);
    const dest = "https://merchant.example.com/" + tail;
    const input =
      "https://unknown-redirector.test/go?url=" + encodeURIComponent(dest);
    assert.equal(unwrap(input), null);
  });

  test("DOES unwrap when destination is exactly at the cap", () => {
    // Build a destination exactly 2000 chars long.
    const base = "https://merchant.example.com/";
    const tail = "a".repeat(2000 - base.length);
    const dest = base + tail;
    assert.equal(dest.length, 2000);
    const input =
      "https://unknown-redirector.test/go?url=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
  });
});

// ---------------------------------------------------------------------------
// Precedence — explicit wrappers always win over the generic path
// ---------------------------------------------------------------------------
describe("Wrapper Engine — explicit-over-generic precedence", () => {
  test("l.facebook.com URL with both u= and url= still uses Facebook (explicit) extractor", () => {
    const realDest = "https://merchant.example.com/product";
    const decoy = "https://decoy.example.com/decoy";
    const input =
      "https://l.facebook.com/l.php?u=" +
      encodeURIComponent(realDest) +
      "&url=" +
      encodeURIComponent(decoy);
    const w = detectWrapper(input);
    assert.ok(w);
    // Explicit facebook-l entry — NOT a generic entry.
    assert.equal(w.id, "facebook-l");
    assert.notEqual(w.isGeneric, true);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, realDest);
    assert.deepEqual(result.networks, ["facebook-l"]);
  });

  test("Skimlinks (host-only explicit) keeps explicit precedence even though it uses ?url=", () => {
    const dest = "https://merchant.example.com/p";
    const input =
      "https://go.redirectingat.com/?url=" + encodeURIComponent(dest);
    const w = detectWrapper(input);
    assert.ok(w);
    assert.equal(w.id, "skimlinks");
    assert.notEqual(w.isGeneric, true);
  });

  test("Unknown host with ?url= falls through to the generic path", () => {
    const dest = "https://merchant.example.com/p";
    const input =
      "https://some-unknown-host.test/go?url=" + encodeURIComponent(dest);
    const w = detectWrapper(input);
    assert.ok(w);
    assert.equal(w.id, "generic-url");
    assert.equal(w.isGeneric, true);
  });
});

// ---------------------------------------------------------------------------
// Recursion compatibility — generic entries should chain through unwrap loop
// ---------------------------------------------------------------------------
describe("Wrapper Engine — generic path integrates with unwrap loop", () => {
  test("generic → explicit chain unwraps both hops", () => {
    const finalDest = "https://merchant.example.com/p";
    const fbUrl =
      "https://l.facebook.com/l.php?u=" + encodeURIComponent(finalDest);
    const input =
      "https://unknown-redirector.test/go?url=" + encodeURIComponent(fbUrl);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, finalDest);
    assert.equal(result.hops, 2);
    assert.deepEqual(result.networks, ["generic-url", "facebook-l"]);
  });
});
