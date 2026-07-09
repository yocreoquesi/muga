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
// Consent version-comparison for feature gating during hard re-onboard (#370).
import { evaluate as evaluateConsentPolicy } from "./consent-policy.js";
// E2E fixture overrides (#407). Returns null in production.
import { getTestFixtures } from "./test-fixtures.js";

// ── Sync: user preferences ──────────────────────────────────────────────────

export const PREF_DEFAULTS = {
  enabled: true,
  injectOwnAffiliate: true,   // on by default to keep the project sustainable; shown in onboarding and revertible any time in Settings, with no loss of cleaning/protection (#224, #1032)
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
  // Follow shortener redirects natively (ADR-0004 phase 2, #699; renamed from
  // privacyProxyEnabled in phase 5, #701). When ON, MUGA resolves the eight
  // generic shorteners in-browser via fetch(redirect:"manual"). Default OFF:
  // requires the eight shortener host permissions, granted from the options toggle.
  // Migration: on startup, if chrome.storage.sync contains privacyProxyEnabled=true,
  // this field is set to true and the old key is deleted (see migrateLegacyProxyPref).
  followShortenersEnabled: false,
  // NOTE (ADR-0004 phase 5, 2026-06-01): privacyProxyEnabled was the Privacy Proxy
  // toggle removed in phase 5. Retained as a deprecation comment only — do NOT add
  // it back to PREF_DEFAULTS. Any live value is migrated to followShortenersEnabled
  // on first startup by migrateLegacyProxyPref().
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
 * ADR-0001). Per-device behavioural overrides (`injectOwnAffiliate`,
 * `remoteRulesEnabled` after a user declines a sync-inherited prompt)
 * are overlaid from per-device-prefs (#364) — local wins.
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
  const [sync, consent, overrides, fixtures] = await Promise.all([
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
    getTestFixtures().catch(() => null),
  ]);

  // Consent overlay (#355). Local wins over sync.
  const overlay = {};
  if (consent.onboardingDone) overlay.onboardingDone = true;
  if (consent.consentVersion !== null) overlay.consentVersion = consent.consentVersion;
  if (consent.consentDate !== null) overlay.consentDate = consent.consentDate;

  // Hard-reonboard gate (#370). When ConsentPolicy says material change
  // pending, force `onboardingDone: false` so existing feature gates
  // (`if (!prefs.onboardingDone) return`) bail until the user re-accepts.
  // Soft re-onboard does NOT gate features — the user's prior consent
  // remains valid for previously accepted behaviour.
  // Under e2e fixtures (#407), the gate fires against the fixture
  // manifest + required version so tests can drive the dormant path.
  const policy = evaluateConsentPolicy({
    stored: consent,
    ...(fixtures?.requiredConsentVersion ? { requiredVersion: fixtures.requiredConsentVersion } : {}),
    ...(fixtures?.consentManifest ? { manifest: fixtures.consentManifest } : {}),
  });
  if (policy.status === "hard-reonboard") {
    overlay.onboardingDone = false;
  }

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
