/**
 * MUGA: Migration Spec
 *
 * Append-only declarative list of all known pref-default migrations. Each
 * entry describes a moment where a user-observable preference default
 * changed between two extension versions, and what banner the user should
 * see post-upgrade so they can opt in or decline explicitly.
 *
 * **Append-only invariant**: never delete or edit a published entry. Once
 * shipped in a release, an entry must remain readable so a user upgrading
 * across many versions encounters a coherent history of decisions. To
 * supersede a past migration, append a new entry — do not mutate the old.
 *
 * The list ships empty. Future additions land here as the project flips
 * pref defaults — e.g. a migration entry for `remoteRulesEnabled` (flipped
 * from off to on by default in #888, now that the signing infrastructure is
 * stable) would belong here if existing installs need an explicit upgrade
 * banner rather than silently inheriting the new default.
 *
 * Entry shape (all fields required unless noted):
 *
 *   id              — stable string identifier, unique across the spec.
 *   fromVersion     — semver-like "x.y.z" of the LAST version where the
 *                     prior default was authoritative.
 *   toVersion       — semver-like "x.y.z" introducing the new default.
 *                     The migration fires when the user upgrades from a
 *                     version <= fromVersion to a version >= toVersion.
 *   prefs           — array of pref keys the migration touches.
 *   proposedValue   — object mapping pref keys to their new accepted value.
 *                     Applied verbatim on user accept.
 *   networkRelated  — boolean. If true, the static schema test requires
 *                     bannerCopyKey to be non-empty (silent migration of
 *                     network-related prefs is forbidden by policy).
 *   bannerCopyKey   — i18n key for the banner copy. Required when
 *                     networkRelated is true; may be empty otherwise.
 *
 * @type {ReadonlyArray<{
 *   id: string,
 *   fromVersion: string,
 *   toVersion: string,
 *   prefs: string[],
 *   proposedValue: Record<string, unknown>,
 *   networkRelated: boolean,
 *   bannerCopyKey: string,
 * }>}
 */
export const MIGRATIONS = Object.freeze([]);
