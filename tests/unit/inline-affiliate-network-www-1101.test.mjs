/**
 * MUGA — Regression tests for #1101.
 *
 * Bug: the inline `isInlineAffiliateRedirectNetwork(host)` guard duplicated
 * into the two content scripts (src/content/bounce-state-cleaner.js and
 * src/content/cleaner.js — content scripts can't import ES modules, hence
 * the copy) does a plain `host === entry` comparison against
 * `INLINE_AFFILIATE_REDIRECT_NETWORKS`. Unlike its source of truth
 * (`isAffiliateRedirectNetwork` / `matches()` in src/lib/opaque-networks.js,
 * which strips a leading "www." before comparing), the inline copy does NOT
 * normalize "www.". Most entries in the mirror have an explicit "www.foo"
 * duplicate (e.g. "awin1.com" + "www.awin1.com"), which accidentally masked
 * the gap — but "anrdoezrs.net" (a CJ Affiliate redirect domain) has no
 * "www." variant listed, so `https://www.anrdoezrs.net/click...` was NOT
 * recognized as an affiliate-redirect host and got unwrapped, bypassing the
 * network's 30x and the merchant's first-party attribution cookie.
 *
 * Fix: strip a leading "www." inside isInlineAffiliateRedirectNetwork()
 * before the comparison, in both content-script copies, matching
 * opaque-networks.js's matches().
 *
 * These tests extract and execute the REAL function source (brace-matching,
 * the established pattern for these un-importable IIFE content scripts —
 * see tests/unit/onboarding-tab-dedup-967.test.mjs) rather than a hand-written
 * replica, so they exercise the actual shipped code.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

/** Extracts a top-level `const <name> = [ ... ];` array literal via source slicing. */
function extractConstArraySource(src, name) {
  const re = new RegExp(`const ${name}\\s*=\\s*\\[[\\s\\S]*?\\];`);
  const match = src.match(re);
  assert.ok(match, `${name} array literal must exist in source`);
  return match[0];
}

/** Extracts a top-level `function <name>(...) { ... }` block via brace matching. */
function extractFunctionSource(src, name) {
  const idx = src.indexOf(`function ${name}`);
  assert.ok(idx !== -1, `${name} must be defined as a function`);
  let depth = 0;
  let started = false;
  let i = idx;
  for (; i < src.length; i++) {
    if (src[i] === "{") { depth++; started = true; }
    else if (src[i] === "}") {
      depth--;
      if (started && depth === 0) { i++; break; }
    }
  }
  return src.slice(idx, i);
}

/** Builds a callable isInlineAffiliateRedirectNetwork bound to the real source. */
function buildIsInlineAffiliateRedirectNetwork(src) {
  const arraySrc = extractConstArraySource(src, "INLINE_AFFILIATE_REDIRECT_NETWORKS");
  const fnSrc = extractFunctionSource(src, "isInlineAffiliateRedirectNetwork");
  const factory = new Function(
    `"use strict";
     ${arraySrc}
     ${fnSrc}
     return isInlineAffiliateRedirectNetwork;`,
  );
  return factory();
}

const SOURCES = [
  ["src/content/bounce-state-cleaner.js", resolve(root, "src/content/bounce-state-cleaner.js")],
  ["src/content/cleaner.js", resolve(root, "src/content/cleaner.js")],
];

describe("#1101 — isInlineAffiliateRedirectNetwork does not normalize www.", () => {
  for (const [label, path] of SOURCES) {
    const source = readFileSync(path, "utf8");
    const isInlineAffiliateRedirectNetwork = buildIsInlineAffiliateRedirectNetwork(source);

    test(`${label}: www.anrdoezrs.net (no explicit www. entry) is recognized as an affiliate-redirect host`, () => {
      assert.equal(
        isInlineAffiliateRedirectNetwork("www.anrdoezrs.net"),
        true,
        "a www.-prefixed affiliate-redirect host must be recognized, matching opaque-networks.js's www.-stripping behavior",
      );
    });

    test(`${label}: bare anrdoezrs.net is still recognized (no regression)`, () => {
      assert.equal(isInlineAffiliateRedirectNetwork("anrdoezrs.net"), true);
    });

    test(`${label}: an unrelated www.-prefixed host is NOT recognized`, () => {
      assert.equal(isInlineAffiliateRedirectNetwork("www.example.com"), false);
    });
  }
});
