/**
 * MUGA: Service Worker (MV3)
 * Processes URLs, handles messages from content scripts,
 * and maintains extension state.
 */

import { processUrl, computeNavigationStrip, parseListEntry, isSiteFullyExempt, isSiteFullyBlacklisted } from "../lib/cleaner.js";
import { getAffiliateDomains } from "../lib/affiliates.js";
import { getPrefs, setPrefs, incrementStat, getStats, setStats, migrateStatsToLocal, migrateLegacyProxyPref, migratePerSiteDisableToAllowlist, migrateDropCookieConsent, migrateFollowShortenersSplit, sessionStorage, incrementDomainStat, cacheDomainRules, getCachedDomainRules, getRemoteParams } from "../lib/storage.js";
import { migrateConsentToLocal } from "../lib/sync-migration.js";
import { setConsent, TERMS_VERSION } from "../lib/consent-storage.js";
import { isValidListEntry } from "../lib/validation.js";
import { hasDNR, isFirefoxMV2, applyDnrState } from "./dnr-sync.js";
import { createToolbarBadge } from "./toolbar-badge.js";
import { createSingleFlightLoader, createFirstUsedBootstrap } from "../lib/single-flight-loader.js";
import { runOneTimeMigrations } from "./run-migrations.js";
import { enqueueListMutation } from "../lib/list-mutation-queue.js";
import { t } from "../lib/i18n.js";
import {
  runRemoteRulesFetch,
  clearRemoteCache,
} from "../lib/remote-rules.js";
import { TRUSTED_PUBLIC_KEYS } from "../lib/remote-rules-keys.js";
import { buildRemoteRulesStatus } from "../lib/remote-rules-status.js";
import { reconcileOverrideForExplicitChoice } from "../lib/per-device-prefs.js";
import { resolveShortener, isPrivateHost, MAX_DESTINATION_LENGTH } from "../lib/native-shortener-resolver.js";
import { cleanResolvedDestination } from "./clean-resolved-destination.js";
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


// Idempotent firstUsed bootstrap. Called from onInstalled + onStartup so the
// hot path (handleProcessUrl) only sees a free boolean check, not a storage
// read, on the first processed URL. Sets firstUsed only when absent (#833).
// #1268: the body moved to lib/single-flight-loader.js so Node can
// import it. It was previously mirrored inside sw-robustness-833.test.mjs,
// where nothing proved the copy still matched this file.
const _firstUsedBootstrap = createFirstUsedBootstrap({ getStats, setStats });

async function _initFirstUsed() {
  await _firstUsedBootstrap.ensure();
}

// B4: fetch domain-rules dynamically (import assertions incompatible with Firefox;
//       top-level await disallowed in Chrome MV3 service workers).
// Cache-first: on each SW restart we attempt to read from chrome.storage.session
// first. Only falls back to fetch() on a cache miss. On persistent fetch failure
// (up to 3 attempts) we log the error and leave domainRules as [] so the SW can
// still operate without domain-specific rules.
//
// #629 win 3: lazy load. The fetch is deferred until the first PROCESS_URL
// message — handleProcessUrl already gates through `_domainRulesLoader.ensure()`
// on demand. The pre-#629 eager call at module top-level
// blocked SW cold start by ~10-15ms even on tabs the user never tries to clean.
let domainRules = [];
const DOMAIN_RULES_MAX_ATTEMPTS = 3;

// #1268: the single-flight gating lives in lib/single-flight-loader.js,
// which Node can import. sw-robustness-833.test.mjs used to assert the #833
// invariant against a copy of this pattern written inside the test file; it now
// asserts it against this loader.
const _domainRulesLoader = createSingleFlightLoader({
  label: "domain-rules.json",
  maxAttempts: DOMAIN_RULES_MAX_ATTEMPTS,
  isLoaded: () => domainRules.length > 0,
  readCache: () => getCachedDomainRules(),
  fetchAll: async () => {
    const r = await fetch(chrome.runtime.getURL("rules/domain-rules.json"));
    return r.json();
  },
  apply: (data) => { domainRules = data; },
  writeCache: (data) => cacheDomainRules(data),
  onError: (err, attempt) => {
    console.error("[MUGA] domain-rules.json fetch failed (attempt", attempt, "):", err);
  },
});

