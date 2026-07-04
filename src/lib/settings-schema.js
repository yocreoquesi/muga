/**
 * MUGA: Settings export/import schema
 *
 * Single source of truth for the Settings export/import feature (#973
 * follow-up). Previously this logic was duplicated three ways inside
 * options.js: the export payload literal, the import BOOL_KEYS array, and
 * the per-key import validation branches. All three now derive from
 * SETTINGS_FIELDS below.
 *
 * Pure module: no chrome/DOM APIs, no side effects. The caller (options.js)
 * owns all storage reads/writes and the async shortener-permission check —
 * planImport() only decides WHAT should be saved, never performs the save.
 *
 * Regression coverage this module exists to protect (see
 * tests/unit/settings-schema.test.mjs):
 *   - #964: followShortenersEnabled must never be handed back in `toSave`.
 *     It is permission-gated and the permission check requires chrome APIs,
 *     so planImport only reports the raw request via `special`.
 *   - #965: guarded prefs (injectOwnAffiliate) must appear in `toSave` as
 *     plain booleans so options.js can run reconcileOverrideForExplicitChoice
 *     against them exactly as before.
 *   - #968: toastDuration/experimentalParamClassesEnabled/honorCreatorMode/
 *     creatorAllowlist must round-trip through export + import.
 */

import { isValidListEntry, isValidCustomParam, capImportedLists, IMPORT_LIST_CAPS } from "./validation.js";
import { addEntry as addCreatorAllowlistEntry } from "./creator-allowlist.js";
import { SUPPORTED_LANGS } from "./i18n.js";

/**
 * Schema version stamped onto every export from this build. Bumping this is
 * a no-op today (there are no migrations yet) but gives future imports a
 * `data.schemaVersion` to branch on via migrate() below.
 */
export const SETTINGS_SCHEMA_VERSION = 1;

/**
 * Discrete toast-duration values offered by the options UI. The persisted
 * pref is snapped to the nearest of these so the pref and the <select> can
 * never disagree — an imported/legacy value like 22 or 45 always maps to a
 * real <option> instead of leaving the control blank (#968).
 */
export const TOAST_DURATION_OPTIONS = Object.freeze([5, 10, 15, 30, 45, 60]);

/** Snaps an arbitrary duration to the nearest offered <option> value. */
export function snapToastDuration(n) {
  const v = Number.isFinite(n) ? n : 15;
  return TOAST_DURATION_OPTIONS.reduce((a, b) =>
    Math.abs(b - v) < Math.abs(a - v) ? b : a);
}

/**
 * Tracking-category keys accepted for `disabledCategories`. Kept as its own
 * literal set (not derived from TRACKING_PARAM_CATEGORIES in affiliates.js)
 * so this import allowlist cannot silently drift if that taxonomy changes
 * shape — it is a storage-schema concern, not a UI-taxonomy one.
 */
const VALID_CATEGORIES = new Set(["utm", "ads", "email", "social", "platform_noise", "generic"]);

/**
 * Ordered descriptor list for every user-settable pref the export/import
 * feature touches. This is the one place that conceptually replaces the
 * three scattered copies that used to live in options.js.
 *
 * `kind` values:
 *   - "boolean"         — plain boolean pref, imported via typeof-check only
 *   - "list"            — blacklist/whitelist/customParams, handled together
 *                          via capImportedLists (shared caps + validation)
 *   - "categories"       — disabledCategories, validated against VALID_CATEGORIES
 *   - "toastDuration"    — snapped via snapToastDuration
 *   - "language"        — validated against SUPPORTED_LANGS
 *   - "creatorAllowlist" — folded through addCreatorAllowlistEntry
 *   - "customRulesList"  — userCustomRules, filtered via isValidCustomParam + capped
 *   - "permissionGated"  — followShortenersEnabled / remoteRulesEnabled: each
 *                          requires an optional host-permission grant that
 *                          cannot happen inside this pure module, so they are
 *                          kept OUT of toSave and reported via `special` for
 *                          options.js to gate against chrome.permissions
 *   - "local"            — devMode: chrome.storage.local, not a synced pref
 *
 * `guarded: true` marks prefs that also appear in GUARDED_PREFS
 * (synced-affiliate-pref-guard.js) and therefore need per-device override
 * reconciliation on explicit import — informational here; the reconcile
 * loop itself stays in options.js and imports GUARDED_PREFS directly so
 * there is exactly one copy of that membership list.
 */
