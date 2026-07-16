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
// migrateCookieConsentMode() needs the per-device onboarding-completed signal
// to distinguish existing users from fresh installs. consent-storage.js is a
// standalone leaf module (no imports of its own), so importing it here
// cannot create a cycle either.
import { getConsent } from "./consent-storage.js";

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
 * One-time migration (cookie-consent 3-state modes, Slice 1): converts the
 * legacy `cookieConsentMinimizerEnabled` boolean into the new
 * `cookieConsentMode` enum ("off" | "reject-only" | "accept-when-necessary")
 * plus the separate `cookieConsentAcceptConsented` hard-gate flag. Safe to
 * call on every startup; idempotent once `cookieConsentMode` is present.
 *
 * Keyed off the onboarding-completed signal (chrome.storage.local's
 * `mugaConsent.onboardingDone`, via consent-storage.js — NOT the sync-side
 * PREF_DEFAULTS.onboardingDone, which prefs.js overlays with this same local
 * value) to distinguish existing users from fresh installs:
 *
 *   - legacy `cookieConsentMinimizerEnabled === true` -> preserve the user's
 *     prior opt-in as the SAFE mode: `cookieConsentMode: "reject-only"`,
 *     `cookieConsentAcceptConsented: false`. NEVER auto-upgrades to accept.
 *   - legacy `=== false` or ABSENT, AND onboarding already completed
 *     (existing user) -> `cookieConsentMode: "off"`. Existing users are not
 *     force-enabled into a new capability; no re-consent event fires.
 *   - fresh install (onboarding not yet completed) -> writes nothing; the
 *     PREF_DEFAULTS default (`"reject-only"`) stands, disclosed via
 *     onboarding itself.
 *   - `cookieConsentMode` already present -> no-op (idempotent); the legacy
 *     key is left exactly as-is (it was already removed the run it migrated).
 *
 * The legacy key is deleted after a successful migration write (both the
 * true-legacy and existing-user branches). Fail-safe: wrapped in try/catch
 * — a storage error must never throw out to the caller or break startup.
 */
export async function migrateCookieConsentMode() {
  try {
    const syncData = await new Promise((resolve, reject) =>
      chrome.storage.sync.get(
        { cookieConsentMinimizerEnabled: null, cookieConsentMode: null },
        (result) => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(result);
        }
      )
    ).catch(() => ({ cookieConsentMinimizerEnabled: null, cookieConsentMode: null }));

    if (syncData.cookieConsentMode !== null) return; // already migrated — no-op

    const consent = await getConsent().catch(() => ({ onboardingDone: false }));
    const legacy = syncData.cookieConsentMinimizerEnabled;

    let updates = null;
    if (legacy === true) {
      // Preserve the user's opt-in as the safe mode — never auto-upgrade to accept.
      updates = { cookieConsentMode: "reject-only", cookieConsentAcceptConsented: false };
    } else if (consent.onboardingDone === true) {
      // Existing user (legacy false or absent) — stay off, no forced upgrade.
      updates = { cookieConsentMode: "off" };
    }
    // else: fresh install — write nothing, let the PREF_DEFAULTS default stand.

    if (!updates) return;

    await new Promise((resolve, reject) =>
      chrome.storage.sync.set(updates, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      })
    );

    await new Promise((resolve) =>
      chrome.storage.sync.remove("cookieConsentMinimizerEnabled", () => {
        void chrome.runtime.lastError; // non-critical
        resolve();
      })
    );
  } catch {
    // Migration is best-effort — a failure here must never break startup.
  }
}
