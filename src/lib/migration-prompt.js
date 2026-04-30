/**
 * MUGA: Migration Prompt (#369)
 *
 * Wires the popup's migration-banner DOM elements to the migration
 * evaluator + storage. Reads the user's previous and current versions
 * + responses + prefs, evaluates pending migrations, and renders the
 * **first** pending migration as a banner. Multiple pending migrations
 * surface one at a time across popup opens (with a "1 of N" indicator).
 *
 * The user has three actions:
 *   accept  — applies the proposed pref change, records 'accept'.
 *   decline — leaves the pref unchanged, records 'decline'.
 *   dismiss — leaves the pref unchanged, records 'dismiss'. Treated as
 *             "not now"; the banner does not re-show within the same
 *             upgrade window.
 *
 * Banner copy is sourced via i18n. Each MigrationSpec entry's
 * `bannerCopyKey` is treated as a *prefix*: the title comes from
 * `<key>_title`, the body from `<key>_body`. This keeps the i18n
 * map keyed cleanly by string and avoids embedding HTML or JSON
 * blobs in translation values.
 */

import { evaluateMigrations } from "./migration-evaluator.js";
import { recordResponse, getAllResponses } from "./migration-storage.js";

/**
 * Mounts the prompt onto the popup's DOM elements. Returns a control
 * object with `refresh()` so the caller can re-render after external
 * changes (e.g. settings page modified a pref while popup is open).
 *
 * @param {object} args
 * @param {HTMLElement} args.root - The .migration-banner element.
 * @param {HTMLElement} args.titleEl
 * @param {HTMLElement} args.bodyEl
 * @param {HTMLElement} args.acceptBtn
 * @param {HTMLElement} args.declineBtn
 * @param {HTMLElement} args.dismissBtn
 * @param {HTMLElement} args.counterEl
 * @param {() => Promise<{previousVersion:string, currentVersion:string, prefs:object}>} args.readState
 *   - Returns the version pair + current prefs needed to evaluate.
 * @param {(prefs:object) => Promise<void>} args.applyPrefs
 *   - Applies the proposed pref change on accept.
 * @param {(key:string) => string} args.t - i18n lookup.
 * @returns {{ refresh: () => Promise<void> }}
 */
export function createMigrationPrompt({
  root,
  titleEl,
  bodyEl,
  acceptBtn,
  declineBtn,
  dismissBtn,
  counterEl,
  readState,
  applyPrefs,
  t,
  migrations,  // optional override; defaults to MIGRATIONS via evaluateMigrations
}) {
  // The migration currently being shown. Updated on every refresh.
  let active = null;

  function hide() {
    if (root) root.hidden = true;
    active = null;
  }

  function render(migration, totalPending) {
    if (!root || !migration) { hide(); return; }
    active = migration;
    const titleKey = migration.bannerCopyKey ? `${migration.bannerCopyKey}_title` : "";
    const bodyKey  = migration.bannerCopyKey ? `${migration.bannerCopyKey}_body`  : "";
    titleEl.textContent = titleKey ? t(titleKey) : "";
    bodyEl.textContent  = bodyKey  ? t(bodyKey)  : "";
    if (counterEl) {
      if (totalPending > 1) {
        counterEl.hidden = false;
        counterEl.textContent = t("migration_counter").replace("{n}", "1").replace("{total}", String(totalPending));
      } else {
        counterEl.hidden = true;
      }
    }
    root.hidden = false;
  }

  async function refresh() {
    try {
      const state = await readState();
      const responses = await getAllResponses();
      const pending = evaluateMigrations({
        previousVersion: state.previousVersion,
        currentVersion: state.currentVersion,
        responses,
        prefs: state.prefs,
        ...(migrations ? { migrations } : {}),
      });
      if (pending.length === 0) { hide(); return; }
      render(pending[0], pending.length);
    } catch (err) {
      console.error("[MUGA] migration-prompt.refresh:", err);
      hide();
    }
  }

  async function handleAccept() {
    if (!active) return;
    try {
      await applyPrefs(active.proposedValue);
      await recordResponse(active.id, "accept");
    } catch (err) {
      console.error("[MUGA] migration-prompt.accept:", err);
    }
    await refresh();
  }

  async function handleDecline() {
    if (!active) return;
    try {
      await recordResponse(active.id, "decline");
    } catch (err) {
      console.error("[MUGA] migration-prompt.decline:", err);
    }
    await refresh();
  }

  async function handleDismiss() {
    if (!active) return;
    try {
      await recordResponse(active.id, "dismiss");
    } catch (err) {
      console.error("[MUGA] migration-prompt.dismiss:", err);
    }
    // Dismiss = "not now". Hide the banner and do NOT re-show others
    // in this upgrade window. refresh() would re-evaluate and surface
    // the next pending migration; we hide instead.
    hide();
  }

  if (acceptBtn)  acceptBtn.addEventListener("click", handleAccept);
  if (declineBtn) declineBtn.addEventListener("click", handleDecline);
  if (dismissBtn) dismissBtn.addEventListener("click", handleDismiss);

  return { refresh };
}
