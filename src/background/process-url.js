/**
 * MUGA — handleProcessUrl, extracted so it can be imported in Node (#1266 item 5, slice 6)
 *
 * `src/background/service-worker.js` makes `chrome.*` calls at module scope,
 * so Node cannot import it. #1266 item 5 lists `handleProcessUrl` LAST, on
 * purpose: "since it carries the most subtle side-effect ordering." This is
 * that slice. Unlike the five that landed before it (dnr-sync.js, toolbar-
 * badge.js, onboarding-gate.js, remote-rules-wake.js, session-log.js), this
 * one function is the hot path for the whole extension and touches the
 * prefs cache, both rule loaders, the cross-site-frequency tracker, session
 * history, the stats counters, and the Attribution Ledger — several of
 * which are shared with call sites OUTSIDE handleProcessUrl and therefore
 * cannot move with it.
 *
 * ## What moved and why
 *
 * The Attribution Ledger subsystem (`_attributionLedger`, its cold-start
 * hydration, and `pushAttributionAndPersist`) moved here IN FULL: nothing
 * outside handleProcessUrl ever read or wrote `_attributionLedger` in
 * service-worker.js (verified — the popup reads the persisted copy
 * straight from `chrome.storage.local`, never through this in-memory
 * object), so it is exclusively this function's collaborator and has no
 * circular-import concern to route around.
 *
 * Everything else handleProcessUrl touches is shared with code that stays
 * in service-worker.js (the Firefox `webRequest` blocking stripper reads
 * `domainRules`/`pathStripRules`/`pathAffiliateRules`/`frequencyTracker`
 * directly; `getPrefsWithCache` and the two rule loaders are called from
 * several other handlers; `appendHistory` is shared with
 * `recordNetworkClean`, the `BADGE_AND_STATS` handler's collaborator). Per
 * the `toolbar-badge.js` precedent, those are INJECTED into the
 * `createProcessUrl({ ... })` factory rather than imported back out of
 * service-worker.js, which would be circular. `domainRules`,
 * `pathStripRules` and `pathAffiliateRules` are `let` bindings reassigned
 * by the rule loaders after their first fetch, so they are injected as
 * accessor functions (`getDomainRules`/`getPathStripRules`/
 * `getPathAffiliateRules`) rather than by value — a plain value captured
 * at factory-construction time would freeze on the initial empty array.
 * `frequencyTracker` never gets reassigned, so it is injected directly.
 *
 * `processUrl` (the cleaner), `incrementStat`/`incrementDomainStat`, and
 * `logAction` are plain lib imports with no circularity concern — they are
 * imported directly here exactly as service-worker.js imported them,
 * matching the `dnr-sync.js` precedent of importing library dependencies
 * rather than injecting them.
 *
 * ## Side-effect ordering (the point of this slice)
 *
 * Mapped directly from the pre-move function body before anything was
 * touched. `handleProcessUrl(rawUrl, opts)` runs, in this order:
 *
 *   0. Guard: if `rawUrl` does not start with "http", return `untouched`
 *      immediately. No loader, no prefs read, no side effect at all.
 *   1. `Promise.all([domainRulesLoader.ensure(), pathRulesLoader.ensure()])`
 *      — both rule loaders requested concurrently, awaited together.
 *   2. `getPrefs()` — prefs cache warmed/read (after step 1 resolves).
 *   3. Guard: if `!prefs.enabled || !prefs.onboardingDone`, return
 *      `untouched`. Steps 1-2 already ran (harmless/idempotent); nothing
 *      past this point runs.
 *   4. `effectivePrefs` is built: `skipNotify` forces
 *      `notifyForeignAffiliate: false` (nothing else — the affiliate-
 *      injection override this branch used to also flip was removed when
 *      MUGA stopped injecting its own tag). `skipNotify` has NO effect on
 *      any step below; it only changes what the cleaner sees.
 *   5. `processUrl(...)` (the cleaner) runs synchronously. On throw:
 *      `console.error` + return `{ action: "error", ... }` — none of the
 *      steps below run.
 *   6. `firstUsedBootstrap.ensure()` is awaited (idempotent after the
 *      first call in a worker lifetime).
 *   7. `urlChanged` and `parsedRaw` (a `new URL(rawUrl)` best-effort parse)
 *      are computed.
 *   8. IF `!skipSideEffects` AND (`action === "untouched"` OR
 *      (`!urlChanged && junkRemoved === 0`)): a `"passthrough"` entry is
 *      logged via `logAction` when the raw URL had a query string.
 *   9. IF `action !== "untouched"` AND (`urlChanged || junkRemoved > 0`):
 *      this block and the next are SEPARATE top-level conditions, not
 *      nested — a `detected_foreign` result with neither urlChanged nor
 *      junkRemoved can skip this block and still hit step 10.
 *        9a. IF `!skipStats && !skipSideEffects`: `incrementStat
 *            ("urlsCleaned")`, then `incrementStat("junkRemoved", n)` if
 *            `junkRemoved > 0`, then (if `prefs.domainStats &&
 *            junkRemoved > 0`) `incrementDomainStat(hostname, n)` inside
 *            its own try/catch (a bad hostname parse only skips the
 *            domain stat, nothing else).
 *        9b. IF `!skipSideEffects`: `await appendHistory(...)` — THEN,
 *            after it resolves, a `"cleaned"` entry is logged via
 *            `logAction` (inside its own try/catch — a malformed
 *            `cleanUrl` only skips the log, not the history write that
 *            already happened).
 *   10. IF `action === "detected_foreign"`: IF `!skipSideEffects`,
 *       `incrementStat("referralsSpotted")` then a `"affiliate_detected"`
 *       entry is logged via `logAction`. `skipStats` does NOT gate this —
 *       only `skipSideEffects` does (verified against the source: the
 *       original code's referralsSpotted bump answers to
 *       `!skipSideEffects` alone, not `!skipStats && !skipSideEffects`
 *       like step 9a's urlsCleaned/junkRemoved bump).
 *   11. IF `!skipSideEffects`: `pushAttributionAndPersist(...)` fires
 *       WITHOUT being awaited (fire-and-forget, unchanged from the
 *       original — "so a write hiccup never affects the caller's URL
 *       processing"). This runs regardless of `action`, including
 *       `"untouched"` — `fromCleanerResult` itself decides whether an
 *       event is worth pushing (an `untouched` navigation still produces
 *       a `{ type: "navigate" }` event, so this is NOT a no-op for that
 *       action — verified against `lib/attribution-ledger.js`).
 *   12. `return result`.
 *
 * `skipStats` gates ONLY step 9a (urlsCleaned/junkRemoved/domainStats).
 * `skipSideEffects` gates steps 8, 9a, 9b, 10 and 11 — i.e. everything
 * that would touch storage, the session log, or the ledger — while the
 * cleaner still runs and the return value is still fully computed.
 * `skipNotify` gates neither; it only changes `effectivePrefs` (step 4),
 * which can change `result.action` itself (a foreign-affiliate tag is
 * only detected when `prefs.notifyForeignAffiliate` is true — see
 * `lib/cleaner.js`), so its effect on steps 8-11 is only ever indirect,
 * through a different `result`.
 *
 * ## The Attribution Ledger's own ordering (moved here verbatim)
 *
 * `_hydrateAttributionLedger()` is fired the moment `createProcessUrl` is
 * CALLED — not lazily, not on the first `handleProcessUrl` invocation. The
 * original comment (kept below, verbatim) explains why: a `PROCESS_URL`
 * arriving during the cold-start hydration window must never race the
 * hydration and lose a push. `pushAttributionAndPersist` awaits the SAME
 * hydration promise every call, so a push either lands before hydration
 * starts reading or after it finishes writing, never in between.
 *
 * PRESERVING THIS INVARIANT IS THE CALLER'S RESPONSIBILITY:
 * service-worker.js MUST call `createProcessUrl({ ... })` at module scope,
 * synchronously, at (or before) the same point in its own top-level
 * execution where the original `_hydrateAttributionLedger()` call used to
 * sit — i.e. as early as possible, well before any message can be
 * processed. Calling it lazily (e.g. inside the message listener, on first
 * PROCESS_URL) would reintroduce exactly the write-loss race #1266 fixed.
 *
 * `chrome.storage.local` is referenced directly inside the ledger's
 * functions, not injected, matching the `dnr-sync.js` precedent
 * ("module-scope chrome.* reads turned into lazily-evaluated functions") —
 * Node can import this module freely because nothing at TRUE module scope
 * touches `chrome`; only calling `createProcessUrl()` (which a test
 * controls, after stubbing `globalThis.chrome`) reaches it.
 *
 * ## What stays in service-worker.js
 *
 * The message listener and every `chrome.*.addListener` call — the
 * composition root, per #1266. That includes the `PROCESS_URL` handler
 * itself (which calls the `handleProcessUrl` this factory returns), the
 * badge update + `creatorReferralPreserved` toolbar-bus emit that follow
 * it (those run AFTER `handleProcessUrl` resolves, in the message
 * handler's `.then()` — NOT inside `handleProcessUrl` itself; verified
 * against the source, so no ordering claim about the toolbar bus belongs
 * in this file), and the other four call sites (keyboard shortcut,
 * context-menu copy-link, context-menu copy-selection fallback, and the
 * shortener-resolution re-clean).
 */

