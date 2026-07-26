/**
 * MUGA: Cookie Consent Minimizer — Tier 2 toggle-reject save invariant
 * (cookie-consent-toggle-reject, PR 1 — safety core, INERT this PR)
 *
 * Pure, DOM-free module. NOT loaded as a content script — see AGENTS.md
 * (content scripts cannot use ES module imports). Hand-copied, byte-for-byte
 * modulo indentation, into src/content/cookie-noise.js under a
 * `@sync:cmp-tier2-save-invariant` block, kept in sync by
 * tests/unit/cookie-noise-sync.test.mjs — same pattern as
 * `@sync:cmp-tier2-veto`'s copy of src/lib/cmp-tier2-veto.js.
 *
 * ── PR 1 scope: ZERO CMP wiring ─────────────────────────────────────────────
 *
 * This file is created but NOT called anywhere yet — no dispatcher wiring,
 * no rule uses a `toggleScope` field, so this PR is BEHAVIOR-INERT (see
 * design.md's "PR 1 — safety core (inert)" migration entry). It exists so
 * the safety math (the invariant that must hold before any Save click is
 * ever permitted) is reviewable and adversarially unit-tested BEFORE any DOM
 * actuation code exists to call it.
 *
 * ── The two exported primitives ─────────────────────────────────────────────
 *
 * `computeSaveInvariant` decides whether it is safe to click a neutral
 * "Save"/"Speichern" control after a reject-only toggle sweep: satisfied
 * IFF every non-locked toggle in scope is verified OFF, at least one
 * locked/necessary toggle is present (the CMP's "essential" category),
 * and a CMP-selector-INDEPENDENT backstop scan of the panel found zero
 * still-checked standard controls outside the locked set. Any unreadable,
 * empty, or malformed input fails CLOSED (unsatisfied) — this function
 * NEVER throws.
 *
 * `planToggleActuation` is the pure decision half of the reject-only sweep:
 * given a toggle readout, it returns ONLY the indices that must be forced
 * OFF. There is no "on"/enable action this planner is capable of expressing
 * — by construction, not by convention: the returned array is a list of
 * force-off targets, full stop, so a future edit cannot smuggle in an
 * enable path without changing this function's entire return contract (and
 * every call site that consumes it). The locked/necessary toggle is never
 * included in the plan.
 *
 * @typedef {object} ToggleReadoutEntry
 * @property {boolean} [locked] - true for the CMP's necessary/locked
 *   category (matched by the rule's `lockedOn` selector) — excluded from
 *   both the off-check and the actuation plan.
 * @property {boolean} [checked] - the toggle's current on/off state.
 * @property {boolean} [readable] - false when the DOM read of this toggle's
 *   state failed or was ambiguous; treated as unreadable regardless of
 *   `checked`'s value.
 *
 * @typedef {object} SaveInvariantResult
 * @property {boolean} satisfied
 * @property {string} reason - one of "ok", "unreadable-toggle",
 *   "toggle-still-on", "backstop-checked", "empty-scope", "no-locked".
 */

// @sync:cmp-tier2-save-invariant:start

/**
 * Fail-closed gate for the Save click: re-verifies the post-sweep state of
 * every in-scope toggle PLUS a CMP-selector-independent backstop scan,
 * instead of trusting the sweep's own actuation result. See the file
 * docblock for the full contract. Pure; never throws.
 *
 * Evaluated strictly in this order — first failing check returns:
 *   1. `toggleReadout` is not an array -> unsatisfied ("unreadable-toggle").
 *   2. `toggleReadout` is an empty array -> unsatisfied ("empty-scope").
 *   3. Any entry is not a well-formed object -> unsatisfied
 *      ("unreadable-toggle").
 *   4. Any non-locked entry has `readable !== true` -> unsatisfied
 *      ("unreadable-toggle").
 *   5. Any non-locked entry has `checked !== false` -> unsatisfied
 *      ("toggle-still-on").
 *   6. No entry in scope has `locked === true` -> unsatisfied ("no-locked").
 *   7. `backstopCheckedCount` is not the exact numeric value `0` -> a
 *      non-zero, non-numeric, or non-finite value all fail CLOSED
 *      ("backstop-checked").
 *   8. Otherwise -> satisfied ("ok").
 * @param {Array<ToggleReadoutEntry>} toggleReadout
 * @param {number} backstopCheckedCount
 * @returns {SaveInvariantResult}
 */
function computeSaveInvariant(toggleReadout, backstopCheckedCount) {
  if (!Array.isArray(toggleReadout)) return { satisfied: false, reason: "unreadable-toggle" };
  if (toggleReadout.length === 0) return { satisfied: false, reason: "empty-scope" };

  let hasLocked = false;
  for (const entry of toggleReadout) {
    if (!entry || typeof entry !== "object") return { satisfied: false, reason: "unreadable-toggle" };
    if (entry.locked === true) {
      hasLocked = true;
      continue;
    }
    if (entry.readable !== true) return { satisfied: false, reason: "unreadable-toggle" };
    if (entry.checked !== false) return { satisfied: false, reason: "toggle-still-on" };
  }
  if (!hasLocked) return { satisfied: false, reason: "no-locked" };

  const backstopIsZero = typeof backstopCheckedCount === "number"
    && Number.isFinite(backstopCheckedCount)
    && backstopCheckedCount === 0;
  if (!backstopIsZero) return { satisfied: false, reason: "backstop-checked" };

  return { satisfied: true, reason: "ok" };
}

/**
 * Pure reject-only actuation planner: returns the indices of `toggleReadout`
 * entries that must be forced OFF. NEVER returns an index for a locked entry
 * and has NO representation for an "on"/enable action anywhere in its
 * return shape — an index in the returned array means exactly one thing,
 * "force this toggle off", so there is no code path here capable of
 * planning a toggle-toward-ON write. An entry already reading off
 * (`checked === false`) is omitted (no redundant write); an unreadable
 * entry is omitted too (the impure actuation layer cannot safely act on a
 * state it could not read — the unread toggle then surfaces as a
 * `computeSaveInvariant` failure downstream, never as a guessed write
 * here). Pure; never throws.
 * @param {Array<ToggleReadoutEntry>} toggleReadout
 * @returns {number[]} indices, within `toggleReadout`, to force OFF
 */
function planToggleActuation(toggleReadout) {
  const list = Array.isArray(toggleReadout) ? toggleReadout : [];
  const plan = [];
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    if (!entry || typeof entry !== "object") continue;
    if (entry.locked === true) continue;
    if (entry.readable !== true) continue;
    if (entry.checked === true) plan.push(i);
  }
  return plan;
}
// @sync:cmp-tier2-save-invariant:end

export { computeSaveInvariant, planToggleActuation };
