/**
 * MUGA: Service Worker (MV3)
 * Processes URLs, handles messages from content scripts,
 * and maintains extension state.
 */

import { processUrl, computeNavigationStrip, parseListEntry, getFullyExemptDomains, isSiteFullyExempt, getFullyBlacklistedDomains, isSiteFullyBlacklisted } from "../lib/cleaner.js";
import { getAffiliateDomains, resolveOurTag } from "../lib/affiliates.js";
import { getPrefs, setPrefs, incrementStat, getStats, setStats, migrateStatsToLocal, migrateLegacyProxyPref, migratePerSiteDisableToAllowlist, migrateCookieConsentMode, sessionStorage, incrementDomainStat, cacheDomainRules, getCachedDomainRules, getRemoteParams } from "../lib/storage.js";
import { migrateConsentToLocal } from "../lib/sync-migration.js";
import { evaluate as evaluateConsent } from "../lib/consent-policy.js";
import { isCookieConsentModeActive } from "../lib/settings-schema.js";
import { isValidListEntry } from "../lib/validation.js";
import {
  DNR_CUSTOM_PARAMS_RULE_ID,
  DNR_REMOTE_PARAMS_RULE_ID,
  DNR_ALLOWLIST_RULE_ID_BASE,
  DNR_ALLOWLIST_MAX_RULES,
  DNR_SUPPRESS_REFERER_RULE_ID,
  DNR_BLOCK_BEACONS_RULE_ID,
  DNR_BLOCKLIST_REFERER_RULE_ID_BASE,
  DNR_BLOCKLIST_BEACON_RULE_ID_BASE,
  DNR_BLOCKLIST_MAX_RULES,
  ALLOWLIST_RESOURCE_TYPES,
} from "../lib/dnr-ids.js";
import { partitionRulesets } from "../lib/dnr-ruleset-state.js";
import { t } from "../lib/i18n.js";
import {
  runRemoteRulesFetch,
  clearRemoteCache,
  buildRemoteDnrRule,
} from "../lib/remote-rules.js";
import { TRUSTED_PUBLIC_KEYS } from "../lib/remote-rules-keys.js";
import { buildRemoteRulesStatus } from "../lib/remote-rules-status.js";
import { reconcileOverrideForExplicitChoice } from "../lib/per-device-prefs.js";
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

// Idempotent firstUsed bootstrap. Called from onInstalled + onStartup so the
// hot path (handleProcessUrl) only sees a free boolean check, not a storage
// read, on the first processed URL. Sets firstUsed only when absent (#833).
async function _initFirstUsed() {
  if (_firstUsedSet) return;
  try {
    const stats = await getStats();
    if (!stats.firstUsed) await setStats({ firstUsed: Date.now() });
    _firstUsedSet = true;
  } catch { /* best-effort; handleProcessUrl fallback still guards */ }
}

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
    // Do NOT null _domainRulesReady here — concurrent callers share this promise.
    // handleProcessUrl nulls it after all callers finish awaiting, enabling retry.
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
    // Do NOT null _pathRulesReady here — concurrent callers share this promise.
    // handleProcessUrl nulls it after all callers finish awaiting, enabling retry.
  }
}

// B3: chrome.action (MV3) does not exist in Firefox MV2; fall back to browserAction
const _rawActionApi = globalThis.chrome?.action || globalThis.chrome?.browserAction || {};

// E2E action-API call counter (#408). Increments on every presenter-side
// mutation so e2e specs can assert idempotency (no redundant calls when
// the resolved state hasn't changed). Reset / read via __TEST__ handlers
// (see below) gated on the test-mode sentinel. Production never reads
// these counts; the cost is one integer increment per action call.
// setIcon is tracked here PURELY as an e2e regression guard (#910): the
// toolbar presenter must NEVER call it (the prior icon-variant swap raced
// navigation resets and caused the Firefox MV2 icon to flash/disappear —
// f6a6e2b). Production code never calls actionApi.setIcon; if this counter
// is ever non-zero in a test run, that is itself the regression.
let _testActionCalls = { setTitle: 0, setBadgeText: 0, setIcon: 0 };
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

// --- Toolbar presenter (#358, badge re-introduced #910) ---
// All toolbar surface mutations (tooltip, badge text) flow through this
// presenter via the event bus. No code outside the presenter calls
// chrome.action.set* directly. setIcon is never called — see
// toolbar-presenter.js module doc for why (f6a6e2b regression).
const toolbarBus   = createToolbarEventBus();
const toolbarState = createTabPresenterState();
const toolbarPresenter = createToolbarPresenter({
  bus: toolbarBus,
  state: toolbarState,
  actionApi,
  // The presenter calls t(key) without a lang. Resolve from cachedPrefs at
  // call time so the user's current language is used. Defaults to "en"
  // before the cache is warm, which is fine — tooltip update fires after
  // URL processing, by which point prefs are loaded.
  t: (key) => t(key, cachedPrefs?.language || "en"),
  // Same call-time-resolution pattern as `t` above. Defaults (cachedPrefs
  // still null) resolve to showBadge:true / onboardingDone:false — the
  // latter is the SAFE default: never paint a per-tab badge before we
  // actually know consent is complete, since that would mask the global
  // "!" badge for that tab.
  getShowBadge: () => cachedPrefs?.showBadge !== false,
  isOnboardingDone: () => cachedPrefs?.onboardingDone === true,
});

