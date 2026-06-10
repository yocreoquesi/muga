/**
 * MUGA: Service Worker (MV3)
 * Processes URLs, handles messages from content scripts,
 * and maintains extension state.
 */

import { processUrl, parseListEntry } from "../lib/cleaner.js";
import { getAffiliateDomains } from "../lib/affiliates.js";
import { getPrefs, setPrefs, incrementStat, getStats, setStats, migrateStatsToLocal, migrateLegacyProxyPref, sessionStorage, incrementDomainStat, cacheDomainRules, getCachedDomainRules, getRemoteParams, incrementShortenerStat } from "../lib/storage.js";
import { migrateConsentToLocal } from "../lib/sync-migration.js";
import { evaluate as evaluateConsent } from "../lib/consent-policy.js";
import { isValidListEntry } from "../lib/validation.js";
import { DNR_CUSTOM_PARAMS_RULE_ID } from "../lib/dnr-ids.js";
import { t } from "../lib/i18n.js";
import {
  runRemoteRulesFetch,
  clearRemoteCache,
  buildRemoteDnrRule,
  REMOTE_RULE_ID,
} from "../lib/remote-rules.js";
import { TRUSTED_PUBLIC_KEYS } from "../lib/remote-rules-keys.js";
import { resolveShortener } from "../lib/native-shortener-resolver.js";
import { isGenericShortener } from "../lib/opaque-networks.js";
import { createToolbarEventBus } from "../lib/toolbar-event-bus.js";
import { createTabPresenterState } from "../lib/tab-presenter-state.js";
import { createToolbarPresenter } from "../lib/toolbar-presenter.js";
import {
  createTracker as createFrequencyTracker,
  createChromeLocalAdapter as createFrequencyChromeAdapter,
  defaultHasher as defaultFrequencyHasher,
} from "../lib/cross-site-frequency.js";
import {
  createLedger as createAttributionLedger,
  pushEvent as pushAttributionEvent,
  fromCleanerResult as attributionEventFromCleanerResult,
  DEFAULT_LEDGER_CAPACITY,
} from "../lib/attribution-ledger.js";

self.addEventListener("unhandledrejection", (e) => {
  console.warn("[MUGA] unhandled rejection:", e.reason);
});

// Pre-compute affiliate domains once at startup for getPrefs responses
const _affiliateDomains = getAffiliateDomains();

let _firstUsedSet = false;

// B4: fetch domain-rules dynamically (import assertions incompatible with Firefox;
//       top-level await disallowed in Chrome MV3 service workers).
// Cache-first: on each SW restart we attempt to read from chrome.storage.session
// first. Only falls back to fetch() on a cache miss. On persistent fetch failure
// (up to 3 attempts) we log the error and leave domainRules as [] so the SW can
// still operate without domain-specific rules.
//
// #629 win 3: lazy load. The fetch is deferred until the first PROCESS_URL
// message — handleProcessUrl already gates on `_domainRulesReady` and triggers
// `_loadDomainRules()` on demand. The pre-#629 eager call at module top-level
// blocked SW cold start by ~10-15ms even on tabs the user never tries to clean.
let domainRules = [];
let _domainRulesReady = null;
let _domainRulesFetchAttempts = 0;
const DOMAIN_RULES_MAX_ATTEMPTS = 3;

async function _loadDomainRules() {
  const cached = await getCachedDomainRules();
  if (cached) {
    domainRules = cached;
    return;
  }
  if (_domainRulesFetchAttempts >= DOMAIN_RULES_MAX_ATTEMPTS) {
    console.error("[MUGA] domain-rules.json: max fetch attempts reached; domain rules unavailable");
    return;
  }
  try {
    _domainRulesFetchAttempts++;
    const r = await fetch(chrome.runtime.getURL("rules/domain-rules.json"));
    const data = await r.json();
    domainRules = data;
    await cacheDomainRules(data);
  } catch (err) {
    console.error("[MUGA] domain-rules.json fetch failed (attempt", _domainRulesFetchAttempts, "):", err);
    // Null out so the next handleProcessUrl call retries (up to the cap)
    _domainRulesReady = null;
  }
}

// Path rules — declarative path-strip and path-affiliate arrays (issue #625).
// Follows the same lazy-load / retry-cap pattern as domain rules above.
// No session-cache layer: both JSON files are tiny (≪1KB combined) and the
// cache-on-first-load complexity does not pay rent at this size.
let pathStripRules = [];
let pathAffiliateRules = [];
let _pathRulesReady = null;
let _pathRulesFetchAttempts = 0;
const PATH_RULES_MAX_ATTEMPTS = 3;

/**
 * Fetch path-strip-rules.json and path-affiliate-rules.json in parallel and
 * assign their parsed arrays to the module-level `pathStripRules` and
 * `pathAffiliateRules` vars. Called lazily on the first PROCESS_URL message,
 * in a single outer Promise.all alongside _loadDomainRules() so all three
 * JSON files are in flight at once.
 *
 * On failure: both arrays are reset to [] (graceful-degradation — path logic
 * becomes a no-op), a console.warn is emitted, and _pathRulesReady is nulled
 * so the next call retries (up to PATH_RULES_MAX_ATTEMPTS).
 */
async function _loadPathRules() {
  if (_pathRulesFetchAttempts >= PATH_RULES_MAX_ATTEMPTS) {
    console.error("[MUGA] path-rules: max fetch attempts reached; path rules unavailable");
    return;
  }
  try {
    _pathRulesFetchAttempts++;
    const [stripResp, affResp] = await Promise.all([
      fetch(chrome.runtime.getURL("rules/path-strip-rules.json")),
      fetch(chrome.runtime.getURL("rules/path-affiliate-rules.json")),
    ]);
    pathStripRules     = await stripResp.json();
    pathAffiliateRules = await affResp.json();
  } catch (err) {
    console.warn("[MUGA] path rules fetch failed:", err);
    pathStripRules     = [];
    pathAffiliateRules = [];
    // Null out so the next handleProcessUrl call retries (up to the cap)
    _pathRulesReady = null;
  }
}

// B3: chrome.action (MV3) does not exist in Firefox MV2; fall back to browserAction
const _rawActionApi = globalThis.chrome?.action || globalThis.chrome?.browserAction || {};

// E2E action-API call counter (#408). Increments on every presenter-side
// mutation so e2e specs can assert idempotency (no redundant calls when
// the resolved state hasn't changed). Reset / read via __TEST__ handlers
// (see below) gated on the test-mode sentinel. Production never reads
// these counts; the cost is one integer increment per action call.
let _testActionCalls = { setTitle: 0, setBadgeText: 0 };
const actionApi = new Proxy(_rawActionApi, {
  get(target, prop) {
    const orig = target[prop];
    if (typeof orig !== "function") return orig;
    if (prop in _testActionCalls) {
      return function (...args) {
        _testActionCalls[prop]++;
        return orig.apply(target, args);
      };
    }
    return orig.bind(target);
  },
});

// --- Toolbar presenter (#358) ---
// All toolbar surface mutations (tooltip, badge text, badge color, icon) flow
// through this presenter via the event bus. No code outside the presenter calls
// chrome.action.set* directly.
const toolbarBus   = createToolbarEventBus();
const toolbarState = createTabPresenterState();
createToolbarPresenter({
  bus: toolbarBus,
  state: toolbarState,
  actionApi,
  // The presenter calls t(key) without a lang. Resolve from cachedPrefs at
  // call time so the user's current language is used. Defaults to "en"
  // before the cache is warm, which is fine — tooltip update fires after
  // URL processing, by which point prefs are loaded.
  t: (key) => t(key, cachedPrefs?.language || "en"),
});

