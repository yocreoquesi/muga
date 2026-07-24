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

/**
 * Computes the browser-dependent default for `followShortenersEnabled`.
 *
 * - Chrome (MV3): `host_permissions` already grants `<all_urls>` at install
 *   time (src/manifest.json), so the native shortener-resolution fetch works
 *   with zero extra permission prompts. Default ON.
 * - Firefox (MV2): the shortener origins are only ever granted via an
 *   explicit `chrome.permissions.request()` gesture from the Settings
 *   toggle (src/options/options.js requestShortenerPermissions). Default
 *   OFF (unchanged) — nobody is prompted without asking first.
 *
 * Evaluated once at module load (the manifest never changes mid-session).
 * Never throws: an absent/stubbed `chrome.runtime.getManifest` (unit-test
 * environments, or an unforeseen host) fails closed to `false`.
 *
 * A value the user has explicitly stored always wins over this default —
 * chrome.storage.sync.get() only substitutes a default for a key that is
 * ABSENT from storage (see getPrefs() below).
 *
 * @returns {boolean}
 */
function defaultFollowShortenersEnabled() {
  try {
    return chrome.runtime.getManifest().manifest_version === 3;
  } catch {
    return false;
  }
}

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
  // privacyProxyEnabled in phase 5, #701). When ON, MUGA resolves generic
  // shorteners in-browser via fetch(redirect:"manual"). Requires the
  // shortener host permissions, granted from the options toggle.
  // MUST stay a pure literal: this defaults object is bundled into the
  // chrome-free web engine (cleaner-bundle.js / web/engine), so it cannot
  // reference chrome.*. The BROWSER-DEPENDENT default (true on Chrome MV3, false
  // on Firefox MV2) is applied in getPrefs() below — the extension-only path
  // where chrome.runtime.getManifest is available — via
  // defaultFollowShortenersEnabled(). An explicitly stored value (the user
  // toggled it) always wins over that default.
  // Migration: on startup, if chrome.storage.sync contains privacyProxyEnabled=true,
  // this field is set to true and the old key is deleted (see migrateLegacyProxyPref).
  followShortenersEnabled: false,
  // Hover destination preview (#1028). Desktop-only: shows a small
  // text-only tooltip with the real cleaned destination when hovering AND
  // holding still over a link for hoverPreviewDelayMs. Shown when MUGA's
  // local unwrap/clean changes the link's host (wrappers / redirect
  // networks) — that path is fully local, no network access. It is ALSO
  // shown for a generic shortener link (bit.ly etc.) whose host does NOT
  // change locally, but only when followShortenersEnabled is ON: that path
  // performs the same network resolution the click-time follow-shorteners
  // flow already does (RESOLVE_SHORTENER), gated behind the user's existing
  // opt-in — no new permission is requested by this feature itself. A plain
  // link that neither unwraps nor resolves shows nothing. Default ON,
  // PC-only (never activates on touch-only devices), and unobtrusive
  // (appears only after a ~2.5s hold). Opt-out any time in Settings > Advanced.
  hoverPreviewEnabled: true,
  // Hold duration (ms) before the hover preview tooltip appears.
  hoverPreviewDelayMs: 2500,
  // Cookie Consent Minimizer — 2-state mode. When a supported CMP exposes a
  // confirmed reject / necessary-only path, MUGA exercises it on the user's
  // behalf. On a hard wall (only a broad consent-granting action exists, no
  // reject path), MUGA does nothing and leaves the banner for the user — it
  // never invokes that action itself, and never clicks a consent-granting
  // control on the user's behalf (see src/lib/cmp-adapters.js's docblock for
  // the full rule).
  //
  //   "off"         — the gate never opens; no CMP interaction at all.
  //   "reject-only" — the gate opens; only ever rejects / picks an existing
  //                   necessary-only path. DEFAULT for new installs
  //                   (disclosed via onboarding). Existing users are
  //                   migrated to "off" (see migrateCookieConsentMode in
  //                   storage-migrations.js) — nobody is silently upgraded
  //                   into a new capability.
  //
  // This calls a page-authored global directly, a capability class disclosed
  // via the consent-version bump (see src/lib/consent-version-manifest.js
  // "1.2", shown to new users through onboarding). Changeable any time in
  // Settings > Advanced.
  cookieConsentMode: "reject-only",
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
  const [sync, followStored, consent, overrides, fixtures] = await Promise.all([
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
    // Bare read (NO default) to detect whether followShortenersEnabled was
    // ever explicitly stored. The merged read above cannot tell "user set it
    // to false" apart from "never set" (both surface as false). We need that
    // distinction to apply the Chrome-MV3 default-on ONLY when the user never
    // chose, without clobbering an explicit opt-out.
    new Promise((resolve) => {
      chrome.storage.sync.get("followShortenersEnabled", (result) => {
        resolve(chrome.runtime.lastError ? {} : (result || {}));
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
  // Defensive: a malformed stored consentVersion could make evaluateConsentPolicy
  // throw. getPrefs must never reject on that (callers await it without a catch),
  // so on an un-evaluable policy we FAIL SAFE — gate features by forcing
  // onboardingDone:false, matching the pre-#1045 return-defaults behaviour.
  let policy;
  try {
    policy = evaluateConsentPolicy({
      stored: consent,
      ...(fixtures?.requiredConsentVersion ? { requiredVersion: fixtures.requiredConsentVersion } : {}),
      ...(fixtures?.consentManifest ? { manifest: fixtures.consentManifest } : {}),
    });
  } catch (err) {
    console.error("[MUGA] getPrefs consent-policy eval failed:", err);
    policy = { status: "hard-reonboard" };
  }
  if (policy.status === "hard-reonboard") {
    overlay.onboardingDone = false;
  }

  // Browser-aware default for followShortenersEnabled. PREF_DEFAULTS keeps a
  // pure literal `false` (it is bundled into the chrome-free web engine), so the
  // Chrome-MV3 default-on is applied HERE, where chrome.runtime.getManifest is
  // available, and ONLY when the user never explicitly stored the pref. A stored
  // value (from the merged `sync` read) or a per-device override both win, since
  // overlay is applied over `sync` and overrides are applied last.
  // A stored value is always a boolean; anything else (key absent → undefined)
  // means the user never chose, so the browser default applies. Using a typeof
  // check rather than `in` is robust to storage stubs that surface an absent key
  // as `{ key: undefined }` instead of omitting it.
  if (typeof followStored.followShortenersEnabled !== "boolean") {
    overlay.followShortenersEnabled = defaultFollowShortenersEnabled();
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
