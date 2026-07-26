/**
 * MUGA — Cookie Consent Minimizer: toggle-reject sweep shaping logic
 * (cookie-consent-toggle-reject, PR 2 / design.md ADR-2/ADR-3)
 *
 * content/cookie-noise.js cannot be imported as an ES module (content
 * scripts — see AGENTS.md), so `collectToggleStates` / `countCheckedControls`
 * / `tier2ActuateToggleOff` are exercised here via a PURE re-implementation
 * that mirrors production exactly, run against a small fake DOM (see
 * tests/unit/helpers/fake-dom.mjs) — same "pure re-implementation mirrors
 * cookie-noise.js" pattern already used by `makeTier2RemoteMergeHelper` in
 * tests/unit/cookie-noise-sync.test.mjs. Production is pinned to the SAME
 * shape by the structural guards in that file's "Tier 2 toggle-reject sweep
 * structural guards (PR 2)" describe block (source-text regex assertions:
 * exact write patterns, call ordering, one-shot guard).
 *
 * computeSaveInvariant/planToggleActuation themselves are the REAL, pure,
 * genuinely-importable exports from src/lib/cmp-tier2-save-invariant.js —
 * no mirror needed for those (already adversarially unit-tested in
 * tests/unit/cmp-tier2-save-invariant.test.mjs, PR 1).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeElement, FakeDocument } from "./helpers/fake-dom.mjs";
import { computeSaveInvariant, planToggleActuation } from "../../src/lib/cmp-tier2-save-invariant.js";

// ── Pure re-implementations mirroring cookie-noise.js's impure DOM helpers ──

function toggleKind(el) {
  const tag = typeof el.tagName === "string" ? el.tagName.toLowerCase() : "";
  const type = typeof el.getAttribute === "function" ? el.getAttribute("type") : null;
  if (tag === "input" && typeof type === "string" && type.toLowerCase() === "checkbox") return "checkbox";
  const role = typeof el.getAttribute === "function" ? el.getAttribute("role") : null;
  if (role === "switch" || role === "checkbox") return "aria";
  return "unknown";
}

function readToggleChecked(el, kind) {
  if (kind === "checkbox") return typeof el.checked === "boolean" ? el.checked : null;
  if (kind === "aria") {
    const v = el.getAttribute("aria-checked");
    if (v === "true") return true;
    if (v === "false") return false;
    return null;
  }
  return null;
}

function collectToggleStates(container, toggleSel, lockedOnSel) {
  const readout = [];
  if (!container) return readout;
  const nodes = container.querySelectorAll(toggleSel);
  for (const el of nodes) {
    const locked = typeof lockedOnSel === "string" && lockedOnSel.length > 0 && el.matches(lockedOnSel);
    const kind = toggleKind(el);
    const checked = readToggleChecked(el, kind);
    readout.push({ ref: el, kind, checked: checked === true, locked, readable: checked !== null });
  }
  return readout;
}

const STANDARD_CHECKED_SELECTOR =
  'input[type="checkbox"]:checked, [role="switch"][aria-checked="true"], [role="checkbox"][aria-checked="true"]';

function countCheckedControls(container, lockedOnSel) {
  if (!container) return Number.POSITIVE_INFINITY;
  const nodes = container.querySelectorAll(STANDARD_CHECKED_SELECTOR);
  let count = 0;
  for (const el of nodes) {
    const locked = typeof lockedOnSel === "string" && lockedOnSel.length > 0 && el.matches(lockedOnSel);
    if (!locked) count += 1;
  }
  return count;
}

/** ARIA click handler injection point: `onAriaClick(el)` simulates the
 * page's own JS reacting to a `.click()` call — the test controls whether
 * (and how) a toggle flips. */
function actuateToggleOff(readout, { onAriaClick } = {}) {
  const plan = planToggleActuation(readout);
  for (const idx of plan) {
    const entry = readout[idx];
    if (!entry || entry.locked === true) continue;
    if (entry.kind === "checkbox") {
      if (entry.ref.checked === true) entry.ref.checked = false;
    } else if (entry.kind === "aria") {
      if (typeof onAriaClick === "function") onAriaClick(entry.ref);
      else entry.ref.click();
    }
    const checked = readToggleChecked(entry.ref, entry.kind);
    entry.checked = checked === true;
    entry.readable = checked !== null;
  }
  return readout;
}

