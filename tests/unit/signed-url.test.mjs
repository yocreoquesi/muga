/**
 * #1200 — signed-URL guard
 *
 * The reported symptom was "downloads are often broken on github". The chain:
 * a GitHub artifact link redirects to an Azure Blob SAS URL, MUGA's global
 * strip rule removed `spr` (signedProtocol), and Azure computes the signature
 * over that field — so the request came back 403 with nothing pointing at the
 * extension. "Often" rather than "always" because `spr` is optional in a SAS.
 *
 * These tests pin both halves of the fix: the detection rule itself, and the
 * guarantee that processUrl() leaves a signed URL completely untouched.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isSignedUrl,
  SIGNATURE_PARAM_NAMES,
  MIN_SIGNATURE_LENGTH,
  SIGNED_URL_REGEX_FILTER,
} from "../../src/lib/signed-url.js";
import { processUrl } from "../../src/lib/cleaner.js";

/** A realistic GitHub Actions artifact download target (the #1200 report). */
const GITHUB_ARTIFACT_SAS =
  "https://productionresultssa10.blob.core.windows.net/actions-results/1a2b/workflow-job-run-3c4d/artifacts/build.zip" +
  "?sv=2025-01-05&spr=https&se=2026-08-08T22%3A00%3A00Z&sr=b&sp=r" +
  "&sig=nBx7Qk2ZfLp9YwR4tVhC8mJdE6sA1uGvXo0KpTzN5Ic%3D&rscd=attachment%3B+filename%3Dbuild.zip";

const PREFS = {
  enabled: true,
  whitelist: [],
  blacklist: [],
  stripAllAffiliates: false,
};

/** An S3 SigV4 presigned URL, carrying one genuine tracking param (utm_source). */
const S3_SIGV4 =
  "https://bucket.s3.amazonaws.com/f.zip?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
  "&X-Amz-Credential=a&X-Amz-Date=20260101T000000Z&X-Amz-Expires=300" +
  "&X-Amz-SignedHeaders=host&X-Amz-Signature=0123456789abcdef0123456789abcdef" +
  "&utm_source=x";

// GITHUB_ARTIFACT_SAS alone has no strippable field (spr etc. are not in
// TRACKING_PARAMS), so a test using it bare would pass even with the #1476
// defect still present — it would prove nothing. Appending a genuine
// tracking param is what makes the assertion meaningful.
const AZURE_SAS_WITH_UTM = GITHUB_ARTIFACT_SAS + "&utm_source=newsletter";

describe("#1200 — isSignedUrl detection", () => {
  it("detects an Azure Blob SAS URL (the GitHub artifact case)", () => {
    assert.equal(isSignedUrl(GITHUB_ARTIFACT_SAS), true);
  });

  it("detects an AWS SigV4 presigned URL", () => {
    const url =
      "https://bucket.s3.amazonaws.com/file.zip?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=AKIA%2F20260808%2Fus-east-1%2Fs3%2Faws4_request" +
      "&X-Amz-Date=20260808T220000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host" +
      "&X-Amz-Signature=7f3c9a2e5b184d6079fe2c1ab8d43e5f6072a9b1c8d4e3f201a7b6c5d4e3f210";
    assert.equal(isSignedUrl(url), true);
  });

  it("detects a Google Cloud Storage V4 presigned URL", () => {
    const url =
      "https://storage.googleapis.com/bucket/object.bin?X-Goog-Algorithm=GOOG4-RSA-SHA256" +
      "&X-Goog-Expires=900&X-Goog-Signature=3ab91f7c25d84e60bf1a9c7d2e8f4056a1b3c5d7e9f0";
    assert.equal(isSignedUrl(url), true);
  });

  it("detects the older CloudFront / V2 `signature` form", () => {
    const url =
      "https://cdn.example.com/video.mp4?Expires=1800000000&Key-Pair-Id=APKAEXAMPLE" +
      "&Signature=Gt5xQm2Lp8Rv1Yw4Cz7Nk0Jh3Fd6Sa9Ub2Te5Oi8Pl1Mn4Kj7Hg0Fe3Dc6Ba9";
    assert.equal(isSignedUrl(url), true);
  });

  it("is case-insensitive on the parameter name", () => {
    assert.equal(
      isSignedUrl("https://x.example/f?SIG=nBx7Qk2ZfLp9YwR4tVhC8mJdE6sA1uGvXo0"),
      true
    );
  });

  it("ignores a short value under the same name (not a signature)", () => {
    const short = "a".repeat(MIN_SIGNATURE_LENGTH - 1);
    assert.equal(isSignedUrl(`https://x.example/p?sig=${short}`), false);
  });

  it("accepts a value exactly at the length floor", () => {
    const exact = "a".repeat(MIN_SIGNATURE_LENGTH);
    assert.equal(isSignedUrl(`https://x.example/p?sig=${exact}`), true);
  });

  it("does not fire on an ordinary tracking URL", () => {
    assert.equal(
      isSignedUrl("https://shop.example/product?utm_source=newsletter&fbclid=abcdefghijklmnop"),
      false
    );
  });

  it("does not fire on a URL with no query string", () => {
    assert.equal(isSignedUrl("https://example.com/path"), false);
  });

  it("never throws on malformed input, and fails toward cleaning", () => {
    // False, not true: a parse failure must never become a blanket exemption.
    for (const bad of ["not a url", "", null, undefined, 42, {}]) {
      assert.equal(isSignedUrl(/** @type {any} */ (bad)), false);
    }
  });
});

