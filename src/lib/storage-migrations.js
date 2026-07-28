/**
 * MUGA: One-time storage migrations
 *
 * Extracted from storage.js (#826 PR2) — pure relocation, zero behaviour change.
 *
 * Design rule: this module must NOT import from storage.js to avoid circularity.
 * The two helpers below need local-storage reads/writes that would normally go
 * through getStats/setStats — instead they call chrome.storage.local directly,
 * keeping the module dependency-free from its sibling.
 */

// migratePerSiteDisableToAllowlist() reuses the entry parser/domain-matcher
// from cleaner.js rather than re-implementing "domain::disabled" splitting.
// Safe: cleaner.js (and its full dependency chain — affiliates.js,
// wrapper-engine.js, opaque-networks.js, canonical-extractor.js,
// honor-creator.js, param-classifier.js, path-rules.js,
// cross-site-frequency.js, creator-allowlist.js) never imports storage.js or
// storage-migrations.js, so this import cannot create a cycle.
import { parseListEntry, domainMatches } from "./cleaner.js";

// ── One-time migration ────────────────────────────────────────────────────────

/**
 * One-time migration: moves stats out of chrome.storage.sync into
 * chrome.storage.local. Safe to call on every startup. Exits immediately
 * if migration already done or no old data exists.
 */
export async function migrateStatsToLocal() {
  const STAT_DEFAULTS = {
    stats: { urlsCleaned: 0, junkRemoved: 0, referralsSpotted: 0 },
    firstUsed: null,
    nudgeDismissed: false,
  };

  const syncData = await new Promise((resolve, reject) =>
    chrome.storage.sync.get({ stats: null, firstUsed: null, nudgeDismissed: null }, (result) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    })
  ).catch(() => ({ stats: null, firstUsed: null, nudgeDismissed: null }));

  const hasOldStats =
    syncData.stats !== null ||
    syncData.firstUsed !== null ||
    syncData.nudgeDismissed !== null;

  if (!hasOldStats) return;

  // Copy to local (only if local doesn't already have data)
  const localData = await new Promise((resolve, reject) =>
    chrome.storage.local.get(STAT_DEFAULTS, (result) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    })
  ).catch(() => ({ ...STAT_DEFAULTS }));

  const merged = {
    stats: syncData.stats ?? localData.stats,
    firstUsed: syncData.firstUsed ?? localData.firstUsed,
    nudgeDismissed: syncData.nudgeDismissed ?? localData.nudgeDismissed,
  };

  await new Promise((resolve, reject) =>
    chrome.storage.local.set(merged, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    })
  );

  // Remove from sync
  await new Promise((resolve, reject) =>
    chrome.storage.sync.remove(["stats", "firstUsed", "nudgeDismissed"], () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    })
  ).catch(() => {}); // best-effort: old keys already migrated, removal is non-critical
}

/**
 * One-time migration (ADR-0004 phase 5, #701): renames `privacyProxyEnabled` →
 * `followShortenersEnabled` in chrome.storage.sync. Safe to call on every
 * startup. Exits immediately if the old key is absent.
 *
 * If the user had `privacyProxyEnabled = true` they were using native shortener
 * resolution (the default since phase 4 / 2.2.0-beta.1), so we preserve their
 * intent by setting `followShortenersEnabled = true`. A false value needs no
 * migration because `followShortenersEnabled` already defaults to false.
 */
export async function migrateLegacyProxyPref() {
  try {
    const data = await new Promise((resolve, reject) =>
      chrome.storage.sync.get({ privacyProxyEnabled: null }, (result) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(result);
      })
    ).catch(() => ({ privacyProxyEnabled: null }));

    if (data.privacyProxyEnabled === null) return; // key absent — nothing to do

    const updates = {};
    if (data.privacyProxyEnabled === true) {
      // Preserve user's intent: they had the feature enabled.
      updates.followShortenersEnabled = true;
    }
    // Write followShortenersEnabled only when migrating a `true` value; a false
    // or absent old value needs no write (the new key already defaults to false).
    // The old key is removed unconditionally below regardless.
    if (Object.keys(updates).length > 0) {
      await new Promise((resolve, reject) =>
        chrome.storage.sync.set(updates, () => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve();
        })
      );
    }
    // Remove the deprecated key.
    await new Promise((resolve) =>
      chrome.storage.sync.remove("privacyProxyEnabled", () => {
        void chrome.runtime.lastError; // non-critical
        resolve();
      })
    );
  } catch {
    // Migration is best-effort — a failure here must never break startup.
  }
}