// Run migrations once on startup (no-ops if already done).
// Both are idempotent and best-effort — failures must not break startup.
migrateStatsToLocal();
migrateConsentToLocal();

// --- Session log (actions + errors, exported via debug log) ---
const SESSION_LOG_MAX = 2000;
const MAX_URL_LENGTH = 8192;

function appendSessionLog(level, args) {
  const entry = { ts: Date.now(), level, msg: args.map(a => {
    try { return typeof a === "object" ? JSON.stringify(a) : String(a); } catch { return "[unserializable]"; }
  }).join(" ") };
  sessionStorage.get({ debugLog: [] }).then(data => {
    const log = [entry, ...data.debugLog].slice(0, SESSION_LOG_MAX);
    sessionStorage.set({ debugLog: log }).catch(() => { /* best-effort debug log */ });
  }).catch(() => { /* session storage may be unavailable */ });
}

/** Log a MUGA action as a structured object for rich debug output. */
function logAction(action, detail) {
  if (typeof detail === "object") {
    appendSessionLog("action", [`[${action}]`, JSON.stringify(detail)]);
  } else {
    appendSessionLog("action", [`[${action}]`, detail]);
  }
}

const _origError = console.error.bind(console);
console.error = (...args) => { _origError(...args); appendSessionLog("error", args); };
const _origWarn = console.warn.bind(console);
console.warn = (...args) => { _origWarn(...args); appendSessionLog("warn", args); };

// --- Cross-site frequency tracker singleton (#446 / #495) ---
//
// The tracker is wired ONCE per service-worker lifetime. We pass it into
// every processUrl() call from this SW so the cleaner can record the
// (firstPartyDomain, paramName, value) tuple for each stripped tracking
// param. Storage lives in chrome.storage.local — never sync.
//
// `createChromeLocalAdapter()` is feature-detected: in test contexts (and
// in the rare runtime where chrome.storage.local is missing), it returns
// null and we leave the tracker undefined. The cleaner already treats a
// missing tracker as a no-op, so we don't need any extra guards.
const _frequencyAdapter = createFrequencyChromeAdapter();
const frequencyTracker = _frequencyAdapter
  ? createFrequencyTracker({ adapter: _frequencyAdapter, hasher: defaultFrequencyHasher })
  : null;

// --- Attribution Ledger (#460, A2) ---
//
// Rolling ring buffer of cleaner-pipeline events feeding the popup
// "Recent activity" section. Persisted to chrome.storage.local under
// "attributionLedger" so the popup can render after SW restart.
//
// In-memory ledger is the source of truth during a SW lifetime; the
// local-storage write is a fire-and-forget mirror. On SW cold start the
// in-memory copy is empty and the popup reads directly from local
// storage — both surfaces converge once the next event lands.
//
// Gated on prefs.attributionLedgerEnabled (default true). When false,
// pushAttributionAndPersist short-circuits without touching storage.
let _attributionLedger = createAttributionLedger(DEFAULT_LEDGER_CAPACITY);

async function _hydrateAttributionLedger() {
  try {
    const data = await new Promise((resolve, reject) => {
      chrome.storage.local.get(
        { attributionLedger: { events: [], capacity: DEFAULT_LEDGER_CAPACITY } },
        (r) => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(r);
        },
      );
    });
    if (data?.attributionLedger && Array.isArray(data.attributionLedger.events)) {
      _attributionLedger = {
        events: data.attributionLedger.events.slice(),
        capacity: Number(data.attributionLedger.capacity) || DEFAULT_LEDGER_CAPACITY,
      };
    }
  } catch {
    // Best-effort: stay with the empty in-memory ledger. The first push
    // will overwrite local-storage cleanly.
  }
}
_hydrateAttributionLedger();

/**
 * Builds an attribution event from a cleaner result and persists the
 * updated ledger. Fire-and-forget — never blocks the caller. Gated on
 * prefs.attributionLedgerEnabled so users can opt out of URL persistence
 * without disabling the rest of MUGA.
 *
 * @param {string} rawUrl
 * @param {object} result - return value from processUrl
 * @param {object} prefs  - cached prefs (already resolved)
 */
function pushAttributionAndPersist(rawUrl, result, prefs) {
  // Privacy gate: skip both in-memory accumulation AND storage write so
  // a user who flips the toggle off mid-session sees the ring buffer
  // freeze immediately.
  if (prefs?.attributionLedgerEnabled === false) return;
  let event;
  try {
    event = attributionEventFromCleanerResult(rawUrl, result);
  } catch (err) {
    console.warn("[MUGA] attribution: fromCleanerResult failed:", err);
    return;
  }
  if (!event) return;
  _attributionLedger = pushAttributionEvent(_attributionLedger, event);
  // Best-effort write — failures are silent because the ledger is a UX
  // affordance, not authoritative state.
  try {
    chrome.storage.local.set({ attributionLedger: _attributionLedger }, () => {
      if (chrome.runtime.lastError) {
        console.warn("[MUGA] attribution: ledger write failed:", chrome.runtime.lastError);
      }
    });
  } catch (err) {
    console.warn("[MUGA] attribution: ledger write threw:", err);
  }
}

// --- Prefs cache ---

let cachedPrefs = null;
let prefsFetchPromise = null;
let _cacheVersion = 0;

/**
 * Invalidates the prefs cache so the next getPrefsWithCache() call re-fetches.
 * Extracted to a single function so all three call-sites (storage.onChanged,
 * ADD_TO_WHITELIST, ADD_TO_BLACKLIST) remain consistent when the cache
 * mechanism evolves (e.g., adding a 4th invalidation flag).
 */
function _invalidatePrefsCache() {
  cachedPrefs = null;
  prefsFetchPromise = null;
  _cacheVersion++;
}

// Serialize list mutations (whitelist/blacklist) to prevent race conditions
// where two rapid messages read the same cached list and the second overwrites the first.
let _listMutationQueue = Promise.resolve();

function getPrefsWithCache() {
  if (cachedPrefs) return Promise.resolve(cachedPrefs);
  if (!prefsFetchPromise) {
    const versionAtStart = _cacheVersion;
    // Fetch sync prefs and local remoteParams together so the cleaner sees
    // remote params on the copy/context-menu/selection paths (REQ-MERGE-5).
    // Without this, processUrl() gets prefs.remoteParams === undefined and
    // remote params are only stripped via DNR (navigation), not the content-script copy path.
    prefsFetchPromise = Promise.all([getPrefs(), getRemoteParams()]).then(([prefs, remote]) => {
      if (_cacheVersion !== versionAtStart) {
        // Cache was invalidated while fetching — discard stale result
        prefsFetchPromise = null;
        return getPrefsWithCache();
      }
      // Pre-parse blacklist/whitelist once so processUrl doesn't re-parse on every call
      prefs._parsedBlacklist = (prefs.blacklist || []).map(parseListEntry);
      prefs._parsedWhitelist = (prefs.whitelist || []).map(parseListEntry);
      prefs.remoteParams = remote.remoteParams || [];
      cachedPrefs = prefs;
      prefsFetchPromise = null;
      return prefs;
    });
  }
  return prefsFetchPromise;
}