import { processUrl } from "../lib/cleaner.js";
import { incrementStat, incrementDomainStat } from "../lib/storage.js";
import { logAction } from "./session-log.js";
import {
  createLedger as createAttributionLedger,
  pushEvent as pushAttributionEvent,
  fromCleanerResult as attributionEventFromCleanerResult,
  DEFAULT_LEDGER_CAPACITY,
} from "../lib/attribution-ledger.js";

/**
 * @param {object} args
 * @param {{ ensure: () => Promise<void> }} args.domainRulesLoader - service-worker.js's `_domainRulesLoader`.
 * @param {{ ensure: () => Promise<void> }} args.pathRulesLoader - service-worker.js's `_pathRulesLoader`.
 * @param {{ ensure: () => Promise<void> }} args.firstUsedBootstrap - service-worker.js's `_firstUsedBootstrap`.
 * @param {() => Promise<object>} args.getPrefs - service-worker.js's `getPrefsWithCache`.
 * @param {() => Array} args.getDomainRules - reads service-worker.js's mutable `domainRules`.
 * @param {() => Array} args.getPathStripRules - reads service-worker.js's mutable `pathStripRules`.
 * @param {() => Array} args.getPathAffiliateRules - reads service-worker.js's mutable `pathAffiliateRules`.
 * @param {object|null} args.frequencyTracker - service-worker.js's `frequencyTracker` singleton (never reassigned).
 * @param {(original: string, clean: string, removedTracking?: string[]) => Promise<void>} args.appendHistory -
 *   service-worker.js's `appendHistory`. Shared with `recordNetworkClean` — MUST be the same instance, not a copy.
 * @returns {{ handleProcessUrl: Function }}
 */