describe("#1200 — processUrl leaves signed URLs untouched", () => {
  it("returns the GitHub artifact SAS URL byte-for-byte unchanged", () => {
    const result = processUrl(GITHUB_ARTIFACT_SAS, PREFS);

    assert.equal(result.action, "untouched");
    assert.equal(result.cleanUrl, GITHUB_ARTIFACT_SAS);
  });

  it("preserves spr, the signed field that broke the download", () => {
    const result = processUrl(GITHUB_ARTIFACT_SAS, PREFS);
    const params = new URL(result.cleanUrl).searchParams;

    // Every field the SAS signature covers must survive. spr is the one the
    // global strip rule removed in #1200; the rest are asserted alongside it
    // so a future param addition cannot break a different field unnoticed.
    for (const field of ["sv", "spr", "se", "sr", "sp", "sig"]) {
      assert.ok(params.has(field), `SAS field "${field}" was stripped from a signed URL`);
    }
  });

  it("reports nothing removed, so the UI cannot claim a clean that did not happen", () => {
    const result = processUrl(GITHUB_ARTIFACT_SAS, PREFS);
    assert.deepEqual(result.removedTracking ?? [], []);
  });

  it("still strips tracking params on an unsigned URL from the same host", () => {
    const unsigned =
      "https://productionresultssa10.blob.core.windows.net/actions-results/x.zip?utm_source=github";
    const result = processUrl(unsigned, PREFS);

    assert.ok(!new URL(result.cleanUrl).searchParams.has("utm_source"));
  });
});

