/**
 * MUGA: Landing inline morph — source guard.
 *
 * landing/index.html's morph script is browser-only (DOM/clipboard access)
 * and cannot be exercised under node:test, mirroring the repo's existing
 * `readFileSync` structural-test pattern (e.g. tests/unit/web-ui-source-
 * guard.test.mjs, tests/unit/csp-inline-style-guard.test.mjs) for modules
 * that cannot be imported in Node.
 *
 * The morph no longer reimplements the cleaner: clicking "Clean a link now"
 * (#cta-web) reveals the FULL /clean tool (#demo-tool) and hands it to the
 * REAL controller (landing/clean/ui.js, the mirror of web/ui.js). These
 * checks pin that wiring: the lazy same-origin load path, the progressive-
 * enhancement fallback, the static-example hide-on-morph fix, and that the
 * landing hosts every id ui.js init() binds to (so a future ui.js binding the
 * landing forgets is caught here).
 *
 * Scope: these checks target ONLY the morph feature (the inline script
 * block between the "// Inline morph:" and "// Console easter egg"
 * comments, and the markup/copy added for it). They deliberately do not
 * scan the rest of landing/index.html's pre-existing markup/scripts.
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
const UI_JS = readFileSync(join(ROOT, "web/ui.js"), "utf8");

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

/** Every element id web/ui.js's init() binds via getElementById(). The
 * landing must host every one of these inside #demo-tool, or the real
 * controller would fail to wire part of the tool. Derived from the source
 * so a NEW binding added to ui.js that the landing forgets is caught. */