// Run migrations once on startup (no-ops if already done).
// All are idempotent and best-effort — failures must not break startup.
migrateStatsToLocal();
migrateConsentToLocal();
migratePerSiteDisableToAllowlist().catch(() => {});
// Cookie-consent 2-state mode: converts the legacy
// cookieConsentMinimizerEnabled boolean into cookieConsentMode. This
// top-level call passes no reason, so it runs the SAFE idempotent pass only
// (maps a present legacy key; never infers "off" from an absent mode).
// Genuine installs are seeded by the onInstalled call site, which passes
// details.reason.
migrateCookieConsentMode().catch(() => {});

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
 * @param {string} [referrer] - navigation referrer (#452/B14), threaded
 *   through so fromCleanerResult can reprocess an `injected` result with
 *   the same referrer context when deriving the tagless copy-safe URL (#946).
 */
function pushAttributionAndPersist(rawUrl, result, prefs, referrer = "") {
  // Privacy gate: skip both in-memory accumulation AND storage write so
  // a user who flips the toggle off mid-session sees the ring buffer
  // freeze immediately.
  if (prefs?.attributionLedgerEnabled === false) return;
  let event;
  try {
    // #946: ctx lets fromCleanerResult reprocess `injected` results with
    // injectOwnAffiliate forced off, so the ledger never stores a
    // MUGA-tagged URL. domainRules/pathStripRules/pathAffiliateRules are
    // the same module-level caches handleProcessUrl() itself uses.
    event = attributionEventFromCleanerResult(rawUrl, result, {
      prefs, domainRules, pathStripRules, pathAffiliateRules, referrer,
    });
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

// --- Cleaned-URL stats/badge recording (shared) ---

/**
 * Records a clean into the badge + stats + session history. Extracted so the
 * content-script BADGE_AND_STATS message handler and the Firefox blocking
 * webRequest stripper (below) increment identical tallies — the counter must
 * reflect network-layer strips on Firefox exactly as it reflects content-script
 * strips. Stat-increment semantics mirror handleProcessUrl:
 *   - urlsCleaned + junkRemoved fire only when action !== "untouched" AND
 *     (the URL changed OR junkRemoved > 0);
 *   - referralsSpotted fires when action === "detected_foreign";
 *   - domainStats fires only when prefs.domainStats is on AND junk > 0.
 *
 * @param {number|undefined} tabId
 * @param {string} originalUrl
 * @param {{cleanUrl?:string, action?:string, removedTracking?:string[], junkRemoved?:number}} result
 */
function recordNetworkClean(tabId, originalUrl, result) {
  const junkRemoved = Number(result?.junkRemoved) || 0;
  const removedTracking = Array.isArray(result?.removedTracking) ? result.removedTracking : [];
  const action = String(result?.action || "");
  const cleanUrl = typeof result?.cleanUrl === "string" ? result.cleanUrl : "";
  const urlChanged = cleanUrl && originalUrl && cleanUrl !== originalUrl;

  if (junkRemoved > 0) updateTabBadge(tabId, junkRemoved);

  if (action !== "untouched" && (urlChanged || junkRemoved > 0)) {
    incrementStat("urlsCleaned");
    if (junkRemoved > 0) incrementStat("junkRemoved", junkRemoved);
    // Domain stats requires the user's pref. Best-effort read; failure skips the
    // increment without affecting the rest.
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
        console.warn("[MUGA] recordNetworkClean appendHistory:", err);
      });
    }
  }

  if (action === "detected_foreign") {
    incrementStat("referralsSpotted");
  }
}

// --- Firefox network-layer stripper (blocking webRequest) ---
//
// Chrome MV3 removed blocking webRequest and cleans navigations via DNR. Firefox
// MV2 KEEPS blocking webRequest, so on Firefox we use it as the network-layer
// stripper — the true equivalent of Chrome's DNR: it strips tracking params from
// the top-level navigation BEFORE the request goes out and, unlike DNR, can feed
// the cleaned-URL counter (DNR emits no onRuleMatched signal). Chrome is
// unaffected — it never registers this listener and keeps using DNR.
//
// Gate: MV2 manifest (only ever shipped to Firefox via with-firefox-manifest.sh)
// AND a blocking-capable webRequest. `hasDNR` cannot distinguish the targets
// (both expose declarativeNetRequest); the manifest version can.
const isFirefoxMV2 =
  chrome.runtime.getManifest().manifest_version === 2 &&
  typeof chrome.webRequest?.onBeforeRequest?.addListener === "function";

// Set true once prefs + domain/path rules have all settled (success or failure).
// The blocking listener passes navigations through until then: stripping with an
// empty domainRules would miss domain-specific rules AND could over-strip a
// param that a domain's preserveParams would have kept. The content-script
// self-clean covers this brief startup window (Firefox's bg page is persistent,
// so it is effectively just the first navigation after browser start).
let _fxStripperReady = false;

/**
 * Blocking onBeforeRequest handler. MUST return synchronously (a BlockingResponse
 * or undefined). Reads the warm prefs/rules caches synchronously and delegates the
 * strip decision to computeNavigationStrip (the same pure logic a unit test
 * exercises), so behavior never diverges from Chrome.
 *
 * @param {{url:string, tabId:number}} details
 * @returns {{redirectUrl:string}|undefined}
 */
function onBeforeNavigateStrip(details) {
  // Pass through until prefs AND rules are warm (see _fxStripperReady). Kick the
  // warm-up on the way past so it resolves as soon as possible.
  if (!_fxStripperReady || !cachedPrefs) { getPrefsWithCache(); return; }

  const decision = computeNavigationStrip(
    details.url, cachedPrefs, domainRules, pathStripRules, pathAffiliateRules, frequencyTracker,
  );
  if (!decision) return;

  // Fire-and-forget stats — keeps this listener's return synchronous.
  recordNetworkClean(details.tabId, details.url, decision.result);
  return { redirectUrl: decision.cleanUrl };
}

/**
 * Blocking onBeforeSendHeaders handler (Firefox MV2 only, referer-beacon-privacy
 * PR 3). Removes the `referer` request header when the destination host is NOT
 * fully exempt (allowlist) AND either the global `suppressReferer` pref is ON
 * or the host is fully blacklisted (force-suppress regardless of the global
 * pref, per design D2). Encodes the SAME precedence as the Chrome DNR rule
 * priorities from PR 2: allowlist allow (1000) always wins; blocklist
 * force-suppress (2) fires even with the global toggle OFF; the global rule
 * (1) only fires when its own pref is ON.
 *
 * MUST return synchronously (a BlockingResponse or undefined), like
 * onBeforeNavigateStrip above. Reads the warm `cachedPrefs` directly — unlike
 * the param stripper, this listener needs no domain/path rules, so
 * `cachedPrefs` itself is the readiness signal. Fails OPEN (returns
 * undefined, leaving `requestHeaders` untouched) on a cold cache, a malformed
 * URL, or an exempt/blacklist-check throw — an internal error must never
 * strip a header a real user relies on.
 *
 * @param {{url:string, requestHeaders?:Array<{name:string,value?:string}>}} details
 * @returns {{requestHeaders: Array}|undefined}
 */
function onBeforeSendHeadersSuppressReferer(details) {
  if (!cachedPrefs) { getPrefsWithCache(); return; }

  let host;
  try {
    host = new URL(details.url).hostname;
  } catch {
    return; // malformed URL -> pass through unchanged
  }

  try {
    if (isSiteFullyExempt(host, cachedPrefs)) return; // allowlist always wins
    if (cachedPrefs.suppressReferer !== true && !isSiteFullyBlacklisted(host, cachedPrefs)) return;
  } catch {
    return; // exempt/blacklist check threw -> pass through unchanged
  }

  const requestHeaders = (details.requestHeaders || []).filter(
    (header) => header.name.toLowerCase() !== "referer",
  );
  return { requestHeaders };
}

/**
 * Blocking onBeforeRequest handler for beacon traffic (Firefox MV2 only,
 * referer-beacon-privacy PR 3). Registered filtered to `types:["ping","beacon"]`
 * below: unlike Chrome (which folds both into "ping"), Firefox emits a distinct
 * "beacon" resourceType for `navigator.sendBeacon()` and reserves "ping" for
 * `<a ping>`, so BOTH types must be listed or real sendBeacon() calls slip
 * through (caught by beacon-block.smoke.mjs). Cancels the request under the
 * IDENTICAL precedence as the Referer listener above:
 * allowlist always wins; blocklist force-blocks even with the global
 * `blockBeacons` toggle OFF.
 *
 * Fails OPEN (returns undefined, letting the beacon through) on a cold cache,
 * malformed URL, or exempt/blacklist-check throw.
 *
 * @param {{url:string}} details
 * @returns {{cancel:true}|undefined}
 */
function onBeforeRequestBlockBeacons(details) {
  if (!cachedPrefs) { getPrefsWithCache(); return; }

  let host;
  try {
    host = new URL(details.url).hostname;
  } catch {
    return;
  }

  try {
    if (isSiteFullyExempt(host, cachedPrefs)) return;
    if (cachedPrefs.blockBeacons !== true && !isSiteFullyBlacklisted(host, cachedPrefs)) return;
  } catch {
    return;
  }

  return { cancel: true };
}

if (isFirefoxMV2) {
  // Warm the caches the blocking listener reads synchronously, then arm it. Only
  // strip once domain/path rules have settled so a startup navigation can never
  // over-strip a preserve-domain param. Firefox's background page is persistent,
  // so this warm-up runs once at startup.
  if (_domainRulesReady === null) _domainRulesReady = _loadDomainRules();
  if (_pathRulesReady === null) _pathRulesReady = _loadPathRules();
  Promise.all([getPrefsWithCache(), _domainRulesReady, _pathRulesReady])
    .catch(() => { /* best-effort warm; failures fall back to pass-through */ })
    .finally(() => { _fxStripperReady = true; });
  chrome.webRequest.onBeforeRequest.addListener(
    onBeforeNavigateStrip,
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["blocking"],
  );
  // referer-beacon-privacy PR 3: Referer suppression, no resource-type filter
  // (Referer matters across every request type, not just navigations).
  chrome.webRequest.onBeforeSendHeaders.addListener(
    onBeforeSendHeadersSuppressReferer,
    { urls: ["<all_urls>"] },
    ["blocking", "requestHeaders"],
  );
  // referer-beacon-privacy PR 3: beacon block. Unlike Chrome (which folds
  // BOTH `<a ping>` navigations and navigator.sendBeacon() into a single
  // "ping" resourceType), Firefox's webRequest classifies sendBeacon() under
  // its OWN "beacon" resourceType and reserves "ping" for `<a ping>` only
  // (verified empirically via tests/e2e-firefox/beacon-block.smoke.mjs — the
  // design.md D4 claim that both surface as "ping" in FF holds for Chrome's
  // vocabulary, not Firefox's; a "ping"-only filter silently let every real
  // sendBeacon() call through). Both types must be listed so this listener
  // covers the full beacon surface on Firefox.
  chrome.webRequest.onBeforeRequest.addListener(
    onBeforeRequestBlockBeacons,
    { urls: ["<all_urls>"], types: ["ping", "beacon"] },
    ["blocking"],
  );
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
    // Read the FULL merged prefs (not just remoteRulesEnabled): getPrefs()
    // overlays the per-device consent record (onboardingDone / consentVersion /
    // consentDate), which the consent gate below needs.
    const prefs = await getPrefs();
    if (!prefs.remoteRulesEnabled) return;
    // #888 review C1: the weekly signed GET to rules.muga.app is a
    // consent-gated network egress. It MUST NOT fire until the user has
    // accepted the consent version that introduced it (v1.1). Since #888
    // flipped remoteRulesEnabled ON by default, an existing user with stored
    // consent 1.0 who never touched the toggle would otherwise leak the GET on
    // the very next SW wake — BEFORE acting on the non-blocking soft re-onboard
    // tab. shouldOpenOnboarding(prefs) is true for every non-`valid` status
    // (never-accepted / soft- / hard-reonboard), i.e. exactly the states where
    // the disclosure has not been accepted. Block the egress in those states so
    // disclosure and egress stay coupled. Fresh installs write consentVersion
    // 1.1 on onboarding completion → valid → allowed; existing 1.0 users stay
    // blocked until they accept the delta re-onboard (which writes 1.1).
    if (shouldOpenOnboarding(prefs)) return;
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
// Guard all DNR calls with a feature-detect. Firefox MV2 (≥113) DOES support
// declarativeNetRequest for static rulesets and regexSubstitution redirects;
// the guard covers Firefox Android and any environment where the API is absent.
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
    // #1104: every entry may fail the format filter above (e.g. all-symbol
    // junk input), leaving normalized empty. Registering a DNR rule with
    // removeParams: [] is a no-op that serves no purpose and pollutes the
    // dynamic rule table with a dead entry. Treat an empty post-filter list
    // the same as "no customParams at all" — mirrors the mergeIntoCache()
    // empty-accepted guard in remote-rules.js (#923).
    if (normalized.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [DNR_CUSTOM_PARAMS_RULE_ID],
        addRules: [],
      });
      return;
    }
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