describe("#1200 — the DNR regex mirrors the runtime rule", () => {
  const re = new RegExp(SIGNED_URL_REGEX_FILTER, "i");

  it("matches exactly the URLs isSignedUrl() accepts", () => {
    const signed = [
      GITHUB_ARTIFACT_SAS,
      "https://b.s3.amazonaws.com/f?X-Amz-Signature=7f3c9a2e5b184d6079fe2c1ab8d43e5f",
      "https://storage.googleapis.com/b/o?X-Goog-Signature=3ab91f7c25d84e60bf1a9c7d2e8f4056",
      "https://cdn.example.com/v.mp4?Signature=Gt5xQm2Lp8Rv1Yw4Cz7Nk0Jh3Fd6Sa9Ub2",
    ];
    for (const url of signed) {
      assert.equal(re.test(url), isSignedUrl(url), `disagreement on ${url}`);
      assert.equal(re.test(url), true, `DNR regex missed ${url}`);
    }
  });

  it("agrees with isSignedUrl() on URLs that must stay cleanable", () => {
    const unsigned = [
      "https://shop.example/p?utm_source=news&fbclid=abcdefghijklmnop",
      "https://example.com/path",
      `https://x.example/p?sig=${"a".repeat(MIN_SIGNATURE_LENGTH - 1)}`,
      "https://example.com/p?design=something-long-enough-to-look-signed",
    ];
    for (const url of unsigned) {
      assert.equal(re.test(url), isSignedUrl(url), `disagreement on ${url}`);
      assert.equal(re.test(url), false, `DNR regex over-matched ${url}`);
    }
  });

  it("stays small enough that Chrome will not silently drop the rule", () => {
    // Chrome compiles DNR regexes with RE2 under a per-ruleset memory budget
    // and drops an oversized rule with no error. A dropped guard would look
    // exactly like a working one, so the size ceiling is asserted, not assumed.
    assert.ok(
      SIGNED_URL_REGEX_FILTER.length < 128,
      `regexFilter is ${SIGNED_URL_REGEX_FILTER.length} chars; keep it short`
    );
    // RE2 has no lookaround; using it would make the rule invalid, not slow.
    assert.ok(!/\(\?[=!<]/.test(SIGNED_URL_REGEX_FILTER), "regexFilter uses lookaround");
  });

  it("covers every documented signature param name", () => {
    for (const name of SIGNATURE_PARAM_NAMES) {
      const url = `https://example.com/x?${name}=${"z".repeat(MIN_SIGNATURE_LENGTH)}`;
      assert.equal(re.test(url), true, `DNR regex does not cover "${name}"`);
    }
  });
});

describe("#1476 — signed-URL guard survives a redirect-wrapper unwrap", () => {
  // The #1200 guard only ran on the pre-unwrap rawUrl. A signed URL reached
  // THROUGH a wrapper (Gmail/Google's google.com/url, Facebook's
  // l.facebook.com/l.php, and the same class of the other 26 unwrapped
  // wrappers) skipped it entirely: unwrapAndExtract replaced rawUrl with the
  // real destination and nothing re-checked it before the strip steps ran.
  // S3_SIGV4 and AZURE_SAS_WITH_UTM are module-scope (shared with the
  // canonical-extractor/AMP-resolve/invariant describe blocks below, #1490).

  it("google.com/url wrapping an Azure SAS URL: cleaned (unwrapped), but the signed query survives", () => {
    const wrapped = "https://www.google.com/url?q=" + encodeURIComponent(AZURE_SAS_WITH_UTM) + "&sa=D";
    const result = processUrl(wrapped, PREFS);

    assert.equal(result.action, "cleaned", "unwrap must still apply — only the strip is skipped");
    assert.deepEqual(result.removedTracking ?? [], []);
    const params = new URL(result.cleanUrl).searchParams;
    for (const field of ["sv", "spr", "se", "sr", "sp", "sig", "utm_source"]) {
      assert.ok(params.has(field), `SAS field "${field}" was stripped after unwrap`);
    }
  });

  it("l.facebook.com/l.php wrapping an S3 SigV4 URL: X-Amz-Signature survives, utm_source is NOT removed", () => {
    const wrapped = "https://l.facebook.com/l.php?u=" + encodeURIComponent(S3_SIGV4);
    const result = processUrl(wrapped, PREFS);

    assert.equal(result.action, "cleaned");
    assert.deepEqual(result.removedTracking ?? [], []);
    const params = new URL(result.cleanUrl).searchParams;
    assert.ok(params.has("X-Amz-Signature"), "X-Amz-Signature was stripped after unwrap — signature invalidated");
    assert.ok(params.has("utm_source"), "utm_source must NOT be removed once the destination is recognized as signed");
  });

  it("l.facebook.com/l.php wrapping the Azure SAS URL: same protection", () => {
    const wrapped = "https://l.facebook.com/l.php?u=" + encodeURIComponent(AZURE_SAS_WITH_UTM);
    const result = processUrl(wrapped, PREFS);

    assert.equal(result.action, "cleaned");
    assert.deepEqual(result.removedTracking ?? [], []);
    const params = new URL(result.cleanUrl).searchParams;
    assert.ok(params.has("sig"), "sig was stripped after unwrap");
    assert.ok(params.has("utm_source"), "utm_source must NOT be removed once the destination is recognized as signed");
  });

  it("a wrapped, UNSIGNED destination is still cleaned normally (no over-broad exemption)", () => {
    const wrapped = "https://www.google.com/url?q=" +
      encodeURIComponent("https://shop.example/product?utm_source=newsletter&size=m") + "&sa=D";
    const result = processUrl(wrapped, PREFS);

    assert.equal(result.action, "cleaned");
    assert.deepEqual(result.removedTracking, ["utm_source"]);
    assert.equal(result.cleanUrl, "https://shop.example/product?size=m");
    assert.equal(new URL(result.cleanUrl).hostname, "shop.example", "must actually land on the unwrapped destination host");
  });
});

// ── #1490 items 4/5: the OTHER two paths that replace rawUrl in
// unwrapAndExtract before the Step 1b re-check — canonical-extractor
// (opaque wrapper + canonicalBundle) and the Google AMP detour resolver
// (unwrapAmpUrl). #1476's own tests (above) only covered the explicit
// redirect-wrapper (unwrap()) path; these two never had a test proving Step
// 1b actually sees the value they substitute for rawUrl. ──────────────────

describe("#1490 — signed-URL guard survives the canonical-extractor path (#442/#1476)", () => {
  // t.co is an opaque wrapper: detectWrapper() matches it but unwrap() cannot
  // extract a destination from the URL itself, so the canonical extractor
  // tier (fed by canonicalBundle, e.g. <link rel="canonical">) is what
  // replaces rawUrl here — never the explicit wrapper-engine unwrap() the
  // #1476 tests above exercise.
  const CANONICAL_PREFS = { ...PREFS };

  it("a t.co link whose canonical destination is a signed S3 URL: cleaned, signature intact", () => {
    const s3Signed =
      "https://bucket.s3.amazonaws.com/f.zip?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=a&X-Amz-Date=20260101T000000Z&X-Amz-Expires=300" +
      "&X-Amz-SignedHeaders=host&X-Amz-Signature=0123456789abcdef0123456789abcdef" +
      "&utm_source=newsletter";
    const bundle = { linkCanonical: s3Signed, jsonLdId: null };

    const result = processUrl("https://t.co/OpaquePath", CANONICAL_PREFS, [], bundle, undefined, undefined);

    assert.equal(result.action, "cleaned", "unwrap via canonical extraction must still apply");
    assert.deepEqual(result.removedTracking ?? [], [], "the strip step must be skipped entirely for a signed destination");
    assert.equal(result.cleanUrl, s3Signed, "cleanUrl must be the canonical destination byte-for-byte, signature untouched");
    const params = new URL(result.cleanUrl).searchParams;
    assert.ok(params.has("X-Amz-Signature"), "X-Amz-Signature was stripped after canonical extraction");
    assert.ok(params.has("utm_source"), "utm_source must NOT be removed once the canonical destination is signed");
  });

  it("a t.co link whose canonical destination is an UNSIGNED URL is still cleaned normally", () => {
    const bundle = {
      linkCanonical: "https://shop.example/product?utm_source=twitter&size=m",
      jsonLdId: null,
    };
    const result = processUrl("https://t.co/OpaquePath2", CANONICAL_PREFS, [], bundle, undefined, undefined);

    assert.equal(result.action, "cleaned");
    assert.deepEqual(result.removedTracking, ["utm_source"]);
    assert.equal(result.cleanUrl, "https://shop.example/product?size=m");
  });
});

describe("#1490 — signed-URL guard and the AMP-detour resolve path (#1441/#1476)", () => {
  // unwrapAmpUrl() reconstructs the target as:
  //   "https://" + <rest-of-pathname-after-/amp/s/> + url.search + url.hash
  // — where `url.search` is the AMP URL's OWN query string, reused verbatim
  // (see src/lib/amp-unwrap.js). Only the origin+pathname move from the
  // pathname segment; the query string never changes at all.
  //
  // That makes this path structurally different from the wrapper-unwrap
  // (#1476) and canonical-extractor (above) paths this file also tests: both
  // of THOSE hide the destination's query string inside a single opaque,
  // percent-encoded parameter value (`?q=<encoded dest>`) or an out-of-band
  // canonicalBundle, so a `sig=`/`X-Amz-Signature=` field on the destination
  // is invisible to Step 0b's regex scan of the pre-unwrap rawUrl — Step 1b
  // (the #1476 fix) is what catches it.
  //
  // The AMP path cannot hide anything that way: isSignedUrl() matches on
  // `[?&](sig|signature|...)=...` literally present in the query string, and
  // the AMP target's query string is byte-identical to the AMP URL's own
  // query string. So whenever the resolved AMP destination is signed, the
  // ORIGINAL rawUrl the user navigated to already carries that exact signed
  // query too, and Step 0b (not Step 1b) already returns "untouched" before
  // unwrapAndExtract even runs. There is no rawUrl shape that reaches Step 1b
  // carrying a signed AMP destination Step 0b did not already catch — this
  // path genuinely cannot exercise Step 1b for a signed destination, so the
  // test below pins the (still correct, still safe) "untouched via Step 0b"
  // behavior instead of asserting a "cleaned" outcome that would never
  // happen and would be faking Step-1b coverage this path cannot provide.

  it("a google.com/amp/s/... URL carrying a signed destination query is caught by Step 0b, untouched", () => {
    const [origin, query] = S3_SIGV4.split("?");
    const publisherPart = origin.replace(/^https:\/\//, "");
    const ampWrapped = `https://www.google.com/amp/s/${publisherPart}?${query}`;

    const result = processUrl(ampWrapped, PREFS, [], undefined, undefined, undefined);

    assert.equal(result.action, "untouched", "Step 0b must exempt this before any unwrap runs");
    assert.deepEqual(result.removedTracking ?? [], []);
    assert.equal(result.cleanUrl, ampWrapped, "cleanUrl must be the ORIGINAL AMP URL — Step 0b returns before unwrap");
  });

  it("a google.com/amp/s/... detour resolving to an UNSIGNED destination is still cleaned normally", () => {
    const ampWrapped = "https://www.google.com/amp/s/shop.example/product?utm_source=newsletter&size=m";
    const result = processUrl(ampWrapped, PREFS, [], undefined, undefined, undefined);

    assert.equal(result.action, "cleaned");
    assert.deepEqual(result.removedTracking, ["utm_source"]);
    assert.equal(result.cleanUrl, "https://shop.example/product?size=m");
  });
});

// ── #1490 item 5: the invariant the Step 1b comment states but nothing
// asserted — "when unwrap did NOT change anything, rawUrl here is identical
// to the Step 0b input, which already returned 'untouched' above". Every
// processUrl assertion below checks action, removedTracking AND cleanUrl
// together, per this repo's testing rule (AGENTS.md).
describe("#1490 — Step 0b/1b invariant: unchanged signed input is untouched, a wrapped one is cleaned with the unwrapped signed URL", () => {
  it("an unwrapped, already-signed URL (no wrapper involved) returns action untouched with cleanUrl unchanged", () => {
    const result = processUrl(GITHUB_ARTIFACT_SAS, PREFS, [], undefined, undefined, undefined);

    assert.equal(result.action, "untouched");
    assert.deepEqual(result.removedTracking ?? [], []);
    assert.equal(result.cleanUrl, GITHUB_ARTIFACT_SAS);
  });

  it("a signed URL reached through a wrapper returns action cleaned with cleanUrl === the unwrapped signed URL", () => {
    const wrapped = "https://www.google.com/url?q=" + encodeURIComponent(AZURE_SAS_WITH_UTM) + "&sa=D";
    const result = processUrl(wrapped, PREFS, [], undefined, undefined, undefined);

    assert.equal(result.action, "cleaned");
    assert.deepEqual(result.removedTracking ?? [], []);
    assert.equal(result.cleanUrl, AZURE_SAS_WITH_UTM, "cleanUrl must be exactly the unwrapped signed URL, not further modified");
  });
});

// #1338: `spr` had no upstream evidence as a tracking param in either source,
// global or anchored, and stripping it is what broke the #1200 downloads. The
// signed-URL guard stays as the second line; the strip list must not name it.
describe("#1338 — spr is not a global tracking param", () => {
  it("is absent from TRACKING_PARAMS", async () => {
    const { TRACKING_PARAMS } = await import("../../src/lib/affiliates-data.js");
    assert.ok(!TRACKING_PARAMS.includes("spr"));
  });

  it("is absent from the generated DNR tracking rules", async () => {
    const { readFileSync } = await import("node:fs");
    const rules = readFileSync(new URL("../../src/rules/tracking-params.json", import.meta.url), "utf8");
    assert.ok(!/"spr"/.test(rules));
  });
});
