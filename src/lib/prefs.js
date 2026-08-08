/**
 * MUGA: User preferences
 *
 * User preference defaults and accessors (getPrefs / setPrefs).
 * Extracted from storage.js (#826 PR2) — pure relocation, zero behaviour change.
 *
 * Storage bucket: chrome.storage.sync (synced across devices, 100 KB quota).
 * Consent-tier fields (onboardingDone / consentVersion / consentDate) are
 * overlaid from per-device chrome.storage.local via consent-storage (#355, ADR-0001).
 */

// Per-device consent overlay for getPrefs (#355, ADR-0001).
import { getConsent } from "./consent-storage.js";
// Per-device pref overrides on top of synced behavioural prefs (#364).
import { getOverrides as getPerDeviceOverrides } from "./per-device-prefs.js";

// ── Sync: user preferences ──────────────────────────────────────────────────

export const PREF_DEFAULTS = {
  enabled: true,
  notifyForeignAffiliate: false,
  stripAllAffiliates: false,
  blacklist: [],     // e.g. ["amazon.es", "booking.com::aid::123456"]
  whitelist: [],     // e.g. ["amazon.es::tag::youtuber-21"]
  customParams: [],  // e.g. ["ref_code", "promo_id"]
  dnrEnabled: true,
  // Active-defense content scripts toggle (#1006): gates the history
  // pushState/replaceState defuser, the window.name defuser, and the DOM
  // link/click rewriter (all four gate on the single muga:history-gate
  // event dispatched by content/history-defuser.js). Default ON so nothing
  // changes for existing users; users can opt out if these scripts break a
  // site (e.g. rt.com comments, #1006).
  activeDefenseEnabled: true,
  contextMenuEnabled: true,
  blockPings: true,
  // Referer suppression toggle (referer-beacon-privacy, PR 1). Opt-in,
  // default OFF: removes the Referer header on non-allowlisted domains when
  // ON (see src/background/service-worker.js's syncSuppressRefererDNR, wired
  // in a later PR). Independent from blockPings — that pref governs the
  // DOM-layer navigator.sendBeacon()/<a ping> defuser and is left untouched
  // by this feature.
  suppressReferer: false,
  // Beacon block toggle (referer-beacon-privacy, PR 1). Opt-in, default OFF:
  // blocks network-layer "ping" resource-type requests (sendBeacon/<a ping>)
  // on non-allowlisted domains when ON (see syncBlockBeaconsDNR, wired in a
  // later PR). Distinct from blockPings (DOM-layer, default true, unchanged).
  blockBeacons: false,
  ampRedirect: true,
  unwrapRedirects: true,
  language: "en",
  onboardingDone: false,
  consentVersion: null,   // e.g. "1.0". Bump to re-trigger onboarding on ToS changes.
  consentDate: null,      // Unix timestamp (ms) of when the user accepted
  disabledCategories: [],  // e.g. ["utm", "ads"]. Params in these categories are not stripped.
  toastDuration: 15,  // seconds: how long the affiliate notification stays visible
  paramBreakdown: true,
  showReportButton: true,
  domainStats: true,
  // Toolbar badge toggle (#910). Default ON: shows the tab's running count
  // of tracking params stripped as a native browser badge (setBadgeText)
  // on the toolbar icon, mirroring uBlock Origin. Deliberately NOT an
  // icon-variant swap — see toolbar-presenter.js module doc for why a
  // prior setIcon-based badge attempt (f6a6e2b) was reverted.
  showBadge: true,
  // Remote rules toggle — lives in sync so the preference follows the user
  // across devices. Default true (#888): the weekly Ed25519-signed GET to
  // rules.muga.app carries no user data (credentials: "omit", no cookies, no
  // identifiers) and readiness (signing infra, defense-in-depth verification,
  // disclosure copy) has been ratified. Users can disable it any time in
  // Settings. REQ-OPT-1 (zero network activity on fresh install) is
  // superseded by this default — see CHANGELOG.
  remoteRulesEnabled: true,
  // Honor Creator Mode toggle (#435, B12). Pure plumbing for B13/B14: no
  // behaviour change. Default false so existing users see no functional
  // difference. The feature is opt-in because honoring creator referral
  // chains may route through redirect networks the user did not consent to
  // contact otherwise.
  honorCreatorMode: false,
  // Per-creator allowlist (#445, B13). Referrer-domain-shaped strings
  // (e.g., "youtube.com/@LinusTechTips", "dot-css-news.com") that the user
  // has explicitly opted into for Honor Creator Mode. Empty by default.
  // Capped at 100 entries (storage hygiene): 100 × ~80 chars ≈ 8 KB, within
  // sync's 8 KB-per-item / 100 KB-total budget. CRUD lives in
  // src/lib/creator-allowlist.js (pure module, immutable arrays).
  creatorAllowlist: [],
  // Canonical Extractor toggle (#442, B7). Default ON: when the wrapper
  // engine detects an opaque wrapper (host matched but no destination in
  // the URL), the cleaner consults a content-script-supplied "canonical
  // bundle" (<link rel=canonical> + JSON-LD @id) BEFORE giving up. Disable
  // here to bypass that tier entirely without uninstalling content scripts.
  canonicalExtractorEnabled: true,
  // Cross-Site Frequency Tracker toggle (#446, B16). Default ON: a local-
  // only correlation map of (paramName, hashedValue) per first-party
  // domain, used to surface likely cross-site identifiers in the popup.
  // Privacy-sensitive enough to deserve its own toggle even though the
  // data never leaves the device — turning it off makes observe() a
  // no-op and hides the freq subgroup in the suspicious-params section.
  crossSiteFrequencyEnabled: true,
  // Attribution Ledger persistence (#460, A2). When ON (default), the SW
  // writes the rolling ring buffer of recent navigation events to
  // chrome.storage.local under "attributionLedger" so the popup can
  // render a "Recent activity" section that survives SW restarts. When
  // OFF, the writer is gated to a no-op; the section just stays empty.
  // Privacy-sensitive (it carries URLs), so we expose it as its own
  // toggle even though the data is local-only.
  attributionLedgerEnabled: true,
  // EXPERIMENTAL shape-based param heuristic (#544). Default OFF: a multi-
  // signal heuristic that strips params whose VALUE SHAPE matches a tracker
  // pattern (suspicious key prefix + length>16 + Shannon entropy>4.0 +
  // base64/hex/uuid charset — ALL four required). False-positive risk is
  // real (auth tokens / session IDs LOOK like trackers), so it ships behind
  // a flag and is gated by a hard-coded allowlist of well-known oauth /
  // session keys (state, code, csrf_token, access_token, …) that never
  // strip even when all four signals fire. With the flag OFF, behaviour is
  // byte-identical to the #530 baseline (the benchmark stays 117/117).
  experimentalParamClassesEnabled: false,
  // User-promoted custom strip rules (#536). Populated by the popup's
  // "Strip locally" button on flagged Suspicious-params rows. Each entry
  // is a bare param name (lowercased on read by the cleaner) that
  // processUrl strips on EVERY host — the user has explicitly trusted
  // the rule. Affiliate-preservation still wins (the affiliateParamSet
  // skip in stripTrackingParams runs before custom-rule matching), so a
  // user can never accidentally strip their own creator's referral tag.
  // Lives in sync so the rule list follows the user across devices.
  // Default empty — opt-in by user click only.
  userCustomRules: [],
  // Hover destination preview (#1028). Desktop-only: shows a small
  // text-only tooltip with the real cleaned destination when hovering AND
  // holding still over a link for hoverPreviewDelayMs. Shown when MUGA's
  // local unwrap/clean changes the link's host (wrappers / redirect
  // networks) — that path is fully local, no network access. It is ALSO
  // shown for a generic shortener link (bit.ly etc.) whose host does NOT
  // change locally, but only when resolveShortenersOnHover is ON (browsewrap
  // Phase 2 — see below): that path performs a network resolution
  // (RESOLVE_SHORTENER), gated behind the user's own opt-in — no new
  // permission is requested by this feature itself. A plain link that
  // neither unwraps nor resolves shows nothing. Default ON, PC-only (never
  // activates on touch-only devices), and unobtrusive (appears only after a
  // ~2.5s hold). Opt-out any time in Settings > Advanced.
  hoverPreviewEnabled: true,
  // Hold duration (ms) before the hover preview tooltip appears.
  hoverPreviewDelayMs: 2500,
  // Shortener resolution split (browsewrap Phase 2, follow-up to ADR-0004).
  // The single `followShortenersEnabled` pref used to gate BOTH click-time
  // resolution (content/cleaner.js) and hover/proactive resolution
  // (content/hover-preview.js) together. Splitting them recognises that the
  // two have very different privacy costs:
  //   - Click-time: the user was already navigating to this link. Resolving
  //     it just reveals the destination before/instead of the browser
  //     following the shortener's own redirect. Low risk — default ON.
  //   - Hover/proactive: pings the shortener host for a link the user only
  //     LOOKED at, never clicked — leaking "the user saw this link" to a
  //     third party they never chose to visit. Opt-in — default OFF.
  // Both prefs are plain literals here (no browser-aware default — the old
  // Chrome-MV3-only default-on logic is retired along with the single pref;
  // resolveShortenersOnClick is unconditionally true on every browser). Both
  // still require the shortener host permissions (optional_host_permissions),
  // granted from the Settings toggle exactly as followShortenersEnabled did —
  // see src/options/options.js requestShortenerPermissions.
  // Migration: migrateFollowShortenersSplit() (storage-migrations.js) maps a
  // previously EXPLICITLY-stored followShortenersEnabled onto both of these
  // on first startup after upgrade, then removes the old key. A value the
  // user never explicitly set (auto-default only) migrates to nothing —
  // these new defaults simply apply.
  resolveShortenersOnClick: true,
  resolveShortenersOnHover: false,
  // NOTE (ADR-0004 phase 5, 2026-06-01): privacyProxyEnabled was the Privacy Proxy
  // toggle removed in phase 5. Retained as a deprecation comment only — do NOT add
  // it back to PREF_DEFAULTS. Any live value was migrated to followShortenersEnabled
  // on first startup by migrateLegacyProxyPref(); followShortenersEnabled was itself
  // retired in browsewrap Phase 2 (see resolveShortenersOnClick/OnHover above).
  //
  // NOTE (ADR-0004 phase 5, 2026-06-01): useNativeShortenerResolution was the
  // dual-path selector removed in phase 5. Native resolution is now the ONLY path.
  // Do NOT add it back to PREF_DEFAULTS.
};