// Path rules — declarative path-strip and path-affiliate arrays (issue #625).
// Follows the same lazy-load / retry-cap pattern as domain rules above.
// No session-cache layer: both JSON files are tiny (≪1KB combined) and the
// cache-on-first-load complexity does not pay rent at this size.
let pathStripRules = [];
let pathAffiliateRules = [];
const PATH_RULES_MAX_ATTEMPTS = 3;

// Same shape as the domain loader above, minus the session cache: both files
// are tiny (much less than 1KB combined) and caching them does not pay rent.
const _pathRulesLoader = createSingleFlightLoader({
  label: "path-rules",
  maxAttempts: PATH_RULES_MAX_ATTEMPTS,
  isLoaded: () => pathStripRules.length > 0 || pathAffiliateRules.length > 0,
  fetchAll: async () => {
    const [stripResp, affResp] = await Promise.all([
      fetch(chrome.runtime.getURL("rules/path-strip-rules.json")),
      fetch(chrome.runtime.getURL("rules/path-affiliate-rules.json")),
    ]);
    return { strip: await stripResp.json(), affiliate: await affResp.json() };
  },
  apply: (data) => {
    pathStripRules = data.strip;
    pathAffiliateRules = data.affiliate;
  },
  onError: (err) => {
    console.warn("[MUGA] path rules fetch failed:", err);
    // Graceful degradation: path logic becomes a no-op rather than throwing
    // into every caller.
    pathStripRules = [];
    pathAffiliateRules = [];
  },
});


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

// The ONE place one-time migrations are invoked (#1257).
//
// They used to run from here AND from onInstalled AND from onStartup, so any
// wake that fired either handler raced this call — two or three copies of the
// same read-modify-write at once, with only migrateConsentToLocal guarded
// (#1216/#1219). The three sites were never independent: every wake evaluates
// this module and the handlers only fire on wakes, so module scope already ran
// on a strict superset of the occasions they did.
//
// Each is idempotent and best-effort; runOneTimeMigrations settles them all and
// reports failures rather than letting one escape as an unhandled rejection,
// which is what the two bare calls here used to do.
runOneTimeMigrations({
  // ADR-0004 phase 5 (#701): privacyProxyEnabled -> followShortenersEnabled.
  migrateLegacyProxyPref,
  // browsewrap Phase 2: the retired followShortenersEnabled pref splits into
  // resolveShortenersOnClick / resolveShortenersOnHover.
  migrateFollowShortenersSplit,
  // Legacy `domain::disabled` blacklist entries (removed syntax) become
  // domain-only whitelist entries.
  migratePerSiteDisableToAllowlist,
  migrateStatsToLocal,
  migrateConsentToLocal,
  // drop-cookie-consent (Slice D of 6): deletes every storage key left behind
  // by the retired cookie-consent-minimizer subsystem (sync pref + legacy
  // keys, plus the dead Tier2 remote-rules local cache).
  migrateDropCookieConsent,
});

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

// #1266: this call used to be bare, so nothing could wait for it. A PROCESS_URL
// arriving inside the cold-start window pushed onto the EMPTY default ledger,
// and the hydration that landed a microtask later replaced the whole object,
// dropping that push. One lost row in "Recent activity" is the visible symptom,
// which is why this is a secondary rather than part of #1257 — but the shape is
// the same write-loss as those: read, then overwrite what someone else wrote in
// between.
//
// Retaining the promise makes the window waitable. pushAttributionAndPersist
// awaits it before touching _attributionLedger, so a push either happens before
// hydration starts reading or after it has finished writing, never in between.
// Nothing else needs to change: the hydration is still started here, at module
// scope, so it is in flight during the cold start rather than deferred to the
// first push.
const _attributionLedgerHydrated = _hydrateAttributionLedger();

/**
 * Builds an attribution event from a cleaner result and persists the
 * updated ledger. Fire-and-forget — never blocks the caller. Gated on
 * prefs.attributionLedgerEnabled so users can opt out of URL persistence
 * without disabling the rest of MUGA.
 *
 * @param {string} rawUrl
 * @param {object} result - return value from processUrl
 * @param {object} prefs  - cached prefs (already resolved)
 * @param {string} [referrer] - navigation referrer (#452/B14).
 */
