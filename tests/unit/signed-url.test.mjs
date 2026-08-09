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