// Full range of allowlist rule IDs ever handed out, so a resync always
// clears every previously-added rule before adding the current set - no
// stale rule can survive a domain being removed from the allowlist or the
// per-site pause being lifted.
const ALLOWLIST_RULE_ID_RANGE = Array.from(
  { length: DNR_ALLOWLIST_MAX_RULES },
  (_, i) => DNR_ALLOWLIST_RULE_ID_BASE + i,
);

// ALLOWLIST_RESOURCE_TYPES is imported from ../lib/dnr-ids.js (task 1.5,
// referer-beacon-privacy): promoted to a shared constant so the allow rule
// below and the global/blocklist Referer-suppression rules
// (syncSuppressRefererDNR / syncBlocklistRefererDNR, PR 2) reference the
// exact same list and cannot drift apart. See its JSDoc in dnr-ids.js for the
// main_frame gotcha this list exists to guard against.

/**
 * Syncs one dynamic DNR "allow" rule per fully-exempt domain
 * (#allowlist-full-inert): a domain-only whitelist entry. This is the
 * network-layer half of the "allowlist = MUGA fully inert" choke point -
 * src/lib/cleaner.js#processUrl is the JS-layer
 * half, both sourced from the same isSiteFullyExempt/getFullyExemptDomains
 * predicate so the two never drift.
 *
 * Each rule uses `action: { type: "allow" }` with an explicit
 * ALLOWLIST_RESOURCE_TYPES list (see its doc comment for why `main_frame`
 * must be listed explicitly) and `requestDomains: [domain]` (Chrome matches
 * this against the domain and its subdomains, same semantics as
 * domainMatches() in cleaner.js). Priority is set to 1000 - strictly higher
 * than every strip/redirect rule MUGA registers today (all declared at
 * priority 1, the DNR default) - so Chrome's documented precedence rule
 * (a higher-priority "allow" action wins over a lower-priority
 * "redirect"/"block" action for the same request, regardless of rule order
 * or ruleset) makes the allow win deterministically. Because the condition
 * is domain-wide rather than tied to a specific rule ID, this also covers
 * any STRIP RULE ADDED LATER at the default priority, with no per-mechanism
 * patch required - that is the future-proofing property this rule exists for.
 *
 * Modeled on syncCustomParamsDNR() above: same hasDNR guard, try/catch, and
 * updateDynamicRules() usage.
 *
 * @param {{ whitelist?: string[], blacklist?: string[] }} prefs
 */
async function syncAllowlistDNR(prefs) {
  if (!hasDNR) return;
  try {
    const domains = getFullyExemptDomains(prefs);

    if (domains.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ALLOWLIST_RULE_ID_RANGE,
        addRules: [],
      });
      return;
    }

    let syncedDomains = domains;
    if (domains.length > DNR_ALLOWLIST_MAX_RULES) {
      const dropped = domains.slice(DNR_ALLOWLIST_MAX_RULES);
      syncedDomains = domains.slice(0, DNR_ALLOWLIST_MAX_RULES);
      console.warn(
        `[MUGA] syncAllowlistDNR: ${domains.length} exempt domains exceed the ` +
        `${DNR_ALLOWLIST_MAX_RULES}-rule cap; dropped from network-level allow rules ` +
        "(active-defense + JS cleaning stay inert for these via isSiteFullyExempt, " +
        "only the DNR allow rule is missing):",
        dropped,
      );
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ALLOWLIST_RULE_ID_RANGE,
      addRules: syncedDomains.map((domain, i) => ({
        id: DNR_ALLOWLIST_RULE_ID_BASE + i,
        priority: 1000,
        action: { type: "allow" },
        condition: { requestDomains: [domain], resourceTypes: ALLOWLIST_RESOURCE_TYPES },
      })),
    });
  } catch (err) {
    console.error("[MUGA] syncAllowlistDNR failed:", err);
  }
}

/**
 * Syncs the dynamic GLOBAL Referer-suppression rule (referer-beacon-privacy,
 * PR 2). Removes the `referer` request header on every http(s) request when
 * `prefs.suppressReferer` is true; removes rule 2500 when false. Modeled on
 * syncCustomParamsDNR() above: same hasDNR guard, try/catch, and
 * updateDynamicRules() usage.
 *
 * Uses the shared ALLOWLIST_RESOURCE_TYPES list (same list syncAllowlistDNR's
 * allow rule uses) so that rule, registered at priority 1000, deterministically
 * shadows this one (priority 1) on allowlisted domains — see D3 in design.md.
 * On a domain that is also on the blacklist, syncBlocklistRefererDNR's
 * priority-2 rule fires the same action regardless of this rule/pref.
 *
 * @param {{ suppressReferer?: boolean }} prefs
 */
async function syncSuppressRefererDNR(prefs) {
  if (!hasDNR) return;
  try {
    if (!prefs.suppressReferer) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [DNR_SUPPRESS_REFERER_RULE_ID],
        addRules: [],
      });
      return;
    }
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_SUPPRESS_REFERER_RULE_ID],
      addRules: [{
        id: DNR_SUPPRESS_REFERER_RULE_ID,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "referer", operation: "remove" }],
        },
        condition: { urlFilter: "*", resourceTypes: ALLOWLIST_RESOURCE_TYPES },
      }],
    });
  } catch (err) {
    console.error("[MUGA] syncSuppressRefererDNR failed:", err);
  }
}

/**
 * Syncs the dynamic GLOBAL beacon-block rule (referer-beacon-privacy, PR 2).
 * Blocks every "ping"-resourceType request (covers both `<a ping>` hyperlink
 * auditing and `sendBeacon()`, the network-layer gap the DOM-layer
 * `blockPings` pref cannot reach) when `prefs.blockBeacons` is true; removes
 * rule 2600 when false. Modeled on syncCustomParamsDNR() above.
 *
 * @param {{ blockBeacons?: boolean }} prefs
 */
async function syncBlockBeaconsDNR(prefs) {
  if (!hasDNR) return;
  try {
    if (!prefs.blockBeacons) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [DNR_BLOCK_BEACONS_RULE_ID],
        addRules: [],
      });
      return;
    }
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_BLOCK_BEACONS_RULE_ID],
      addRules: [{
        id: DNR_BLOCK_BEACONS_RULE_ID,
        priority: 1,
        action: { type: "block" },
        condition: { resourceTypes: ["ping"] },
      }],
    });
  } catch (err) {
    console.error("[MUGA] syncBlockBeaconsDNR failed:", err);
  }
}

// Full range of blocklist Referer-force rule IDs ever handed out (referer-
// beacon-privacy, PR 2), mirroring ALLOWLIST_RULE_ID_RANGE above: a resync
// always clears every previously-added rule so no stale force rule survives
// a domain being removed from the blacklist.
const BLOCKLIST_REFERER_RULE_ID_RANGE = Array.from(
  { length: DNR_BLOCKLIST_MAX_RULES },
  (_, i) => DNR_BLOCKLIST_REFERER_RULE_ID_BASE + i,
);

// Same as above, for the beacon-block force rule range.
const BLOCKLIST_BEACON_RULE_ID_RANGE = Array.from(
  { length: DNR_BLOCKLIST_MAX_RULES },
  (_, i) => DNR_BLOCKLIST_BEACON_RULE_ID_BASE + i,
);

