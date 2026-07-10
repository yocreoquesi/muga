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
  // `label` is an i18n key naming the pref for display purposes (currently
  // consumed by diffImport()'s import-diff-preview rows, #983). Wherever an
  // existing options.html row/section already names the pref, that exact
  // key is reused so the diff preview and the settings page never disagree
  // on wording — no new key was introduced unless nothing suitable existed.
  { key: "enabled", kind: "boolean", label: "toggle_enabled" },
  { key: "injectOwnAffiliate", kind: "boolean", guarded: true, label: "row_inject_label" },
  { key: "notifyForeignAffiliate", kind: "boolean", label: "row_notify_label" },
  { key: "stripAllAffiliates", kind: "boolean", label: "row_strip_affiliates_label" },
  { key: "dnrEnabled", kind: "boolean", label: "row_dnr_label" },
  { key: "activeDefenseEnabled", kind: "boolean", label: "row_active_defense_label" },
  { key: "blockPings", kind: "boolean", label: "row_pings_label" },
  { key: "ampRedirect", kind: "boolean", label: "row_amp_label" },
  { key: "unwrapRedirects", kind: "boolean", label: "row_unwrap_label" },
  { key: "blacklist", kind: "list", label: "section_blacklist" },
  { key: "whitelist", kind: "list", label: "section_whitelist" },
  { key: "customParams", kind: "list", label: "section_custom_params" },
  { key: "contextMenuEnabled", kind: "boolean", label: "row_context_menu_label" },
  { key: "disabledCategories", kind: "categories", label: "section_tracking_categories" },
  { key: "toastDuration", kind: "toastDuration", label: "row_toast_duration_label" },
  { key: "language", kind: "language", label: "lang_label" },
  { key: "devMode", kind: "local", label: "advanced_mode_label" },
  { key: "paramBreakdown", kind: "boolean", label: "row_param_breakdown_label" },
  { key: "showReportButton", kind: "boolean", label: "row_show_report_button_label" },
  { key: "domainStats", kind: "boolean", label: "row_domain_stats_label" },
  { key: "showBadge", kind: "boolean", label: "row_show_badge_label" },
  { key: "followShortenersEnabled", kind: "permissionGated", label: "follow_shorteners_section_title" },
  { key: "remoteRulesEnabled", kind: "permissionGated", guarded: true, label: "optionsRemoteRulesTitle" },
  { key: "canonicalExtractorEnabled", kind: "boolean", label: "row_canonical_extractor_label" },
  { key: "crossSiteFrequencyEnabled", kind: "boolean", label: "row_cross_site_frequency_label" },
  { key: "attributionLedgerEnabled", kind: "boolean", label: "row_attribution_ledger_label" },
  { key: "userCustomRules", kind: "customRulesList", label: "section_user_custom_rules" },
  { key: "experimentalParamClassesEnabled", kind: "boolean", label: "exp_param_classes_label" },
  { key: "honorCreatorMode", kind: "boolean", label: "honor_creator_mode_label" },
  { key: "creatorAllowlist", kind: "creatorAllowlist", label: "creator_allowlist_label" },
  // #1028: hoverPreviewDelayMs is deliberately NOT in SETTINGS_FIELDS — it
  // isn't a discrete-option control like toastDuration, so round-tripping it
  // through export/import would need its own clamp/validation branch. Out of
  // scope for now; the pref keeps its PREF_DEFAULTS value (2500ms) on import.
  // hoverPreviewEnabled is a plain boolean and round-trips normally via
  // BOOLEAN_KEYS.
  { key: "hoverPreviewEnabled", kind: "boolean", label: "row_hover_preview_label" },
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
 * Migration seam for schema versions and removed-syntax cleanup. Runs on the
 * import path before the structural validity check.
 *
 * #1053: the legacy `domain::disabled` per-site-pause blacklist syntax was
 * removed entirely (a domain is exempted ONLY via a domain-only whitelist
 * entry now). A pre-#1053 settings backup can still carry `domain::disabled`
 * entries, which isValidListEntry now rejects (all 2-part entries are
 * invalid) - and a single invalid entry aborts the whole import. Fold each
 * domain-only `::disabled` entry into a bare whitelist domain here, exactly
 * as the runtime migration migratePerSiteDisableToAllowlist() does for live
 * storage, so an imported legacy backup preserves the exemption intent
 * instead of failing the import. Keep the two implementations in sync.
 *
 * Legacy files with no `schemaVersion` still import as before. Do NOT reject
 * unknown/future versions here.
 *
 * @param {object} data - Parsed import payload.
 * @param {number|undefined} _fromVersion - data.schemaVersion, if present.
 * @returns {object} The (possibly transformed) data to validate/import.
 */
