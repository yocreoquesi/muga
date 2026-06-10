/**
 * Popup wiring for the tracker-count celebration line (#326).
 *
 * The celebration is what turns "MUGA worked silently" into "MUGA delivered
 * value I can see." These tests pin down the i18n contract, the HTML
 * surface, the JS render path, and the reset cleanup.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

import { makeChromeMock } from "./helpers/chrome-stub.mjs";
globalThis.chrome = makeChromeMock({ hasSession: false, promiseShape: true });

const { TRANSLATIONS } = await import("../../src/lib/i18n.js");

// ── i18n keys ────────────────────────────────────────────────────────────────

test("preview_count_one: i18n key exists with en + es non-empty, no {n} placeholder", () => {
  const k = TRANSLATIONS.preview_count_one;
  assert.ok(k, "preview_count_one must exist");
  assert.ok(typeof k.en === "string" && k.en.length > 0, "en non-empty");
  assert.ok(typeof k.es === "string" && k.es.length > 0, "es non-empty");
  // The "one" key uses literal "1" — no placeholder needed; renderer relies
  // on this to short-circuit the split logic.
  assert.ok(!k.en.includes("{n}"), "preview_count_one must NOT contain {n}");
});

test("preview_count_other: i18n key exists with {n} placeholder in every locale", () => {
  const k = TRANSLATIONS.preview_count_other;
  assert.ok(k, "preview_count_other must exist");
  for (const locale of ["en", "es", "pt", "de", "fr", "it", "ja"]) {
    assert.ok(typeof k[locale] === "string" && k[locale].length > 0, `${locale} non-empty`);
    assert.ok(k[locale].includes("{n}"), `${locale} must contain the {n} placeholder`);
  }
});

test("preview_count_clean: i18n key exists with en + es non-empty", () => {
  const k = TRANSLATIONS.preview_count_clean;
  assert.ok(k, "preview_count_clean must exist");
  assert.ok(typeof k.en === "string" && k.en.length > 0, "en non-empty");
  assert.ok(typeof k.es === "string" && k.es.length > 0, "es non-empty");
});

// ── HTML surface ─────────────────────────────────────────────────────────────

test("popup.html exposes #preview-count inside #preview, before #preview-removed", () => {
  const html = readFileSync(resolve(root, "src/popup/popup.html"), "utf8");

  assert.match(html, /id="preview-count"/, "popup.html must contain #preview-count");
  assert.match(html, /id="preview-count"[^>]*hidden/, "#preview-count must start hidden");
  assert.match(
    html,
    /id="preview-count"[^>]*aria-live=/,
    "#preview-count must have aria-live for screen readers"
  );

  // Ordering: count before removed list. Count is the headline; removed list
  // is the detail.
  const countIdx = html.indexOf('id="preview-count"');
  const removedIdx = html.indexOf('id="preview-removed"');
  assert.ok(countIdx !== -1 && removedIdx !== -1, "both elements must exist");
  assert.ok(countIdx < removedIdx, "#preview-count must come before #preview-removed in DOM order");
});

// ── JS wiring ────────────────────────────────────────────────────────────────

test("popup.js declares renderCountCelebration and uses Intl.PluralRules", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");

  assert.ok(
    /function renderCountCelebration/.test(popupSrc),
    "popup.js must declare a renderCountCelebration helper"
  );
  assert.ok(
    /Intl\.PluralRules/.test(popupSrc),
    "popup.js must use Intl.PluralRules for grammatical plurals (no hard count===1 fork)"
  );
  assert.ok(
    /preview_count_one|preview_count_other/.test(popupSrc),
    "popup.js must read both singular and plural i18n keys"
  );
  assert.ok(
    /preview_count_clean/.test(popupSrc),
    "popup.js must render the already-clean state from the dedicated key"
  );
});

test("popup.js builds the count line via DOM nodes, not innerHTML", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");

  // The renderer must avoid innerHTML so the i18n template can never become
  // an injection vector, even though count is a number today.
  const fnIdx = popupSrc.indexOf("function renderCountCelebration");
  const next = popupSrc.indexOf("\nfunction ", fnIdx + 10);
  const slice = popupSrc.slice(fnIdx, next === -1 ? fnIdx + 4000 : next);
  assert.ok(
    !/\binnerHTML\s*=/.test(slice),
    "renderCountCelebration must not assign innerHTML"
  );
  assert.ok(
    /createTextNode|createElement|appendChild|replaceChildren/.test(slice),
    "renderCountCelebration must build content via DOM APIs"
  );
});

test("renderCountCelebration: count=1 span-vs-textContent paths are mutually exclusive (#819)", () => {
  // Bug: the original code unconditionally built the .preview-count-number
  // span AND appended it to el, then — for the "one" key (after===undefined)
  // — called `el.textContent = template` which obliterates the span and kills
  // the CSS pulse animation for the most common case (exactly 1 tracker).
  //
  // Fix: the span-build path and the plain-text path must be mutually
  // exclusive. The correct structure is:
  //   if (after === undefined) {
  //     el.textContent = template;           // plain text only, no span
  //   } else {
  //     // build text-before + span + text-after
  //   }
  //
  // This test reads the function source and verifies the span is ONLY built
  // inside the else branch (i.e. guarded by `after !== undefined`).

  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  const fnIdx = popupSrc.indexOf("function renderCountCelebration");
  assert.ok(fnIdx >= 0, "renderCountCelebration must exist");
  const next = popupSrc.indexOf("\nfunction ", fnIdx + 10);
  const fnBody = popupSrc.slice(fnIdx, next === -1 ? fnIdx + 4000 : next);

  // The buggy pattern: span is created BEFORE the `after === undefined` check
  // and `el.textContent = template` clobbers it afterward. In the fixed code,
  // `el.textContent = template` must NOT appear AFTER `el.appendChild(number)`
  // in an unconditional position. We detect the bug by looking for the
  // anti-pattern: span append followed immediately (with no else-guard) by
  // el.textContent assignment.
  //
  // Approach: the fixed function must NOT contain `el.textContent = template`
  // after an unconditional `el.appendChild(number)`.  We verify this by
  // checking that `el.textContent = template` does NOT appear after the
  // last `el.appendChild(number)` in an unguarded path.
  //
  // Simpler structural invariant:  in the fixed version the `number` span and
  // its `el.appendChild(number)` call appear ONLY inside an `else` block or
  // ONLY when `after !== undefined`.  We assert that the span creation is
  // never followed by `el.textContent` on the same un-branched code path.

  // Collect positions of the key statements inside the fn body
  const spanCreatePos  = fnBody.indexOf('number.className = "preview-count-number"');
  const textContentPos = fnBody.lastIndexOf("el.textContent = template");

  // If textContent still follows span creation with no intervening else/return
  // the bug is still present.  In the fixed version either:
  //   (a) textContent assignment is gone entirely from the count>0 branch, OR
  //   (b) span creation appears AFTER the textContent check (inside else)
  //
  // Both are captured by: spanCreatePos must NOT be less than textContentPos
  // when textContent exists inside the fn body.
  if (textContentPos !== -1 && spanCreatePos !== -1) {
    assert.ok(
      spanCreatePos > textContentPos,
      "renderCountCelebration: .preview-count-number span must be created AFTER (inside else branch of) the el.textContent plain-text path — " +
        "otherwise el.textContent obliterates the span for count===1. " +
        "Move the span-build path into the `else` branch guarded by `after !== undefined`."
    );
  }
  // If textContent is gone from the count>0 branch entirely that's also fine.
});

test("_resetPreviewDom clears #preview-count and the animation flag", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  const fnIdx = popupSrc.indexOf("function _resetPreviewDom");
  assert.ok(fnIdx !== -1, "_resetPreviewDom must exist");
  const slice = popupSrc.slice(fnIdx, fnIdx + 2500);
  assert.ok(slice.includes("preview-count"), "_resetPreviewDom must reset #preview-count");
  // Stale data-animating would replay the pulse on the next storage-onChanged
  // re-render even when the count did not move — strip it on reset.
  assert.ok(/data-animating/.test(slice), "_resetPreviewDom must clear data-animating");
});
