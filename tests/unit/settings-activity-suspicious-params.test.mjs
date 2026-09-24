/**
 * MUGA — Suspicious-params relocation to Settings' Activity section (#1351)
 *
 * ADR-0011 Decision 3 classifies the popup's old "Suspicious params" section
 * as two things: an ENTROPY subgroup (params on the CURRENT page's URL) and
 * a FREQUENCY subgroup (cross-site, storage-backed), plus two actions that
 * write `prefs.userCustomRules` — the single most consequential action MUGA
 * offers. The 2026-09-24 maintainer decision on #1351 settled the open
 * question ADR-0011 left unaddressed (Settings has no "current page"): the
 * ENTROPY subgroup stays in the popup, READ-ONLY; the FREQUENCY subgroup and
 * every action that writes userCustomRules move to Settings.
 *
 * These tests pin:
 *   1. options.html hosts the frequency panel inside #section-activity,
 *      under its own id (no collision with the popup's #suspicious-params).
 *   2. options.js wires the panel from the extracted view module and the
 *      cross-site-frequency tracker, and shares the per-panel visibility
 *      helper #1351 introduced.
 *   3. popup.js/popup.html no longer render any action that writes
 *      userCustomRules — the issue's explicit closing condition.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const optionsHtml = readFileSync(join(ROOT, "src/options/options.html"), "utf8");
const optionsJs = readFileSync(join(ROOT, "src/options/options.js"), "utf8");
const popupHtml = readFileSync(join(ROOT, "src/popup/popup.html"), "utf8");
const popupJs = readFileSync(join(ROOT, "src/popup/popup.js"), "utf8");

// ── 1. options.html hosts the frequency panel ──────────────────────────────

describe("options.html — #section-activity hosts the suspicious-params (frequency) panel", () => {
  test("suspicious-params-panel lives inside #section-activity with its own list container", () => {
    const sectionMatch = optionsHtml.match(/<section id="section-activity" hidden>[\s\S]*?<\/section>/);
    assert.ok(sectionMatch, "#section-activity must be a well-formed <section>");
    assert.match(sectionMatch[0], /id="suspicious-params-panel"/);
    assert.match(sectionMatch[0], /id="suspicious-params-settings-list"/);
  });

  test("the panel id does not collide with the popup's #suspicious-params id", () => {
    assert.doesNotMatch(optionsHtml, /id="suspicious-params"(?!-)/, "options.html must not reuse the popup's bare #suspicious-params id");
  });
});

// ── 2. options.js wiring ────────────────────────────────────────────────────

describe("options.js — renders the Activity suspicious-params (frequency) panel", () => {
  test("imports planSuspiciousParamsSettingsView from the extracted view module", () => {
    assert.match(
      optionsJs,
      /import\s*\{\s*planSuspiciousParamsSettingsView\s*\}\s*from\s*["']\.\.\/lib\/suspicious-params-view\.js["']/,
      "options.js must import planSuspiciousParamsSettingsView from ../lib/suspicious-params-view.js",
    );
  });

  test("imports the cross-site-frequency tracker", () => {
    assert.match(optionsJs, /from\s+"\.\.\/lib\/cross-site-frequency\.js"/);
  });

  test("imports addUserCustomRule for the Strip-everywhere action", () => {
    assert.match(
      optionsJs,
      /import\s*\{\s*addUserCustomRule\s*\}\s*from\s*["']\.\.\/lib\/user-custom-rules\.js["']/,
    );
  });

  test("declares a renderer for the Activity suspicious-params panel", () => {
    assert.match(optionsJs, /async function\s+renderSuspiciousParamsActivity\s*\(/);
  });

  test("gates the panel on crossSiteFrequencyEnabled", () => {
    const fnStart = optionsJs.indexOf("async function renderSuspiciousParamsActivity(");
    assert.ok(fnStart !== -1);
    const fnEnd = optionsJs.indexOf("\nasync function ", fnStart + 1);
    const fnBody = optionsJs.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    assert.match(fnBody, /crossSiteFrequencyEnabled/);
    assert.match(fnBody, /panel\.hidden\s*=\s*!enabled/);
    assert.match(fnBody, /updateActivitySectionVisibility\(\)/);
  });

  test("writes userCustomRules through withSyncMutation + addUserCustomRule (race-safe, shared lock)", () => {
    assert.match(optionsJs, /withSyncMutation\(withListLock,\s*"userCustomRules"/);
    assert.match(optionsJs, /addUserCustomRule\(list,\s*paramName\)/);
  });

  test("surfaces the cap error via the existing showToast/list_full path", () => {
    const fnStart = optionsJs.indexOf('function buildStripGloballyButton(');
    assert.ok(fnStart !== -1, "buildStripGloballyButton must exist");
    const fnEnd = optionsJs.indexOf("\nfunction ", fnStart + 1);
    const fnBody = optionsJs.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    assert.match(fnBody, /error\s*===\s*"max"/);
    assert.match(fnBody, /t\("list_full",\s*_currentLang\)/);
  });
});

// ── 3. Per-panel Activity visibility (#1351 fix of the #1350 gap) ─────────

describe("options.js — #section-activity visibility is per-panel, not tied to one pref", () => {
  test("declares a shared updateActivitySectionVisibility helper", () => {
    assert.match(optionsJs, /function\s+updateActivitySectionVisibility\s*\(/);
  });

  test("the helper hides the section only when every known panel is hidden", () => {
    const fnStart = optionsJs.indexOf("function updateActivitySectionVisibility(");
    assert.ok(fnStart !== -1);
    const fnEnd = optionsJs.indexOf("\n}", fnStart);
    const fnBody = optionsJs.slice(fnStart, fnEnd);
    assert.match(fnBody, /domain-stats-panel/);
    assert.match(fnBody, /suspicious-params-panel/);
    // "some panel visible" logic, not a single-pref check.
    assert.match(fnBody, /\.some\(/);
  });

  test("both panel renderers call the shared visibility helper instead of touching #section-activity directly", () => {
    for (const fnName of ["renderDomainStatsActivity", "renderSuspiciousParamsActivity"]) {
      const start = optionsJs.indexOf(`function ${fnName}(`);
      assert.ok(start !== -1, `${fnName} must exist`);
      const end = optionsJs.indexOf("\n}", optionsJs.indexOf("\n}", start) + 1);
      const body = optionsJs.slice(start, end);
      assert.match(body, /updateActivitySectionVisibility\(\)/, `${fnName} must call updateActivitySectionVisibility()`);
      assert.doesNotMatch(
        body,
        /document\.getElementById\("section-activity"\)\.hidden\s*=/,
        `${fnName} must not set #section-activity's hidden state directly`,
      );
    }
  });
});

// ── 4. No render interleave (#1351 R3-render-interleave) ───────────────────
//
// renderSuspiciousParamsActivity awaits storage twice before it has enough
// data to render. Two overlapping calls (a toggle flip while a previous
// call is still awaiting, or a rapid re-render after import) must not
// interleave their rows: the SAME run-counter/isStale() pattern
// initReportFlow's runReportUrlCheck already uses (#1353) applies here, and
// the list must only be cleared+filled once every await has resolved and
// the call is still the latest one — never at the top of the function,
// which would let a superseded call leave the list empty (or race a
// fresher call's rows) while it was still awaiting storage.

describe("options.js — renderSuspiciousParamsActivity does not interleave overlapping renders", () => {
  function getRenderFnBody() {
    const start = optionsJs.indexOf("async function renderSuspiciousParamsActivity(");
    assert.ok(start !== -1, "renderSuspiciousParamsActivity must exist");
    // Find this function's closing brace by bracket depth, not the first
    // "\n}" (the function body itself contains several nested blocks).
    let depth = 0;
    let i = optionsJs.indexOf("{", start);
    const bodyStart = i;
    for (; i < optionsJs.length; i++) {
      if (optionsJs[i] === "{") depth++;
      else if (optionsJs[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    return optionsJs.slice(bodyStart, i + 1);
  }

  test("uses a module-scoped run counter with an isStale() guard", () => {
    assert.match(optionsJs, /let\s+_suspiciousParamsRenderRun\s*=\s*0\s*;/);
    const body = getRenderFnBody();
    assert.match(body, /const\s+run\s*=\s*\+\+_suspiciousParamsRenderRun\s*;/);
    assert.match(body, /const\s+isStale\s*=\s*\(\)\s*=>\s*run\s*!==\s*_suspiciousParamsRenderRun\s*;/);
  });

  test("bumps the run counter BEFORE the disabled gate, so turning the panel off invalidates an in-flight render", () => {
    const body = getRenderFnBody();
    const bump = body.indexOf("++_suspiciousParamsRenderRun");
    const gate = body.indexOf("if (!enabled) return;");
    assert.ok(bump !== -1 && gate !== -1 && bump < gate);
  });

  test("checks isStale() after each of the two storage awaits, before touching the DOM", () => {
    const body = getRenderFnBody();
    const isStaleChecks = [...body.matchAll(/if\s*\(isStale\(\)\)\s*return\s*;/g)];
    assert.ok(isStaleChecks.length >= 2, "expected at least 2 isStale() bail-outs (one per await boundary)");
  });

  test("clears and fills the list only ONCE, after every await, not at the top of the function", () => {
    const body = getRenderFnBody();
    const replaceIdx = body.indexOf("list.replaceChildren()");
    assert.ok(replaceIdx !== -1, "must clear the list somewhere");
    // Every `await` in the function must occur BEFORE the clear+fill point —
    // i.e. the clear happens only once every async dependency has resolved.
    const awaitIndices = [...body.matchAll(/\bawait\b/g)].map((m) => m.index);
    assert.ok(awaitIndices.length > 0, "sanity: the function must await something");
    for (const idx of awaitIndices) {
      assert.ok(idx < replaceIdx, "every await must occur before list.replaceChildren()");
    }
    // And the LAST isStale() bail-out must occur between the last await and
    // the clear, so a superseded run never reaches it.
    const lastAwait = Math.max(...awaitIndices);
    const isStaleIndices = [...body.matchAll(/if\s*\(isStale\(\)\)\s*return\s*;/g)].map((m) => m.index);
    assert.ok(
      isStaleIndices.some((idx) => idx > lastAwait && idx < replaceIdx),
      "an isStale() check must sit between the last await and the list clear",
    );
  });
});

// ── 5. Popup no longer writes userCustomRules (issue #1351 closing condition) ──

describe("popup.js / popup.html — userCustomRules can no longer be written from the popup (#1351)", () => {
  test("popup.js never calls chrome.storage.sync.set with userCustomRules", () => {
    assert.doesNotMatch(
      popupJs,
      /chrome\.storage\.sync\.set\(\s*\{\s*userCustomRules/,
      "popup.js must not write userCustomRules to chrome.storage.sync",
    );
  });

  test("popup.js has no write path to userCustomRules in any shape (object key, string key, helper)", () => {
    // The literal set() shape above is only one way to write it; a spread
    // object, setPrefs({ userCustomRules }) or withSyncMutation(..., "userCustomRules")
    // would all slip past it. popup.js may READ the key, never name it as a
    // key or a string.
    const code = popupJs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\buserCustomRules\s*[:,}]/, "no object-key or shorthand use of userCustomRules");
    assert.doesNotMatch(code, /["'`]userCustomRules["'`]/, "no string-key use of userCustomRules");
    assert.doesNotMatch(code, /withSyncMutation\(/, "the popup has no sync mutation path at all");
  });

  test("popup.js no longer imports addUserCustomRule", () => {
    assert.doesNotMatch(popupJs, /from\s+"\.\.\/lib\/user-custom-rules\.js"/);
  });

  test("popup.js no longer declares a strip-everywhere/strip-locally click handler", () => {
    assert.doesNotMatch(popupJs, /_appendStripLocallyButton/);
    assert.doesNotMatch(popupJs, /strip-locally-btn/);
    assert.doesNotMatch(popupJs, /strip-globally-btn/);
  });

  test("popup.js no longer imports the cross-site-frequency tracker (moved to options.js)", () => {
    assert.doesNotMatch(popupJs, /from\s+"\.\.\/lib\/cross-site-frequency\.js"/);
  });

  test("popup.js no longer declares the report-upstream button builder", () => {
    assert.doesNotMatch(popupJs, /_appendReportUpstreamButton/);
    assert.doesNotMatch(popupJs, /report-upstream-btn/);
  });

  test("popup.html no longer declares the retired strip-locally-count deep link host", () => {
    assert.doesNotMatch(popupHtml, /id="strip-locally-count"/);
  });

  test("popup.js's showSuspiciousParams keeps the entropy heuristic, read-only", () => {
    assert.match(popupJs, /from\s+"\.\.\/lib\/entropy-heuristic\.js"/);
    assert.match(popupJs, /async function\s+showSuspiciousParams\s*\(lang\)/);
  });
});
