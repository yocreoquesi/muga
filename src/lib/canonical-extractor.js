/**
 * MUGA: Canonical URL Extractor (B7, #442)
 *
 * Second tier in the cleaner pipeline:
 *   Wrapper Engine → Canonical Extractor → existing cleaner.
 *
 * Consulted only when the wrapper engine DETECTED a wrapper host but the
 * destination URL could NOT be extracted from the URL itself ("opaque
 * wrapper" — t.co, link.medium.com, …). Before falling back to a network
 * resolution we do not perform, this module gives the page DOM a chance
 * to volunteer the canonical URL via:
 *   - <link rel="canonical">       (W3C standard; preferred)
 *   - JSON-LD @id                  (schema.org metadata; secondary)
 *
 * ── Why a pure function over a "canonical bundle" object ──────────────────
 * The MUGA test runner is plain `node:test` with no jsdom and no
 * DOMParser. Accepting a Document/DocumentFragment directly would force
 * tests to ship a DOM mock for every fixture. Instead, the caller (the
 * content script — the only place with real DOM access) extracts the two
 * raw values up-front:
 *
 *   const bundle = {
 *     linkCanonical: document.querySelector('link[rel="canonical"]')?.href,
 *     jsonLdId:      readJsonLdId(document), // see content script
 *   };
 *
 * and passes the bundle to processUrl(). This module makes the W3C-vs-
 * JSON-LD precedence decision and validates the resulting URL. Pure,
 * deterministic, jsdom-free.
 *
 * ── Validation rules (consistent with the rest of the codebase) ──────────
 *   - http:// or https:// only — never javascript:, data:, file:, etc.
 *   - Length cap ≤ 2000 chars (matches wrapper-engine and cleaner caps).
 *   - Malformed strings are silently rejected (try/catch around `new URL`).
 *   - When linkCanonical fails validation, jsonLdId is given a chance.
 */

const URL_LENGTH_CAP = 2000;

/**
 * Returns the input string if it parses to a well-formed http(s) URL of
 * acceptable length, otherwise null. Trims surrounding whitespace before
 * parsing — common in DOM-extracted hrefs.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
function validateHttpUrl(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > URL_LENGTH_CAP) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  // Only http(s) — match the rest of the cleaner / wrapper-engine policy.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return trimmed;
}

/**
 * Pure canonical extractor.
 *
 * Decision rules (per acceptance criteria of #442):
 *   1. If linkCanonical is a valid http(s) URL → return it.
 *      (W3C `<link rel="canonical">` outranks JSON-LD `@id` even when both
 *      are present and disagree.)
 *   2. Otherwise, if jsonLdId is a valid http(s) URL → return it.
 *   3. Otherwise → null (caller falls through to the rest of the pipeline).
 *
 * @param {{linkCanonical?: string|null, jsonLdId?: string|null}|null} bundle
 *   A "canonical bundle" produced by the content script from the parsed
 *   DOM. Either field may be absent, null, or empty string. Passing
 *   undefined/null bundles is supported (returns null) so background
 *   workers — which never have DOM access — can call freely.
 * @returns {string|null} The canonical URL, or null if none usable.
 */
export function extractCanonical(bundle) {
  if (!bundle || typeof bundle !== "object") return null;

  // 1. linkCanonical wins on validity. We do NOT short-circuit on its
  // mere presence — a malformed canonical href on the page must not poison
  // the result; jsonLdId still gets a chance.
  const link = validateHttpUrl(bundle.linkCanonical);
  if (link) return link;

  // 2. JSON-LD @id as fallback.
  const id = validateHttpUrl(bundle.jsonLdId);
  if (id) return id;

  // 3. Neither slot yielded a usable URL.
  return null;
}