// --- Remote-rules opportunistic fetch ---
// MV3 service workers wake on many events (navigation, message, onInstalled,
// onStartup, etc.). Instead of using chrome.alarms — which requires a separate
// permission and a Privacy-practices justification — we piggyback on those
// natural wake-ups and throttle with a time-gate stored in remoteRulesMeta.
// Users who never open the browser don't need fresh rules; users who do, get
// one fetch per ~7 days as a side-effect of normal activity.

// Target interval between successful remote-rules fetches (7 days).
const REMOTE_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// Module-level flag — checked once per SW lifetime so repeated wake events
// (one per message, one per navigation, etc.) don't hit chrome.storage on
// every call. Resets automatically when the SW dies and respawns.
let _remoteRulesCheckedThisLifetime = false;

/**
 * Fires a remote-rules fetch iff (a) the user has opted in, (b) no fetch is
 * currently in flight (enforced by runRemoteRulesFetch internally), and (c)
 * the last successful fetch is older than REMOTE_REFRESH_INTERVAL_MS (or has
 * never happened). Silent no-op on any failure to read state — this is a
 * best-effort path that must never block callers.
 *
 * Deduplicated per SW lifetime via `_remoteRulesCheckedThisLifetime` so
 * hot paths (PROCESS_URL, message handlers) can call it freely without
 * extra storage reads.
 *
 * @param {object} deps - Dependencies for runRemoteRulesFetch (same shape as Phase 2).
 * @returns {Promise<void>}
 */
async function maybeFetchRemoteRules(deps) {
  if (_remoteRulesCheckedThisLifetime) return;
  _remoteRulesCheckedThisLifetime = true;
  try {
    const { remoteRulesEnabled } = await getPrefs();
    if (!remoteRulesEnabled) return;
    const { remoteRulesMeta } = await getRemoteParams();
    const last = remoteRulesMeta?.fetchedAt ? Date.parse(remoteRulesMeta.fetchedAt) : 0;
    if (Number.isFinite(last) && Date.now() - last < REMOTE_REFRESH_INTERVAL_MS) return;
    await runRemoteRulesFetch(deps);
  } catch (err) {
    // Non-fatal: remote rules are optional. Leave built-in rules active.
    console.warn("[MUGA] maybeFetchRemoteRules:", err?.message || err);
  }
}

// --- DNR sync helpers ---
// Firefox MV2 does not support declarativeNetRequest; guard all DNR calls.
const hasDNR = typeof chrome.declarativeNetRequest !== "undefined";

async function syncCustomParamsDNR(customParams) {
  if (!hasDNR) return;
  try {
    if (!customParams || customParams.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [DNR_CUSTOM_PARAMS_RULE_ID],
        addRules: [],
      });
      return;
    }
    const normalized = customParams
      .filter(p => /^[a-zA-Z0-9_.-]+$/.test(p.trim()))
      .map(p => p.trim().toLowerCase());
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_CUSTOM_PARAMS_RULE_ID],
      addRules: [{
        id: DNR_CUSTOM_PARAMS_RULE_ID,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { transform: { queryTransform: { removeParams: normalized } } },
        },
        condition: { urlFilter: "*", resourceTypes: ["main_frame"] },
      }],
    });
  } catch (err) {
    console.error("[MUGA] syncCustomParamsDNR failed:", err);
  }
}

async function applyDnrState(prefs) {
  if (!hasDNR) return;
  // Gate DNR on onboardingDone too (#consent-gate). Content scripts
  // already short-circuit on `!prefs.onboardingDone`, but the DNR
  // rulesets are declarative — they would still fire before the user
  // accepts unless we explicitly disable them here. This makes "the
  // extension is disabled until the user accepts the ToS" hold across
  // both the dynamic and declarative cleaning paths.
  //
  // Derive which rulesets are actually declared in the active manifest
  // at runtime so we never pass IDs that don't exist in the current
  // manifest (Firefox MV2 declares only "tracking_params"; passing
  // "amp_redirect" or "wrapper_unwrap" there would cause the API to
  // reject the entire call). (#810)
  const declaredIds = (
    chrome.runtime.getManifest()?.declarative_net_request?.rule_resources ?? []
  ).map(r => r.id);

  if (prefs.enabled && prefs.dnrEnabled && prefs.onboardingDone) {
    // Gate open: selectively enable/disable based on per-feature prefs.
    // The manifest defaults all three to enabled:true, so rulesets whose
    // feature pref is OFF must be explicitly disabled — otherwise they
    // stay active from the manifest default.
    const enableRulesetIds = [];
    const disableRulesetIds = [];

    for (const id of declaredIds) {
      if (id === "tracking_params") {
        enableRulesetIds.push(id);
      } else if (id === "amp_redirect") {
        if (prefs.ampRedirect) {
          enableRulesetIds.push(id);
        } else {
          disableRulesetIds.push(id);
        }
      } else if (id === "wrapper_unwrap") {
        if (prefs.unwrapRedirects) {
          enableRulesetIds.push(id);
        } else {
          disableRulesetIds.push(id);
        }
      } else {
        // A manifest-declared ruleset this gate doesn't know about would
        // keep its manifest default and silently bypass any feature pref.
        // Enable it explicitly (matching the manifest default) and warn so
        // the gap is visible the moment a fourth ruleset is added. (#810)
        console.warn("[MUGA] applyDnrState: unmanaged ruleset id:", id);
        enableRulesetIds.push(id);
      }
    }

    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds,
      disableRulesetIds,
    }).catch(err => console.warn("[MUGA] applyDnrState enable:", err));
    await syncCustomParamsDNR(prefs.customParams);
  } else {
    // Gate closed: disable ALL declared rulesets so that AMP redirects
    // and wrapper-unwrapping cannot fire before the user has accepted
    // the ToS or while the extension is toggled off. (#810)
    if (declaredIds.length > 0) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: declaredIds,
      }).catch(err => console.warn("[MUGA] applyDnrState disable:", err));
    }
    await syncCustomParamsDNR([]);
  }
}

/**
 * Global toolbar badge for the consent-required state. Shown as "!"
 * while the user has not yet accepted the ToS — including
 * hard-reonboard, where getPrefs() forces onboardingDone:false.
 * Cleared on acceptance.
 *
 * Uses the global setBadgeText (no tabId), so it surfaces on every tab.
 */
async function applyOnboardingBadge(prefs) {
  if (!actionApi || typeof actionApi.setBadgeText !== "function") return;
  try {
    if (!prefs.onboardingDone) {
      await actionApi.setBadgeText({ text: "!" });
    } else {
      await actionApi.setBadgeText({ text: "" });
    }
  } catch { /* best-effort: action API may be unavailable in some contexts */ }
}

