/**
 * MUGA — Regression test: the generic `?url=`-style wrapper fallback is GONE
 * (issue #907, retiring the #531 feature).
 *
 * Run with: npm test
 *
 * Background: #531 added a generic fallback that unwrapped ANY host with a
 * query param matching a conventional redirect key (`url`, `u`, `redirect`,
 * `dest`, `target`) — even unknown/unvetted redirectors. #907 removed it
 * (`GENERIC_WRAPPER_PARAMS`, `GENERIC_AUTH_PATH_FRAGMENTS`, `tryGenericExtract`,
 * `buildGenericWrapper`, `effectiveHost` all deleted from
 * src/lib/wrapper-engine.js) because it produced false positives on networks
 * whose destination param happens to collide with the allowlist but whose 30x
 * carries attribution context the generic path silently discarded.
 *
 * The canonical repro is Effiliation's redirect shape:
 *   https://track.effiliation.com/servlet/effi.redir?id_compteur=...&url=<merchant>
 * `track.effiliation.com` is neither an explicit WRAPPERS recipe (vetted
 * against caps-spec) nor a registered AFFILIATE_REDIRECT_NETWORKS pass-through
 * host — it must be left alone entirely (pass-through: neither unwrapped nor
 * flagged as a wrapper), so the network's own redirect executes in the
 * browser and the merchant's tag receives the click context.
 *
 * Only per-host recipes vetted against caps-spec (WRAPPERS, sourced from
 * src/rules/wrappers.json) are unwrapped now. This file locks that contract.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { unwrap, detectWrapper } from "../../src/lib/wrapper-engine.js";

// ---------------------------------------------------------------------------
// The generic path's symbols are gone — no export survives to import.
// ---------------------------------------------------------------------------
describe("Wrapper Engine — generic ?url= fallback removed (#907)", () => {
  test("unrecognized host with ?url= is NOT unwrapped (no generic fallback)", () => {
    const dest = "https://merchant.example.com/product/42";
    const input = "https://unknown-redirector.test/go?url=" + encodeURIComponent(dest);
    assert.equal(unwrap(input), null);
    assert.equal(detectWrapper(input), null);
  });

  for (const key of ["url", "u", "redirect", "dest", "target"]) {
    test(`unrecognized host with ?${key}= is NOT unwrapped (all former generic keys retired)`, () => {
      const dest = "https://merchant.example.com/product/42";
      const input = `https://unknown-redirector.test/go?${key}=${encodeURIComponent(dest)}`;
      assert.equal(unwrap(input), null);
      assert.equal(detectWrapper(input), null);
    });
  }

  test("naked-query destination on an unrecognized host is NOT unwrapped either", () => {
    const input = "https://unknown-redirector.test/?https://destination.example.com/article";
    assert.equal(unwrap(input), null);
    assert.equal(detectWrapper(input), null);
  });
});

// ---------------------------------------------------------------------------
// Canonical repro — Effiliation (issue #907 root cause)
// ---------------------------------------------------------------------------
describe("Wrapper Engine — Effiliation regression (#907 root cause)", () => {
  test("track.effiliation.com is left alone — not a wrapper, not unwrapped", () => {
    const merchant = "https://www.merchant.example/product";
    const input =
      "https://track.effiliation.com/servlet/effi.redir?id_compteur=12345&url=" +
      encodeURIComponent(merchant);
    assert.equal(detectWrapper(input), null, "Effiliation host must not be flagged as a wrapper");
    assert.equal(unwrap(input), null, "Effiliation redirect must pass through unmodified");
  });

  test("Effiliation with additional publisher params still passes through", () => {
    const merchant = "https://www.merchant.example/product?ref=aff";
    const input =
      "https://track.effiliation.com/servlet/effi.redir?id_compteur=12345&idev=1&url=" +
      encodeURIComponent(merchant);
    assert.equal(unwrap(input), null);
  });
});

// ---------------------------------------------------------------------------
// Explicit wrappers are unaffected by the generic path's removal.
// ---------------------------------------------------------------------------
describe("Wrapper Engine — explicit wrappers still function without the generic path", () => {
  test("l.facebook.com with u= still unwraps via its explicit recipe", () => {
    const dest = "https://merchant.example.com/product";
    const input = "https://l.facebook.com/l.php?u=" + encodeURIComponent(dest);
    const w = detectWrapper(input);
    assert.ok(w);
    assert.equal(w.id, "facebook-l");
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
    assert.deepEqual(result.networks, ["facebook-l"]);
  });
});