/**
 * Syncs one dynamic DNR Referer force-suppress rule per bare-domain
 * blacklist entry (referer-beacon-privacy, PR 2; D2 in design.md: the
 * blocklist ALSO governs this feature). ACTIVE REGARDLESS of
 * `prefs.suppressReferer` — a blacklisted domain forces Referer removal even
 * when the global toggle is off, matching the blocklist's existing "be
 * aggressive on this domain" meaning (Scenario D). Shadowed on a domain that
 * is ALSO allowlisted by syncAllowlistDNR's priority-1000 allow rule
 * (allowlist always wins).
 *
 * Structural clone of syncAllowlistDNR()'s clear-then-register pattern:
 * clears the full BLOCKLIST_REFERER_RULE_ID_RANGE on every resync, caps at
 * DNR_BLOCKLIST_MAX_RULES, and logs dropped domains rather than silently
 * truncating.
 *
 * @param {{ blacklist?: string[] }} prefs
 */
async function syncBlocklistRefererDNR(prefs) {
  if (!hasDNR) return;
  try {
    const domains = getFullyBlacklistedDomains(prefs);

    if (domains.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: BLOCKLIST_REFERER_RULE_ID_RANGE,
        addRules: [],
      });
      return;
    }

    let syncedDomains = domains;
    if (domains.length > DNR_BLOCKLIST_MAX_RULES) {
      const dropped = domains.slice(DNR_BLOCKLIST_MAX_RULES);
      syncedDomains = domains.slice(0, DNR_BLOCKLIST_MAX_RULES);
      console.warn(
        `[MUGA] syncBlocklistRefererDNR: ${domains.length} blacklisted domains exceed the ` +
        `${DNR_BLOCKLIST_MAX_RULES}-rule cap; dropped from Referer force-suppress rules:`,
        dropped,
      );
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: BLOCKLIST_REFERER_RULE_ID_RANGE,
      addRules: syncedDomains.map((domain, i) => ({
        id: DNR_BLOCKLIST_REFERER_RULE_ID_BASE + i,
        priority: 2,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "referer", operation: "remove" }],
        },
        condition: { requestDomains: [domain], resourceTypes: ALLOWLIST_RESOURCE_TYPES },
      })),
    });
  } catch (err) {
    console.error("[MUGA] syncBlocklistRefererDNR failed:", err);
  }
}

/**
 * Syncs one dynamic DNR beacon-block force rule per bare-domain blacklist
 * entry (referer-beacon-privacy, PR 2; same D2 rationale as
 * syncBlocklistRefererDNR above). ACTIVE REGARDLESS of `prefs.blockBeacons`.
 * Referer removal and beacon blocking are distinct DNR action types, so a
 * blacklisted domain needs a rule from both this function and
 * syncBlocklistRefererDNR — they cannot be merged into one rule.
 *
 * @param {{ blacklist?: string[] }} prefs
 */
async function syncBlocklistBeaconsDNR(prefs) {
  if (!hasDNR) return;
  try {
    const domains = getFullyBlacklistedDomains(prefs);

    if (domains.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: BLOCKLIST_BEACON_RULE_ID_RANGE,
        addRules: [],
      });
      return;
    }

    let syncedDomains = domains;
    if (domains.length > DNR_BLOCKLIST_MAX_RULES) {
      const dropped = domains.slice(DNR_BLOCKLIST_MAX_RULES);
      syncedDomains = domains.slice(0, DNR_BLOCKLIST_MAX_RULES);
      console.warn(
        `[MUGA] syncBlocklistBeaconsDNR: ${domains.length} blacklisted domains exceed the ` +
        `${DNR_BLOCKLIST_MAX_RULES}-rule cap; dropped from beacon-block force rules:`,
        dropped,
      );
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: BLOCKLIST_BEACON_RULE_ID_RANGE,
      addRules: syncedDomains.map((domain, i) => ({
        id: DNR_BLOCKLIST_BEACON_RULE_ID_BASE + i,
        priority: 2,
        action: { type: "block" },
        condition: { requestDomains: [domain], resourceTypes: ["ping"] },
      })),
    });
  } catch (err) {
    console.error("[MUGA] syncBlocklistBeaconsDNR failed:", err);
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
    // Gate open: selectively enable/disable based on per-feature prefs (pure
    // decision in partitionRulesets). The manifest defaults every ruleset to
    // enabled:true, so rulesets whose feature pref is OFF — or which a different
    // mechanism now owns (tracking_params on Firefox, handled by the blocking
    // webRequest stripper) — must be explicitly disabled here.
    const { enableRulesetIds, disableRulesetIds, unmanaged } =
      partitionRulesets(declaredIds, prefs, { isFirefoxMV2 });
    for (const id of unmanaged) {
      console.warn("[MUGA] applyDnrState: unmanaged ruleset id:", id);
    }

    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds,
      disableRulesetIds,
    }).catch(err => console.warn("[MUGA] applyDnrState enable:", err));
    await syncCustomParamsDNR(prefs.customParams);
    // Allowlist "allow" rules (#allowlist-full-inert) - rebuilt from current
    // prefs on every gate-open sync so a whitelist/pause change takes effect
    // live (see the storage.onChanged handler below and the mugaConsent /
    // mugaPerDevicePrefs branches, all of which call applyDnrState).
    await syncAllowlistDNR(prefs);
    // Referer/beacon privacy layer (referer-beacon-privacy, PR 2): two
    // global rules gated on their own pref (suppressReferer/blockBeacons)
    // plus two per-domain blocklist-force rule families that are ACTIVE
    // REGARDLESS of those prefs (D2 in design.md). Order here matches the
    // priority scheme documented in dnr-ids.js and design.md: allowlist
    // allow (1000, synced above) > blocklist force (2) > global suppress (1).
    await syncSuppressRefererDNR(prefs);
    await syncBlockBeaconsDNR(prefs);
    await syncBlocklistRefererDNR(prefs);
    await syncBlocklistBeaconsDNR(prefs);
    // Re-arm the dynamic remote-params rule (id 1001). The gate-closed branch
    // removes it (#921), so a close→open cycle — or a wake where the weekly
    // signed fetch is time-gated and skips re-adding it — would otherwise leave
    // remote cleaning silently off. Rebuild it here from the cached payload.
    await reconcileRemoteDnrRule(prefs);
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
    // Clear the allowlist "allow" rules too: when the gate is closed every
    // strip/redirect rule is already off (disabled rulesets + cleared
    // dynamic rules above), so there is nothing left for an "allow" rule to
    // out-prioritize - leaving them registered would just be a stale,
    // unnecessary MUGA network footprint while the extension is off.
    await syncAllowlistDNR({ whitelist: [], blacklist: [] });
    // Clear the referer/beacon privacy rules too (referer-beacon-privacy,
    // PR 2): the two global rules (2500/2600) AND the full per-domain
    // blocklist-force ranges (2700-2899/2900-3099). "Always aggressive on
    // this domain" (blocklist-force) still yields to "extension not yet
    // accepted / disabled" — no Referer removal or beacon block, global or
    // blocklist-forced, may run before onboardingDone or while disabled.
    await syncSuppressRefererDNR({ suppressReferer: false });
    await syncBlockBeaconsDNR({ blockBeacons: false });
    await syncBlocklistRefererDNR({ blacklist: [] });
    await syncBlocklistBeaconsDNR({ blacklist: [] });
    // Disabling the static rulesets and clearing rule 1000 is NOT enough: the
    // remote-params rule (dynamic id 1001) is a DNR redirect that keeps
    // stripping params for a disabled or non-consented extension. Remove it so
    // the consent gate holds across the dynamic cleaning path too. (#921)
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_REMOTE_PARAMS_RULE_ID],
    }).catch(err => console.warn("[MUGA] applyDnrState remote-params clear:", err));
  }
}