/**
 * Reads all user preferences. Behavioural prefs come from
 * `chrome.storage.sync` (cross-device). Consent fields
 * (`onboardingDone`, `consentVersion`, `consentDate`) are overlaid
 * from per-device `chrome.storage.local` via consent-storage (#355,
 * ADR-0001). Per-device behavioural overrides (`remoteRulesEnabled`
 * after a user declines a sync-inherited prompt) are overlaid from
 * per-device-prefs (#364) — local wins.
 *
 * Reads in parallel for minimum latency.
 *
 * @returns {Promise<object>} Preferences merged with PREF_DEFAULTS.
 */
export async function getPrefs() {
  // Each source is read independently and degrades on its OWN failure. A
  // transient sync-read failure must NOT discard the independently-stored
  // consent record (onboardingDone) or the per-device overrides — otherwise a
  // fully onboarded user is treated as never-onboarded for this call, and a
  // declined per-device pref silently reverts to the synced value (audit #1045).
  const [sync, consent, overrides] = await Promise.all([
    new Promise((resolve) => {
      chrome.storage.sync.get(PREF_DEFAULTS, (result) => {
        if (chrome.runtime.lastError) {
          console.error("[MUGA] getPrefs sync read failed:", chrome.runtime.lastError);
          resolve({ ...PREF_DEFAULTS });
        } else {
          resolve(result);
        }
      });
    }),
    getConsent().catch((err) => {
      console.error("[MUGA] getPrefs consent read failed:", err);
      return { onboardingDone: false, consentVersion: null, consentDate: null };
    }),
    getPerDeviceOverrides().catch((err) => {
      console.error("[MUGA] getPrefs overrides read failed:", err);
      return {};
    }),
  ]);

  // Consent overlay (#355). Local wins over sync.
  const overlay = {};
  if (consent.onboardingDone) overlay.onboardingDone = true;
  if (consent.consentVersion !== null) overlay.consentVersion = consent.consentVersion;
  if (consent.consentDate !== null) overlay.consentDate = consent.consentDate;

  // No re-acceptance gate. MUGA follows the uBlock Origin model: the Terms
  // and Privacy policy are available and linked, acceptance is by use, and a
  // change to them never re-prompts or re-gates an existing user. The
  // versioned-consent policy engine that used to force `onboardingDone:false`
  // on a material bump was removed along with its manifest and clause list.
  // `onboardingDone` now comes solely from the stored per-device record.

  // Per-device pref overlay (#364). Any key set in overrides wins
  // over sync. Boolean shape is enforced at the source (overrides
  // can only be set via per-device-prefs.setOverrides).
  return { ...sync, ...overlay, ...overrides };
}

/**
 * Writes a partial preferences object to chrome.storage.sync.
 *
 * Returns whether the write actually landed. It resolves `false` (never throws)
 * on a storage failure so existing fire-and-forget callers stay unaffected,
 * while callers that must not report false success — notably the Settings
 * import path — can gate their success UI on the result (audit #1044).
 *
 * @param {object} partial - Key/value pairs to merge into stored prefs.
 * @returns {Promise<boolean>} true if the write succeeded, false otherwise.
 */
export async function setPrefs(partial) {
  try {
    await new Promise((resolve, reject) => {
      chrome.storage.sync.set(partial, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
    return true;
  } catch (err) {
    console.error("[MUGA] setPrefs failed:", err);
    return false;
  }
}
