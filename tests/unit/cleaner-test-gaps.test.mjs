/**
 * MUGA — Closes #630 conceptual test gaps.
 *
 * Three behaviors that are correct today but were NOT regression-protected
 * by any prior test. A future refactor could silently break any of them.
 *
 *   1. honor-creator × stripAllAffiliates flag precedence matrix.
 *   2. Wrapper engine recursion bounds (deep nesting; `seen` guard
 *      documented but not directly triggerable with current wrappers — see
 *      the describe block for the rationale).
 *   3. Param-classifier `_skipBoundedScope` flag — fires on every URL whose
 *      hostname is a known wrapper OR a known affiliate-redirect host.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { processUrl } from "../../src/lib/cleaner.js";
import { unwrap, detectWrapper } from "../../src/lib/wrapper-engine.js";
import { classify as classifyParams, PARAM_PAIRS } from "../../src/lib/param-classifier.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. honor-creator × stripAllAffiliates precedence matrix
// ─────────────────────────────────────────────────────────────────────────────
//
// honor-creator is checked at the very top of the pipeline (step 0a in
// unwrapAndExtract). When the user is on Honor Creator Mode AND the URL is a
// known redirect-network wrapper AND the navigation referrer matches an
// allowlist entry, the URL passes through unmodified — even when other prefs
// (stripAllAffiliates, blacklist, …) would normally rewrite it. This is the
// design contract: honor-creator is an explicit "this is the creator's link;
// don't touch it" override.

const SKIMLINKS = "https://go.redirectingat.com/?id=1&url=https%3A%2F%2Famazon.com%2Fdp%2FB000";
const REF_MATCH = "https://www.youtube.com/@LinusTechTips/community";
const REF_MISS = "https://news.ycombinator.com/";
const ALLOWLIST = ["youtube.com/@linustechtips"];

describe("#630 gap 1: honor-creator × stripAllAffiliates precedence", () => {
  test("BOTH true + matching referrer → honor wins, URL untouched", () => {
    const result = processUrl(
      SKIMLINKS,
      {
        enabled: true,
        honorCreatorMode: true,
        stripAllAffiliates: true,
        creatorAllowlist: ALLOWLIST,
      },
      [],
      undefined,
      undefined,
      REF_MATCH,
    );
    assert.equal(result.action, "honored-creator");
    assert.equal(result.cleanUrl, SKIMLINKS, "honor must keep the URL byte-identical");
    assert.equal(result.network, "skimlinks");
    assert.equal(result.creator, "youtube.com/@linustechtips");
  });

  test("honorCreatorMode=false + stripAllAffiliates=true + match → strip path runs (no honor)", () => {
    const result = processUrl(
      SKIMLINKS,
      {
        enabled: true,
        honorCreatorMode: false,
        stripAllAffiliates: true,
        creatorAllowlist: ALLOWLIST,
      },
      [],
      undefined,
      undefined,
      REF_MATCH,
    );
    assert.notEqual(result.action, "honored-creator");
    // Skimlinks gets unwrapped to the merchant; the strip path then runs.
    assert.ok(result.cleanUrl.startsWith("https://amazon.com/dp/B000"));
  });

  test("honorCreatorMode=true + stripAllAffiliates=true + non-matching referrer → strip path runs", () => {
    const result = processUrl(
      SKIMLINKS,
      {
        enabled: true,
        honorCreatorMode: true,
        stripAllAffiliates: true,
        creatorAllowlist: ALLOWLIST,
      },
      [],
      undefined,
      undefined,
      REF_MISS,
    );
    assert.notEqual(result.action, "honored-creator");
    assert.ok(result.cleanUrl.startsWith("https://amazon.com/dp/B000"));
  });

  test("creatorAllowlist 'youtube.com/@foo' + referrer on alien subdomain 'm.youtube.com/@foo' → NOT honored", () => {
    // refKey strips only the literal `www.` prefix; arbitrary subdomains
    // (m., mobile., music.) do NOT match the bare-domain allowlist entry.
    // This pins that the allowlist is host-precise (not eTLD+1).
    const result = processUrl(
      SKIMLINKS,
      {
        enabled: true,
        honorCreatorMode: true,
        creatorAllowlist: ALLOWLIST,
      },
      [],
      undefined,
      undefined,
      "https://m.youtube.com/@LinusTechTips/community",
    );
    assert.notEqual(result.action, "honored-creator");
  });

  test("creatorAllowlist 'youtube.com/@foo' + referrer on path-prefix 'youtube.com/@foobar' → NOT honored", () => {
    // The match boundary check blocks `@foo` from matching `@foobar` —
    // the next char in the referrer key must be EOS or a / ? # separator.
    const result = processUrl(
      SKIMLINKS,
      {
        enabled: true,
        honorCreatorMode: true,
        creatorAllowlist: ALLOWLIST,
      },
      [],
      undefined,
      undefined,
      "https://www.youtube.com/@LinusTechTipsExtended/post",
    );
    assert.notEqual(result.action, "honored-creator");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Wrapper engine recursion bounds — deep nesting + seen-guard rationale
// ─────────────────────────────────────────────────────────────────────────────
//
// The unwrap loop is bounded by `maxHops` (default 3) AND by a `seen` Set
// that catches an extract returning a URL already in the chain. The maxHops
// bound is the primary defense against pathological nesting (and the one a
// real adversarial URL would exercise — AMP wrappers can stack 4+ deep).
// The seen guard is defense-in-depth — with the current wrapper recipes it
// cannot be triggered by static construction (every extract produces a
// strictly shorter URL than its input, so `A = wrap(A)` is mathematically
// impossible). It exists to protect against future wrapper recipes whose
// extract is non-shortening, and it's pinned indirectly by the maxHops
// tests (both serve the same "infinite loop" purpose).
//
// What we DO test here:
//   - Pathological depth (10 levels nested) terminates at default maxHops=3
//   - Custom maxHops respects the depth bound (maxHops=5 on 10 levels)
//   - A malformed inner extract (no `url=`) breaks early without throwing

function wrapSkim(dest) {
  return "https://go.redirectingat.com/?url=" + encodeURIComponent(dest);
}

describe("#630 gap 2: wrapper engine recursion bounds", () => {
  test("10 levels of nesting + default maxHops=3 → hops=3, output still wrapped at level 7", () => {
    let current = "https://merchant.example.com/product";
    for (let i = 0; i < 10; i++) current = wrapSkim(current);
    const result = unwrap(current);
    assert.ok(result, "deep chain should produce a result");
    assert.equal(result.hops, 3, "default maxHops caps recursion at 3 even on a 10-level chain");
    // After 3 unwraps from level 10 we are at level 7 — still a wrapper.
    assert.ok(
      detectWrapper(result.unwrapped) !== null,
      "the depth-bounded result is still a wrapper URL (proves we did not exhaust the chain)",
    );
  });

  test("10-level chain + maxHops=5 → hops=5", () => {
    let current = "https://merchant.example.com/product";
    for (let i = 0; i < 10; i++) current = wrapSkim(current);
    const result = unwrap(current, { maxHops: 5 });
    assert.ok(result);
    assert.equal(result.hops, 5);
    assert.ok(detectWrapper(result.unwrapped) !== null, "still a wrapper at level 5");
  });

  test("malformed inner extract (no url=) → terminates mid-chain, returns last successful unwrap", () => {
    // outer wraps inner; inner is a Skimlinks URL with no `url=` param.
    // The first extract succeeds (yields inner), the second fails (no url=
    // on inner), and the loop breaks with hops=1.
    const inner = "https://go.redirectingat.com/?id=42&xs=1";
    const outer = wrapSkim(inner);
    const result = unwrap(outer);
    assert.ok(result, "first hop succeeded — result is non-null");
    assert.equal(result.hops, 1, "second extract returned null → loop breaks at hop 1");
    assert.equal(result.unwrapped, inner);
  });

  test("unwrap of a non-wrapper URL returns null (no hops, no work)", () => {
    assert.equal(unwrap("https://merchant.example.com/p?id=1"), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. param-classifier _skipBoundedScope short-circuit
// ─────────────────────────────────────────────────────────────────────────────
//
// The bounded-scope classifier (#530) strips an ambiguous param (PARAM_PAIRS
// — `pid`, `icid`, `icmp`, `CMP`, `NLID`, `soc_src`) ONLY when an anchor
// tracker (utm_*, gclid, fbclid, …) co-occurs in the URL. Cleaner.js sets
// `_skipBoundedScope` on the classifier prefs when the URL is on a network-
// redirect host (a wrapper OR an affiliate-redirect network from
// AFFILIATE_REDIRECT_NETWORKS) so the contextual rule MUST NOT fire on the
// network's own redirect page (spec §3.2 step 6).
//
// Without this flag, an affiliate-redirect URL carrying `pid=...&utm_source=…`
// would have `pid` stripped — even though the network page is the
// publisher's click endpoint and its params are load-bearing for attribution.

describe("#630 gap 3: param-classifier _skipBoundedScope short-circuit", () => {
  // Pick a known ambiguous + an anchor. The setup matches what cleaner.js
  // would compute when running on an affiliate-redirect host (e.g. awin1.com).
  const ambiguousParam = PARAM_PAIRS[0]; // "pid"
  const urlWithBoth = `https://example.com/page?${ambiguousParam}=42&utm_source=foo`;

  test("without _skipBoundedScope: ambiguous param is stripped when an anchor co-occurs", () => {
    const result = classifyParams(urlWithBoth, {});
    assert.ok(
      result.stripParams.includes(ambiguousParam),
      `${ambiguousParam} should be in stripParams when utm_source anchors the strip`,
    );
  });

  test("with _skipBoundedScope=true: ambiguous param is preserved even with anchor present", () => {
    const result = classifyParams(urlWithBoth, { _skipBoundedScope: true });
    assert.ok(
      !result.stripParams.includes(ambiguousParam),
      `${ambiguousParam} must NOT be stripped when _skipBoundedScope is set — the page is a network redirect`,
    );
  });

  test("processUrl on an affiliate-redirect host (awin1.com) does NOT strip ambiguous params", () => {
    // awin1.com is in AFFILIATE_REDIRECT_NETWORKS — cleaner.js sets
    // _skipBoundedScope = true and the bounded-scope strip is suppressed.
    // utm_source is still stripped (universal strip path); pid survives.
    const input = `https://awin1.com/cread.php?awinmid=1&${ambiguousParam}=42&utm_source=foo&p=https%3A%2F%2Fmerchant.com`;
    const result = processUrl(input, { enabled: true });
    const u = new URL(result.cleanUrl);
    assert.ok(
      u.searchParams.has(ambiguousParam),
      `${ambiguousParam} must survive on awin1.com — it is a network-redirect host (affiliate pass-through)`,
    );
  });

  test("processUrl on a non-redirect host DOES strip the ambiguous param when anchor is present", () => {
    // Baseline contrast: same params, but on a regular merchant — bounded
    // scope SHOULD fire because the page is not a network redirect.
    const input = `https://example.com/page?${ambiguousParam}=42&utm_source=foo`;
    const result = processUrl(input, { enabled: true });
    const u = new URL(result.cleanUrl);
    assert.equal(
      u.searchParams.has(ambiguousParam),
      false,
      `${ambiguousParam} should be stripped here — bounded scope fires on a non-redirect host`,
    );
  });
});