// ── Fixture builder ──────────────────────────────────────────────────────

function buildPanel({ toggles = [], includeLocked = true } = {}) {
  const doc = new FakeDocument();
  const panel = new FakeElement("div", { id: "panel", class: "cmp-panel" });
  doc.body.appendChild(panel);

  if (includeLocked) {
    const locked = new FakeElement("input", { type: "checkbox", checked: true, disabled: true, class: "toggle" });
    panel.appendChild(locked);
  }
  const els = toggles.map((t) => {
    const el = t.kind === "checkbox"
      ? new FakeElement("input", { type: "checkbox", checked: t.checked === true, class: "toggle" })
      : new FakeElement("div", { role: "switch", "aria-checked": t.checked === true ? "true" : "false", class: "toggle" });
    panel.appendChild(el);
    return el;
  });
  return { doc, panel, toggles: els };
}

const TOGGLE_SEL = ".toggle";
const LOCKED_SEL = "[disabled]";

// ── collectToggleStates ──────────────────────────────────────────────────

describe("collectToggleStates — readout shaping (mirrors cookie-noise.js)", () => {
  test("includes the locked entry in the readout (never excludes it)", () => {
    const { panel } = buildPanel({ toggles: [{ kind: "checkbox", checked: true }] });
    const readout = collectToggleStates(panel, TOGGLE_SEL, LOCKED_SEL);
    assert.equal(readout.length, 2, "locked entry + one non-locked toggle");
    assert.equal(readout.filter((e) => e.locked).length, 1);
  });

  test("classifies native input[type=checkbox] as kind 'checkbox' and reads .checked", () => {
    const { panel } = buildPanel({ toggles: [{ kind: "checkbox", checked: true }] });
    const readout = collectToggleStates(panel, TOGGLE_SEL, LOCKED_SEL);
    const entry = readout.find((e) => !e.locked);
    assert.equal(entry.kind, "checkbox");
    assert.equal(entry.checked, true);
    assert.equal(entry.readable, true);
  });

  test("classifies role=switch as kind 'aria' and reads aria-checked", () => {
    const { panel } = buildPanel({ toggles: [{ kind: "aria", checked: true }] });
    const readout = collectToggleStates(panel, TOGGLE_SEL, LOCKED_SEL);
    const entry = readout.find((e) => !e.locked);
    assert.equal(entry.kind, "aria");
    assert.equal(entry.checked, true);
    assert.equal(entry.readable, true);
  });

  test("an unknown widget kind (no type=checkbox, no role) reads back unreadable, never guessed", () => {
    const { panel } = buildPanel({ toggles: [] });
    const mystery = new FakeElement("div", { class: "toggle" }); // no role, not an input
    panel.appendChild(mystery);
    const readout = collectToggleStates(panel, TOGGLE_SEL, LOCKED_SEL);
    const entry = readout.find((e) => !e.locked);
    assert.equal(entry.readable, false);
    assert.equal(entry.checked, false, "unreadable entries default checked to false, never true");
  });

  test("a malformed aria-checked value (not the literal string 'true'/'false') reads back unreadable", () => {
    const { panel } = buildPanel({ toggles: [] });
    const weird = new FakeElement("div", { role: "switch", "aria-checked": "mixed", class: "toggle" });
    panel.appendChild(weird);
    const readout = collectToggleStates(panel, TOGGLE_SEL, LOCKED_SEL);
    const entry = readout.find((e) => !e.locked);
    assert.equal(entry.readable, false);
  });

  test("an absent/null container returns an empty readout, never throws", () => {
    assert.deepEqual(collectToggleStates(null, TOGGLE_SEL, LOCKED_SEL), []);
  });
});

// ── countCheckedControls (backstop) ──────────────────────────────────────

