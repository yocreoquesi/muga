/**
 * MUGA: Landing inline morph — source guard.
 *
 * landing/index.html's morph script is browser-only (DOM/clipboard access)
 * and cannot be exercised under node:test, mirroring the repo's existing
 * `readFileSync` structural-test pattern (e.g. tests/unit/web-ui-source-
 * guard.test.mjs, tests/unit/csp-inline-style-guard.test.mjs) for modules
 * that cannot be imported in Node.
 *
 * Scope: these checks target ONLY the morph feature (the inline script
 * block between the "// Inline morph:" and "// Console easter egg"
 * comments, and the markup/copy added for it). They deliberately do not
 * scan the rest of landing/index.html's pre-existing markup/scripts,
 * which are out of scope for this change and covered elsewhere.
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

/** Strips `//` and `/* *\/` comments so structural checks scan only
 * executable code, not developer-facing doc comments. */
function stripJsComments(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const MORPH_START = HTML.indexOf("// Inline morph:");
const MORPH_END = HTML.indexOf("// Console easter egg");
if (MORPH_START === -1 || MORPH_END === -1 || MORPH_END <= MORPH_START) {
  throw new Error("Could not locate the inline-morph script block markers in landing/index.html");
}
const MORPH_SCRIPT = HTML.slice(MORPH_START, MORPH_END);
const MORPH_SCRIPT_NO_COMMENTS = stripJsComments(MORPH_SCRIPT);

describe("landing inline morph — progressive enhancement", () => {
  test("#cta-web keeps its https://muga.app/clean href (no-JS fallback)", () => {
    const ctaMatch = HTML.match(/<a[^>]*id\s*=\s*["']cta-web["'][^>]*>/i);
    assert.ok(ctaMatch, "the #cta-web anchor must exist");
    assert.ok(
      /href\s*=\s*["']https:\/\/muga\.app\/clean["']/.test(ctaMatch[0]),
      "#cta-web must keep href=\"https://muga.app/clean\" so JS-disabled visitors still navigate to the full tool",
    );
  });

  test("the morph handler calls preventDefault() on the #cta-web click", () => {
    assert.ok(
      /ctaWeb\.addEventListener\(\s*['"]click['"]/.test(MORPH_SCRIPT),
      "a click handler must be wired to ctaWeb via addEventListener",
    );
    assert.ok(
      /ctaWeb\.addEventListener\(\s*['"]click['"][\s\S]{0,120}preventDefault\(\)/.test(MORPH_SCRIPT),
      "the #cta-web click handler must call event.preventDefault() so JS-enabled visitors do not navigate away",
    );
  });

  test("the engine is loaded from ./clean/engine/ only inside loadEngine(), not at the top level", () => {
    const loadEngineMatch = MORPH_SCRIPT.match(/function loadEngine\s*\([^)]*\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(loadEngineMatch, "a loadEngine() function must exist");
    assert.ok(
      loadEngineMatch[0].includes("./clean/engine/cleaner-bundle.js"),
      "loadEngine() must load the vendored engine bundle from ./clean/engine/cleaner-bundle.js",
    );
    assert.ok(
      loadEngineMatch[0].includes("./clean/engine/adapter.js"),
      "loadEngine() must import cleanUrl from ./clean/engine/adapter.js",
    );

    const outsideLoadEngine = MORPH_SCRIPT.replace(loadEngineMatch[0], "");
    assert.ok(
      !outsideLoadEngine.includes("cleaner-bundle.js") && !outsideLoadEngine.includes("./clean/engine/adapter.js"),
      "the engine bundle/adapter must be referenced only inside loadEngine(), never elsewhere in the morph script",
    );
  });

  test("loadEngine() is only invoked from runClean(), never eagerly at module scope or from enterLiveMode()", () => {
    const enterLiveMode = MORPH_SCRIPT.match(/function enterLiveMode\s*\([^)]*\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(enterLiveMode, "an enterLiveMode() function must exist");
    assert.ok(!enterLiveMode[0].includes("loadEngine("), "enterLiveMode() (the #cta-web morph step) must not call loadEngine() itself");

    const runClean = MORPH_SCRIPT.match(/function runClean\s*\([^)]*\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(runClean, "a runClean() function must exist");
    assert.ok(runClean[0].includes("loadEngine("), "runClean() (the Clean button / Enter handler) must call loadEngine()");
  });
});

describe("landing inline morph — security (AGENTS.md)", () => {
  test("never assigns innerHTML with dynamic data", () => {
    assert.ok(!/\.innerHTML\s*=/.test(MORPH_SCRIPT), "the morph script must render via textContent/createElement, never innerHTML");
  });

  test("never calls eval or new Function", () => {
    assert.ok(!/\beval\s*\(/.test(MORPH_SCRIPT), "the morph script must not call eval(");
    assert.ok(!/new\s+Function\s*\(/.test(MORPH_SCRIPT), "the morph script must not construct new Function(");
  });

  test("wires events via addEventListener only", () => {
    assert.ok(MORPH_SCRIPT.includes("addEventListener"), "the morph script must attach handlers via addEventListener");
    assert.ok(!/\.on(click|keydown|keyup|submit)\s*=/.test(MORPH_SCRIPT), "the morph script must not assign .onclick/.onkeydown/... handlers directly");
  });

  test("the pasted URL is only ever rendered via textContent, never concatenated into markup", () => {
    assert.ok(MORPH_SCRIPT.includes(".textContent = text"), "renderer helpers must assign untrusted text via .textContent");
    assert.ok(!/[+`]\s*(rawUrl|cleanUrlStr|originalUrl|value)\b[\s\S]{0,20}(innerHTML|outerHTML)/.test(MORPH_SCRIPT), "user-controlled URL values must never be concatenated into innerHTML/outerHTML");
  });

  test("landing/index.html has no inline event handler attributes", () => {
    assert.ok(
      !/\bon[a-z]+\s*=\s*["']/i.test(HTML),
      "index.html must not use inline event handler attributes (onclick=, onload=, ...)",
    );
  });

  test("the dynamically injected engine <script> src is same-origin, not a CDN/external host", () => {
    const scriptSrcMatch = MORPH_SCRIPT.match(/script\.src\s*=\s*['"][^'"]+['"]/);
    assert.ok(scriptSrcMatch, "loadEngine() must set script.src");
    assert.ok(!/https?:\/\//.test(scriptSrcMatch[0]), "script.src must not be an absolute/external URL");
    assert.ok(scriptSrcMatch[0].includes("./clean/engine/"), "script.src must point at ./clean/engine/");
  });
});

describe("landing inline morph — accessibility", () => {
  test("the live result region announces changes to assistive tech", () => {
    const outputMatch = HTML.match(/<div[^>]*id\s*=\s*["']demo-output["'][^>]*>/);
    assert.ok(outputMatch, "#demo-output must exist");
    assert.ok(/aria-live\s*=\s*["']polite["']/.test(outputMatch[0]), "#demo-output must have aria-live=\"polite\"");

    const footMatch = HTML.match(/<div[^>]*id\s*=\s*["']demo-foot["'][^>]*>/);
    assert.ok(footMatch, "#demo-foot must exist");
    assert.ok(/aria-live\s*=\s*["']polite["']/.test(footMatch[0]), "#demo-foot must have aria-live=\"polite\"");
  });

  test("Clean and Copy controls are real <button> elements (keyboard-operable by default)", () => {
    assert.ok(/<button[^>]*id\s*=\s*["']hero-clean-btn["']/.test(HTML), "hero-clean-btn must be a <button>");
    assert.ok(/<button[^>]*id\s*=\s*["']demo-copy-btn["']/.test(HTML), "demo-copy-btn must be a <button>");
  });
});

describe("landing inline morph — copy style constraints", () => {
  test("no em-dash in the morph script's user-facing strings (comments excluded)", () => {
    assert.ok(!MORPH_SCRIPT_NO_COMMENTS.includes("—"), "the morph script's copy strings must not contain an em-dash");
  });

  test("no double-hyphen dash in the morph script's user-facing strings (comments excluded)", () => {
    assert.ok(!MORPH_SCRIPT_NO_COMMENTS.includes("--"), "the morph script's copy strings must not contain \"--\"");
  });

  test("added markup copy (placeholder, button labels, link text) has no em-dash", () => {
    const addedIds = ["hero-clean-input", "hero-clean-btn", "demo-copy-btn", "demo-open-full"];
    for (const id of addedIds) {
      const tagMatch = HTML.match(new RegExp(`<[a-z]+[^>]*id\\s*=\\s*["']${id}["'][^>]*>([^<]*)`, "i"));
      assert.ok(tagMatch, `element #${id} must exist`);
      const text = tagMatch[0];
      assert.ok(!text.includes("—"), `#${id} markup must not contain an em-dash`);
    }
  });

  test("the full-tool fallback link points at https://muga.app/clean", () => {
    const linkMatch = HTML.match(/<a[^>]*id\s*=\s*["']demo-open-full["'][^>]*>/);
    assert.ok(linkMatch, "#demo-open-full must exist");
    assert.ok(/href\s*=\s*["']https:\/\/muga\.app\/clean["']/.test(linkMatch[0]), "#demo-open-full must link to https://muga.app/clean");
  });
});