export const SETTINGS_FIELDS = Object.freeze([
  { key: "enabled", kind: "boolean" },
  { key: "injectOwnAffiliate", kind: "boolean", guarded: true },
  { key: "notifyForeignAffiliate", kind: "boolean" },
  { key: "stripAllAffiliates", kind: "boolean" },
  { key: "dnrEnabled", kind: "boolean" },
  { key: "blockPings", kind: "boolean" },
  { key: "ampRedirect", kind: "boolean" },
  { key: "unwrapRedirects", kind: "boolean" },
  { key: "blacklist", kind: "list" },
  { key: "whitelist", kind: "list" },
  { key: "customParams", kind: "list" },
  { key: "contextMenuEnabled", kind: "boolean" },
  { key: "disabledCategories", kind: "categories" },
  { key: "toastDuration", kind: "toastDuration" },
  { key: "language", kind: "language" },
  { key: "devMode", kind: "local" },
  { key: "paramBreakdown", kind: "boolean" },
  { key: "showReportButton", kind: "boolean" },
  { key: "domainStats", kind: "boolean" },
  { key: "showBadge", kind: "boolean" },
  { key: "followShortenersEnabled", kind: "permissionGated" },
  { key: "remoteRulesEnabled", kind: "permissionGated", guarded: true },
  { key: "canonicalExtractorEnabled", kind: "boolean" },
  { key: "crossSiteFrequencyEnabled", kind: "boolean" },
  { key: "attributionLedgerEnabled", kind: "boolean" },
  { key: "userCustomRules", kind: "customRulesList" },
  { key: "experimentalParamClassesEnabled", kind: "boolean" },
  { key: "honorCreatorMode", kind: "boolean" },
  { key: "creatorAllowlist", kind: "creatorAllowlist" },
]);

/**
 * Plain boolean pref keys (the 18-entry set formerly hardcoded as BOOL_KEYS
 * in options.js). Exported so options.js can reuse the exact same list for
 * the post-import GUARDED_PREFS reconcile loop instead of maintaining a
 * second copy.
 */
export const BOOLEAN_KEYS = Object.freeze(
  SETTINGS_FIELDS.filter((f) => f.kind === "boolean").map((f) => f.key),
);

/**
 * Migration seam for future schema versions. Currently a no-op: there is
 * exactly one schema version, and legacy files with no `schemaVersion` at
 * all must import exactly as they do today. Do NOT reject unknown/future
 * versions here — that is out of scope for this slice.
 *
 * @param {object} data - Parsed import payload.
 * @param {number|undefined} _fromVersion - data.schemaVersion, if present.
 * @returns {object} The (possibly transformed) data to validate/import.
 */
function migrate(data, _fromVersion) {
  return data;
}

/**
 * Builds the export payload from the current synced prefs. Pure: the
 * caller reads chrome.storage.sync + devMode + the manifest version and
 * passes them in.
 *
 * @param {object} prefs - Raw chrome.storage.sync.get(PREF_DEFAULTS) result.
 * @param {{devMode?: boolean, appVersion?: string}} [opts]
 * @returns {object} Flat export payload (same shape as before this refactor,
 *   plus `schemaVersion`).
 */
export function buildExportPayload(prefs, { devMode, appVersion } = {}) {
  const payload = {
    muga: true,
    version: appVersion,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
  };
  for (const field of SETTINGS_FIELDS) {
    payload[field.key] = field.kind === "local" ? devMode : prefs[field.key];
  }
  return payload;
}

/**
 * Validates and plans a Settings import. Pure and synchronous — never
 * touches chrome APIs. Anything that would throw/reject today (missing or
 * falsy `muga`, non-array/malformed lists) returns `{ ok: false }` so the
 * caller can show the same catch-all `import_error` toast as before.
 *
 * @param {*} data - Parsed JSON from the imported file.
 * @returns {object} `{ ok: false }` on failure, or `{ ok: true, toSave,
 *   special: { followShortenersRequested, devMode }, skipped }` on success.
 */