function migrate(data, _fromVersion) {
  if (
    !data || typeof data !== "object" ||
    !Array.isArray(data.blacklist) || !Array.isArray(data.whitelist)
  ) {
    return data;
  }

  const normalize = (d) => d.trim().replace(/^www\./, "").toLowerCase();
  const coversDomain = (host, entry) => {
    if (typeof entry !== "string" || entry.includes("::")) return false;
    const e = normalize(entry);
    return !!e && (host === e || host.endsWith("." + e));
  };

  const whitelist = data.whitelist.slice();
  const blacklist = [];
  let changed = false;

  for (const raw of data.blacklist) {
    if (typeof raw === "string") {
      const parts = raw.split("::");
      if (parts.length === 2 && parts[1].trim().toLowerCase() === "disabled") {
        // A per-site-disable marker: fold a valid domain into the allowlist
        // and drop the marker (an empty-domain "::disabled" is just dropped).
        changed = true;
        const domain = normalize(parts[0] || "");
        if (domain && !whitelist.some((w) => coversDomain(domain, w))) {
          whitelist.push(domain);
        }
        continue;
      }
    }
    blacklist.push(raw);
  }

  return changed ? { ...data, blacklist, whitelist } : data;
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

/**
 * `kind`s whose values are arrays compared as sets (order-insensitive).
 * Every other kind is treated as a scalar (see diffImport below).
 */
const LIST_KINDS = new Set(["list", "categories", "creatorAllowlist", "customRulesList"]);

/**
 * Builds a dry-run diff between the currently-effective settings and a
 * resolved set of incoming values, for the Settings import diff-preview
 * (#983). PURE: no chrome APIs, no DOM, no i18n resolution — the caller
 * (options.js) resolves `row.labelKey` via t() when rendering.
 *
 * Only fields present as a key in `incomingValues` are considered — this
 * lets the caller build `incomingValues` from an already fully-resolved
 * `toSave` (permission gates applied, devMode folded in) without diffImport
 * needing to know about any of that resolution logic itself.
 *
 * List-kind fields are compared as sets of strings: two lists with the same
 * entries in a different order produce NO row. `added`/`removed` are
 * returned FULL and uncapped — capping the displayed count is a rendering
 * concern, not a diffing one, and lives in options.js's showImportDiff().
 *
 * @param {object} currentValues - Effective current settings (e.g. from
 *   getPrefs() plus the current devMode), keyed by SETTINGS_FIELDS `key`.
 * @param {object} incomingValues - Resolved incoming settings (e.g. the
 *   post-permission-gate `toSave` plus the landed devMode), keyed the same way.
 * @returns {Array<
 *   { key: string, labelKey: string, kind: "scalar", before: *, after: * } |
 *   { key: string, labelKey: string, kind: "list", added: string[], removed: string[] }
 * >} Rows in SETTINGS_FIELDS declaration order. Empty array when nothing changed.
 */
export function diffImport(currentValues, incomingValues) {
  const current = currentValues || {};
  const incoming = incomingValues || {};
  /** @type {Array<{ key: string, labelKey: string, kind: "scalar", before: *, after: * } | { key: string, labelKey: string, kind: "list", added: string[], removed: string[] }>} */
  const rows = [];

  for (const field of SETTINGS_FIELDS) {
    const { key, kind, label } = field;
    if (!(key in incoming)) continue;

    const before = current[key];
    const after = incoming[key];

    if (LIST_KINDS.has(kind)) {
      const beforeArr = Array.isArray(before) ? before : [];
      const afterArr = Array.isArray(after) ? after : [];
      const beforeSet = new Set(beforeArr);
      const afterSet = new Set(afterArr);
      const added = afterArr.filter((entry) => !beforeSet.has(entry));
      const removed = beforeArr.filter((entry) => !afterSet.has(entry));
      if (added.length === 0 && removed.length === 0) continue;
      rows.push({ key, labelKey: label, kind: "list", added, removed });
      continue;
    }

    if (before === after) continue;
    rows.push({ key, labelKey: label, kind: "scalar", before, after });
  }

  return rows;
}
