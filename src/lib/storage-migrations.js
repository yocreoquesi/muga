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
 * One-time migration (drop-cookie-consent, Slice D of 6): deletes every
 * storage key left behind by the retired cookie-consent-minimizer subsystem.
 * The runtime that read these keys (content/cookie-noise.js,
 * lib/cmp-adapters.js, the Tier2 remote-rules pipeline) was already deleted
 * in Slices A/B, so no live code reads or writes any of them anymore — this
 * migration exists purely to stop existing installs from carrying dead
 * bytes in storage forever.
 *
 * `chrome.storage.sync`:
 *   - `cookieConsentMode` — the 2-state mode pref itself.
 *   - `cookieConsentMinimizerEnabled` — legacy boolean predecessor.
 *   - `cookieConsentAcceptConsented` — retired accept-gesture flag.
 *
 * `chrome.storage.local`:
 *   - `remoteTier2Rules`, `remoteTier2Meta`, `remoteTier2VersionFloor` — the
 *     dead Tier2 remote-rules cache (Slice B removed the code that wrote
 *     these; any pre-Slice-B install may still carry them).
 *
 * Read-first, write-only-if-present (mirrors migratePerSiteDisableToAllowlist
 * exactly): each area is read before any write, and a `remove` is issued
 * for that area ONLY when at least one of its keys is actually present
 * (`!== undefined`, the robust presence signal that also covers a stored
 * `false`). `remove` still counts against Chrome's sync write quota even
 * for an absent key, so an unconditional call on every SW wake would waste
 * quota forever — this keeps steady-state (already-clean) installs at zero
 * writes.
 *
 * Idempotent: after the first successful run, every key is absent, so a
 * later call finds nothing to remove and is a pure no-op.
 *
 * Fail-safe: wrapped in try/catch — a storage error must never throw out to
 * the caller or break startup. Best-effort throughout.
 */
export async function migrateDropCookieConsent() {
  try {
    const syncKeys = ["cookieConsentMode", "cookieConsentMinimizerEnabled", "cookieConsentAcceptConsented"];
    const syncData = await new Promise((resolve) => {
      chrome.storage.sync.get(syncKeys, (result) => {
        void chrome.runtime.lastError; // non-critical
        resolve(result || {});
      });
    });
    const syncPresent = syncKeys.some((k) => syncData[k] !== undefined);
    if (syncPresent) {
      await new Promise((resolve) => {
        chrome.storage.sync.remove(syncKeys, () => {
          void chrome.runtime.lastError; // non-critical
          resolve();
        });
      });
    }

    const localKeys = ["remoteTier2Rules", "remoteTier2Meta", "remoteTier2VersionFloor"];
    const localData = await new Promise((resolve) => {
      chrome.storage.local.get(localKeys, (result) => {
        void chrome.runtime.lastError; // non-critical
        resolve(result || {});
      });
    });
    const localPresent = localKeys.some((k) => localData[k] !== undefined);
    if (localPresent) {
      await new Promise((resolve) => {
        chrome.storage.local.remove(localKeys, () => {
          void chrome.runtime.lastError; // non-critical
          resolve();
        });
      });
    }
  } catch {
    // Migration is best-effort — a failure here must never break startup.
  }
}

/**
 * One-time migration (browsewrap Phase 2, shortener click/hover split):
 * replaces the single `followShortenersEnabled` pref with two independently
 * gated prefs — `resolveShortenersOnClick` (new default true) and
 * `resolveShortenersOnHover` (new default false, opt-in) — then removes the
 * retired key. Safe to call on every startup.
 *
 * Maps the user's EXPLICIT prior intent, using a bare read (no default) to
 * distinguish "explicitly stored" from "never stored" — the same
 * explicit-vs-auto-default detection prefs.js's getPrefs() used to perform
 * for the now-retired browser-aware default:
 *   - explicitly `true`  → the user had opted into shortener resolution;
 *     preserve that intent on BOTH new prefs (click AND hover become true).
 *   - explicitly `false` → the user had explicitly opted out; preserve that
 *     on both (click AND hover become false).
 *   - never stored (the old browser-computed auto-default only, which is
 *     indistinguishable from "absent" in storage) → nothing to preserve;
 *     no write — the new prefs' own defaults (click true, hover false)
 *     simply apply.
 *
 * Read-first, write-only-if-needed (mirrors migrateLegacyProxyPref): the old
 * key is removed unconditionally once present; a write to the new keys only
 * happens for the two explicit branches above.
 *
 * Fail-safe: wrapped in try/catch — a storage error must never throw out to
 * the caller or break startup.
 */
export async function migrateFollowShortenersSplit() {
  try {
    const data = await new Promise((resolve, reject) =>
      chrome.storage.sync.get({ followShortenersEnabled: null }, (result) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(result);
      })
    ).catch(() => ({ followShortenersEnabled: null }));

    if (data.followShortenersEnabled === null) return; // never explicitly stored — nothing to migrate

    const updates = {};
    if (data.followShortenersEnabled === true) {
      updates.resolveShortenersOnClick = true;
      updates.resolveShortenersOnHover = true;
    } else if (data.followShortenersEnabled === false) {
      updates.resolveShortenersOnClick = false;
      updates.resolveShortenersOnHover = false;
    }
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
      chrome.storage.sync.remove("followShortenersEnabled", () => {
        void chrome.runtime.lastError; // non-critical
        resolve();
      })
    );
  } catch {
    // Migration is best-effort — a failure here must never break startup.
  }
}