// Reconciles the dynamic remote-params rule (id 1001) with current prefs +
// cached payload. Used on gate-open so rule 1001 is restored after the
// gate-closed branch removed it, without waiting for the next weekly fetch.
// buildRemoteDnrRule rejects an empty removeParams transform, so an empty or
// missing cache resolves to "no rule" (removal only). (#921)
//
// Named distinctly from the SW-local syncRemoteParamsDNR retired in #706: that
// helper duplicated the write that runRemoteRulesFetch already performs, whereas
// this one restores rule 1001 from the CACHE on gate-open, which the time-gated
// weekly fetch does not do.
async function reconcileRemoteDnrRule(prefs) {
  if (!hasDNR) return;
  try {
    const params = prefs.remoteRulesEnabled
      ? (await getRemoteParams()).remoteParams
      : [];
    const list = Array.isArray(params) ? params : [];
    if (list.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [DNR_REMOTE_PARAMS_RULE_ID],
      });
      return;
    }
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_REMOTE_PARAMS_RULE_ID],
      addRules: [buildRemoteDnrRule(list)],
    });
  } catch (err) {
    console.warn("[MUGA] reconcileRemoteDnrRule failed:", err);
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

// Serialize chrome.storage.session read-modify-write mutations (badge totals,
// per-page counters, session history) the same way _listMutationQueue (above)
// serializes whitelist/blacklist chrome.storage.sync mutations. In MV3,
// chrome.storage.session is real async IPC (not a synchronous in-memory Map),
// so two of these cycles racing on the same tab/key can each read the
// pre-update value and the second write clobbers the first (#1097 — badge
// undercounts under fast frames/SPAs). Mirrors the createMutex/withSyncMutation
// shape in src/options/sync-mutation.js, scoped to session storage here.
let _sessionMutationQueue = Promise.resolve();

/**
 * Runs `fn` after every previously-queued session-storage mutation has
 * settled, so concurrent callers never race on the same read-modify-write
 * cycle. Uses `.then(fn, fn)` (not `.then(fn).catch(...)`) so a throwing
 * mutation does not permanently poison the queue for later callers — the
 * next mutation still runs, mirroring createMutex()'s self-healing chain.
 *
 * @param {() => Promise<any>} fn - the read-modify-write cycle to serialize
 * @returns {Promise<any>} whatever `fn` resolves to
 */
function withSessionMutation(fn) {
  _sessionMutationQueue = _sessionMutationQueue.then(fn, fn);
  return _sessionMutationQueue;
}

// Badge background color is set by the toolbar presenter at startup (#358).

// --- Badge helpers ---
//
// The badge text and tooltip are driven by the ToolbarPresenter (#358,
// badge counter re-introduced #910). updateTabBadge emits a urlCleaned
// event; the presenter writes the tooltip AND (when showBadge is on and
// onboarding is done) the native toolbar badge text.
//
// TWO session-storage keys, two different reset semantics — do not merge
// them:
//   - `tab_{tabId}`       — per-PAGE count, cleared on every navigation.
//     Feeds the popup's "This page" preview badge (src/popup/popup.js).
//     Unchanged by #910.
//   - `tab_badge_{tabId}` — per-TAB running total, cleared ONLY on tab
//     close. Feeds the toolbar badge (#910's requirement: accumulates
//     across every navigation in the tab, including SPA). Passed to the
//     presenter as event.total so the badge stays correct even if the
//     presenter's in-memory map was wiped by a service-worker restart.
async function updateTabBadge(tabId, junkRemoved) {
  if (!tabId || junkRemoved <= 0) return;
  const key = `tab_${tabId}`;
  const badgeKey = `tab_badge_${tabId}`;

  // Serialized (#1097): without this, two rapid clean events on the same tab
  // (fast frames/SPA navigations) can each read the pre-update count before
  // either write lands, so the second write clobbers the first and the badge
  // undercounts. withSessionMutation queues this whole read-modify-write
  // cycle behind any other pending session-storage mutation.
  const badgeTotal = await withSessionMutation(async () => {
    const data = await sessionStorage.get({ [key]: 0 });
    const newCount = data[key] + junkRemoved;
    await sessionStorage.set({ [key]: newCount });

    const badgeData = await sessionStorage.get({ [badgeKey]: 0 });
    const newBadgeTotal = badgeData[badgeKey] + junkRemoved;
    await sessionStorage.set({ [badgeKey]: newBadgeTotal });
    return newBadgeTotal;
  });

  // Warm the prefs cache BEFORE emitting so the presenter's live accessors
  // (getShowBadge / isOnboardingDone, which read cachedPrefs at call time)
  // never observe a null cache on a cold/evicted MV3 service worker (#910
  // cold-SW race). The PROCESS_URL path is safe only because
  // handleProcessUrl() awaits getPrefsWithCache() before calling us — but
  // the BADGE_AND_STATS fire-and-forget path calls updateTabBadge with no
  // prior prefs read. Without this await, a cold SW would emit urlCleaned
  // while cachedPrefs is null, isOnboardingDone() would default to false,
  // and writeBadge() would silently skip the write — the badge would never
  // appear for that clean and only self-heal on the next one.
  await getPrefsWithCache();

  toolbarBus.emit({ type: "urlCleaned", tabId, paramsRemoved: junkRemoved, total: badgeTotal });
}

// Enumerate every tab's DURABLE running badge total from the
// `tab_badge_{tabId}` session keys. The presenter's in-memory badgeTotals
// map does NOT survive service-worker eviction, but these session keys do
// (and so do the browser-rendered per-tab badges). When the showBadge pref
// flips we pass this authoritative list to the presenter as event.tabs so
// it can clear/repaint EVERY tab — including tabs whose badge was painted
// before a restart wiped the in-memory map (#910 OFF-path map blind spot).
async function collectBadgeTotals() {
  try {
    const all = await sessionStorage.get(null);
    const prefix = "tab_badge_";
    const tabs = [];
    for (const [key, value] of Object.entries(all || {})) {
      if (!key.startsWith(prefix)) continue;
      const tabId = Number(key.slice(prefix.length));
      if (!Number.isFinite(tabId) || tabId < 0) continue;
      tabs.push({ tabId, total: Math.max(0, Number(value) || 0) });
    }
    return tabs;
  } catch {
    return [];
  }
}

// --- Tab active-state (toolbar-inactive-badge) ---
//
// "Active-on-tab" mirrors isSiteFullyExempt/getFullyExemptDomains (#allowlist
// -full-inert) exactly the same way syncAllowlistDNR does for the network
// layer above: a tab is ACTIVE only when the extension is globally on,
// onboarding/consent is complete, AND the tab's hostname is not a fully
// exempt (allowlisted / per-site-paused — migratePerSiteDisableToAllowlist
// folded the legacy per-site pause into the same whitelist mechanism) site.
// Defensive by construction: any falsy/missing prefs resolves through
// isSiteFullyExempt's own fail-safe (false), so a malformed prefs object
// can only ever make computeTabActiveState MORE cautious about calling a
// tab "inactive", never less.
function computeTabActiveState(prefs, hostname) {
  return prefs?.enabled === true && prefs?.onboardingDone === true && !isSiteFullyExempt(hostname, prefs);
}

// Repaints EVERY open tab's active-state on the toolbar (#toolbar-inactive
// -badge). Called whenever a pref that can flip Active-on-tab changes:
// prefs.enabled, whitelist/blacklist (allowlist + per-site pause), or
// onboarding/consent state.
//
// Cold-SW-safe by construction, unlike collectBadgeTotals() above: there is
// no durable/session-storage record of "is this tab active" to rehydrate —
// the value is always recomputed fresh from the tab's LIVE url (via
// chrome.tabs.query, which reflects the real open-tab list regardless of
// service-worker restarts) plus the current prefs. So a restart loses
// nothing this function needs; there is nothing to lose.
async function repaintAllTabsActiveState(prefs) {
  if (!prefs?.onboardingDone) return; // the global "!" badge owns the surface; nothing to repaint per-tab
  let tabs;
  try {
    tabs = await new Promise((resolve) => {
      chrome.tabs.query({}, (r) => { void chrome.runtime.lastError; resolve(r || []); });
    });
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (typeof tab.id !== "number" || tab.id < 0) continue;
    if (!tab.url || !/^https?:\/\//i.test(tab.url)) continue; // skip non-http(s) tabs (chrome://, extension pages, etc.)
    let hostname;
    try {
      hostname = new URL(tab.url).hostname;
    } catch {
      continue; // malformed URL — never throw, just skip this tab (see AGENTS.md new URL() guard)
    }
    toolbarBus.emit({
      type: "tabActiveStateChanged",
      tabId: tab.id,
      active: computeTabActiveState(prefs, hostname),
    });
  }
}

// Reset the per-PAGE popup preview count and the tooltip on every
// navigation start. Deliberately does NOT touch `tab_badge_{tabId}` or
// emit anything badge-related — the toolbar badge is a per-TAB running
// total that must survive navigation (#910).
//
// While onboarding is pending we deliberately skip the toolbar bus emit:
// the cleaner is gated on onboardingDone, so there is no per-page state to
// reset in this state, and emitting would still update the tooltip for a
// tab the user has not consented on. Skipping is safe and matches the
// pre-#910 behavior.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "loading") return;
  sessionStorage.remove(`tab_${tabId}`);
  let prefs = null;
  try {
    prefs = await getPrefsWithCache();
    if (!prefs.onboardingDone) return;
  } catch { /* fall through and emit — toolbar reset is the safer default */ }
  // The browser CLEARS the per-tab badge TEXT on every navigation (MDN
  // action.setBadgeText, `tabId`: "reset when the user navigates this tab to
  // a new page"). Read the DURABLE running total so the presenter can
  // re-paint the badge the browser just wiped — otherwise the count vanishes
  // after any navigation that does not itself trigger a urlCleaned (#910
  // flicker). Cold-SW safe: this session key survives SW eviction even when
  // the presenter's in-memory map does not. Best-effort — on a read failure
  // the presenter falls back to its in-memory total.
  let total = 0;
  try {
    const badgeKey = `tab_badge_${tabId}`;
    const badgeData = await sessionStorage.get({ [badgeKey]: 0 });
    total = Math.max(0, Number(badgeData[badgeKey]) || 0);
  } catch { /* best-effort; presenter falls back to its in-memory total */ }
  toolbarBus.emit({ type: "navigationStarted", tabId, total });

  // Recompute the tab's active-state for the NEW page (toolbar-inactive
  // -badge). Emitted AFTER navigationStarted above so the presenter's
  // per-page reset (which repaints the tooltip/badge from the tab's
  // PREVIOUS active flag — see toolbar-presenter.js module doc) is
  // immediately corrected for the new hostname; the gap is at most one JS
  // macrotask within this same handler invocation, not user-observable.
  // Skipped when the prefs fetch above failed (prefs stays null) — best
  // effort, mirrors the fall-through above.
  if (prefs) {
    try {
      if (tab?.url && /^https?:\/\//i.test(tab.url)) {
        const hostname = new URL(tab.url).hostname;
        toolbarBus.emit({ type: "tabActiveStateChanged", tabId, active: computeTabActiveState(prefs, hostname) });
      }
      // Non-http(s) tab (chrome://, extension pages, new-tab, etc.): leave
      // the tab's active flag untouched — MUGA never runs there anyway.
    } catch { /* malformed tab.url (new URL() guard) — skip this navigation's recompute */ }
  }
});