/**
 * One-time migration: the legacy `domain::disabled` per-site-pause blacklist
 * syntax has been removed entirely — a domain is exempted ONLY via a
 * domain-only whitelist (allowlist) entry now. This migration converts each
 * existing `domain::disabled` blacklist entry into a bare, lowercased,
 * www-stripped domain whitelist entry, so no existing user (or the
 * maintainer's own test data) is silently left with a dead entry that no
 * longer exempts anything.
 *
 * Param-scoped blacklist entries (e.g. "domain.com::tag::x" or
 * "domain.com::disabled::keep", where "disabled" is itself a param value
 * rather than the marker) are left untouched — only the domain-only
 * `disabled` marker (no value) is converted.
 *
 * Dedup: a domain already covered by an existing (or just-migrated)
 * domain-only whitelist entry — exact match or parent-domain match, via
 * domainMatches() — is not added again.
 *
 * Idempotent: after running once, no `::disabled` entries remain in the
 * blacklist, so a second run finds nothing to convert and exits as a no-op
 * without writing anything back. Safe to call on every startup.
 *
 * Fail-safe: wrapped in try/catch — a storage error or malformed data must
 * never throw out to the caller or break startup.
 */
export async function migratePerSiteDisableToAllowlist() {
  try {
    const data = await new Promise((resolve, reject) =>
      chrome.storage.sync.get({ whitelist: [], blacklist: [] }, (result) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(result);
      })
    ).catch(() => ({ whitelist: [], blacklist: [] }));

    const blacklist = Array.isArray(data.blacklist) ? data.blacklist : [];
    const newWhitelist = Array.isArray(data.whitelist) ? data.whitelist.slice() : [];

    const isDomainOnlyCovered = (domain) =>
      newWhitelist.some((raw) => {
        let e;
        try {
          e = parseListEntry(raw);
        } catch {
          return false;
        }
        return !!e.domain && !e.param && domainMatches(domain, e.domain);
      });

    const newBlacklist = [];
    let changed = false;

    for (const raw of blacklist) {
      let entry;
      try {
        entry = parseListEntry(raw);
      } catch {
        newBlacklist.push(raw); // unparseable — leave untouched, never drop silently
        continue;
      }
      const isPerSiteDisable = !!entry.domain && entry.param === "disabled" && !entry.value;
      if (!isPerSiteDisable) {
        newBlacklist.push(raw);
        continue;
      }
      changed = true;
      if (!isDomainOnlyCovered(entry.domain)) {
        newWhitelist.push(entry.domain);
      }
    }

    if (!changed) return; // no `::disabled` entries found — nothing to do

    await new Promise((resolve, reject) =>
      chrome.storage.sync.set({ whitelist: newWhitelist, blacklist: newBlacklist }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      })
    );
  } catch {
    // Migration is best-effort — a failure here must never break startup.
  }
}

/**
 * One-time migration (drop-affiliate-injection, PR 1b): deletes the retired
 * `injectOwnAffiliate` key from chrome.storage.sync. The own-tag affiliate
 * injection feature was removed in PR 1a; the pref itself (and its guarded
 * per-device override machinery — see synced-affiliate-pref-guard.js's
 * GUARDED_PREFS) is retired in PR 1b, so no code path writes or reads this
 * key anymore. Safe to call on every startup: it reads the key FIRST and
 * only issues the `remove` write when the key is actually present, so after
 * the one-time cleanup it never spends a sync write op again (matching the
 * read-first, write-only-if-needed pattern of the sibling migrations —
 * `remove` still counts against Chrome's sync write quota even for an absent
 * key, so an unconditional write on every SW wake would waste quota forever).
 *
 * Fail-safe: wrapped in try/catch — a storage error must never throw out to
 * the caller or break startup.
 */
export async function migrateDropInjectOwnAffiliate() {
  try {
    const present = await new Promise((resolve) => {
      chrome.storage.sync.get("injectOwnAffiliate", (data) => {
        void chrome.runtime.lastError; // non-critical
        // chrome omits absent keys; a stored boolean is defined. `!== undefined`
        // is the robust presence signal (covers stored `false` too).
        resolve(!!data && data.injectOwnAffiliate !== undefined);
      });
    });
    if (!present) return; // already clean — no write, no wasted quota op
    await new Promise((resolve) => {
      chrome.storage.sync.remove("injectOwnAffiliate", () => {
        void chrome.runtime.lastError; // non-critical
        resolve();
      });
    });
  } catch {
    // Migration is best-effort — a failure here must never break startup.
  }
}

