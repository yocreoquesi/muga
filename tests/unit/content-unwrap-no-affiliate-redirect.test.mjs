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
