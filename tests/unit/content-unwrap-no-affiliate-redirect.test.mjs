/**
 * MUGA — Regression test for the #695 invariant.
 *
 * No host declared in `AFFILIATE_REDIRECT_NETWORKS` (the 2.1 pass-through
 * bucket — `src/lib/opaque-networks.js`) may appear as a key in the legacy
 * content-script `AFFILIATE_REDIRECT_PARAMS` map (`src/content/cleaner.js`).
 *
 * If both lists ever overlap again, the content script's `runRedirectUnwrap`
 * would client-side-unwrap the affiliate-redirect URL — the user never
 * reaches the network's 30x, the merchant's first-party attribution cookie
 * never gets populated at landing, and creator commissions silently break.
 *
 * Locks the fix from #695 — which removed `awin1.com`, `ad.admitad.com`,
 * `alitems.com`, `clk.tradedoubler.com`, and `redirect.viglink.com` from the
 * legacy map after #684's pass-through retirement quietly missed this
 * surface.
 *
 * #907 update: `shareasale.com` — the map's last remaining entry — was also
 * retired to pass-through (joining Skimlinks' `go.redirectingat.com` /
 * `go.skimresources.com`). `AFFILIATE_REDIRECT_PARAMS` in
 * src/content/cleaner.js is now an empty object literal (`{}`). The
 * invariant this file locks still holds trivially (the empty set can't
 * overlap with AFFILIATE_REDIRECT_NETWORKS), but the tests below now assert
 * the map is empty rather than assert its single surviving entry.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { AFFILIATE_REDIRECT_NETWORKS, isAffiliateRedirectNetwork } from "../../src/lib/opaque-networks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_CLEANER_SOURCE = readFileSync(
  join(__dirname, "../../src/content/cleaner.js"),
  "utf8",
);

/**
 * Pulls the AFFILIATE_REDIRECT_PARAMS object literal out of the content
 * script source. The map is declared inside an IIFE so it can't be imported
 * directly; we parse the source instead — the same approach
 * tests/unit/redirect-unwrap.test.mjs uses to sync its replica.
 */
function parseLegacyAffiliateMap() {
  const match = CONTENT_CLEANER_SOURCE.match(
    /const AFFILIATE_REDIRECT_PARAMS\s*=\s*\{([\s\S]*?)\};/,
  );
  assert.ok(
    match,
    "src/content/cleaner.js must contain an AFFILIATE_REDIRECT_PARAMS object literal",
  );
  const entries = [...match[1].matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)];
  return Object.fromEntries(entries.map((m) => [m[1], m[2]]));
}

describe("#695 invariant: AFFILIATE_REDIRECT_NETWORKS ∩ legacy unwrap map = ∅", () => {
  const legacyMap = parseLegacyAffiliateMap();
  const legacyHosts = Object.keys(legacyMap);

  test("the legacy map is empty (#907 — shareasale retired to pass-through, no entries remain)", () => {
    assert.deepEqual(legacyHosts, [], "AFFILIATE_REDIRECT_PARAMS should be {} post-#907 — did a new entry get added without an AFFILIATE_REDIRECT_NETWORKS check?");
  });

  test("no key in AFFILIATE_REDIRECT_PARAMS is in AFFILIATE_REDIRECT_NETWORKS (literal check)", () => {
    for (const host of legacyHosts) {
      assert.ok(
        !AFFILIATE_REDIRECT_NETWORKS.includes(host),
        `${host} appears in BOTH the pass-through bucket and the legacy unwrap map — client-side unwrap would defeat 30x attribution`,
      );
    }
  });

  test("no key in AFFILIATE_REDIRECT_PARAMS resolves true under isAffiliateRedirectNetwork (wildcard coverage)", () => {
    // Literal check above misses wildcard entries like `*.pxf.io`. The helper
    // covers both literal and wildcard cases — locks the invariant for hosts
    // a future PR might add as a wildcard.
    for (const host of legacyHosts) {
      assert.equal(
        isAffiliateRedirectNetwork(host),
        false,
        `isAffiliateRedirectNetwork("${host}") is true — host must not be in the legacy unwrap map`,
      );
    }
  });

  test("post-#907 the legacy map has zero entries (shareasale retired to pass-through)", () => {
    // ShareASale was the map's last surviving entry (a genuine wrapper —
    // caps-spec `shareasale` recipe + DNR rule) until #907 reclassified it
    // as pass-through, joining Awin/Impact/Rakuten/TradeTracker/Skimlinks.
    // If this assertion fails because a new wrapper was added to the map,
    // double-check the host is NOT in AFFILIATE_REDIRECT_NETWORKS before
    // adding the new key here.
    assert.deepEqual(Object.keys(legacyMap).sort(), []);
  });
});

