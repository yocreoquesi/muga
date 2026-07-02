/**
 * MUGA — Honor Creator Mode decision module (#452, B14).
 *
 * Pure module — no DOM, no network, no clock. Given a URL, an optional
 * navigation referrer, and the user's prefs, decides whether MUGA should
 * "honor" the creator's referral chain (i.e. let a social/shortener
 * redirect wrapper URL pass through unmodified) or fall back to the default
 * tracking-strip + unwrap pipeline.
 *
 * Three conditions must ALL hold for an honor decision:
 *   1. `prefs.honorCreatorMode === true` (user opted in)
 *   2. The URL is a recognized wrapper per Wrapper Engine's
 *      `detectWrapper()` — social redirects (e.g. `l.facebook.com`) and
 *      link shorteners (e.g. `t.co`, `bit.ly`)
 *   3. The navigation referrer matches an entry in `prefs.creatorAllowlist`
 *
 * If any condition fails, the result is `{ honor: false }` and the caller
 * (cleaner.js) proceeds with default behaviour. This module never mutates
 * its inputs and never throws — defensive against malformed prefs and
 * non-string URLs.
 *
 * ── Scope: affiliate-redirect networks are NOT decided here ────────────────
 *
 * Affiliate-redirect networks (Awin, Skimlinks, ShareASale, Impact, Rakuten,
 * TradeTracker) are excluded from `detectWrapper()` (see
 * `wrapper-engine.js`'s `MUGA_EXCLUDED_IDS` and
 * `AFFILIATE_REDIRECT_NETWORKS` in `opaque-networks.js`, #907). Their
 * creator referral is honored by DEFAULT via pass-through — the request
 * always reaches the network's own redirect so the 30x can populate the
 * merchant's first-party cookie — regardless of `honorCreatorMode` or the
 * allowlist. The destination is still denoised afterward by the normal
 * DNR + content-script cleaning pipeline once it lands on the merchant.
 * This module and its `honorCreatorMode` preference never apply to those
 * networks; `shouldHonor()` will always return `{ honor: false }` for a
 * URL that `detectWrapper()` doesn't recognize.
 *
 * ── Design notes ──────────────────────────────────────────────────────────
 *
 * Network classification reuses Wrapper Engine — single source of truth for
 * "is this a (social/shortener) redirect wrapper?". When `detectWrapper(url)`
 * returns null, there's nothing to honor here (either the URL isn't a
 * wrapper at all, or it's an affiliate-redirect network already handled by
 * unconditional pass-through, above).
 *
 * Referrer matching is intentionally `host + pathname` prefix-based:
 *   - Strip `www.` from the referrer host (the most common alias) so users
 *     don't have to add both `youtube.com/@foo` and `www.youtube.com/@foo`.
 *   - Compare the lowercased `host + path` against the normalized entry.
 *   - Match iff the referrer string starts with the entry AND the next
 *     character is either end-of-string or a path/query/fragment boundary.
 *     This blocks `example.com` from matching `evilexample.com` and prevents
 *     `youtube.com/@foo` from matching `youtube.com/@foobar`.
 *
 * Entry normalization is delegated to `creator-allowlist.js#normalizeEntry`
 * to guarantee identical semantics with the storage CRUD module — entries
 * are written and read through the same normalizer.
 */

import { detectWrapper } from "./wrapper-engine.js";
import { normalizeEntry } from "./creator-allowlist.js";

/**
 * Extracts a comparable `host + pathname` key from a referrer URL.
 * Lowercases, strips a leading `www.` from the host, and concatenates the
 * pathname (which always begins with `/` per the URL spec when present).
 * Returns "" when the input is unusable.
 *
 * @param {string|null|undefined} referrer
 * @returns {string} e.g. "youtube.com/@foo/community" or "" on failure.
 */
function refKey(referrer) {
  if (typeof referrer !== "string" || !referrer) return "";
  let parsed;
  try {
    parsed = new URL(referrer);
  } catch {
    return "";
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  // pathname is always at least "/"; concatenating gives "host" or "host/path".
  // Lowercase the path too — allowlist entries are normalized lowercase by
  // creator-allowlist.normalizeEntry, and URL paths can carry mixed case
  // (e.g. `/@LinusTechTips`). Without this, `youtube.com/@LinusTechTips`
  // would fail to match the stored entry `youtube.com/@linustechtips`.
  // Strip a trailing slash so `host/` and `host` compare equal — entries are
  // stored without trailing slashes (see creator-allowlist.normalizeEntry).
  const path = parsed.pathname === "/" ? "" : parsed.pathname.toLowerCase();
  return host + path;
}

/**
 * Returns the matching allowlist entry for a navigation referrer, or null
 * when nothing matches. The entry is returned in its normalized form (the
 * same form that lives in `prefs.creatorAllowlist`), suitable for
 * round-tripping into popup UI.
 *
 * Matching is prefix-based on `host + pathname` after `www.` stripping.
 * The match boundary is enforced so partial host overlaps (e.g.
 * `example.com` vs `evilexample.com`) and partial path segments (e.g.
 * `@foo` vs `@foobar`) never produce false positives.
 *
 * @param {string|null|undefined} referrer
 * @param {string[]|undefined}    allowlist
 * @returns {string|null} the matching normalized entry, or null
 */
export function matchesAllowlist(referrer, allowlist) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return null;
  const key = refKey(referrer);
  if (!key) return null;

  for (const raw of allowlist) {
    const entry = normalizeEntry(raw);
    if (!entry) continue;
    if (!key.startsWith(entry)) continue;
    // Boundary check: the next char in `key` must be end-of-string or a
    // path/query/fragment separator. Otherwise `example.com` would match
    // `evilexample.com` (impossible because we anchored at start, but the
    // path side still needs the boundary to block `@foo` matching `@foobar`).
    const next = key.charAt(entry.length);
    if (next === "" || next === "/" || next === "?" || next === "#") {
      return entry;
    }
  }
  return null;
}

/**
 * Decides whether the cleaner pipeline should honor the creator's referral
 * chain on this navigation. Pure inspection — never mutates inputs.
 *
 * Only applies to wrappers `detectWrapper()` recognizes, i.e. social
 * redirects and link shorteners (e.g. `"facebook-l"`, `"tco"`). Affiliate-
 * redirect networks (e.g. Skimlinks, Awin) never reach this function with
 * `honor: true` — see the module header's "Scope" note above.
 *
 * @param {{ url: any, referrer: string|null|undefined, prefs: object }} args
 * @returns {{ honor: boolean, network?: string, creator?: string }}
 *   When `honor === true`, `network` is the wrapper id (e.g. `"facebook-l"`)
 *   and `creator` is the matching normalized allowlist entry. Otherwise
 *   only `honor: false` is returned.
 */
export function shouldHonor({ url, referrer, prefs }) {
  if (!prefs || prefs.honorCreatorMode !== true) return { honor: false };
  if (typeof url !== "string" || !url) return { honor: false };

  const wrapper = detectWrapper(url);
  if (!wrapper) return { honor: false };

  const creator = matchesAllowlist(referrer, prefs.creatorAllowlist);
  if (!creator) return { honor: false };

  return { honor: true, network: wrapper.id, creator };
}