// Matches http/https URLs in arbitrary text. Used by the "selection" context menu handler.
// NOTE: content/cleaner.js contains an identical copy of this regex. Content scripts
// cannot import ES modules, so the definition must stay in both files. The sync
// regression test at tests/unit/url-regex-sync.test.mjs enforces identical literals.
const URL_RE = /https?:\/\/[^\s"'<>()[\]{}]{1,2000}/g;

// --- Context menu helpers ---
// Firefox Android does not support chrome.contextMenus; guard all calls.
const hasContextMenus = typeof chrome.contextMenus !== "undefined";

async function syncContextMenus(enabled) {
  if (!hasContextMenus) return;
  await chrome.contextMenus.removeAll();
  if (!enabled) return;
  const prefs = await getPrefsWithCache();
  if (!prefs.enabled) return;
  const lang = prefs.language || "en";
  // Titles sourced from lib/i18n.js (ctx_copy_clean_link / ctx_copy_clean_selection).
  // Canonical German (de): "Bereinigten Link kopieren" — see lib/i18n.js.
  const titles = {
    copy: t("ctx_copy_clean_link", lang),
    selection: t("ctx_copy_clean_selection", lang),
  };
  chrome.contextMenus.create({
    id: "muga-copy-clean",
    title: titles.copy,
    contexts: ["link"],
  });
  chrome.contextMenus.create({
    id: "muga-copy-clean-selection",
    title: titles.selection,
    contexts: ["selection"],
  });
}

// Badge background color is set by the toolbar presenter at startup (#358).

// --- Badge helpers ---
//
// The badge text and tooltip are now driven by the ToolbarPresenter (#358).
// updateTabBadge emits a urlCleaned event; the presenter accumulates the
// count and writes the badge text. Session storage is still used so the
// count survives service-worker termination across the same tab lifecycle.

async function updateTabBadge(tabId, junkRemoved) {
  if (!tabId || junkRemoved <= 0) return;
  const key = `tab_${tabId}`;
  const data = await sessionStorage.get({ [key]: 0 });
  const newCount = data[key] + junkRemoved;
  await sessionStorage.set({ [key]: newCount });
  toolbarBus.emit({ type: "urlCleaned", tabId, paramsRemoved: junkRemoved });
}

// Clear badge when a tab starts navigating to a new page.
// While onboarding is pending we deliberately skip the toolbar bus
// emit: the presenter responds to navigationStarted by writing a
// per-tab badge "" via setBadgeText({tabId, text:""}), which in
// Firefox (and Chrome) overrides the global "!" badge for that tab.
// The result was that the consent-required cue silently disappeared
// from any tab the user navigated. Since the cleaner is gated on
// onboardingDone, there are no per-tab counts to clear in this state,
// so skipping the emit is safe.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  sessionStorage.remove(`tab_${tabId}`);
  try {
    const prefs = await getPrefsWithCache();
    if (!prefs.onboardingDone) return;
  } catch { /* fall through and emit — toolbar reset is the safer default */ }
  toolbarBus.emit({ type: "navigationStarted", tabId });
});

// Clean up session data when a tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  sessionStorage.remove(`tab_${tabId}`);
  toolbarBus.emit({ type: "tabClosed", tabId });
});

// --- Session history helpers ---

const HISTORY_MAX = 10;

async function appendHistory(original, clean, removedTracking = []) {
  if (original === clean) return;
  const data = await sessionStorage.get({ history: [] });
  const entry = { original, clean, ts: Date.now(), removedTracking };
  const history = [entry, ...data.history].slice(0, HISTORY_MAX);
  await sessionStorage.set({ history });
}

// --- Storage change listener: invalidate cache and re-apply DNR state ---
chrome.storage.onChanged.addListener(async (changes, area) => {
  // Invalidate the prefs cache on both sync changes (disabledCategories, customParams, etc.)
  // and local changes that affect the merged cache (remoteParams — REQ-MERGE-5).
  if (area === "local") {
    if (changes.remoteParams) _invalidatePrefsCache();
    // E2E fixture overrides (#407): when fixtures change, prefs may
    // produce a different effective onboardingDone (hard-reonboard
    // gate) — drop the cache so the next read picks up the fixture.
    // The sentinel + fixture keys are never written in production.
    if (changes.__muga_test_mode || changes.__muga_test_fixtures) {
      _invalidatePrefsCache();
    }
    // Consent record changed (onboarding completed, hard-reonboard
    // accepted, etc.). Re-sync the cleaner gate + badge in one shot so
    // both DNR and the toolbar reflect the new state without needing a
    // browser restart.
    if (changes.mugaConsent) {
      _invalidatePrefsCache();
      const prefs = await getPrefsWithCache();
      await applyDnrState(prefs);
      await applyOnboardingBadge(prefs);
    }
    // Per-device overrides changed (per-device-prefs.setOverrides /
    // clearOverrides). getPrefs() overlays these last, so a change flips the
    // EFFECTIVE prefs (e.g. injectOwnAffiliate) that drive DNR + badge. Without
    // this the cache stays stale; previously correctness relied on overrides
    // only ever being written alongside a mugaConsent write — a fragile coupling.
    if (changes.mugaPerDevicePrefs) {
      _invalidatePrefsCache();
      const prefs = await getPrefsWithCache();
      await applyDnrState(prefs);
      await applyOnboardingBadge(prefs);
    }
    return;
  }
  if (area !== "sync") return;
  // Any sync storage change (including disabledCategories, contextMenuEnabled, etc.)
  // must invalidate the prefs cache so the next getPrefsWithCache() reads fresh data.
  _invalidatePrefsCache();
  if (changes.customParams || changes.dnrEnabled || changes.enabled ||
      changes.ampRedirect || changes.unwrapRedirects) {
    const prefs = await getPrefsWithCache();
    await applyDnrState(prefs);
  }
  if (changes.contextMenuEnabled || changes.language || changes.enabled) {
    const enabled = changes.contextMenuEnabled
      ? changes.contextMenuEnabled.newValue !== false
      : (await getPrefsWithCache()).contextMenuEnabled !== false;
    await syncContextMenus(enabled);
  }
});