// ---------------------------------------------------------------------------
// #920 — the inline INLINE_AFFILIATE_REDIRECT_NETWORKS guard in cleaner.js
// mirrors the canonical AFFILIATE_REDIRECT_NETWORKS list.
//
// runRedirectUnwrap's GENERIC redirect loop (REDIRECT_PATH_RE + REDIRECT_PARAMS)
// is host-agnostic: unlike detectWrapper / inlineDetectWrapper it had no
// affiliate-redirect-host guard. A pass-through network that ever served a
// redirect-shaped path (/redirect, /out, …) with a ?url= param would be
// unwrapped client-side, defeating its 30x and stripping the creator's
// commission. #920 adds an inline host mirror + early bail. This block pins
// that mirror to the source-of-truth so the two copies cannot silently drift.
// ---------------------------------------------------------------------------
function parseInlineAffiliateMirror() {
  const match = CONTENT_CLEANER_SOURCE.match(
    /const INLINE_AFFILIATE_REDIRECT_NETWORKS\s*=\s*\[([\s\S]*?)\];/,
  );
  assert.ok(
    match,
    "src/content/cleaner.js must contain an INLINE_AFFILIATE_REDIRECT_NETWORKS array literal (the #920 guard mirror)",
  );
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase());
}

describe("#920 — cleaner.js INLINE_AFFILIATE_REDIRECT_NETWORKS mirrors the source-of-truth", () => {
  const inlineMirror = parseInlineAffiliateMirror();

  test("the inline mirror is non-empty", () => {
    assert.ok(
      inlineMirror.length > 0,
      "INLINE_AFFILIATE_REDIRECT_NETWORKS is empty — the guard is a no-op",
    );
  });

  test("every host in AFFILIATE_REDIRECT_NETWORKS is in the inline mirror", () => {
    const mirrorSet = new Set(inlineMirror);
    for (const host of AFFILIATE_REDIRECT_NETWORKS) {
      assert.ok(
        mirrorSet.has(host.toLowerCase()),
        `${host} is in AFFILIATE_REDIRECT_NETWORKS but missing from the cleaner.js INLINE_AFFILIATE_REDIRECT_NETWORKS mirror — the generic-unwrap guard will not cover it`,
      );
    }
  });

  test("the inline mirror does not contain entries beyond AFFILIATE_REDIRECT_NETWORKS", () => {
    const sourceSet = new Set(
      AFFILIATE_REDIRECT_NETWORKS.map((h) => h.toLowerCase()),
    );
    for (const host of inlineMirror) {
      assert.ok(
        sourceSet.has(host),
        `${host} is in cleaner.js INLINE_AFFILIATE_REDIRECT_NETWORKS but not in AFFILIATE_REDIRECT_NETWORKS — drift means the mirror is stale`,
      );
    }
  });

  test("runRedirectUnwrap bails via isInlineAffiliateRedirectNetwork before the generic loop", () => {
    // Structural check: the guard must be wired in AND positioned before the
    // REDIRECT_PATH_RE generic loop. Without this call, the mirror is a dead
    // constant.
    assert.ok(
      /isInlineAffiliateRedirectNetwork\(location\.hostname\.toLowerCase\(\)\)/.test(
        CONTENT_CLEANER_SOURCE,
      ),
      "cleaner.js must call isInlineAffiliateRedirectNetwork(location.hostname.toLowerCase()) and return when true",
    );
    const guardIdx = CONTENT_CLEANER_SOURCE.indexOf(
      "isInlineAffiliateRedirectNetwork(location.hostname",
    );
    const loopIdx = CONTENT_CLEANER_SOURCE.indexOf("const REDIRECT_PATH_RE =");
    assert.ok(guardIdx !== -1 && loopIdx !== -1, "both the guard and the generic loop must exist");
    assert.ok(
      guardIdx < loopIdx,
      "the affiliate-redirect guard must run BEFORE the generic REDIRECT_PATH_RE loop",
    );
  });
});

