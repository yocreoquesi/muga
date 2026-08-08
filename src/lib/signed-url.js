/**
 * MUGA: signed-URL guard (#1200)
 *
 * A presigned URL is a capability: the query string is not metadata about the
 * request, it IS the credential. The signature is computed over the other
 * query fields, so removing ANY of them invalidates it and the server answers
 * 403. That makes a signed URL the one case where MUGA's normal instinct —
 * "an unknown param is probably tracking, strip it" — is actively harmful.
 *
 * This is not hypothetical. Issue #1200 reported broken GitHub artifact
 * downloads. GitHub redirects those to an Azure Blob SAS URL, and MUGA's
 * global strip rule removed `spr` (signedProtocol), which is one of the
 * fields the SAS signature covers. The download failed with no visible cause,
 * and it failed "often" rather than always because `spr` is optional in a SAS.
 *
 * The durable fix is to recognise the shape rather than to chase param names:
 * when a URL carries a signature, MUGA leaves the whole query string alone.
 *
 * Detection rule, deliberately shared with the DNR layer below so the network
 * layer and the runtime cleaner can never disagree:
 *
 *   A URL is signed when it carries a query parameter named `sig`,
 *   `signature`, `x-amz-signature` or `x-goog-signature` whose value is at
 *   least MIN_SIGNATURE_LENGTH characters.
 *
 * Those four names cover Azure Blob SAS (`sig`), AWS SigV4 presigned URLs and
 * S3-compatible stores (`x-amz-signature`), Google Cloud Storage V4
 * (`x-goog-signature`), and the older CloudFront / GCS V2 / S3 V2 form
 * (`signature`). The length floor is what keeps the guard honest: a real
 * signature is a long base64 or hex digest, so it separates a credential from
 * a short marketing value that happens to share the name.
 *
 * The trade-off is explicit: a site could in principle escape cleaning by
 * adding a long `sig` param. Breaking a download is a visible, unattributable
 * failure the user blames on the site; leaving one URL uncleaned is not. The
 * guard is deliberately biased toward not breaking the web.
 */

/**
 * Query parameter names that carry a cryptographic signature over the rest of
 * the URL. Lower-case; lookups are case-insensitive.
 */
export const SIGNATURE_PARAM_NAMES = [
  "sig",               // Azure Blob / Storage SAS
  "signature",         // AWS S3 V2, CloudFront, Google Cloud Storage V2
  "x-amz-signature",   // AWS SigV4 presigned (and S3-compatible stores)
  "x-goog-signature",  // Google Cloud Storage V4 presigned
];

/**
 * Minimum value length for a signature param to count as a real signature.
 * The shortest real-world digest in use here is a 128-bit hex/base64 blob;
 * 16 characters sits below every one of them while still excluding the short
 * values a tracking param would carry.
 */
export const MIN_SIGNATURE_LENGTH = 16;

/**
 * DNR `regexFilter` expressing exactly the rule documented above, for the
 * static "allow" rule that exempts signed URLs at the network layer.
 *
 * Kept deliberately small and bounded: Chrome compiles DNR regexes with RE2
 * under a per-ruleset memory budget and silently DROPS a rule whose regex is
 * too large, with no error anywhere. A dropped rule here would mean signed
 * URLs get stripped again with the guard appearing to be in place, so this
 * pattern must stay short. It uses no lookaround, which RE2 does not support.
 *
 * DNR regex matching is case-insensitive unless `isUrlFilterCaseSensitive` is
 * set, which is why the alternation is lower-case only.
 */
export const SIGNED_URL_REGEX_FILTER =
  `[?&](sig|signature|x-amz-signature|x-goog-signature)=[^&]{${MIN_SIGNATURE_LENGTH},}`;

/**
 * Is this URL cryptographically signed, and therefore off-limits to cleaning?
 *
 * Fail-safe direction matters here and is the opposite of most guards in this
 * codebase: on malformed input this returns false (not signed, clean it
 * normally) rather than true, so a parse failure can never turn into a silent
 * blanket exemption from cleaning.
 *
 * @param {URL|string} url - Parsed URL or raw URL string.
 * @returns {boolean} True when the URL carries a signature parameter.
 */
export function isSignedUrl(url) {
  let params;
  try {
    params = (typeof url === "string" ? new URL(url) : url).searchParams;
    if (!params) return false;
  } catch {
    return false;
  }

  let signed = false;
  // forEach rather than iteration + spread: under Firefox's Xray vision a
  // spread over searchParams can yield the wrong view (see the same pattern
  // and #1009 in cleaner.js#stripTrackingParams).
  params.forEach((value, name) => {
    if (signed) return;
    if (
      SIGNATURE_PARAM_NAMES.includes(name.toLowerCase()) &&
      typeof value === "string" &&
      value.length >= MIN_SIGNATURE_LENGTH
    ) {
      signed = true;
    }
  });

  return signed;
}