export function createProcessUrl({
  domainRulesLoader,
  pathRulesLoader,
  firstUsedBootstrap,
  getPrefs,
  getDomainRules,
  getPathStripRules,
  getPathAffiliateRules,
  frequencyTracker,
  appendHistory,
}) {
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
  //
  // #1266 item 5 slice 6: "module scope" now means the moment createProcessUrl()
  // is called — see this file's docblock for why service-worker.js must call it
  // eagerly, at the same point in its own top-level execution this used to sit.
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
        prefs, domainRules: getDomainRules(), pathStripRules: getPathStripRules(), pathAffiliateRules: getPathAffiliateRules(), referrer,
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

  async function handleProcessUrl(rawUrl, { skipNotify = false, source = "navigation", skipStats = false, skipSideEffects = false, referrer = "" } = {}) {
    if (!rawUrl?.startsWith("http")) return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], junkRemoved: 0, detectedAffiliate: null, autoInjected: null };
    // Both loaders in one outer Promise.all so all three JSON files (domain +
    // 2x path) are in flight at once. Each ensure() shares a single in-flight
    // promise across concurrent callers and re-arms the retry after the await
    // — the #833 invariant, now in lib/single-flight-loader.js where it
    // can be tested directly rather than through a copy (#1268).
    await Promise.all([domainRulesLoader.ensure(), pathRulesLoader.ensure()]);
    const prefs = await getPrefs();

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
      result = processUrl(rawUrl, effectivePrefs, getDomainRules(), undefined, frequencyTracker, referrer, getPathStripRules(), getPathAffiliateRules());
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
    await firstUsedBootstrap.ensure();

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

  return { handleProcessUrl };
}