// Clean up session data when a tab closes. Both the per-page popup
// counter AND the per-tab badge running total are tab-scoped and must be
// evicted here — this is the ONLY place the badge total resets (#910).
chrome.tabs.onRemoved.addListener((tabId) => {
  sessionStorage.remove(`tab_${tabId}`);
  sessionStorage.remove(`tab_badge_${tabId}`);
  toolbarBus.emit({ type: "tabClosed", tabId });
});

// --- Session history helpers ---

const HISTORY_MAX = 10;

async function appendHistory(original, clean, removedTracking = []) {
  if (original === clean) return;
  // Serialized (#1097): same race as updateTabBadge above — two rapid clean
  // events can each read the same pre-update history array, and the second
  // write would silently drop the first entry without this queue.
  await withSessionMutation(async () => {
    const data = await sessionStorage.get({ history: [] });
    const entry = { original, clean, ts: Date.now(), removedTracking };
    const history = [entry, ...data.history].slice(0, HISTORY_MAX);
    await sessionStorage.set({ history });
  });
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
      // Onboarding/consent state is one of the three Active-on-tab factors
      // (toolbar-inactive-badge) — a fresh accept/hard-reonboard flips it
      // for every open tab, not just the global "!" badge.
      await repaintAllTabsActiveState(prefs);
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
      await repaintAllTabsActiveState(prefs);
    }
    return;
  }
  if (area !== "sync") return;
  // Any sync storage change (including disabledCategories, contextMenuEnabled, etc.)
  // must invalidate the prefs cache so the next getPrefsWithCache() reads fresh data.
  _invalidatePrefsCache();
  if (changes.customParams || changes.dnrEnabled || changes.enabled ||
      changes.ampRedirect || changes.unwrapRedirects ||
      changes.whitelist || changes.blacklist ||
      changes.suppressReferer || changes.blockBeacons) {
    // whitelist/blacklist (#allowlist-full-inert): toggling the allowlist or
    // the per-site pause must re-sync the DNR allow rules live, without
    // requiring the user to also flip an unrelated pref. suppressReferer /
    // blockBeacons (referer-beacon-privacy, PR 2) need the same live re-sync
    // once a future UI (PR 4) lets a user flip them.
    const prefs = await getPrefsWithCache();
    await applyDnrState(prefs);
  }
  if (changes.enabled || changes.whitelist || changes.blacklist) {
    // toolbar-inactive-badge: prefs.enabled and whitelist/blacklist
    // (allowlist + per-site pause) are Active-on-tab factors — repaint every
    // open tab's badge/tooltip immediately rather than waiting for its next
    // navigation. getPrefsWithCache() is already warm from the block above
    // when both conditions overlap (e.g. changes.enabled).
    const prefs = await getPrefsWithCache();
    await repaintAllTabsActiveState(prefs);
  }
  if (changes.contextMenuEnabled || changes.language || changes.enabled) {
    const enabled = changes.contextMenuEnabled
      ? changes.contextMenuEnabled.newValue !== false
      : (await getPrefsWithCache()).contextMenuEnabled !== false;
    await syncContextMenus(enabled);
  }
  // showBadge toggled (#910). Tell the presenter immediately so it clears
  // (or repaints) every currently-tracked tab's badge — "stops updates"
  // alone would leave stale numbers visible until each tab's next clean.
  if (changes.showBadge) {
    const tabs = await collectBadgeTotals();
    toolbarBus.emit({ type: "showBadgePrefChanged", value: changes.showBadge.newValue !== false, tabs });
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
async function handleTestMessage(message, _sender) {
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
      //
      // #910: warm the prefs cache before emitting. The production emit
      // paths warm the cache themselves — handleProcessUrl() for PROCESS_URL,
      // and updateTabBadge() (which now awaits getPrefsWithCache() before
      // emitting) for BADGE_AND_STATS — so the presenter's getShowBadge()/
      // isOnboardingDone() accessors never observe a null cachedPrefs when a
      // REAL urlCleaned event fires. This SYNTHETIC test path bypasses both
      // of those functions and emits straight onto the bus, so it must warm
      // the cache itself; otherwise a cold/evicted SW would read cachedPrefs
      // as null and the presenter would (correctly, but misleadingly for a
      // test) skip the badge write — a flaky false negative unrelated to
      // presenter logic.
      await getPrefsWithCache();
      const inner = message.event;
      if (!inner || typeof inner.type !== "string") {
        return { ok: false, error: "missing event.type" };
      }
      if (inner.type === "showBadgePrefChanged") {
        // Mirror the production emit path: carry the DURABLE per-tab totals
        // so the presenter can clear/repaint every tab even when its
        // in-memory map was wiped by a SW restart (#910 OFF-path fix).
        const tabs = await collectBadgeTotals();
        toolbarBus.emit({ type: "showBadgePrefChanged", value: inner.value === true, tabs });
        return { ok: true };
      }
      const tabIdNum = Number(inner.tabId);
      if (!Number.isFinite(tabIdNum) || tabIdNum < 0) {
        return { ok: false, error: "invalid tabId" };
      }
      const event = { type: inner.type, tabId: tabIdNum };
      if (inner.type === "urlCleaned") {
        event.paramsRemoved = Number(inner.paramsRemoved) || 0;
        if (Number.isFinite(inner.total)) event.total = Number(inner.total);
      }
      if (inner.type === "tabActiveStateChanged") {
        event.active = inner.active === true;
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
      _testActionCalls = { setTitle: 0, setBadgeText: 0, setIcon: 0 };
      return { ok: true };
    }
    case "__TEST__resetPresenterBadgeMap": {
      // Simulate a service-worker restart WITHOUT touching chrome.storage.session:
      // wipe the presenter's in-memory badgeTotals map while the durable
      // `tab_badge_{tabId}` session keys (and the browser-rendered per-tab
      // badges) survive. Lets the OFF-path regression spec prove the badge
      // clear no longer depends on the in-memory map (#910).
      toolbarPresenter._resetInMemoryTotals();
      return { ok: true };
    }
    case "__TEST__updateTabBadge": {
      // Drive the REAL production updateTabBadge() path — the same function
      // the BADGE_AND_STATS fire-and-forget handler calls. Deliberately does
      // NOT go through __TEST__emitToolbarEvent (which warms the prefs cache),
      // so it exercises updateTabBadge's OWN cache handling and writes the
      // durable `tab_badge_{tabId}` session key just like production.
      //
      // With `coldCache: true` it invalidates the prefs cache immediately
      // before calling updateTabBadge and does NOT re-warm it here — mirroring
      // a cold/evicted MV3 service worker (#910 cold-SW race). If updateTabBadge
      // fails to await getPrefsWithCache() before emitting, the presenter reads
      // a null cachedPrefs, isOnboardingDone() defaults to false, and the badge
      // write is silently skipped — which this handler makes observable.
      const tabId = Number(message.tabId);
      if (!Number.isFinite(tabId) || tabId < 0) {
        return { ok: false, error: "invalid tabId" };
      }
      const junkRemoved = Number(message.junkRemoved) || 0;
      // Deterministic starting total for this tab.
      await sessionStorage.remove(`tab_badge_${tabId}`);
      if (message.coldCache === true) {
        _invalidatePrefsCache();
      }
      await updateTabBadge(tabId, junkRemoved);
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
      .then(prefs => sendResponse({
        ...prefs,
        _affiliateDomains,
        // Cookie Consent Minimizer gate wiring (cookie-consent-accept Slice
        // 2a): content scripts cannot import settings-schema.js (no ES
        // imports — AGENTS.md), and src/lib/cmp-adapters.js's
        // computeCookieGate is lexically restricted, so this pre-validated
        // boolean is computed here (the one place both concerns are
        // importable) and handed down verbatim. See the @sync:cookie-gate
        // comment in cmp-adapters.js / content/cookie-noise.js.
        modeActive: isCookieConsentModeActive(prefs.cookieConsentMode),
      }))
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
      try { sendResponse({ cleanUrl: null, action: "error", removedTracking: [], junkRemoved: 0, detectedAffiliate: null, autoInjected: null }); } catch { /* channel closed */ }
      return true;
    }
    // Opportunistic remote-rules refresh — cheap no-op after the first call
    // in each SW lifetime. Catches the "user never restarts browser" case
    // that onStartup can't reach. Runs in parallel with URL processing.
    maybeFetchRemoteRules(_remoteRulesDeps());
    const tabId = sender.tab?.id;
    handleProcessUrl(message.url, { skipNotify: message.skipNotify, source: message.skipNotify ? "copy_selection" : "navigation", skipStats: !!message.skipStats, skipSideEffects: !!message.skipSideEffects, referrer: typeof message.referrer === "string" ? message.referrer : "" })
      .then(result => {
        updateTabBadge(tabId, result.junkRemoved ?? 0);
        if (typeof tabId === "number" && (result.preservedAffiliate || result.creatorReferralPreserved)) {
          toolbarBus.emit({ type: "creatorReferralPreserved", tabId });
        }
        sendResponse(result);
      })
      .catch(err => {
        console.error("[MUGA] PROCESS_URL handler failed:", err);
        try { sendResponse({ cleanUrl: message.url, action: "error", removedTracking: [], junkRemoved: 0, detectedAffiliate: null, autoInjected: null }); } catch { /* channel closed */ }
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
    const originalUrl = typeof message.originalUrl === "string" ? message.originalUrl : "";
    recordNetworkClean(sender.tab?.id, originalUrl, {
      cleanUrl: typeof message.cleanUrl === "string" ? message.cleanUrl : "",
      action: message.action,
      removedTracking: message.removedTracking,
      junkRemoved: message.junkRemoved,
    });
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
        // Explicit Settings action → reconcile the per-device override so the
        // choice sticks. getPrefs() overlays overrides LAST, so a stale
        // onboarding-decline override would otherwise keep the effective value
        // OFF despite the sync write (#888 follow-up, write path).
        await reconcileOverrideForExplicitChoice("remoteRulesEnabled", true);
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
        // Explicit Settings action → reconcile the per-device override so the
        // OFF choice sticks against any pre-existing override (#888 follow-up).
        await reconcileOverrideForExplicitChoice("remoteRulesEnabled", false);
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
        // `enabled` MUST be the CANONICAL effective value (sync + consent +
        // per-device overrides), so the Settings toggle matches what the
        // extension actually does. A raw sync.get with a hardcoded default
        // contradicted PREF_DEFAULTS.remoteRulesEnabled=true and rendered the
        // toggle OFF on fresh installs even though the pref DEFAULTS to enabled
        // (the weekly signed fetch only starts once the rules.muga.app optional
        // host permission is granted via the toggle, #888 follow-up).
        // buildRemoteRulesStatus routes through getPrefs().
        const status = await buildRemoteRulesStatus({
          getPrefs,
          local: chrome.storage.local,
          hasDNR,
        });
        try {
          sendResponse(status);
        } catch { /* channel closed */ }
      } catch (err) {
        console.error("[MUGA] GET_REMOTE_RULES_STATUS handler failed:", err);
        try { sendResponse({ ok: false, error: String(err) }); } catch { /* channel closed */ }
      }
    })();
    return true;
  }

  if (message.type === "FORCE_FETCH_REMOTE_RULES") {
    // Manual "Update now" action from Settings. Bypasses the 7-day cadence
    // gate in maybeFetchRemoteRules (there is none to bypass in
    // runRemoteRulesFetch itself), but MUST replicate the same consent gate
    // maybeFetchRemoteRules enforces before the automatic path fetches —
    // this is still a consent-gated network egress (#888 review C1) and the
    // button must not be able to leak the signed GET before consent.
    // DRIFT GUARD: this gate is mirrored by forceFetchRemoteRules() in
    // tests/unit/service-worker-patterns.test.mjs. If you change either check
    // below (or their order), update that mirror too — the source-existence
    // test only pins that this handler exists, NOT that the gate is intact.
    (async () => {
      try {
        const prefs = await getPrefs();
        if (!prefs.remoteRulesEnabled) {
          try { sendResponse({ ok: false, reason: "disabled" }); } catch { /* channel closed */ }
          return;
        }
        if (shouldOpenOnboarding(prefs)) {
          try { sendResponse({ ok: false, reason: "disabled" }); } catch { /* channel closed */ }
          return;
        }
        await runRemoteRulesFetch(_remoteRulesDeps());
        try { sendResponse({ ok: true }); } catch { /* channel closed */ }
      } catch (err) {
        console.error("[MUGA] FORCE_FETCH_REMOTE_RULES handler failed:", err);
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
        // Consent gate (#922): a disabled or non-onboarded extension MUST NOT
        // perform the live shortener-resolution egress. This mirrors the DNR
        // consent gate — no network activity until the user has enabled the
        // extension AND accepted the ToS. Checked before followShortenersEnabled
        // and before any fetch so the gate cannot be bypassed by the feature toggle.
        if (!prefs.enabled || !prefs.onboardingDone) {
          try { sendResponse({ ok: false, reason: "disabled" }); } catch { /* channel closed */ }
          return;
        }
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

        try { sendResponse(result); } catch { /* channel closed */ }
      } catch (err) {
        console.error("[MUGA] RESOLVE_SHORTENER handler failed:", err);
        try { sendResponse({ ok: false, reason: "network" }); } catch { /* channel closed */ }
      }
    })();
    return true;
  }

});