export function planImport(data) {
  if (!data || typeof data !== "object") return { ok: false };

  const migrated = migrate(data, data.schemaVersion);

  if (
    !migrated.muga ||
    !Array.isArray(migrated.blacklist) ||
    !Array.isArray(migrated.whitelist) ||
    !Array.isArray(migrated.customParams)
  ) {
    return { ok: false };
  }

  // Structural integrity only: a malformed blacklist/whitelist ENTRY signals
  // a corrupt or foreign file, so abort. Exceeding a size cap does NOT — see
  // capImportedLists below (#911).
  if (!migrated.blacklist.every(isValidListEntry) || !migrated.whitelist.every(isValidListEntry)) {
    return { ok: false };
  }

  const { blacklist, whitelist, customParams, droppedBlacklist, droppedWhitelist, skippedParams } =
    capImportedLists(migrated);
  const skipped = skippedParams + droppedBlacklist + droppedWhitelist;

  const toSave = { blacklist, whitelist, customParams };

  // devMode is device-local and followShortenersEnabled is permission-gated —
  // both are deliberately excluded from BOOLEAN_KEYS (see their `kind` above)
  // so this loop can never touch either.
  for (const key of BOOLEAN_KEYS) {
    if (typeof migrated[key] === "boolean") toSave[key] = migrated[key];
  }

  if (Array.isArray(migrated.disabledCategories) && migrated.disabledCategories.every((e) => VALID_CATEGORIES.has(e))) {
    toSave.disabledCategories = migrated.disabledCategories;
  }

  if (typeof migrated.toastDuration === "number") {
    toSave.toastDuration = snapToastDuration(migrated.toastDuration);
  }

  // #968: fold each imported creator-allowlist entry through the same pure
  // validator the add-box uses, so invalid entries, duplicates, and
  // anything past the cap are dropped exactly as a manual add would handle
  // them.
  if (Array.isArray(migrated.creatorAllowlist)) {
    toSave.creatorAllowlist = migrated.creatorAllowlist.reduce(
      (acc, entry) => addCreatorAllowlistEntry(acc, entry).list,
      [],
    );
  }

  // #925: userCustomRules — validate each entry as a bare param name and
  // cap at the customParams ceiling (same shape/limit the popup enforces).
  if (Array.isArray(migrated.userCustomRules)) {
    toSave.userCustomRules = migrated.userCustomRules
      .filter(isValidCustomParam)
      .slice(0, IMPORT_LIST_CAPS.customParams);
  }

  // Validate against the full SUPPORTED_LANGS list (not a hardcoded subset,
  // #729) so codes added later (fr/it/ja, #707) survive a round-trip.
  if (SUPPORTED_LANGS.some((l) => l.code === migrated.language)) {
    toSave.language = migrated.language;
  }

  return {
    ok: true,
    toSave,
    special: {
      // #964: the raw request only. Whether it actually lands as `true` on
      // save depends on chrome.permissions.contains(), which this pure
      // module cannot call — options.js resolves that and merges the
      // result into its own toSave before calling setPrefs().
      //
      // `followShortenersProvided` distinguishes "file carries the key as a
      // real boolean" (write it, gated) from "absent" (leave the stored value
      // untouched). options.js branches on THIS, not on the raw `data`, so the
      // decision stays derived from the migrated payload — if a future
      // migrate() rewrites the field, the gate follows it automatically.
      followShortenersProvided: typeof migrated.followShortenersEnabled === "boolean",
      followShortenersRequested: migrated.followShortenersEnabled === true,
      // remoteRulesEnabled is likewise permission-gated (optional host grant for
      // rules.muga.app) AND guarded (per-device override). options.js enables it
      // only when the grant is already present, then reconciles the override to
      // whatever value actually landed. Same provided/requested split as above.
      remoteRulesProvided: typeof migrated.remoteRulesEnabled === "boolean",
      remoteRulesRequested: migrated.remoteRulesEnabled === true,
      devMode: typeof migrated.devMode === "boolean" ? migrated.devMode : undefined,
    },
    skipped,
  };
}