describe("countCheckedControls — CMP-selector-independent backstop (mirrors cookie-noise.js)", () => {
  test("returns 0 when every standard control is off (excluding locked)", () => {
    const { panel } = buildPanel({ toggles: [{ kind: "checkbox", checked: false }, { kind: "aria", checked: false }] });
    assert.equal(countCheckedControls(panel, LOCKED_SEL), 0);
  });

  test("counts a standard checked control the curated `toggle` selector never enumerated (defaulted-ON category the rule missed)", () => {
    const { panel } = buildPanel({ toggles: [] });
    // A checkbox WITHOUT the ".toggle" class — the curated toggle selector
    // (".toggle") would never see it, but the backstop's fixed selector
    // (independent of any rule field) still counts it.
    const missed = new FakeElement("input", { type: "checkbox", checked: true });
    panel.appendChild(missed);
    assert.equal(countCheckedControls(panel, LOCKED_SEL), 1);
  });

  test("excludes a checked control matching the lockedOn selector", () => {
    const { panel } = buildPanel({ toggles: [] }); // includeLocked default true, locked checkbox is checked:true
    assert.equal(countCheckedControls(panel, LOCKED_SEL), 0, "the locked/necessary control must not count toward the backstop");
  });

  test("counts a checked ARIA role=checkbox control too, not just role=switch", () => {
    const { panel } = buildPanel({ toggles: [] });
    const el = new FakeElement("div", { role: "checkbox", "aria-checked": "true" });
    panel.appendChild(el);
    assert.equal(countCheckedControls(panel, LOCKED_SEL), 1);
  });

  test("an absent/null container fails CLOSED (non-zero, non-finite sentinel), never a silent 0", () => {
    const count = countCheckedControls(null, LOCKED_SEL);
    assert.equal(Number.isFinite(count), false);
    assert.notEqual(count, 0);
  });
});

// ── tier2ActuateToggleOff (reject-only actuation) ────────────────────────

describe("actuateToggleOff — reject-only, monotone-toward-denial (mirrors cookie-noise.js)", () => {
  test("a native checkbox that reads ON is forced to .checked = false", () => {
    const { panel } = buildPanel({ toggles: [{ kind: "checkbox", checked: true }] });
    const readout = collectToggleStates(panel, TOGGLE_SEL, LOCKED_SEL);
    actuateToggleOff(readout);
    const entry = readout.find((e) => !e.locked);
    assert.equal(entry.ref.checked, false);
    assert.equal(entry.checked, false);
    assert.equal(entry.readable, true);
  });

  test("a native checkbox already OFF is left untouched (no redundant write, not planned for actuation)", () => {
    const { panel } = buildPanel({ toggles: [{ kind: "checkbox", checked: false }] });
    const readout = collectToggleStates(panel, TOGGLE_SEL, LOCKED_SEL);
    const nonLockedIdx = readout.findIndex((e) => !e.locked);
    assert.equal(planToggleActuation(readout).includes(nonLockedIdx), false,
      "an already-off entry must not be in the actuation plan at all");
    actuateToggleOff(readout);
    const entry = readout.find((e) => !e.locked);
    assert.equal(entry.ref.checked, false);
  });

  test("an ARIA toggle that flips to false on .click() reads back off and readable", () => {
    const { panel } = buildPanel({ toggles: [{ kind: "aria", checked: true }] });
    const readout = collectToggleStates(panel, TOGGLE_SEL, LOCKED_SEL);
    actuateToggleOff(readout, {
      onAriaClick: (el) => el.setAttribute("aria-checked", "false"), // simulates the page's own JS flipping it
    });
    const entry = readout.find((e) => !e.locked);
    assert.equal(entry.checked, false);
    assert.equal(entry.readable, true);
  });

  test("an ARIA toggle that does NOT flip on .click() (stuck/hostile page) is left as still-on — no second click, no forced write", () => {
    const { panel } = buildPanel({ toggles: [{ kind: "aria", checked: true }] });
    const readout = collectToggleStates(panel, TOGGLE_SEL, LOCKED_SEL);
    let clickCount = 0;
    actuateToggleOff(readout, {
      onAriaClick: () => { clickCount += 1; /* deliberately does NOT flip aria-checked */ },
    });
    const entry = readout.find((e) => !e.locked);
    assert.equal(clickCount, 1, "must click at most once — never retry");
    assert.equal(entry.checked, true, "a stuck toggle must surface as still-on, never forced to false via a direct write");
  });

  test("a locked entry is NEVER included in the actuation plan (defense-in-depth, matches planToggleActuation's own contract)", () => {
    const { panel } = buildPanel({ toggles: [] }); // only the locked, checked:true checkbox exists
    const readout = collectToggleStates(panel, TOGGLE_SEL, LOCKED_SEL);
    const plan = planToggleActuation(readout);
    assert.deepEqual(plan, [], "the locked entry must never be planned for actuation, even though it reads checked:true");
    actuateToggleOff(readout);
    const locked = readout.find((e) => e.locked);
    assert.equal(locked.ref.checked, true, "the locked control's real DOM state must be completely untouched");
  });

  test("NEVER writes toward on: no fixture in this suite results in a checked:true / aria-checked:true write by actuateToggleOff", () => {
    const { panel } = buildPanel({
      toggles: [
        { kind: "checkbox", checked: true },
        { kind: "aria", checked: true },
        { kind: "checkbox", checked: false },
        { kind: "aria", checked: false },
      ],
    });
    const readout = collectToggleStates(panel, TOGGLE_SEL, LOCKED_SEL);
    actuateToggleOff(readout, { onAriaClick: (el) => el.setAttribute("aria-checked", "false") });
    for (const entry of readout.filter((e) => !e.locked)) {
      assert.equal(entry.checked, false, `entry (kind=${entry.kind}) must never end up checked:true after actuation`);
    }
  });
});

