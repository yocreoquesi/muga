/**
 * MUGA: Web-cleaner-tool UI source guard (#1029, Phase 4)
 *
 * web/index.html and web/ui.js are browser-only (DOM/clipboard access)
 * and cannot be exercised under node:test, mirroring the repo's existing
 * `readFileSync` structural-test pattern for modules that cannot be
 * imported in Node (AGENTS.md "Testing" section, e.g. csp-inline-style-
 * guard.test.mjs). This file enforces the spec's Security Boundary and
 * Copy Style Constraints requirements by scanning the committed source
 * text directly.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const HTML = readFileSync(join(ROOT, "web/index.html"), "utf8");
const UI_JS = readFileSync(join(ROOT, "web/ui.js"), "utf8");
const UI_VIEW_JS = readFileSync(join(ROOT, "web/ui-view.js"), "utf8");

/** Strips <style>...</style> blocks, whose CSS custom properties (--bg,
 * --accent, ...) legitimately contain "--" and would otherwise false-
 * positive the copy-style-constraint scan below. */
function stripStyleBlocks(html) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "");
}

/** Strips `//` and `/* *\/` comments so structural checks below scan only
 * executable code, not developer-facing doc comments that legitimately
 * discuss the boundary (e.g. explaining what ui.js must NOT do). */
function stripJsComments(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("Security boundary (spec: Security Boundary)", () => {
  test("web/ui.js never assigns innerHTML", () => {
    assert.ok(
      !/\.innerHTML\s*=/.test(UI_JS),
      "ui.js must render user-controlled/dynamic text via textContent/createElement, never innerHTML",
    );
  });

  test("web/ui.js never uses eval or new Function", () => {
    assert.ok(!/\beval\s*\(/.test(UI_JS), "ui.js must not call eval(");
    assert.ok(!/new\s+Function\s*\(/.test(UI_JS), "ui.js must not construct new Function(");
  });

  test("web/ui.js wires events via addEventListener only", () => {
    assert.ok(UI_JS.includes("addEventListener"), "ui.js must attach handlers via addEventListener");
    assert.ok(!/\.on(click|keydown|keyup|submit)\s*=/.test(UI_JS), "ui.js must not assign .onclick/.onkeydown/... handlers directly");
  });

  test("web/index.html has no inline event handler attributes", () => {
    assert.ok(
      !/\bon[a-z]+\s*=\s*["']/i.test(HTML),
      "index.html must not use inline event handler attributes (onclick=, onload=, ...)",
    );
  });

  test("web/ui.js and web/ui-view.js never issue network requests", () => {
    for (const [label, text] of [["ui.js", UI_JS], ["ui-view.js", UI_VIEW_JS]]) {
      assert.ok(!text.includes("fetch("), `${label} must not call fetch( — nothing about the URL may leave the device`);
      assert.ok(!text.includes("XMLHttpRequest"), `${label} must not use XMLHttpRequest`);
    }
  });

  test("web/index.html loads only same-origin scripts", () => {
    const scriptSrcs = [...HTML.matchAll(/<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    assert.ok(scriptSrcs.length > 0, "index.html must load at least the engine bundle and the UI module");
    for (const src of scriptSrcs) {
      assert.ok(
        src.startsWith("./") || src.startsWith("../"),
        `index.html script src must be same-origin relative, got: ${src}`,
      );
    }
  });

  test("web/index.html loads the engine bundle before the UI module (document order)", () => {
    const bundleIndex = HTML.indexOf('src="./engine/cleaner-bundle.js"');
    const uiIndex = HTML.indexOf('src="./ui.js"');
    assert.ok(bundleIndex !== -1, "index.html must load ./engine/cleaner-bundle.js");
    assert.ok(uiIndex !== -1, "index.html must load ./ui.js as the UI module");
    assert.ok(bundleIndex < uiIndex, "the engine bundle <script> must appear before the UI module <script> so window.__mugaCleaner exists first");
  });

  test("web/index.html's UI module script has type=\"module\"", () => {
    const moduleScriptMatch = HTML.match(/<script[^>]*src\s*=\s*["']\.\/ui\.js["'][^>]*>/i);
    assert.ok(moduleScriptMatch, "the ./ui.js <script> tag must exist");
    assert.ok(/type\s*=\s*["']module["']/.test(moduleScriptMatch[0]), "the ./ui.js <script> tag must be type=\"module\"");
  });
});

describe("UI depends only on the adapter contract (design ADR-1)", () => {
  test("web/ui.js imports cleanUrl from the adapter, never window.__mugaCleaner directly", () => {
    assert.ok(UI_JS.includes('from "./engine/adapter.js"'), "ui.js must import from ./engine/adapter.js");
    assert.ok(
      !stripJsComments(UI_JS).includes("__mugaCleaner"),
      "ui.js must never reference window.__mugaCleaner directly in code (adapter-only boundary)",
    );
  });
});

describe("Copy style constraints (spec: Copy Style Constraints)", () => {
  const htmlBody = stripStyleBlocks(HTML);

  test("web/index.html visible copy has no em-dash", () => {
    assert.ok(!htmlBody.includes("—"), "index.html copy must not contain an em-dash (—)");
  });

  test("web/index.html visible copy has no double-hyphen dash", () => {
    assert.ok(!htmlBody.includes("--"), "index.html copy must not contain \"--\" (CSS custom properties are excluded from this scan)");
  });

  test("web/ui.js and web/ui-view.js copy has no em-dash or double-hyphen", () => {
    for (const [label, text] of [["ui.js", UI_JS], ["ui-view.js", UI_VIEW_JS]]) {
      assert.ok(!text.includes("—"), `${label} must not contain an em-dash (—)`);
    }
  });

  test("the URL-cleaning purpose is explicit in the page copy", () => {
    assert.ok(/clean/i.test(htmlBody), "page copy must reference cleaning");
    assert.ok(/tracking/i.test(htmlBody), "page copy must reference tracking parameters");
  });

  test("page copy never mentions injecting an affiliate tag (pure cleaner, no Scenario B)", () => {
    assert.ok(!/inject/i.test(htmlBody), "index.html must never mention injecting MUGA's own affiliate tag");
    assert.ok(
      !/inject/i.test(stripJsComments(UI_JS) + stripJsComments(UI_VIEW_JS)),
      "ui.js/ui-view.js code (excluding developer doc comments) must never mention injecting an affiliate tag",
    );
  });
});

describe("Accessibility (spec: UI Controls and Accessibility)", () => {
  test("the Clean and Copy controls are real <button> elements (keyboard-operable by default)", () => {
    assert.ok(/<button[^>]*id\s*=\s*["']clean-btn["']/.test(HTML), "clean-btn must be a <button>");
    assert.ok(/<button[^>]*id\s*=\s*["']copy-btn["']/.test(HTML), "copy-btn must be a <button>");
  });

  test("the result message region announces changes to assistive tech", () => {
    const resultMessageTag = HTML.match(/<p[^>]*id\s*=\s*["']result-message["'][^>]*>/);
    assert.ok(resultMessageTag, "result-message element must exist");
    assert.ok(/aria-live\s*=\s*["']polite["']/.test(resultMessageTag[0]), "result-message must have aria-live=\"polite\"");
  });

  test("interactive elements rely on :focus-visible styling, not :focus alone", () => {
    assert.ok(HTML.includes(":focus-visible"), "index.html must style :focus-visible for keyboard users");
  });
});
