/**
 * MUGA: Onboarding creator-affiliate choice (#1503)
 *
 * Onboarding shows the creator-affiliate choice explicitly: "keep" is
 * preselected, "remove them too" is one click away, and the choice writes the
 * EXISTING `stripAllAffiliates` pref through the same `setPrefs` path the
 * Settings toggle uses. No new pref, no migration: an existing value is shown
 * as-is and never overwritten unless the user actually changes the choice.
 *
 * The wiring lives in src/lib/onboarding-affiliate-choice.js so it can be
 * driven here with plain fake inputs (onboarding.js itself is browser-only).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  AFFILIATE_CHOICE_KEEP,
  AFFILIATE_CHOICE_REMOVE,
  affiliateChoiceFromPrefs,
  prefsPatchForAffiliateChoice,
  bindAffiliateChoice,
} from "../../src/lib/onboarding-affiliate-choice.js";
import { PREF_DEFAULTS } from "../../src/lib/prefs.js";

// ── Fakes ─────────────────────────────────────────────────────────────────

/** Minimal radio input: checked/value plus addEventListener("change"). */
function fakeRadio(value, checked = false) {
  const listeners = [];
  return {
    value,
    checked,
    addEventListener(type, fn) { if (type === "change") listeners.push(fn); },
    /** Simulates the user clicking this radio: the browser unchecks the sibling. */
    async click(sibling) {
      this.checked = true;
      if (sibling) sibling.checked = false;
      for (const fn of listeners) await fn();
    },
  };
}

function setup({ prefs = { ...PREF_DEFAULTS }, writeResult = true, readThrows = false } = {}) {
  const keepInput = fakeRadio(AFFILIATE_CHOICE_KEEP, true); // HTML default
  const removeInput = fakeRadio(AFFILIATE_CHOICE_REMOVE, false);
  const errorEl = { hidden: true };
  const writes = [];
  const binding = bindAffiliateChoice({
    keepInput,
    removeInput,
    errorEl,
    readPrefs: async () => {
      if (readThrows) throw new Error("storage unavailable");
      return prefs;
    },
    writePrefs: async (patch) => { writes.push(patch); return writeResult; },
  });
  return { keepInput, removeInput, errorEl, writes, binding };
}

// ── Pure mapping ──────────────────────────────────────────────────────────

describe("#1503 — affiliate choice mapping", () => {
  test("the shipped default keeps creator tags (stripAllAffiliates stays false)", () => {
    assert.equal(PREF_DEFAULTS.stripAllAffiliates, false);
    assert.equal(affiliateChoiceFromPrefs(PREF_DEFAULTS), AFFILIATE_CHOICE_KEEP);
  });

  test("only an explicit stripAllAffiliates:true maps to remove", () => {
    assert.equal(affiliateChoiceFromPrefs({ stripAllAffiliates: true }), AFFILIATE_CHOICE_REMOVE);
    assert.equal(affiliateChoiceFromPrefs({ stripAllAffiliates: false }), AFFILIATE_CHOICE_KEEP);
    assert.equal(affiliateChoiceFromPrefs({}), AFFILIATE_CHOICE_KEEP);
    assert.equal(affiliateChoiceFromPrefs(null), AFFILIATE_CHOICE_KEEP);
    assert.equal(affiliateChoiceFromPrefs({ stripAllAffiliates: "true" }), AFFILIATE_CHOICE_KEEP);
  });

  test("each choice writes only the existing stripAllAffiliates pref", () => {
    assert.deepEqual(prefsPatchForAffiliateChoice(AFFILIATE_CHOICE_KEEP), { stripAllAffiliates: false });
    assert.deepEqual(prefsPatchForAffiliateChoice(AFFILIATE_CHOICE_REMOVE), { stripAllAffiliates: true });
  });

  test("an unknown choice produces no write", () => {
    assert.equal(prefsPatchForAffiliateChoice("bogus"), null);
    assert.equal(prefsPatchForAffiliateChoice(undefined), null);
  });
});

// ── Wiring ────────────────────────────────────────────────────────────────