// --- E2E test handlers (#398) ---
//
// Dispatched by the main message listener below when the message type
// starts with "__TEST__" AND the test-mode sentinel is set in
// chrome.storage.local. Production builds never set the sentinel, so
// these handlers are unreachable at runtime in production.
//
// Each handler reads state that is otherwise inaccessible from a
// content-script's world (e.g. chrome.action surface). Future slices
// add handlers for fixture-manifest / fixture-migrations overrides.
async function handleTestMessage(message, sender) {
  switch (message.type) {
    case "__TEST__readActionSurface": {
      const tabId = Number(message.tabId);
      if (!Number.isFinite(tabId) || tabId < 0) {
        return { ok: false, error: "invalid tabId" };
      }
      // chrome.action.getXxx returns a Promise on Chrome MV3 (NOT callback-
      // compatible there: passing a callback returns the Promise but the
      // callback is never invoked). On Firefox MV2 browserAction.getXxx
      // requires a callback. Detect by inspecting the return value.
      const callGet = (apiName, fallback) => {
        const method = actionApi[apiName];
        if (typeof method !== "function") return Promise.resolve(fallback);
        try {
          const result = method.call(actionApi, { tabId });
          if (result && typeof result.then === "function") {
            return result.catch(() => fallback);
          }
          // Callback form: invoke with explicit resolver.
          return new Promise(resolve => {
            try { method.call(actionApi, { tabId }, resolve); }
            catch { resolve(fallback); }
          });
        } catch {
          return Promise.resolve(fallback);
        }
      };
      const [title, badgeText] = await Promise.all([
        callGet("getTitle", ""),
        callGet("getBadgeText", ""),
      ]);
      const tabState = toolbarState.get(tabId);
      return {
        ok: true,
        title,
        badgeText,
        state: { ...tabState },
      };
    }
    case "__TEST__runConsentMigration": {
      // Force a re-run of the sync→local consent migration. Production
      // calls this once on service-worker startup; the e2e suite needs
      // to call it on demand AFTER seeding sync so it can assert the
      // observable end-state (local populated, sync cleaned).
      const report = await migrateConsentToLocal();
      return { ok: true, ...report };
    }
    case "__TEST__emitToolbarEvent": {
      // Drive a synthetic toolbar event onto the same bus the
      // production code uses. Lets the e2e suite assert the
      // chrome.action surface state for any presenter input
      // (urlCleaned / creatorReferralPreserved / foreignAffiliateDetected
      // / navigationStarted / tabClosed) without reproducing the URL
      // navigation that would otherwise generate the event.
      // The inner event lives under `message.event` so its `type` does
      // not collide with the dispatch `type`.
      const inner = message.event;
      if (!inner || typeof inner.type !== "string") {
        return { ok: false, error: "missing event.type" };
      }
      const tabIdNum = Number(inner.tabId);
      if (!Number.isFinite(tabIdNum) || tabIdNum < 0) {
        return { ok: false, error: "invalid tabId" };
      }
      const event = { type: inner.type, tabId: tabIdNum };
      if (inner.type === "urlCleaned") {
        event.paramsRemoved = Number(inner.paramsRemoved) || 0;
      }
      toolbarBus.emit(event);
      return { ok: true };
    }
    case "__TEST__getActiveTabId": {
      // Returns the active tab's id in the last-focused window. Used by
      // e2e specs so they can address chrome.action with a real tabId
      // — fictional tabIds make per-tab setBadgeText / setIcon a no-op
      // because the action API only retains state for live tabs.
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (r) => resolve(r || []));
      });
      const tab = tabs[0];
      if (!tab || typeof tab.id !== "number") {
        return { ok: false, error: "no active tab" };
      }
      return { ok: true, tabId: tab.id };
    }
    case "__TEST__resetActionApiCounts": {
      _testActionCalls = { setTitle: 0, setBadgeText: 0 };
      return { ok: true };
    }
    case "__TEST__readActionApiCounts": {
      return { ok: true, counts: { ..._testActionCalls } };
    }
    case "__TEST__readGlobalBadge": {
      // Reads the global (non-tab-specific) badge text. Per-tab badges
      // set by toolbar-presenter on navigationStarted would mask the
      // global one if we read via {tabId}, so this handler is the only
      // reliable way for the consent-gate spec to assert the global
      // applyOnboardingBadge() output.
      if (typeof actionApi.getBadgeText !== "function") {
        return { ok: true, badgeText: "" };
      }
      try {
        const result = actionApi.getBadgeText({});
        if (result && typeof result.then === "function") {
          const text = await result.catch(() => "");
          return { ok: true, badgeText: text };
        }
        const text = await new Promise(resolve => {
          try { actionApi.getBadgeText({}, resolve); }
          catch { resolve(""); }
        });
        return { ok: true, badgeText: text };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
    case "__TEST__readDnrEnabledRulesets": {
      // Lets the consent-gate regression spec assert that the
      // declarative cleaner is actually disabled while onboarding is
      // pending. Without this hook the test would pass on any code
      // path that merely silenced the badge.
      if (!hasDNR || typeof chrome.declarativeNetRequest?.getEnabledRulesets !== "function") {
        return { ok: true, ruleIds: [] };
      }
      try {
        const ids = await chrome.declarativeNetRequest.getEnabledRulesets();
        return { ok: true, ruleIds: Array.isArray(ids) ? ids : [] };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
    default:
      return { ok: false, error: `unknown __TEST__ message: ${message.type}` };
  }
}

// --- Main message listener from content scripts ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Validate that messages come from our own extension
  if (sender.id !== chrome.runtime.id) return false;

  if (message.type === "getPrefs") {
    getPrefsWithCache()
      .then(prefs => sendResponse({ ...prefs, _affiliateDomains }))
      .catch(() => { try { sendResponse(null); } catch { /* channel closed */ } });
    return true;
  }

  // ── E2E test-mode handlers (#398) ───────────────────────────────────────
  // Gated on chrome.storage.local["__muga_test_mode"]. Production builds
  // never set this sentinel; e2e tests set it via installTestModeSentinel
  // (tests/e2e/helpers/storage.mjs) and clear it on teardown. The handlers
  // expose read-side state that is otherwise unreadable from a content
  // script's world (toolbar action surface).
  if (typeof message.type === "string" && message.type.startsWith("__TEST__")) {
    chrome.storage.local.get({ __muga_test_mode: false }, (r) => {
      if (!r.__muga_test_mode) {
        try { sendResponse({ ok: false, error: "test mode not active" }); } catch { /* channel closed */ }
        return;
      }
      handleTestMessage(message, sender)
        .then(result => { try { sendResponse(result); } catch { /* channel closed */ } })
        .catch(err => {
          console.error("[MUGA] __TEST__ handler:", err);
          try { sendResponse({ ok: false, error: String(err?.message || err) }); } catch { /* channel closed */ }
        });
    });
    return true; // async response
  }

  if (message.type === "PROCESS_URL") {
    if (typeof message.url !== "string" || message.url.length > MAX_URL_LENGTH) {
      try { sendResponse({ cleanUrl: null, action: "error", removedTracking: [], junkRemoved: 0, detectedAffiliate: null }); } catch { /* channel closed */ }
      return true;
    }
    // Opportunistic remote-rules refresh — cheap no-op after the first call
    // in each SW lifetime. Catches the "user never restarts browser" case
    // that onStartup can't reach. Runs in parallel with URL processing.
    maybeFetchRemoteRules(_remoteRulesDeps());
    const tabId = sender.tab?.id;
    handleProcessUrl(message.url, { skipNotify: message.skipNotify, source: message.skipNotify ? "copy_selection" : "navigation", skipStats: !!message.skipStats, referrer: typeof message.referrer === "string" ? message.referrer : "" })
      .then(result => {
        updateTabBadge(tabId, result.junkRemoved ?? 0);
        if (typeof tabId === "number" && (result.preservedAffiliate || result.creatorReferralPreserved)) {
          toolbarBus.emit({ type: "creatorReferralPreserved", tabId });
        }
        sendResponse(result);
      })
      .catch(err => {
        console.error("[MUGA] PROCESS_URL handler failed:", err);
        try { sendResponse({ cleanUrl: message.url, action: "error", removedTracking: [], junkRemoved: 0, detectedAffiliate: null }); } catch { /* channel closed */ }
      });
    return true; // keep the channel open for the async response
  }

  // Fire-and-forget side-channel for the local-cleaning path (#356/#366).
  // The content script does the actual URL cleaning locally via the
  // bundled cleaner and only asks the SW to update badge text, increment
  // stats, append history, and emit toolbar bus events. No response is
  // required — failure here doesn't affect the user-visible URL change
  // that already happened.
  //
  // Stat-increment semantics mirror handleProcessUrl exactly:
  //   - urlsCleaned + junkRemoved fire only when action !== "untouched"
  //     AND (urlChanged OR junkRemoved > 0).
  //   - referralsSpotted fires when action === "detected_foreign".
  //   - domainStats fires only when prefs.domainStats is on AND junk > 0.
  if (message.type === "BADGE_AND_STATS") {
    const tabId = sender.tab?.id;
    const junkRemoved = Number(message.junkRemoved) || 0;
    const removedTracking = Array.isArray(message.removedTracking) ? message.removedTracking : [];
    const action = String(message.action || "");
    const cleanUrl = typeof message.cleanUrl === "string" ? message.cleanUrl : "";
    const originalUrl = typeof message.originalUrl === "string" ? message.originalUrl : "";
    const urlChanged = cleanUrl && originalUrl && cleanUrl !== originalUrl;

    if (junkRemoved > 0) updateTabBadge(tabId, junkRemoved);

    if (action !== "untouched" && (urlChanged || junkRemoved > 0)) {
      incrementStat("urlsCleaned");
      if (junkRemoved > 0) incrementStat("junkRemoved", junkRemoved);
      // Domain stats requires the user's pref. Best-effort read; failure
      // skips the increment without affecting the rest.
      getPrefsWithCache().then(prefs => {
        if (prefs.domainStats && junkRemoved > 0) {
          try {
            const hostname = new URL(originalUrl).hostname.replace(/^www\./, "");
            incrementDomainStat(hostname, junkRemoved);
          } catch { /* invalid URL, skip */ }
        }
      }).catch(() => { /* prefs unavailable, skip */ });
      if (originalUrl && cleanUrl) {
        appendHistory(originalUrl, cleanUrl, removedTracking).catch(err => {
          console.warn("[MUGA] BADGE_AND_STATS appendHistory:", err);
        });
      }
    }

    if (action === "detected_foreign") {
      incrementStat("referralsSpotted");
    }

    try { sendResponse({ ok: true }); } catch { /* channel closed */ }
    return false;
  }

  if (message.type === "ADD_TO_WHITELIST" || message.type === "ADD_TO_BLACKLIST") {
    // List mutations must originate from a tab (content script). Reject messages
    // from extension pages (popup, options) that lack a sender.tab — they cannot
    // legitimately trigger list changes, and this prevents a defense-in-depth gap.
    if (!sender.tab) {
      try { sendResponse({ ok: false, error: "tab-only" }); } catch { /* channel closed */ }
      return false;
    }
  }

  if (message.type === "ADD_TO_WHITELIST") {
    const entry = message.tag;
    if (!isValidListEntry(entry)) {
      sendResponse({ ok: false });
      return true;
    }
    _listMutationQueue = _listMutationQueue.then(async () => {
      const fresh = await getPrefs();
      if (!fresh.whitelist.includes(entry)) {
        await setPrefs({ whitelist: [...fresh.whitelist, entry] });
        logAction("whitelist_add", { entry });
      }
      _invalidatePrefsCache();
      sendResponse({ ok: true });
    }).catch(err => {
      console.error("[MUGA] ADD_TO_WHITELIST handler failed:", err);
      try { sendResponse({ ok: false }); } catch { /* channel closed */ }
    });
    return true;
  }

  if (message.type === "ADD_TO_BLACKLIST") {
    const entry = message.tag;
    if (!isValidListEntry(entry)) {
      sendResponse({ ok: false });
      return true;
    }
    _listMutationQueue = _listMutationQueue.then(async () => {
      const fresh = await getPrefs();
      if (!fresh.blacklist.includes(entry)) {
        await setPrefs({ blacklist: [...fresh.blacklist, entry] });
        logAction("blacklist_add", { entry });
      }
      _invalidatePrefsCache();
      sendResponse({ ok: true });
    }).catch(err => {
      console.error("[MUGA] ADD_TO_BLACKLIST handler failed:", err);
      try { sendResponse({ ok: false }); } catch { /* channel closed */ }
    });
    return true;
  }

  if (message.type === "GET_DEBUG_LOG") {
    sessionStorage.get({ debugLog: [] }).then(data => {
      sendResponse({ log: data.debugLog || [] });
    }).catch(() => {
      sendResponse({ log: [] });
    });
    return true;
  }

  if (message.type === "INCREMENT_STAT") {
    const ALLOWED_STAT_KEYS = ["urlsCleaned", "junkRemoved", "referralsSpotted"];
    if (ALLOWED_STAT_KEYS.includes(message.key)) incrementStat(message.key);
    sendResponse({ ok: true });
    // incrementStat is fire-and-forget — the response above is synchronous.
    // Returning true here keeps the message channel open for an async
    // response that never comes, leaking one port slot per message (#706).
    return false;
  }

  // exposed for future dev-tools use
  if (message.type === "CLEAR_DEBUG_LOG") {
    sessionStorage.set({ debugLog: [] })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  // ── Remote-rules message handlers ──────────────────────────────────────────
  // Sender validation: the top-level guard (sender.id !== chrome.runtime.id) already
  // rejects messages from unknown senders before reaching these branches. (REQ-SECURITY-2)

  if (message.type === "ENABLE_REMOTE_RULES") {
    // Note: chrome.permissions.request must have been called by the UI BEFORE sending
    // this message (Firefox MV2 requires the gesture in the same call frame, design §10).
    (async () => {
      try {
        await setPrefs({ remoteRulesEnabled: true });
        _invalidatePrefsCache();
        // Immediate first fetch (REQ-OPT-3, SC-02). Subsequent fetches happen
        // opportunistically via maybeFetchRemoteRules on any SW wake once the
        // 7-day interval has elapsed — no alarm required.
        await runRemoteRulesFetch(_remoteRulesDeps());
        try { sendResponse({ ok: true }); } catch { /* channel closed */ }
      } catch (err) {
        console.error("[MUGA] ENABLE_REMOTE_RULES handler failed:", err);
        try { sendResponse({ ok: false, error: String(err) }); } catch { /* channel closed */ }
      }
    })();
    return true;
  }

  if (message.type === "DISABLE_REMOTE_RULES") {
    (async () => {
      try {
        await setPrefs({ remoteRulesEnabled: false });
        _invalidatePrefsCache();
        // Clear remote params + DNR rule 1001. Rule 1000 (custom) is NOT touched. (REQ-OPT-5, SC-03)
        await clearRemoteCache({
          storage: {
            remove: (k) => chrome.storage.local.remove(k),
          },
          dnr: hasDNR
            ? { updateDynamicRules: (opts) => chrome.declarativeNetRequest.updateDynamicRules(opts) }
            : { updateDynamicRules: async () => {} },
        });
        try { sendResponse({ ok: true }); } catch { /* channel closed */ }
      } catch (err) {
        console.error("[MUGA] DISABLE_REMOTE_RULES handler failed:", err);
        try { sendResponse({ ok: false, error: String(err) }); } catch { /* channel closed */ }
      }
    })();
    return true;
  }

  if (message.type === "GET_REMOTE_RULES_STATUS") {
    (async () => {
      try {
        // Read enabled from sync (authoritative)
        const syncData = await chrome.storage.sync.get({ remoteRulesEnabled: false });
        const enabled = !!syncData.remoteRulesEnabled;
        // Read meta from local
        const localData = await chrome.storage.local.get({
          remoteParams: [],
          remoteRulesMeta: { version: 0, fetchedAt: null, paramCount: 0, lastError: null, published: null },
        });
        // Feature-detect flags (REQ-UI-5). Since v1.10.1 the feature no
        // longer requires chrome.alarms — the only remaining runtime gate
        // is DNR availability.
        const supportsDNR = hasDNR;
        try {
          sendResponse({
            ok: true,
            enabled,
            meta: localData.remoteRulesMeta,
            remoteParams: localData.remoteParams,
            supportsDNR,
          });
        } catch { /* channel closed */ }
      } catch (err) {
        console.error("[MUGA] GET_REMOTE_RULES_STATUS handler failed:", err);
        try { sendResponse({ ok: false, error: String(err) }); } catch { /* channel closed */ }
      }
    })();
    return true;
  }

  // ── Shortener resolution: resolve generic shortener via native fetch ─────────
  // ADR-0004 phase 5 (#701): proxy path removed. Native resolver is the SOLE
  // path. On failure (permission denied, fetch throws, no Location header):
  // the response ok:false is returned and the content script falls back to
  // the original navigation — per ADR-0004 option-D rejection reasoning
  // (surface/skip rather than silently forward).
  //
  // Sender has already been validated at the top of this listener
  // (sender.id !== chrome.runtime.id returns false before reaching here).
  if (message.type === "RESOLVE_SHORTENER") {
    (async () => {
      try {
        const prefs = await getPrefsWithCache();
        if (!prefs.followShortenersEnabled) {
          try { sendResponse({ ok: false, reason: "disabled" }); } catch { /* channel closed */ }
          return;
        }

        // Validate input URL: scheme must be http/https, host must be a known
        // generic shortener. Under the 2.1 denoise pivot (#659) this tier must
        // NOT resolve affiliate-redirect networks — their click IS the
        // attribution event and must pass through unchanged.
        const rawUrl = message.url;
        let parsedUrl;
        try {
          parsedUrl = new URL(rawUrl);
        } catch {
          try { sendResponse({ ok: false, reason: "invalid_url" }); } catch { /* channel closed */ }
          return;
        }
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
          try { sendResponse({ ok: false, reason: "invalid_url" }); } catch { /* channel closed */ }
          return;
        }
        const hostname = parsedUrl.hostname;
        if (!isGenericShortener(hostname)) {
          try { sendResponse({ ok: false, reason: "invalid_url" }); } catch { /* channel closed */ }
          return;
        }

        // Native resolution — sole path as of ADR-0004 phase 5.
        const result = await resolveShortener(rawUrl);
        // ADR-0004 phase 4: per-shortener pass/fail counter (local-only, never
        // transmitted). Synchronous accumulate-and-flush since #817 — no .catch.
        incrementShortenerStat(hostname, result.ok ? "pass" : "fail");

        try { sendResponse(result); } catch { /* channel closed */ }
      } catch (err) {
        console.error("[MUGA] RESOLVE_SHORTENER handler failed:", err);
        try { sendResponse({ ok: false, reason: "network" }); } catch { /* channel closed */ }
      }
    })();
    return true;
  }

});