async function handleProcessUrl(rawUrl, { skipNotify = false, source = "navigation", skipStats = false, skipSideEffects = false, referrer = "" } = {}) {
  if (!rawUrl?.startsWith("http")) return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null, autoInjected: null };
  // _domainRulesReady / _pathRulesReady are nulled on fetch failure to allow
  // retry on the next call. Both loaders run in a single outer Promise.all so
  // all three JSON files (domain + 2× path) are in flight at once.
  // Single-flight: each ref is assigned once per attempt so concurrent callers
  // share the in-flight promise rather than racing to increment the attempt counter.
  // After the shared await, null the ref only if the load failed and more retries
  // remain — this keeps the single-flight guarantee while still allowing retry.
  if (!_domainRulesReady) _domainRulesReady = _loadDomainRules();
  if (!_pathRulesReady)   _pathRulesReady   = _loadPathRules();
  await Promise.all([_domainRulesReady, _pathRulesReady]);
  if (domainRules.length === 0 && _domainRulesFetchAttempts < DOMAIN_RULES_MAX_ATTEMPTS) {
    _domainRulesReady = null;
  }
  if (pathStripRules.length === 0 && pathAffiliateRules.length === 0 &&
      _pathRulesFetchAttempts < PATH_RULES_MAX_ATTEMPTS) {
    _pathRulesReady = null;
  }
  const prefs = await getPrefsWithCache();

  if (!prefs.enabled || !prefs.onboardingDone) {
    return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null, autoInjected: null };
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
    return { cleanUrl: rawUrl, action: "error", removedTracking: [], junkRemoved: 0, detectedAffiliate: null, autoInjected: null };
  }

  // firstUsed is initialized in onInstalled/onStartup (idempotent); the flag
  // is set there so this hot path is a free boolean check on every call after
  // the first SW lifetime event.
  if (!_firstUsedSet) {
    const localStats = await getStats();
    if (localStats.firstUsed) {
      _firstUsedSet = true;
    } else {
      // Fallback: lifecycle events haven't fired yet (e.g., Firefox temporary
      // add-on loaded without install/startup). Set here so the timestamp is
      // as accurate as possible rather than relying on a future startup event.
      await setStats({ firstUsed: Date.now() });
      _firstUsedSet = true;
    }
  }

  // Update stats and session history. Only count if the URL actually changed (S13).
  const urlChanged = result.cleanUrl !== rawUrl;
  let parsedRaw;
  try { parsedRaw = new URL(rawUrl); } catch { /* ignore */ }
  // #966: copy-safe reprocessing (skipSideEffects) must not mutate any
  // user-visible tally. Copying an entry re-cleans an already-counted URL, so
  // counting it again would inflate "URLs cleaned", prepend a DUPLICATE session
  // history row (evicting real entries), and push a duplicate ledger event. When
  // skipSideEffects is set we still compute the clean URL (and withOurAffiliate
  // below) for the response, but write nothing.
  if (!skipSideEffects && (result.action === "untouched" || (!urlChanged && result.junkRemoved === 0))) {
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
    if (!skipStats && !skipSideEffects) {
      incrementStat("urlsCleaned");
      if (result.junkRemoved > 0) incrementStat("junkRemoved", result.junkRemoved);
      if (prefs.domainStats && result.junkRemoved > 0) {
        try {
          const hostname = new URL(rawUrl).hostname.replace(/^www\./, "");
          incrementDomainStat(hostname, result.junkRemoved);
        } catch { /* invalid URL, skip domain stat */ }
      }
    }
    if (!skipSideEffects) {
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
  }
  if (result.action === "detected_foreign") {
    // #966: a copy must not bump referralsSpotted or log a detection either;
    // the with-our-affiliate variant below still builds for the response.
    if (!skipSideEffects) {
      incrementStat("referralsSpotted");
      const d = result.detectedAffiliate;
      logAction("affiliate_detected", {
        domain: parsedRaw?.hostname.replace(/^www\./, "") ?? "",
        param: d?.param,
        value: d?.value,
        store: d?.pattern?.name ?? null,
        action: result.action,
      });
    }
    // If injection is enabled, build the URL with our tag so "Remove it" can use it.
    // #523 phase 3: pattern.ourTag is now a { host -> tag } map, not a flat string.
    // Pick the tag for the cleanUrl's hostname; if we have no tag for this
    // marketplace, skip the with-our-affiliate variant.
    if (prefs.injectOwnAffiliate && result.detectedAffiliate?.pattern) {
      try {
        const url = new URL(result.cleanUrl);
        const p = result.detectedAffiliate.pattern;
        const ourTagForHost = resolveOurTag(p, url.hostname);
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
  // #966: skipped for copy-safe reprocessing so a copy doesn't push a
  // duplicate ledger event for an already-recorded URL.
  if (!skipSideEffects) {
    pushAttributionAndPersist(rawUrl, result, prefs, referrer);
  }

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
  // Convert legacy `domain::disabled` blacklist entries (removed syntax) into
  // domain-only whitelist entries. Best-effort; failure must not break startup.
  migratePerSiteDisableToAllowlist().catch(() => {});
  // #833: bootstrap firstUsed + run migrations here so the hot path is free.
  _initFirstUsed();
  migrateStatsToLocal();
  migrateConsentToLocal();
  migrateCookieConsentMode().catch(() => {});
});

// --- Dedup: open the onboarding tab at most once while consent is pending. ---
// Two layers: a module flag guards a double-open within a single background
// lifetime (onInstalled + fallback both firing), and a persisted
// chrome.storage.local flag guards across MV3 service-worker cold starts (#967).
// Without the persisted layer the volatile flag reset on every wake, so an
// incomplete onboarding reopened a fresh tab on each navigation-triggered
// restart. The persisted flag is cleared (clearOnboardingTabFlag) once consent
// is valid, so a later ToS re-onboard can still surface the tab again.
let _onboardingTabOpened = false;
const ONBOARDING_TAB_FLAG = "mugaOnboardingTabOpened";

async function openOnboardingOnce() {
  if (_onboardingTabOpened) return;
  _onboardingTabOpened = true; // synchronous within-lifetime guard (no await above)
  try {
    const already = await new Promise((resolve) => {
      chrome.storage.local.get({ [ONBOARDING_TAB_FLAG]: false }, (r) =>
        resolve(!!(r && r[ONBOARDING_TAB_FLAG])));
    });
    if (already) return; // a prior lifetime already opened it — do not spam a new tab
    // Set BEFORE creating the tab so a rapid second cold start can't double-open.
    await new Promise((resolve) => {
      chrome.storage.local.set({ [ONBOARDING_TAB_FLAG]: true }, () => resolve());
    });
  } catch { /* best-effort: worst case one extra tab, never a missing one */ }
  chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
}

// Clears the persisted onboarding-tab guard so a future re-onboard (ToS bump)
// can open the tab again. Called when consent is valid — i.e. onboarding is not
// currently needed — which is the natural point to reset the one-shot guard.
function clearOnboardingTabFlag() {
  _onboardingTabOpened = false;
  try {
    chrome.storage.local.remove(ONBOARDING_TAB_FLAG, () => void chrome.runtime.lastError);
  } catch { /* ignore */ }
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

// --- Migration banner support: persist the previous version (#1100) --------
// The popup's migration banner (src/lib/migration-prompt.js) computes a
// version delta by reading `mugaPrevVersion` from chrome.storage.local and
// comparing it against chrome.runtime.getManifest().version (see
// popup.js's readState). Nothing wrote that key before this fix, so the read
// always fell back to currentVersion, previousVersion === currentVersion
// held forever, and the banner could never fire once a migration entry is
// added to MIGRATIONS (migration-spec.js) — latent until this is fixed.
//
// Chrome supplies the real prior version via details.previousVersion, but
// ONLY when details.reason === "update" (it is undefined on first
// "install"). On install there is no meaningful prior version, so we seed
// the key with the current version — no delta, no migration fires, matching
// the pre-fix fallback behavior for a fresh install.
const MUGA_PREV_VERSION_KEY = "mugaPrevVersion";

async function persistPrevVersion(details) {
  const currentVersion = chrome.runtime.getManifest().version;
  const previousVersion =
    details.reason === "update" && details.previousVersion
      ? details.previousVersion
      : currentVersion;
  try {
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ [MUGA_PREV_VERSION_KEY]: previousVersion }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  } catch (e) {
    console.error("[MUGA] persistPrevVersion failed:", e);
  }
}

// --- On install: open onboarding on first run, sync DNR + maybe fetch rules ---
chrome.runtime.onInstalled.addListener(async (details) => {
  await persistPrevVersion(details);
  const prefs = await getPrefsWithCache();
  await applyDnrState(prefs);
  await applyOnboardingBadge(prefs);
  // Opportunistic fetch: fires on install/update if user had enabled remote rules
  // before the update and the stored payload is stale (or absent).
  maybeFetchRemoteRules(_remoteRulesDeps());
  // ADR-0004 phase 5 (#701): migrate privacyProxyEnabled → followShortenersEnabled
  migrateLegacyProxyPref().catch(() => {});
  // Convert legacy `domain::disabled` blacklist entries (removed syntax) into
  // domain-only whitelist entries. Best-effort; failure must not break startup.
  migratePerSiteDisableToAllowlist().catch(() => {});
  // #833: bootstrap firstUsed + run migrations so hot path is free.
  _initFirstUsed();
  migrateStatsToLocal();
  migrateConsentToLocal();
  // Pass the onInstalled reason so a genuine "install" latches the disclosed
  // reject-only default and an "update" runs the existing-user migration. The
  // top-level and onStartup call sites pass no reason (safe idempotent pass).
  migrateCookieConsentMode({ reason: details.reason }).catch(() => {});

  if (prefs.contextMenuEnabled !== false) {
    await syncContextMenus(true);
  }

  if (details.reason === "install") {
    const installPrefs = await getPrefs();
    if (shouldOpenOnboarding(installPrefs)) {
      await openOnboardingOnce();
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
      await openOnboardingOnce();
    } else {
      // Consent satisfied — reset the one-shot guard so a future ToS re-onboard
      // can surface the tab again (#967).
      clearOnboardingTabFlag();
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
            // skipSideEffects (not just skipStats): this fallback loops over
            // every URL in the selection, so without it appendHistory +
            // pushAttributionAndPersist would fire once per URL for a single
            // copy action, evicting real history and desyncing stats (audit
            // #1041, same rationale as the popup #971 fix).
            const cleaned = await handleProcessUrl(candidate, { skipNotify: true, source: "copy_selection", skipStats: true, skipSideEffects: true });
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
