/**
 * MUGA — Regression tests for the #703 invariants (bounce-state-cleaner).
 *
 * Two related invariants pinned here:
 *
 * 1. No host in `AFFILIATE_REDIRECT_NETWORKS` (the 2.1 pass-through bucket)
 *    may appear in the inline `WRAPPERS` table inside
 *    `src/content/bounce-state-cleaner.js`. If one did, `inlineDetectWrapper`
 *    would match it during the race window before the bundle attaches and
 *    `cleanIfIntermediary` would wipe the network's localStorage — silently
 *    breaking the merchant's first-party attribution at landing.
 *
 *    The runtime guard `INLINE_AFFILIATE_REDIRECT_NETWORKS` is defense in
 *    depth; this test catches the regression at CI time.
 *
 * 2. The inline `INLINE_AFFILIATE_REDIRECT_NETWORKS` mirror must contain
 *    every host listed in the source-of-truth `AFFILIATE_REDIRECT_NETWORKS`
 *    from `src/lib/opaque-networks.js`. Drift here would defeat the guard
 *    silently — adding a new affiliate-redirect network without mirroring
 *    it into the inline list leaves the race-window gap open.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { AFFILIATE_REDIRECT_NETWORKS } from "../../src/lib/opaque-networks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOUNCE_SOURCE = readFileSync(
  join(__dirname, "../../src/content/bounce-state-cleaner.js"),
  "utf8",
);

/**
 * Pulls the WRAPPERS array literal from the IIFE source. The array can't
 * be imported (content scripts have no ES exports), so we parse the text.
 */
function parseInlineWrappers() {
  const match = BOUNCE_SOURCE.match(/const WRAPPERS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(match, "bounce-state-cleaner.js must contain a WRAPPERS array literal");
  const hostRe = /hostPatterns:\s*\[([^\]]+)\]/g;
  const hosts = [];
  let m;
  while ((m = hostRe.exec(match[1])) !== null) {
    for (const raw of m[1].split(",")) {
      const trimmed = raw.trim();
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        hosts.push(trimmed.slice(1, -1).toLowerCase());
      }
    }
  }
  return hosts;
}

function parseInlineAffiliateMirror() {
  const match = BOUNCE_SOURCE.match(
    /const INLINE_AFFILIATE_REDIRECT_NETWORKS\s*=\s*\[([\s\S]*?)\];/,
  );
  assert.ok(
    match,
    "bounce-state-cleaner.js must contain an INLINE_AFFILIATE_REDIRECT_NETWORKS array literal (the inline guard mirror)",
  );
  const entries = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase());
  return entries;
}

describe("#703 — bounce-state WRAPPERS does not overlap AFFILIATE_REDIRECT_NETWORKS", () => {
  const inlineWrapperHosts = parseInlineWrappers();

  test("the WRAPPERS array is non-empty (sanity check)", () => {
    assert.ok(
      inlineWrapperHosts.length > 0,
      "bounce-state WRAPPERS is empty — did the parser find the right literal?",
    );
  });

  test("no WRAPPERS host appears in AFFILIATE_REDIRECT_NETWORKS", () => {
    const affiliateSet = new Set(
      AFFILIATE_REDIRECT_NETWORKS.map((h) => h.toLowerCase()),
    );
    for (const host of inlineWrapperHosts) {
      assert.ok(
        !affiliateSet.has(host),
        `${host} is in bounce-state WRAPPERS AND in AFFILIATE_REDIRECT_NETWORKS — wiping its storage would break 2.1 pass-through attribution`,
      );
    }
  });

  test("awin1.com specifically is NOT in WRAPPERS (#684 / #703)", () => {
    assert.ok(
      !inlineWrapperHosts.includes("awin1.com"),
      "awin1.com was retired from bounce-state WRAPPERS per #684 — see ADR-0003",
    );
  });
});

describe("#703 — INLINE_AFFILIATE_REDIRECT_NETWORKS mirrors the source-of-truth", () => {
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
        `${host} is in AFFILIATE_REDIRECT_NETWORKS but missing from INLINE_AFFILIATE_REDIRECT_NETWORKS — the race-window guard will not cover it`,
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
        `${host} is in INLINE_AFFILIATE_REDIRECT_NETWORKS but not in AFFILIATE_REDIRECT_NETWORKS — drift means the mirror is stale`,
      );
    }
  });

  test("inlineDetectWrapper short-circuits with isInlineAffiliateRedirectNetwork", () => {
    // Structural check: the early-return guard must be wired into the
    // detector. Without this call, the mirror is a dead constant.
    assert.ok(
      /isInlineAffiliateRedirectNetwork\(host\)/.test(BOUNCE_SOURCE),
      "inlineDetectWrapper must call isInlineAffiliateRedirectNetwork(host) and return null when true",
    );
  });
});