async function handleProcessUrl(rawUrl, { skipNotify = false, source = "navigation", skipStats = false, referrer = "" } = {}) {
  if (!rawUrl?.startsWith("http")) return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null };
  // _domainRulesReady / _pathRulesReady are nulled on fetch failure to allow
  // retry on the next call. Both loaders run in a single outer Promise.all so
  // all three JSON files (domain + 2× path) are in flight at once.
  if (!_domainRulesReady) _domainRulesReady = _loadDomainRules();
  if (!_pathRulesReady)   _pathRulesReady   = _loadPathRules();
  await Promise.all([_domainRulesReady, _pathRulesReady]);
  const prefs = await getPrefsWithCache();

  if (!prefs.enabled || !prefs.onboardingDone) {
    return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null };
  }

  // On copy: suppress the toast and affiliate injection. User didn't navigate,
  // they just copied a link, so we should not inject our tag either.
  const effectivePrefs = skipNotify
    ? { ...prefs, notifyForeignAffiliate: false, injectOwnAffiliate: false }
    : prefs;

  let result;
  try {
    // 5th arg `frequencyTracker` is the cross-site-frequency singleton
    // (#446 / #495). Cleaner side fires-and-forgets one observe() per
    // stripped tracking param, gated on prefs.crossSiteFrequencyEnabled.
    // Null-safe: cleaner no-ops when the tracker is missing.
    // 6th arg `referrer` (#452 / B14) wires Honor Creator Mode — when the
    // user enabled the toggle AND the navigation referrer matches an
    // allowlisted creator, the cleaner short-circuits with action
    // "honored-creator". Empty string for non-navigation contexts.
    result = processUrl(rawUrl, effectivePrefs, domainRules, undefined, frequencyTracker, referrer, pathStripRules, pathAffiliateRules);
  } catch (err) {
    console.error("[MUGA] processUrl failed:", err, rawUrl);
    return { cleanUrl: rawUrl, action: "error", removedTracking: [], junkRemoved: 0, detectedAffiliate: null };
  }

  // Record first use timestamp for nudge threshold (stored locally)
  if (!_firstUsedSet) {
    const localStats = await getStats();
    if (localStats.firstUsed) {
      _firstUsedSet = true;
    } else {
      await setStats({ firstUsed: Date.now() });
      _firstUsedSet = true;
    }
  }

  // Update stats and session history. Only count if the URL actually changed (S13).
  const urlChanged = result.cleanUrl !== rawUrl;
  let parsedRaw;
  try { parsedRaw = new URL(rawUrl); } catch { /* ignore */ }
  if (result.action === "untouched" || (!urlChanged && result.junkRemoved === 0)) {
    if (parsedRaw?.search) {
      const passthroughEntry = { domain: parsedRaw.hostname.replace(/^www\./, "") };
      if (prefs.devMode) {
        passthroughEntry.path = parsedRaw.pathname;
        passthroughEntry.params = [...parsedRaw.searchParams.keys()];
      }
      logAction("passthrough", passthroughEntry);
    }
  }
  if (result.action !== "untouched" && (urlChanged || result.junkRemoved > 0)) {
    if (!skipStats) {
      incrementStat("urlsCleaned");
      if (result.junkRemoved > 0) incrementStat("junkRemoved", result.junkRemoved);
      if (prefs.domainStats && result.junkRemoved > 0) {
        try {
          const hostname = new URL(rawUrl).hostname.replace(/^www\./, "");
          incrementDomainStat(hostname, result.junkRemoved);
        } catch { /* invalid URL, skip domain stat */ }
      }
    }
    await appendHistory(rawUrl, result.cleanUrl, result.removedTracking ?? []);
    if (parsedRaw) {
      try {
        const domain = parsedRaw.hostname.replace(/^www\./, "");
        const cleanedEntry = {
          source,
          domain,
          action: result.action,
          junkRemoved: result.junkRemoved,
        };
        if (prefs.devMode) {
          const parsedClean = new URL(result.cleanUrl);
          cleanedEntry.path = parsedRaw.pathname;
          cleanedEntry.removed = result.removedTracking;
          cleanedEntry.originalParams = [...parsedRaw.searchParams.keys()];
          cleanedEntry.cleanParams = [...parsedClean.searchParams.keys()];
          cleanedEntry.cleanUrl = result.cleanUrl;
        }
        logAction("cleaned", cleanedEntry);
      } catch { /* malformed cleanUrl — skip logging */ }
    }
  }
  if (result.action === "detected_foreign") {
    incrementStat("referralsSpotted");
    const d = result.detectedAffiliate;
    logAction("affiliate_detected", {
      domain: parsedRaw?.hostname.replace(/^www\./, "") ?? "",
      param: d?.param,
      value: d?.value,
      store: d?.pattern?.name ?? null,
      action: result.action,
    });
    // If injection is enabled, build the URL with our tag so "Remove it" can use it.
    // #523 phase 3: pattern.ourTag is now a { host -> tag } map, not a flat string.
    // Pick the tag for the cleanUrl's hostname; if we have no tag for this
    // marketplace, skip the with-our-affiliate variant.
    if (prefs.injectOwnAffiliate && result.detectedAffiliate?.pattern) {
      try {
        const url = new URL(result.cleanUrl);
        const p = result.detectedAffiliate.pattern;
        const host = url.hostname.replace(/^www\./, "");
        const ourTagForHost = p.ourTag?.[host] || p.ourTag?.[url.hostname] || "";
        if (ourTagForHost) {
          url.searchParams.set(p.param, ourTagForHost);
          result.withOurAffiliate = url.toString();
        }
      } catch { /* malformed cleanUrl — skip injection */ }
    }
  }

  // #460 (A2): mirror the cleaner outcome into the Attribution Ledger
  // so the popup's "Recent activity" section can render. Fire-and-forget
  // so a write hiccup never affects the caller's URL processing.
  pushAttributionAndPersist(rawUrl, result, prefs);

  return result;
}

