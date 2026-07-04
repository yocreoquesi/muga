/**
 * MUGA — Remote-rules changelog view-model (#984).
 *
 * Pure view-model for the weekly remote-rules changelog block that Settings
 * renders: "N parameters MUGA now cleans (added) / M it no longer cleans
 * (removed)". No DOM, no i18n table access: it takes a translate(key)->string
 * function so it is fully unit-testable. The caller (options.js) applies the
 * returned descriptor to the DOM.
 *
 * Why a separate module from the options glue: options.js is browser-only and
 * cannot be exercised under node:test, so the branching that decides HOW the
 * changelog is framed (first fetch vs. no changes vs. a real diff) lived
 * untested. Extracting it here mirrors the precedent set by
 * attribution-ledger-view.js and lets the tricky first-fetch framing be
 * locked down by unit tests.
 *
 * Framing intent: the FIRST fetch technically "adds" the entire rule set, but
 * surfacing "(+1400 / -0)" would misleadingly read as "1400 parameters added
 * this week". The first fetch is therefore framed as an initial rule set with
 * no "(+N / -M)" suffix.
 *
 * translate(key) must return the raw locale string (with any {n} token intact);
 * this module performs the {n} interpolation.
 *
 * @param {{ enabled?: boolean, changelog?: null | { addedCount?:number, removedCount?:number, added?:string[], removed?:string[], fetchedAt?:number|null, prevFetchedAt?:number|null } }} status
 * @param {(key:string)=>string} translate
 * @returns {{ visible:boolean, summary:string, empty:string|null, added:string[]|null, addedMore:string|null, removed:string[]|null, removedMore:string|null }}
 */
export function planChangelogView(status, translate) {
  const label = translate("optionsRemoteRulesChangelogLabel");

  const hidden = {
    visible: false,
    summary: label,
    empty: null,
    added: null,
    addedMore: null,
    removed: null,
    removedMore: null,
  };

  if (!status || !status.enabled || !status.changelog) {
    return hidden;
  }

  const changelog = status.changelog;
  const addedCount = typeof changelog.addedCount === "number" ? changelog.addedCount : 0;
  const removedCount = typeof changelog.removedCount === "number" ? changelog.removedCount : 0;
  const added = Array.isArray(changelog.added) ? changelog.added : [];
  const removed = Array.isArray(changelog.removed) ? changelog.removed : [];

  const firstFetch = changelog.prevFetchedAt == null;

  // FIRST FETCH: frame as the initial rule set, NOT "(+N / -M)".
  if (firstFetch && addedCount > 0) {
    return {
      visible: true,
      summary: label,
      empty: translate("optionsRemoteRulesChangelogInitial").replace(/\{n\}/g, String(addedCount)),
      added: null,
      addedMore: null,
      removed: null,
      removedMore: null,
    };
  }

  // NO CHANGES: either a first fetch that deduped down to nothing, or a later
  // fetch with an empty diff on both sides.
  if ((firstFetch && addedCount === 0) || (addedCount === 0 && removedCount === 0)) {
    return {
      visible: true,
      summary: label,
      empty: translate("optionsRemoteRulesChangelogNoChanges"),
      added: null,
      addedMore: null,
      removed: null,
      removedMore: null,
    };
  }

  // HAS CHANGES: a real weekly diff (prevFetchedAt set, at least one count > 0).
  const view = {
    visible: true,
    summary: label + " (+" + addedCount + " / -" + removedCount + ")",
    empty: null,
    added: null,
    addedMore: null,
    removed: null,
    removedMore: null,
  };

  if (addedCount > 0) {
    view.added = added;
    view.addedMore = addedCount > added.length
      ? translate("optionsRemoteRulesChangelogMore").replace(/\{n\}/g, String(addedCount - added.length))
      : null;
  }

  if (removedCount > 0) {
    view.removed = removed;
    view.removedMore = removedCount > removed.length
      ? translate("optionsRemoteRulesChangelogMore").replace(/\{n\}/g, String(removedCount - removed.length))
      : null;
  }

  return view;
}