// ── End-to-end shaping: readout + backstop -> computeSaveInvariant ───────
//
// Exercises the REAL, imported computeSaveInvariant against readouts
// produced by the mirror helpers above — proves the shaping logic feeds
// the real safety oracle correctly for the scenarios task 2.7's e2e also
// covers (all-off satisfied; backstop-catches-missed-toggle; reads-back-on
// unsatisfied), at the unit level, before the Playwright e2e re-proves it
// against a real browser.

describe("collectToggleStates + countCheckedControls + actuateToggleOff -> computeSaveInvariant (integration of the mirrors)", () => {
  test("all toggles off, locked present, backstop 0 -> invariant satisfied", () => {
    const { panel } = buildPanel({
      toggles: [{ kind: "checkbox", checked: true }, { kind: "aria", checked: true }],
    });
    const readout = collectToggleStates(panel, TOGGLE_SEL, LOCKED_SEL);
    actuateToggleOff(readout, { onAriaClick: (el) => el.setAttribute("aria-checked", "false") });
    const backstop = countCheckedControls(panel, LOCKED_SEL);
    const result = computeSaveInvariant(readout, backstop);
    assert.equal(result.satisfied, true, result.reason);
  });

  test("a defaulted-ON standard toggle the curated selector missed -> backstop catches it -> invariant unsatisfied", () => {
    const { panel } = buildPanel({ toggles: [{ kind: "checkbox", checked: true }] });
    const missed = new FakeElement("input", { type: "checkbox", checked: true }); // no ".toggle" class
    panel.appendChild(missed);
    const readout = collectToggleStates(panel, TOGGLE_SEL, LOCKED_SEL); // never sees `missed`
    actuateToggleOff(readout);
    const backstop = countCheckedControls(panel, LOCKED_SEL); // DOES see `missed`
    const result = computeSaveInvariant(readout, backstop);
    assert.equal(result.satisfied, false);
    assert.equal(result.reason, "backstop-checked");
  });

  test("an ARIA toggle that reads back ON after .click() -> invariant unsatisfied (toggle-still-on)", () => {
    const { panel } = buildPanel({ toggles: [{ kind: "aria", checked: true }] });
    const readout = collectToggleStates(panel, TOGGLE_SEL, LOCKED_SEL);
    actuateToggleOff(readout, { onAriaClick: () => {} }); // stuck — never flips
    const backstop = countCheckedControls(panel, LOCKED_SEL);
    const result = computeSaveInvariant(readout, backstop);
    assert.equal(result.satisfied, false);
    assert.equal(result.reason, "toggle-still-on");
  });

  test("no locked/necessary entry present at all -> invariant unsatisfied (no-locked), even if every toggle reads off", () => {
    const { panel } = buildPanel({ toggles: [{ kind: "checkbox", checked: false }], includeLocked: false });
    const readout = collectToggleStates(panel, TOGGLE_SEL, LOCKED_SEL);
    const backstop = countCheckedControls(panel, LOCKED_SEL);
    const result = computeSaveInvariant(readout, backstop);
    assert.equal(result.satisfied, false);
    assert.equal(result.reason, "no-locked");
  });
});