// --- Remote-rules deps factory ---
// Builds the deps object for runRemoteRulesFetch. Centralised so the
// ENABLE_REMOTE_RULES message handler and the startup/wake fetch paths
// (maybeFetchRemoteRules) use exactly the same deps.
//
// Test-only key override (design §13.5, T7.2):
//   When globalThis.__MUGA_TRUSTED_KEYS__ is set, use it instead of the
//   production TRUSTED_PUBLIC_KEYS. This allows E2E tests to inject a
//   throw-away keypair without committing any private key material.
//   The override is inert at runtime in the packaged extension — the browser
//   never sets __MUGA_TRUSTED_KEYS__, so production behaviour is unchanged.
function _remoteRulesDeps() {
  const trustedKeys =
    Array.isArray(globalThis.__MUGA_TRUSTED_KEYS__) && globalThis.__MUGA_TRUSTED_KEYS__.length > 0
      ? globalThis.__MUGA_TRUSTED_KEYS__
      : TRUSTED_PUBLIC_KEYS;
  return {
    fetchImpl: globalThis.fetch,
    subtle: globalThis.crypto?.subtle,
    trustedKeys,
    storage: hasDNR ? {
      get: (d) => chrome.storage.local.get(d),
      set: (i) => chrome.storage.local.set(i),
      remove: (k) => chrome.storage.local.remove(k),
    } : null,
    dnr: hasDNR ? {
      updateDynamicRules: (opts) => chrome.declarativeNetRequest.updateDynamicRules(opts),
    } : { updateDynamicRules: async () => {} },
  };
}