/**
 * One-time migration (cookie-consent 2-state mode): converts the legacy
 * `cookieConsentMinimizerEnabled` boolean into the `cookieConsentMode` enum
 * ("off" | "reject-only"). Safe to call on every startup; idempotent once
 * `cookieConsentMode` is present (modulo the defensive cleanup below).
 *
 * The install/update discriminator is `chrome.runtime.onInstalled`'s
 * `details.reason`, passed in by the caller — NOT any storage signal. Storage
 * alone cannot tell a freshly-onboarded new user from a pre-existing user:
 * both have `cookieConsentMode` absent, no legacy key, and `onboardingDone`
 * true (the `reject-only` default lives only in PREF_DEFAULTS and is overlaid
 * at read time, never persisted). Inferring "off" from that shared state
 * silently downgraded every new install from the disclosed `reject-only`
 * default. `reason` is the only ground truth.
 *
 *   - `reason === "install"` (genuine fresh install) -> PERSIST the disclosed
 *     default `cookieConsentMode: "reject-only"` so it latches; every later
 *     idempotent pass is then a no-op.
 *   - `reason === "update"` (existing user upgrading) -> legacy
 *     `cookieConsentMinimizerEnabled === true` preserves the prior opt-in as
 *     `reject-only`; legacy `=== false` or ABSENT stays `off` (no forced
 *     enable). Legacy key deleted.
 *   - no `reason` (top-level module load / onStartup) -> a SAFE idempotent
 *     pass ONLY: if `cookieConsentMode` is present, no-op (aside from the
 *     defensive cleanup below); else if the legacy key is present, map it
 *     (`true` -> `reject-only`, `false` -> `off`) and delete it; else DO
 *     NOTHING (leave the mode absent so the PREF_DEFAULTS overlay applies
 *     and `onInstalled` seeds genuine installs). This pass NEVER infers
 *     "off" from an absent mode.
 *
 * Defensive cleanup (the accept-when-necessary mode never shipped enabled to
 * real users, but may exist in a pre-release/dev profile from this codebase's
 * own history): a persisted `cookieConsentMode === "accept-when-necessary"`
 * is collapsed to `"reject-only"`, and a stale `cookieConsentAcceptConsented`
 * key (the retired accept-gesture flag) is dropped. Both run unconditionally,
 * even when `cookieConsentMode` is already a valid 2-state value, so this
 * cleanup is not gated behind the "already migrated" no-op above.
 *
 * @param {{ reason?: string }} [details] - The onInstalled `details` object.
 *   Omit (or omit `reason`) for the top-level/onStartup safe idempotent pass.
 *
 * Fail-safe: wrapped in try/catch — a storage error must never throw out to
 * the caller or break startup.
 */
export async function migrateCookieConsentMode({ reason } = {}) {
  try {
    const syncData = await new Promise((resolve, reject) =>
      chrome.storage.sync.get(
        {
          cookieConsentMinimizerEnabled: null,
          cookieConsentMode: null,
          cookieConsentAcceptConsented: null,
        },
        (result) => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(result);
        }
      )
    ).catch(() => ({
      cookieConsentMinimizerEnabled: null,
      cookieConsentMode: null,
      cookieConsentAcceptConsented: null,
    }));

    // Defensive cleanup — runs regardless of whether cookieConsentMode was
    // already migrated. Best-effort; never required for correctness since
    // this mode never shipped enabled to real users.
    const cleanup = {};
    if (syncData.cookieConsentMode === "accept-when-necessary") {
      cleanup.cookieConsentMode = "reject-only";
    }
    if (Object.keys(cleanup).length > 0) {
      await new Promise((resolve) =>
        chrome.storage.sync.set(cleanup, () => {
          void chrome.runtime.lastError; // non-critical
          resolve();
        })
      );
    }
    if (syncData.cookieConsentAcceptConsented !== null) {
      await new Promise((resolve) =>
        chrome.storage.sync.remove("cookieConsentAcceptConsented", () => {
          void chrome.runtime.lastError; // non-critical
          resolve();
        })
      );
    }

    if (syncData.cookieConsentMode !== null) return; // already migrated — no-op

    const legacy = syncData.cookieConsentMinimizerEnabled;

    let updates = null;
    let removeLegacy = false;

    if (reason === "install") {
      // Genuine fresh install: latch the disclosed default so no later pass can
      // re-derive it. There is no legacy key on a fresh install, so nothing to
      // delete.
      updates = { cookieConsentMode: "reject-only" };
    } else if (reason === "update") {
      // Existing user upgrading. Preserve a prior opt-in as the safe mode; a
      // false or absent legacy value stays off.
      updates = { cookieConsentMode: legacy === true ? "reject-only" : "off" };
      removeLegacy = true;
    } else {
      // Top-level module load / onStartup: SAFE idempotent pass only. Map a
      // legacy key when present; otherwise DO NOTHING. Never infer "off" from
      // an absent mode — that was the downgrade bug.
      if (legacy === true) {
        updates = { cookieConsentMode: "reject-only" };
        removeLegacy = true;
      } else if (legacy === false) {
        updates = { cookieConsentMode: "off" };
        removeLegacy = true;
      }
      // else: legacy absent — leave the mode absent, let PREF_DEFAULTS stand.
    }

    if (!updates) return;

    await new Promise((resolve, reject) =>
      chrome.storage.sync.set(updates, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      })
    );

    if (removeLegacy) {
      await new Promise((resolve) =>
        chrome.storage.sync.remove("cookieConsentMinimizerEnabled", () => {
          void chrome.runtime.lastError; // non-critical
          resolve();
        })
      );
    }
  } catch {
    // Migration is best-effort — a failure here must never break startup.
  }
}