async function pushAttributionAndPersist(rawUrl, result, prefs, referrer = "") {
  // Privacy gate: skip both in-memory accumulation AND storage write so
  // a user who flips the toggle off mid-session sees the ring buffer
  // freeze immediately. Checked before the await so a disabled ledger costs
  // nothing at all, not even a microtask.
  if (prefs?.attributionLedgerEnabled === false) return;

  // #1266: wait out the cold-start hydration window before touching
  // _attributionLedger. _hydrateAttributionLedger swallows its own failures and
  // always resolves, so this can never reject and never blocks past one cold
  // start. Callers stay fire-and-forget; this function is still documented as
  // never blocking THEM, it just no longer races the hydration.
  await _attributionLedgerHydrated;

  let event;
  try {
    // #946 / drop-affiliate-injection (PR 1a): this ctx bag was originally
    // built so fromCleanerResult could reprocess an `injected` result with
    // injection forced off (deriving a tagless copy-safe URL). That
    // "injected" case is now unreachable — processUrl never produces it —
    // so ctx is currently unused by fromCleanerResult, but harmless to pass.
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

// List mutations (whitelist/blacklist) are serialised through
// lib/list-mutation-queue.js. The chain used to live here as a module-local
// promise, which meant migratePerSiteDisableToAllowlist could not join it --
// it is in a lib module and this file cannot be imported -- so that migration
// wrote the whole list with a raw chrome.storage.sync.set and could destroy an
// entry the user had just added (#1257). A queue only some writers use is not
// a queue.

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
// (both expose declarativeNetRequest); the manifest version can. See
// isFirefoxMV2() in ./dnr-sync.js — it moved there (lazily evaluated, same
// gate) so that module stays importable in Node without a `chrome` stub at
// load time.

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

if (isFirefoxMV2()) {
  // Warm the caches the blocking listener reads synchronously, then arm it. Only
  // strip once domain/path rules have settled so a startup navigation can never
  // over-strip a preserve-domain param. Firefox's background page is persistent,
  // so this warm-up runs once at startup.
  Promise.all([getPrefsWithCache(), _domainRulesLoader.ensure(), _pathRulesLoader.ensure()])
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
    // Egress gate. Blocks the weekly signed GET to rules.muga.app until this
    // device has a recorded acceptance at all.
    //
    // DELIBERATE CHANGE, not an oversight. #888 review C1 originally coupled
    // this egress to a consent VERSION: a user still at stored consentVersion
    // 1.0 (accepted before v1.1 disclosed the request) stayed blocked until
    // they accepted a delta re-onboard. Adopting the uBlock Origin model
    // removed the versioned-consent engine, so that per-version coupling is
    // gone: a 1.0 user now makes the request on the next SW wake.
    //
    // Accepted on the same reasoning uBO applies to its own filter-list
    // fetches — the Terms describing the request are available and linked, the
    // request carries no data about the user (Ed25519-signed, credentials
    // omitted, no body), and it can be turned off in Settings, which returns
    // MUGA to making no outbound requests. Re-coupling disclosure to a version
    // would mean reintroducing the version engine; that trade was considered
    // and declined.
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

/**
 * Global toolbar badge for the onboarding state. Shown as "!" while this
 * device has no recorded acceptance, cleared once it has one.
 *
 * ADR-0007: there is no longer a `hard-reonboard` case here. That gate forced
 * onboardingDone:false when the Terms version moved; the engine behind it was
 * removed, so a fresh install is the only way this badge appears.
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

// --- Toolbar badge + tab active-state (#1266 item 2, item 5) ---
//
// updateTabBadge, collectBadgeTotals, computeTabActiveState and
// repaintAllTabsActiveState, plus the bodies of the chrome.tabs.onUpdated /
// chrome.tabs.onRemoved listeners, live in src/background/toolbar-badge.js —
// see that file's module doc for why (Node importability, and the #1266
// item 2 cold-start repaint test it makes possible). withSessionMutation is
// injected rather than duplicated there because appendHistory (below) also
// uses it; both must share the one queue instance.
//
// The addListener calls themselves STAY here as the composition root
// (#1266 item 5): only their bodies moved.
const toolbarBadge = createToolbarBadge({
  bus: toolbarBus,
  getPrefs: getPrefsWithCache,
  sessionStorage,
  tabsApi: chrome.tabs,
  withSessionMutation,
});
const { updateTabBadge, collectBadgeTotals, repaintAllTabsActiveState } = toolbarBadge;

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => toolbarBadge.onTabUpdated(tabId, changeInfo, tab));
chrome.tabs.onRemoved.addListener((tabId) => toolbarBadge.onTabRemoved(tabId));

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
    // produce a different effective onboardingDone — drop the cache so
    // the next read picks up the fixture.
    // The sentinel + fixture keys are never written in production.
    if (changes.__muga_test_mode || changes.__muga_test_fixtures) {
      _invalidatePrefsCache();
    }
    // Consent record changed (onboarding completed on this device).
    // Re-sync the cleaner gate + badge in one shot so both DNR and the
    // toolbar reflect the new state without needing a browser restart.
    if (changes.mugaConsent) {
      _invalidatePrefsCache();
      const prefs = await getPrefsWithCache();
      await applyDnrState(prefs);
      await applyOnboardingBadge(prefs);
      // Onboarding/consent state is one of the three Active-on-tab factors
      // (toolbar-inactive-badge) — completing onboarding flips it for every
      // open tab, not just the global "!" badge.
      await repaintAllTabsActiveState(prefs);
    }
    // Per-device overrides changed (per-device-prefs.setOverrides /
    // clearOverrides). getPrefs() overlays these last, so a change flips the
    // EFFECTIVE prefs (e.g. remoteRulesEnabled) that drive DNR + badge. Without
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
      if (!hasDNR() || typeof chrome.declarativeNetRequest?.getEnabledRulesets !== "function") {
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
    enqueueListMutation(async () => {
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
    enqueueListMutation(async () => {
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
          dnr: hasDNR()
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
          hasDNR: hasDNR(),
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
        // extension AND accepted the ToS. Checked before the source-gated
        // pref check below and before any fetch, so the gate cannot be
        // bypassed by the feature toggle.
        if (!prefs.enabled || !prefs.onboardingDone) {
          try { sendResponse({ ok: false, reason: "disabled" }); } catch { /* channel closed */ }
          return;
        }
        // Source-gated defense-in-depth (browsewrap Phase 2): the single,
        // now-retired shared shortener pref (which gated BOTH click-time and
        // hover resolution together) is replaced by two independent prefs.
        // The caller declares WHY it wants a resolution
        // (message.source: "click" | "hover"), and the handler enforces the
        // MATCHING pref itself — it does not trust the caller's own gate, so
        // a buggy or compromised content script cannot trigger hover-only
        // egress (a bigger privacy cost — it pings the shortener for a link
        // the user only looked at) by omitting its own check or mislabeling
        // its source. An unrecognized/absent source is always denied
        // (fail-closed).
        const sourceAllowed =
          message.source === "click" ? prefs.resolveShortenersOnClick === true :
          message.source === "hover" ? prefs.resolveShortenersOnHover === true :
          false;
        if (!sourceAllowed) {
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

        // #1264: the resolved destination went straight back to the caller,
        // which navigated to it. On navigation the DNR layer (Chrome) and the
        // blocking webRequest handler (Firefox) still strip tracking params,
        // so the gap is narrower than "the destination is never cleaned" — but
        // wrapper unwrapping and the path rules live ONLY in the JS pipeline.
        // Only l.facebook.com / lm.facebook.com are mirrored into DNR by
        // wrapper-dnr-builder.js; the rest of the WRAPPERS table has no
        // network-layer equivalent. So a short link resolving onto a wrapped
        // URL took that hop un-unwrapped, while the same URL clicked directly
        // would have been unwrapped. The user asked MUGA where the link really
        // goes and got one hop less than it can resolve.
        //
        // Applies to both sources on purpose: "click" navigates to this
        // string, and "hover" (#1028) SHOWS it as the real destination, so an
        // uncleaned value is wrong on the preview for the same reason.
        //
        // Side effects are all suppressed: this is a pre-navigation transform,
        // not a navigation. The browser is about to load the returned URL and
        // the ordinary navigation path owns the tally, so counting here would
        // inflate "URLs cleaned" and prepend a duplicate history row for a
        // single click — the same reason the copy-selection call site passes
        // these flags (#966).
        if (result?.ok === true && typeof result.destination === "string") {
          result.destination = await cleanResolvedDestination(result.destination, {
            clean: (url) => handleProcessUrl(url, {
              skipNotify: true,
              skipStats: true,
              skipSideEffects: true,
              source: "shortener",
            }),
            isPrivateHost,
            maxLength: MAX_DESTINATION_LENGTH,
            onError: (err) => console.warn("[MUGA] cleanResolvedDestination failed:", err),
          });
        }

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
  // Both loaders in one outer Promise.all so all three JSON files (domain +
  // 2x path) are in flight at once. Each ensure() shares a single in-flight
  // promise across concurrent callers and re-arms the retry after the await
  // — the #833 invariant, now in lib/single-flight-loader.js where it
  // can be tested directly rather than through a copy (#1268).
  await Promise.all([_domainRulesLoader.ensure(), _pathRulesLoader.ensure()]);
  const prefs = await getPrefsWithCache();

  if (!prefs.enabled || !prefs.onboardingDone) {
    return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null, autoInjected: null };
  }

  // On copy: suppress the toast. User didn't navigate, they just copied a
  // link. drop-affiliate-injection (PR 1a): the injectOwnAffiliate override
  // was removed — MUGA never injects its own tag anymore, so there is
  // nothing left to suppress on that side.
  const effectivePrefs = skipNotify
    ? { ...prefs, notifyForeignAffiliate: false }
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
  // Fallback for a lifecycle event that has not fired yet (a Firefox temporary
  // add-on loads without install/startup), so the timestamp is as accurate as
  // it can be rather than waiting for a future startup. ensure() is the same
  // call onInstalled/onStartup make and is idempotent per worker lifetime, so
  // after the first one this is a boolean check (#1268).
  await _firstUsedBootstrap.ensure();

  // Update stats and session history. Only count if the URL actually changed (S13).
  const urlChanged = result.cleanUrl !== rawUrl;
  let parsedRaw;
  try { parsedRaw = new URL(rawUrl); } catch { /* ignore */ }
  // #966: copy-safe reprocessing (skipSideEffects) must not mutate any
  // user-visible tally. Copying an entry re-cleans an already-counted URL, so
  // counting it again would inflate "URLs cleaned", prepend a DUPLICATE session
  // history row (evicting real entries), and push a duplicate ledger event. When
  // skipSideEffects is set we still compute the clean URL for the response,
  // but write nothing.
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
    // #966: a copy must not bump referralsSpotted or log a detection either.
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
    // drop-affiliate-injection (PR 1a): the withOurAffiliate alternate-URL
    // construction was removed — MUGA never injects its own tag anymore, so
    // there is no "with our tag" variant for the toast's "Remove it" action
    // to offer. It now always strips to result.cleanUrl.
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
//
// This resolver is factored out so the seam literal below appears exactly
// ONCE in this file. tools/strip-test-seams.mjs's neutraliseTrustedKeysSeam()
// strips it via a single (non-global) string replace at build time; a SECOND
// copy of the literal would silently survive an otherwise-neutralised
// production build and leak the test-key backdoor (caught by
// tests/unit/strip-test-seams.test.mjs).
function _resolveTrustedKeys() {
  const trustedKeys =
    Array.isArray(globalThis.__MUGA_TRUSTED_KEYS__) && globalThis.__MUGA_TRUSTED_KEYS__.length > 0
      ? globalThis.__MUGA_TRUSTED_KEYS__
      : TRUSTED_PUBLIC_KEYS;
  return trustedKeys;
}

function _remoteRulesDeps() {
  const trustedKeys = _resolveTrustedKeys();
  return {
    fetchImpl: globalThis.fetch,
    subtle: globalThis.crypto?.subtle,
    trustedKeys,
    storage: hasDNR() ? {
      get: (d) => chrome.storage.local.get(d),
      set: (i) => chrome.storage.local.set(i),
      remove: (k) => chrome.storage.local.remove(k),
    } : null,
    dnr: hasDNR() ? {
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
  // Migrations are NOT invoked here (#1257). This handler only fires on a wake,
  // and every wake evaluates the module, so the single call site at module
  // scope has already started them. Repeating them here raced that call.
  // #833: bootstrap firstUsed here so the hot path stays free.
  _initFirstUsed();
  // #1266: toolbar-presenter's activeStates map is in-memory only, unlike its
  // sibling badgeTotals which is mirrored to chrome.storage.session for exactly
  // this reason. After an MV3 restart the map is empty and isTabInactive()
  // defaults to active. repaintAllTabsActiveState is the only thing that
  // recomputes it for already-open tabs, and it was wired ONLY to
  // storage.onChanged, so a cold start with no pref change left it unrepainted.
  // Low practical impact, since the cleaning path is gated by the same exemption
  // check, but it was an asymmetry with the durably-backed sibling.
  await repaintAllTabsActiveState(prefs);
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
 * background-load fallback paths (#365). Returns true when the onboarding
 * tab should be opened, which now means one thing only: this device has no
 * recorded acceptance.
 *
 * A Terms update never reopens this tab. MUGA follows the uBlock Origin
 * model — Terms available and linked, acceptance by use, no re-prompt — so
 * the versioned-consent policy that used to return `soft-reonboard` /
 * `hard-reonboard` here was removed.
 *
 * @param {object} prefs - Merged prefs (consent overlay applied by getPrefs).
 * @returns {boolean}
 */
function shouldOpenOnboarding(prefs) {
  return !prefs.onboardingDone;
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

// --- Browsewrap Phase 1: implicit acceptance on fresh install --------------
// "By using MUGA you agree to the Terms of use and Privacy policy." A fresh
// install auto-records acceptance so every onboardingDone-gated feature
// (local cleaning, remote-rules fetch, DNR rulesets) works immediately —
// no forced "Accept" click. Writes the SAME fields the old explicit-accept
// click used to write (see onboarding.js's setConsent call), so a fresh
// install is indistinguishable from a completed acceptance. consentVersion
// is provenance only — nothing evaluates it (see consent-storage's
// TERMS_VERSION).
//
// Runs ONLY on details.reason === "install". An "update" must NEVER touch an
// existing user's stored consent — no re-prompt, no overwrite, no re-dating
// consentDate. This is idempotent (setConsent merges over whatever is
// already there), so calling it more than once on the same install is safe,
// but the "update" gate is what actually protects existing users.
async function recordImplicitAcceptOnInstall() {
  try {
    await setConsent({
      onboardingDone: true,
      consentVersion: TERMS_VERSION,
      consentDate: Date.now(),
    });
  } catch (err) {
    console.error("[MUGA] recordImplicitAcceptOnInstall failed:", err);
  }
}

// --- On install: open onboarding on first run, sync DNR + maybe fetch rules ---
chrome.runtime.onInstalled.addListener(async (details) => {
  await persistPrevVersion(details);

  // Implicit browsewrap acceptance (Phase 1). Written BEFORE the prefs read
  // below so applyDnrState/maybeFetchRemoteRules/badge all see
  // onboardingDone:true on the very first SW wake — features work
  // immediately, without waiting for a welcome-tab click. Never runs on
  // "update" (existing users keep their stored consent untouched).
  if (details.reason === "install") {
    await recordImplicitAcceptOnInstall();
  }

  const prefs = await getPrefsWithCache();
  await applyDnrState(prefs);
  await applyOnboardingBadge(prefs);
  // Opportunistic fetch: fires on install/update if user had enabled remote rules
  // before the update and the stored payload is stale (or absent). On a fresh
  // install this now fires immediately — the implicit-accept write above
  // already moved consent to "valid" before this call runs.
  maybeFetchRemoteRules(_remoteRulesDeps());
  // Migrations are NOT invoked here (#1257) — see the onStartup handler and the
  // single call site at module scope, which this handler's own wake has
  // already evaluated.
  // #833: bootstrap firstUsed so the hot path stays free.
  _initFirstUsed();
  // #1266: same cold-start rehydration as the onStartup handler. An update
  // reloads the worker with tabs already open, so activeStates is empty for
  // every one of them until an unrelated pref change happens to repaint it.
  await repaintAllTabsActiveState(prefs);

  if (prefs.contextMenuEnabled !== false) {
    await syncContextMenus(true);
  }

  if (details.reason === "install") {
    // Non-blocking informational welcome tab (Phase 1 browsewrap): always
    // opens on a fresh install — consent is already implicit, so this is a
    // notice the user can read and close, not a gate they must act on.
    await openOnboardingOnce();
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