// --- On startup: apply DNR state + opportunistic remote-rules fetch ---
chrome.runtime.onStartup.addListener(async () => {
  const prefs = await getPrefsWithCache();
  await applyDnrState(prefs);
  // Opportunistic fetch: time-gated so it only fires if the stored fetchedAt
  // is older than REMOTE_REFRESH_INTERVAL_MS or absent. Also short-circuits
  // immediately if remoteRulesEnabled is false.
  maybeFetchRemoteRules(_remoteRulesDeps());
  // ADR-0004 phase 5 (#701): migrate privacyProxyEnabled → followShortenersEnabled
  // on first startup after upgrade. Best-effort; failure must not break startup.
  migrateLegacyProxyPref().catch(() => {});
});

// --- Dedup flag: prevent opening onboarding twice in the same background lifetime ---
let _onboardingTabOpened = false;
function openOnboardingOnce() {
  if (_onboardingTabOpened) return;
  _onboardingTabOpened = true;
  chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
}

/**
 * Single decision function consulted by both the onInstalled and the
 * background-load fallback paths (#365). Returns true when the
 * onboarding tab should be opened — either because the user has never
 * accepted, or because the required ToS version has advanced past
 * what they accepted (soft or hard re-onboard).
 *
 * Today the manifest holds only "1.0" so this is functionally
 * equivalent to the prior `!prefs.onboardingDone` check; the gate is
 * in place for slice #370 which adds the delta / material rendering
 * modes that consume the policy's `soft-reonboard` / `hard-reonboard`
 * statuses.
 *
 * @param {object} prefs - Merged prefs (consent overlay applied by getPrefs).
 * @returns {boolean}
 */
function shouldOpenOnboarding(prefs) {
  const result = evaluateConsent({ stored: prefs });
  return result.status !== "valid";
}

// --- On install: open onboarding on first run, sync DNR + maybe fetch rules ---
chrome.runtime.onInstalled.addListener(async (details) => {
  const prefs = await getPrefsWithCache();
  await applyDnrState(prefs);
  await applyOnboardingBadge(prefs);
  // Opportunistic fetch: fires on install/update if user had enabled remote rules
  // before the update and the stored payload is stale (or absent).
  maybeFetchRemoteRules(_remoteRulesDeps());
  // ADR-0004 phase 5 (#701): migrate privacyProxyEnabled → followShortenersEnabled
  migrateLegacyProxyPref().catch(() => {});

  if (prefs.contextMenuEnabled !== false) {
    await syncContextMenus(true);
  }

  if (details.reason === "install") {
    const installPrefs = await getPrefs();
    if (shouldOpenOnboarding(installPrefs)) {
      openOnboardingOnce();
    }
  }
});

// --- Fallback: onInstalled is unreliable in Firefox MV2 temporary add-ons ---
// If onboarding was never completed (or required ToS version has advanced),
// open it on background load. This also covers edge cases where onInstalled
// fires before the module registers its listener. The dedup flag ensures
// only one tab opens even if both paths fire.
(async () => {
  try {
    const prefs = await getPrefs();
    if (shouldOpenOnboarding(prefs)) {
      openOnboardingOnce();
    }
    // Surface the consent-required badge on every cold start, not just
    // on first install. onInstalled does not fire on browser restart or
    // on Firefox temporary add-ons.
    await applyOnboardingBadge(prefs);
    // Also ensure context menus are registered on first load
    if (prefs.contextMenuEnabled !== false) {
      await syncContextMenus(true);
    }
  } catch (e) {
    console.error("[MUGA] fallback onboarding check failed:", e);
  }
})();

// --- Keyboard shortcut: copy clean URL of current tab ---
// Firefox Android does not support chrome.commands
if (chrome.commands) chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "copy-clean-url") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !tab?.id) return;

  const result = await handleProcessUrl(tab.url, { skipNotify: true, source: "shortcut" });
  chrome.tabs.sendMessage(tab.id, {
    type: "COPY_TO_CLIPBOARD",
    text: result.cleanUrl,
  }, () => void chrome.runtime.lastError);
});

if (hasContextMenus) chrome.contextMenus.onClicked.addListener(async (info) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (info.menuItemId === "muga-copy-clean") {
    const result = await handleProcessUrl(info.linkUrl, { skipNotify: true, source: "copy_link" });

    // Copy to clipboard via content script (service worker has no direct clipboard access)
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: "COPY_TO_CLIPBOARD",
        text: result.cleanUrl,
      }, () => void chrome.runtime.lastError);
    }
    return;
  }

  if (info.menuItemId === "muga-copy-clean-selection") {
    if (!tab?.id) return;
    // Ask the content script to handle it: it can access the actual DOM selection including hrefs
    chrome.tabs.sendMessage(tab.id, { type: "GET_AND_COPY_CLEAN_SELECTION" }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        // Fallback: plain-text approach (original behavior)
        const text = info.selectionText;
        if (!text) return;
        let result = text;
        (async () => {
          const matches = [...text.matchAll(URL_RE)];
          let anyChanged = false;
          for (const match of matches) {
            const candidate = match[0].replace(/[.,;:!?)\]]+$/, "");
            const cleaned = await handleProcessUrl(candidate, { skipNotify: true, source: "copy_selection", skipStats: true });
            if (cleaned.cleanUrl !== candidate) { result = result.replaceAll(candidate, cleaned.cleanUrl); anyChanged = true; }
          }
          if (anyChanged) incrementStat("urlsCleaned");
          chrome.tabs.sendMessage(tab.id, { type: "COPY_TO_CLIPBOARD", text: result }, () => void chrome.runtime.lastError);
        })();
      }
    });
    return;
  }
});