describe("#1503 — onboarding affiliate choice wiring", () => {
  test("fresh install: keep is preselected and nothing is written on load", async () => {
    const { keepInput, removeInput, writes, binding } = setup();
    await binding;
    assert.equal(keepInput.checked, true);
    assert.equal(removeInput.checked, false);
    assert.deepEqual(writes, []);
  });

  test("choosing remove persists stripAllAffiliates:true in one click", async () => {
    const { keepInput, removeInput, writes, binding } = setup();
    await binding;
    await removeInput.click(keepInput);
    assert.deepEqual(writes, [{ stripAllAffiliates: true }]);
  });

  test("switching back to keep persists stripAllAffiliates:false", async () => {
    const { keepInput, removeInput, writes, binding } = setup();
    await binding;
    await removeInput.click(keepInput);
    await keepInput.click(removeInput);
    assert.deepEqual(writes, [{ stripAllAffiliates: true }, { stripAllAffiliates: false }]);
  });

  test("an existing stripAllAffiliates:true is shown as remove and never overwritten on load", async () => {
    const { keepInput, removeInput, writes, binding } = setup({
      prefs: { ...PREF_DEFAULTS, stripAllAffiliates: true },
    });
    await binding;
    assert.equal(removeInput.checked, true);
    assert.equal(keepInput.checked, false);
    assert.deepEqual(writes, []);
  });

  test("a failed write reverts the selection and reveals the error", async () => {
    const { keepInput, removeInput, errorEl, writes, binding } = setup({ writeResult: false });
    await binding;
    await removeInput.click(keepInput);
    assert.deepEqual(writes, [{ stripAllAffiliates: true }]);
    assert.equal(keepInput.checked, true, "selection must revert to the stored value");
    assert.equal(removeInput.checked, false);
    assert.equal(errorEl.hidden, false);
  });

  test("a later successful write hides the error again", async () => {
    let result = false;
    const keepInput = fakeRadio(AFFILIATE_CHOICE_KEEP, true);
    const removeInput = fakeRadio(AFFILIATE_CHOICE_REMOVE, false);
    const errorEl = { hidden: true };
    await bindAffiliateChoice({
      keepInput, removeInput, errorEl,
      readPrefs: async () => ({ ...PREF_DEFAULTS }),
      writePrefs: async () => result,
    });
    await removeInput.click(keepInput);
    assert.equal(errorEl.hidden, false);
    result = true;
    await removeInput.click(keepInput);
    assert.equal(errorEl.hidden, true);
    assert.equal(removeInput.checked, true);
  });

  test("a failed prefs read falls back to keep without writing", async () => {
    const { keepInput, removeInput, writes, binding } = setup({ readThrows: true });
    await binding;
    assert.equal(keepInput.checked, true);
    assert.equal(removeInput.checked, false);
    assert.deepEqual(writes, []);
  });

  test("a click that lands before the prefs read resolves is not overridden by it", async () => {
    let releaseRead;
    const keepInput = fakeRadio(AFFILIATE_CHOICE_KEEP, true);
    const removeInput = fakeRadio(AFFILIATE_CHOICE_REMOVE, false);
    const writes = [];
    const binding = bindAffiliateChoice({
      keepInput, removeInput, errorEl: { hidden: true },
      readPrefs: () => new Promise((resolve) => { releaseRead = resolve; }),
      writePrefs: async (patch) => { writes.push(patch); return true; },
    });
    await removeInput.click(keepInput);
    releaseRead({ ...PREF_DEFAULTS });
    await binding;
    assert.equal(removeInput.checked, true, "the user's click wins over the late read");
    assert.deepEqual(writes, [{ stripAllAffiliates: true }]);
  });

  test("an early click on keep still writes when the stored value turns out to be remove", async () => {
    let releaseRead;
    const keepInput = fakeRadio(AFFILIATE_CHOICE_KEEP, false);
    const removeInput = fakeRadio(AFFILIATE_CHOICE_REMOVE, true);
    const writes = [];
    const binding = bindAffiliateChoice({
      keepInput, removeInput, errorEl: { hidden: true },
      readPrefs: () => new Promise((resolve) => { releaseRead = resolve; }),
      writePrefs: async (patch) => { writes.push(patch); return true; },
    });
    await keepInput.click(removeInput);
    releaseRead({ ...PREF_DEFAULTS, stripAllAffiliates: true });
    await binding;
    assert.equal(keepInput.checked, true);
    assert.deepEqual(writes, [{ stripAllAffiliates: false }], "an unknown stored value must never skip the write");
  });
});
