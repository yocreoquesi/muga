/**
 * MUGA: Onboarding creator-affiliate choice (#1503)
 *
 * Users did not know MUGA keeps creators' affiliate tags by default, so a kept
 * tag read as a bug (#1502). Onboarding now shows the choice explicitly, with
 * "keep" preselected and "remove them too" one click away.
 *
 * The choice is a VIEW over the existing `stripAllAffiliates` pref, not a new
 * one: keep = false (the shipped default), remove = true. It writes through
 * the same `setPrefs` path as the Settings toggle (options.js bindToggle), so
 * both surfaces stay one source of truth. `stripAllAffiliates` is not in
 * GUARDED_PREFS (synced-affiliate-pref-guard.js), so there is no per-device
 * override to reconcile, exactly as in Settings.
 *
 * Nothing is written on load. An existing user (or a new device that already
 * received a synced value) sees their current value preselected, and the pref
 * only changes when the user actually picks the other option. That is what
 * keeps this free of migrations and re-prompts.
 *
 * Kept DOM-free (inputs and storage are injected) so the wiring is unit-tested
 * in Node; onboarding.js only passes the real elements and prefs functions.
 */

/** Choice value for "keep creators' affiliate tags" (stripAllAffiliates:false). */
export const AFFILIATE_CHOICE_KEEP = "keep";
/** Choice value for "remove them too" (stripAllAffiliates:true). */
export const AFFILIATE_CHOICE_REMOVE = "remove";

/**
 * Maps stored prefs to the onboarding choice. Only an explicit boolean `true`
 * means remove; anything else (missing, default, malformed) is the shipped
 * default, keep.
 *
 * @param {object|null|undefined} prefs - Merged prefs (PREF_DEFAULTS shape).
 * @returns {"keep"|"remove"} The choice to preselect.
 */
export function affiliateChoiceFromPrefs(prefs) {
  return prefs?.stripAllAffiliates === true ? AFFILIATE_CHOICE_REMOVE : AFFILIATE_CHOICE_KEEP;
}

/**
 * Maps an onboarding choice to the prefs patch it writes.
 *
 * @param {string} choice - AFFILIATE_CHOICE_KEEP or AFFILIATE_CHOICE_REMOVE.
 * @returns {{stripAllAffiliates: boolean}|null} The patch, or null for an
 *   unknown choice (which must never write anything).
 */
export function prefsPatchForAffiliateChoice(choice) {
  if (choice === AFFILIATE_CHOICE_KEEP) return { stripAllAffiliates: false };
  if (choice === AFFILIATE_CHOICE_REMOVE) return { stripAllAffiliates: true };
  return null;
}

/**
 * Wires the keep/remove radios to `stripAllAffiliates`.
 *
 * Listeners are attached BEFORE the prefs read so a click that lands while the
 * read is in flight is saved, and the late read never overrides it. A failed
 * write reverts the radios to the last stored choice and reveals `errorEl`.
 *
 * @param {object} args
 * @param {{checked: boolean, value: string, addEventListener: Function}} args.keepInput
 * @param {{checked: boolean, value: string, addEventListener: Function}} args.removeInput
 * @param {{hidden: boolean}|null} [args.errorEl] - Inline save-error message.
 * @param {() => Promise<object>} args.readPrefs - e.g. prefs.js getPrefs.
 * @param {(patch: object) => Promise<boolean>} args.writePrefs - e.g. prefs.js
 *   setPrefs, which resolves false (never throws) on a storage failure.
 * @returns {Promise<void>} Resolves once the stored choice has been applied.
 */
export async function bindAffiliateChoice({ keepInput, removeInput, errorEl = null, readPrefs, writePrefs }) {
  // The HTML ships with keep checked, which matches the default, so the page
  // is correct even before (or without) the read below. `stored` stays null
  // until the read lands: a click before that cannot know the stored value,
  // so it always writes rather than risk skipping a real change.
  let stored = null;
  let userInteracted = false;

  const applyChoice = (choice) => {
    keepInput.checked = choice === AFFILIATE_CHOICE_KEEP;
    removeInput.checked = choice === AFFILIATE_CHOICE_REMOVE;
  };

  const onChange = async (input) => {
    if (!input.checked) return;
    userInteracted = true;
    const patch = prefsPatchForAffiliateChoice(input.value);
    if (!patch || input.value === stored) return;
    let ok = false;
    try {
      ok = await writePrefs(patch);
    } catch (err) {
      console.error("[MUGA] onboarding affiliate choice:", err);
    }
    if (ok) {
      stored = input.value;
      if (errorEl) errorEl.hidden = true;
    } else {
      applyChoice(stored ?? AFFILIATE_CHOICE_KEEP);
      if (errorEl) errorEl.hidden = false;
    }
  };

  keepInput.addEventListener("change", () => onChange(keepInput));
  removeInput.addEventListener("change", () => onChange(removeInput));

  let prefs = null;
  try {
    prefs = await readPrefs();
  } catch (err) {
    console.error("[MUGA] onboarding affiliate choice read:", err);
  }
  if (userInteracted) return;
  stored = affiliateChoiceFromPrefs(prefs);
  applyChoice(stored);
}