// ---------------------------------------------------------------------------
// #920 — behavioural regression: the generic redirect loop must NOT unwrap a
// pass-through affiliate-redirect host, even on a redirect-shaped path, while
// non-affiliate redirect hosts continue to unwrap unchanged.
//
// Replicates the guarded generic-unwrap logic from cleaner.js (IIFE content
// script — cannot be imported). The inline mirror is parsed from source so
// the replica stays honest about which hosts the guard covers.
// ---------------------------------------------------------------------------
describe("#920 — generic redirect loop bails on affiliate-redirect hosts", () => {
  const inlineMirror = parseInlineAffiliateMirror();

  function isInlineAffiliateRedirectNetwork(host) {
    for (const entry of inlineMirror) {
      if (entry.startsWith("*.")) {
        if (host.endsWith(entry.slice(1))) return true;
      } else if (host === entry) {
        return true;
      }
    }
    return false;
  }

  const REDIRECT_PARAMS = ["url", "redirect", "redirect_url", "dest", "goto", "returnurl", "return_url"];
  const REDIRECT_PATH_RE = /\/(redirect|bounce|out|away|leave|goto|jump|click|track|link|redir|forward|proxy|url|exit)\b/i;

  // Mirrors runRedirectUnwrap's guard + generic loop. Returns the unwrapped
  // destination href, or null when nothing is unwrapped (guard bail, path
  // miss, or no matching param).
  function genericUnwrapWithGuard(rawUrl) {
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return null; }
    if (isInlineAffiliateRedirectNetwork(parsed.hostname.toLowerCase())) return null;
    if (!REDIRECT_PATH_RE.test(parsed.pathname)) return null;
    for (const [rawKey, value] of parsed.searchParams) {
      const param = rawKey.toLowerCase();
      if (!REDIRECT_PARAMS.includes(param)) continue;
      if (!value || value.length > 2000) continue;
      let dest;
      try { dest = new URL(value); } catch {
        try { dest = new URL(decodeURIComponent(value)); } catch { continue; }
      }
      if (!["http:", "https:"].includes(dest.protocol)) continue;
      if (!dest.hostname) continue;
      if (dest.hostname === parsed.hostname) continue;
      return dest.href;
    }
    return null;
  }

  test("awin1.com on a redirect-shaped path (/redirect?url=) is NOT unwrapped", () => {
    const dest = genericUnwrapWithGuard(
      "https://www.awin1.com/redirect?url=https%3A%2F%2Fwww.zalando.es%2Fproduct.html",
    );
    assert.equal(dest, null, "affiliate-redirect host must bail before the generic loop (#920)");
  });

  test("go.skimresources.com on /out?url= is NOT unwrapped (#907 host, #920 guard)", () => {
    const dest = genericUnwrapWithGuard(
      "https://go.skimresources.com/out?url=https%3A%2F%2Fshop.example.com%2Fitem",
    );
    assert.equal(dest, null);
  });

  test("shareasale.com on /click?url= is NOT unwrapped (reclassified pass-through)", () => {
    const dest = genericUnwrapWithGuard(
      "https://www.shareasale.com/click?url=https%3A%2F%2Fwww.shein.com%2Fdress.html",
    );
    assert.equal(dest, null);
  });

  test("Impact Radius wildcard subdomain (target.pxf.io) on /redirect?url= is NOT unwrapped", () => {
    const dest = genericUnwrapWithGuard(
      "https://target.pxf.io/redirect?url=https%3A%2F%2Fwww.target.com%2Fp%2F123",
    );
    assert.equal(dest, null, "wildcard *.pxf.io subdomain must be covered by the guard");
  });

  test("every canonical AFFILIATE_REDIRECT_NETWORKS host bails on /redirect?url=", () => {
    for (const host of AFFILIATE_REDIRECT_NETWORKS) {
      // Synthesise a concrete hostname for wildcard entries.
      const concreteHost = host.startsWith("*.") ? `brand${host.slice(1)}` : host;
      const dest = genericUnwrapWithGuard(
        `https://${concreteHost}/redirect?url=https%3A%2F%2Fmerchant.example.com%2Fp`,
      );
      assert.equal(dest, null, `${host} (${concreteHost}) must NOT be unwrapped by the content layer`);
    }
  });

  // ── Non-affiliate hosts: existing unwrap behaviour is unchanged ──────────
  test("a plain non-affiliate tracker on /redirect?url= STILL unwraps", () => {
    const dest = genericUnwrapWithGuard(
      "https://tracker.example.com/redirect?url=https%3A%2F%2Fshop.com%2Fproduct",
    );
    assert.equal(dest, "https://shop.com/product", "non-affiliate hosts must be unaffected by the guard");
  });

  test("Reddit out.reddit.com/out?url= STILL unwraps (not an affiliate-redirect host)", () => {
    const dest = genericUnwrapWithGuard(
      "https://out.reddit.com/out?url=https%3A%2F%2Fexample.com%2Fpost",
    );
    assert.equal(dest, "https://example.com/post");
  });
});