function uiInitBoundIds() {
  const ids = new Set();
  const re = /getElementById\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(UI_JS)) !== null) ids.add(m[1]);
  return [...ids];
}

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

  test("the engine bundle and the real UI module load only inside loadTool(), never at the top level", () => {
    const loadToolMatch = MORPH_SCRIPT.match(/function loadTool\s*\([^)]*\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(loadToolMatch, "a loadTool() function must exist");
    assert.ok(
      loadToolMatch[0].includes("./clean/engine/cleaner-bundle.js"),
      "loadTool() must load the vendored engine bundle from ./clean/engine/cleaner-bundle.js",
    );
    assert.ok(
      /import\(\s*['"]\.\/clean\/ui\.js['"]\s*\)/.test(loadToolMatch[0]),
      "loadTool() must dynamically import the real controller from ./clean/ui.js",
    );
    assert.ok(
      /\bui\.init\(\)/.test(loadToolMatch[0]),
      "loadTool() must call the real controller's init() once the module is imported",
    );

    const outsideLoadTool = MORPH_SCRIPT.replace(loadToolMatch[0], "");
    assert.ok(
      !outsideLoadTool.includes("cleaner-bundle.js") && !outsideLoadTool.includes("./clean/ui.js"),
      "the engine bundle/UI module must be referenced only inside loadTool(), never elsewhere in the morph script",
    );
  });

  test("loadTool() is only invoked from enterLiveMode() (the click path), never eagerly at module scope", () => {
    const enterLiveMode = MORPH_SCRIPT.match(/function enterLiveMode\s*\([^)]*\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(enterLiveMode, "an enterLiveMode() function must exist");
    assert.ok(
      enterLiveMode[0].includes("loadTool("),
      "enterLiveMode() (the #cta-web morph step) must call loadTool() so the engine loads on click, not at page load",
    );

    // The only loadTool() calls in the script are its own definition and the
    // enterLiveMode() invocation — nothing runs it at module top level.
    const invocations = (MORPH_SCRIPT_NO_COMMENTS.match(/loadTool\(/g) || []).length;
    const definition = (MORPH_SCRIPT_NO_COMMENTS.match(/function loadTool\(/g) || []).length;
    assert.equal(
      invocations - definition,
      1,
      "loadTool() must be invoked exactly once (from enterLiveMode), never eagerly at module scope",
    );
  });

  test("the morph does not reimplement the cleaner (no hand-rolled renderer / open-full fallback)", () => {
    assert.ok(!/function renderResult\b/.test(MORPH_SCRIPT), "the lightweight renderResult() must be gone (ui.js renders now)");
    assert.ok(!/function renderBefore\b/.test(MORPH_SCRIPT), "the lightweight renderBefore() must be gone");
    assert.ok(!/function renderAfter\b/.test(MORPH_SCRIPT), "the lightweight renderAfter() must be gone");
    assert.ok(!HTML.includes('id="demo-open-full"'), "the #demo-open-full \"open the full tool\" link must be removed");
    assert.ok(!/open the full tool/i.test(MORPH_SCRIPT_NO_COMMENTS), "no \"open the full tool\" fallback copy should remain in the morph script");
  });
});

describe("landing inline morph — hide static example on morph", () => {
  test("#demo-example and #demo-tool are distinct containers", () => {
    assert.ok(/<div[^>]*id\s*=\s*["']demo-example["'][^>]*>/.test(HTML), "#demo-example (static illustration) must exist");
    assert.ok(/<div[^>]*id\s*=\s*["']demo-tool["'][^>]*>/.test(HTML), "#demo-tool (live tool) must exist");

    const exampleIndex = HTML.indexOf('id="demo-example"');
    const toolIndex = HTML.indexOf('id="demo-tool"');
    const exampleBlock = HTML.slice(exampleIndex, toolIndex);
    assert.ok(
      !exampleBlock.includes('id="url-input"') && !exampleBlock.includes('id="clean-btn"'),
      "the live tool ids must not live inside #demo-example — the example and the tool must be separate nodes",
    );
  });

  test("#demo-tool is hidden before the morph", () => {
    const toolMatch = HTML.match(/<div[^>]*id\s*=\s*["']demo-tool["'][^>]*>/);
    assert.ok(toolMatch, "#demo-tool must exist");
    assert.ok(/\bhidden\b/.test(toolMatch[0]), "#demo-tool must carry the hidden attribute before the morph");
  });

  test("the static example is hidden under .demo.is-live (the hide-on-morph fix)", () => {
    assert.ok(
      /\.demo\.is-live\s+#demo-example\s*\{[^}]*display:\s*none/.test(HTML),
      "CSS must set `.demo.is-live #demo-example { display: none }` so the static example DISAPPEARS on morph (not merely dims)",
    );
  });
});

describe("landing inline morph — hosts the real controller's full markup", () => {
  test("the landing includes every element id web/ui.js init() binds to", () => {
    const ids = uiInitBoundIds();
    assert.ok(ids.length >= 15, `expected ui.js to bind many ids, got ${ids.length}`);
    for (const id of ids) {
      assert.ok(
        HTML.includes(`id="${id}"`),
        `landing/index.html must host id="${id}" (web/ui.js init() binds it; the live tool needs it present)`,
      );
    }
  });

  test("the referral opt-out control and disclosure are present", () => {
    assert.ok(HTML.includes('id="copy-no-referral-btn"'), "#copy-no-referral-btn (copy without MUGA referral) must exist");
    assert.ok(HTML.includes('id="referral-disclosure"'), "#referral-disclosure must exist");
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

  test("the fallback message is rendered via textContent, never concatenated into markup", () => {
    assert.ok(MORPH_SCRIPT.includes(".textContent = text"), "the graceful-degradation message must be assigned via .textContent");
    assert.ok(!/(innerHTML|outerHTML)/.test(MORPH_SCRIPT_NO_COMMENTS), "the morph script's executable code must not touch innerHTML/outerHTML at all");
  });

  test("landing/index.html has no inline event handler attributes", () => {
    assert.ok(
      !/\bon[a-z]+\s*=\s*["']/i.test(HTML),
      "index.html must not use inline event handler attributes (onclick=, onload=, ...)",
    );
  });

  test("the dynamically injected engine <script> src is same-origin, not a CDN/external host", () => {
    const scriptSrcMatch = MORPH_SCRIPT.match(/script\.src\s*=\s*['"][^'"]+['"]/);
    assert.ok(scriptSrcMatch, "loadTool() must set script.src");
    assert.ok(!/https?:\/\//.test(scriptSrcMatch[0]), "script.src must not be an absolute/external URL");
    assert.ok(scriptSrcMatch[0].includes("./clean/engine/"), "script.src must point at ./clean/engine/");
  });

  test("the dynamically imported UI module is same-origin", () => {
    const importMatch = MORPH_SCRIPT.match(/import\(\s*['"]([^'"]+)['"]\s*\)/);
    assert.ok(importMatch, "loadTool() must dynamically import the UI module");
    assert.ok(importMatch[1].startsWith("./"), `the imported UI module must be same-origin relative, got: ${importMatch[1]}`);
  });
});

describe("landing inline morph — accessibility", () => {
  test("the static example region announces changes to assistive tech", () => {
    const outputMatch = HTML.match(/<div[^>]*id\s*=\s*["']demo-output["'][^>]*>/);
    assert.ok(outputMatch, "#demo-output must exist");
    assert.ok(/aria-live\s*=\s*["']polite["']/.test(outputMatch[0]), "#demo-output must have aria-live=\"polite\"");

    const footMatch = HTML.match(/<div[^>]*id\s*=\s*["']demo-foot["'][^>]*>/);
    assert.ok(footMatch, "#demo-foot must exist");
    assert.ok(/aria-live\s*=\s*["']polite["']/.test(footMatch[0]), "#demo-foot must have aria-live=\"polite\"");
  });

  test("the live tool's Clean and Copy controls are real <button> elements (keyboard-operable by default)", () => {
    assert.ok(/<button[^>]*id\s*=\s*["']clean-btn["']/.test(HTML), "clean-btn must be a <button>");
    assert.ok(/<button[^>]*id\s*=\s*["']copy-btn["']/.test(HTML), "copy-btn must be a <button>");
  });

  test("the live tool's result message announces changes to assistive tech", () => {
    const resultMessageTag = HTML.match(/<p[^>]*id\s*=\s*["']result-message["'][^>]*>/);
    assert.ok(resultMessageTag, "result-message element must exist");
    assert.ok(/aria-live\s*=\s*["']polite["']/.test(resultMessageTag[0]), "result-message must have aria-live=\"polite\"");
  });
});

describe("landing inline morph — copy style constraints", () => {
  test("no em-dash in the morph script's user-facing strings (comments excluded)", () => {
    assert.ok(!MORPH_SCRIPT_NO_COMMENTS.includes("—"), "the morph script's copy strings must not contain an em-dash");
  });

  test("no double-hyphen dash in the morph script's user-facing strings (comments excluded)", () => {
    assert.ok(!MORPH_SCRIPT_NO_COMMENTS.includes("--"), "the morph script's copy strings must not contain \"--\"");
  });

  test("added tool markup copy (labels, button text, disclaimers) has no em-dash", () => {
    const addedIds = ["url-input", "clean-btn", "copy-btn", "copy-no-referral-btn", "report-link"];
    for (const id of addedIds) {
      const tagMatch = HTML.match(new RegExp(`<[a-z]+[^>]*id\\s*=\\s*["']${id}["'][^>]*>([^<]*)`, "i"));
      assert.ok(tagMatch, `element #${id} must exist`);
      assert.ok(!tagMatch[0].includes("—"), `#${id} markup must not contain an em-dash`);
    }
  });
});
