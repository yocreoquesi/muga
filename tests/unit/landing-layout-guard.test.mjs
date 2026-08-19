/**
 * MUGA: Landing layout guard — the shapes that silently break narrow phones.
 *
 * landing/index.html has no build step and no component tests, so its CSS is
 * checked structurally, the same way tests/unit/landing-inline-morph-source-guard.test.mjs
 * checks its inline script. Each check below pins a bug that actually shipped
 * and that nothing else catches: all three failure modes render perfectly at
 * desktop width and only surface as a sideways scroll, or a misaligned column,
 * at a width nobody opens by default.
 *
 * Scope: only the shapes with a known failure mode. This is deliberately not a
 * general CSS linter — the page is meant to be restyled freely.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const HTML = readFileSync(join(ROOT, "landing/index.html"), "utf8");

/** The narrowest viewport the landing is expected to survive. 360px is a very
 * common Android width and 320px is the small-phone floor. */
const NARROWEST_VIEWPORT = 320;

const STYLE = (() => {
  const open = HTML.indexOf("<style>");
  const close = HTML.indexOf("</style>", open);
  assert.ok(open !== -1 && close > open, "landing/index.html must carry an inline <style> block");
  return HTML.slice(open + "<style>".length, close);
})();

/** Body of the rule for an exact selector, e.g. ".btn" (not ".btn:hover"). */
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = STYLE.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

/** The horizontal padding .wrap reserves on each side, read from the source so
 * this stays honest if the gutter changes. */
function wrapGutter() {
  const body = ruleBody(".wrap");
  assert.ok(body, ".wrap rule must exist");
  const m = body.match(/padding:\s*[^;]*?\s(\d+(?:\.\d+)?)px/);
  assert.ok(m, `could not read .wrap's horizontal padding from: ${body.trim()}`);
  return Number(m[1]);
}

describe("landing layout — narrow-viewport floors", () => {
  test("no grid track floor forces the page wider than the narrowest viewport", () => {
    // `minmax(340px, 1fr)` cannot shrink below 340px, so that floor plus both
    // .wrap gutters becomes a hard minimum width for the WHOLE page: anything
    // narrower scrolls sideways. Wrapping the floor in `min(..., 100%)` lets it
    // collapse. This shipped as a 368px floor that broke every 360px phone.
    const gutters = wrapGutter() * 2;
    const offenders = [];

    for (const m of STYLE.matchAll(/minmax\(\s*(min\([^)]*\)|[^,)]+?)\s*,/g)) {
      const floor = m[1].trim();
      if (floor.startsWith("min(")) continue; // collapsible, fine at any width
      const px = floor.match(/^(\d+(?:\.\d+)?)px$/);
      if (!px) continue; // 0, percentages, auto, custom properties
      const needed = Number(px[1]) + gutters;
      if (needed > NARROWEST_VIEWPORT) offenders.push(`${m[0]} needs ${needed}px`);
    }

    assert.deepEqual(
      offenders,
      [],
      `a grid track floor plus .wrap's ${gutters}px of gutters exceeds ${NARROWEST_VIEWPORT}px, ` +
        `so the page scrolls sideways on small phones. Wrap the floor in min(..., 100%): ${offenders.join("; ")}`,
    );
  });

  test("the hero headline carries no non-breaking space", () => {
    // A non-breaking space glues two words into one unbreakable run whose width
    // becomes a floor for the whole page, exactly like a grid track floor.
    // "tracking&nbsp;removed." measured ~340px and broke 360px phones.
    // text-wrap: balance already handles the widow this was meant to prevent.
    const m = HTML.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    assert.ok(m, "the hero <h1> must exist");
    const headline = m[1];
    assert.ok(
      !/&nbsp;|&#160;|&#xa0;| /i.test(headline),
      "the hero <h1> contains a non-breaking space. It pins an unbreakable run whose width " +
        `becomes the page's minimum width. Got: ${headline.trim()}`,
    );
  });

  test("the h1 is allowed to shrink on small screens", () => {
    // A clamp() floor is what keeps that unbreakable-run maths survivable.
    const body = ruleBody("h1");
    assert.ok(body, "the h1 rule must exist");
    assert.ok(
      /font-size:\s*clamp\(/.test(body),
      `the hero h1 must size with clamp() so it shrinks on phones. Got: ${body.trim()}`,
    );
  });
});

describe("landing layout — column rules survive wrapping", () => {
  test(".trust-grid does not auto-wrap while its cells carry a left rule", () => {
    // .trust-cell draws its separator as border-left and indents with
    // padding-left, both reset on :first-child. That reset only ever matches
    // ONE cell, so an auto-fit grid that wraps leaves the cell starting each
    // later row with a rule and an indent it should not have — it stops
    // aligning with the section edge. Pin the column count instead.
    const cell = ruleBody(".trust-cell");
    assert.ok(cell, ".trust-cell rule must exist");
    const drawsLeftRule = /border-left:\s*(?!0)/.test(cell) || /padding:\s*[^;]*\s\d+(?:\.\d+)?px\s*;/.test(cell);
    if (!drawsLeftRule) return; // restyled away; the coupling no longer applies

    const grid = ruleBody(".trust-grid");
    assert.ok(grid, ".trust-grid rule must exist");
    assert.ok(
      !/auto-fit|auto-fill/.test(grid),
      ".trust-cell draws a per-cell left rule/indent that only mid-row cells should have, but " +
        `.trust-grid wraps automatically, so wrapped rows start misaligned. Got: ${grid.trim()}`,
    );
  });
});

describe("landing layout — .btn dresses <button> as well as <a>", () => {
  test(".btn sets its own font-family and border", () => {
    // A <button> inherits neither the page font nor a zeroed border from the
    // cascade, so the tool's Clean/Copy controls rendered in the UA font inside
    // a 2px outset border. The system font stack hid this for years; a real
    // webfont makes it obvious.
    const body = ruleBody(".btn");
    assert.ok(body, ".btn rule must exist");
    assert.ok(
      /font-family:/.test(body),
      `.btn must set font-family (a <button> does not inherit it). Got: ${body.trim()}`,
    );
    assert.ok(
      /(^|;|\s)border:/.test(body),
      `.btn must set border (a <button> carries a UA border otherwise). Got: ${body.trim()}`,
    );
  });

  test("the tool's Clean and Copy controls really are <button>s wearing .btn", () => {
    // If these ever stop being <button>s the rule above is pointless; if they
    // stop wearing .btn they lose the whole treatment.
    for (const id of ["clean-btn", "copy-btn"]) {
      const m = HTML.match(new RegExp(`<button[^>]*id\\s*=\\s*["']${id}["'][^>]*>`));
      assert.ok(m, `#${id} must be a <button>`);
      assert.ok(/class\s*=\s*["'][^"']*\bbtn\b/.test(m[0]), `#${id} must carry the .btn class. Got: ${m[0]}`);
    }
  });
});
