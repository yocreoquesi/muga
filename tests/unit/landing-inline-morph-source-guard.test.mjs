/**
 * MUGA: Landing inline tool — source guard.
 *
 * The landing hero embeds the FULL /clean tool (#demo-tool), visible from page
 * load, driven by the REAL controller (landing/clean/ui.js, the mirror of
 * web/ui.js) with ZERO cleaning logic duplicated inline. There is no longer a
 * click-to-morph step and no static before/after illustration: the tool is
 * always on screen, and the engine bundle + UI module load lazily on the first
 * interaction with the tool.
 *
 * landing/index.html's bootstrap script is browser-only (DOM access) and cannot
 * be exercised under node:test, mirroring the repo's existing `readFileSync`
 * structural-test pattern (e.g. tests/unit/web-ui-source-guard.test.mjs,
 * tests/unit/csp-inline-style-guard.test.mjs) for modules that cannot be
 * imported in Node. These checks pin that wiring: the always-visible tool
 * markup, the single-line input, the lazy same-origin load path triggered only
 * on interaction, the graceful-degradation fallback, and that the landing hosts
 * every id ui.js init() binds to (so a future ui.js binding the landing forgets
 * is caught here).
 *
 * Scope: these checks target ONLY the inline tool feature (the bootstrap script
 * block between the "// Lazy tool bootstrap:" and "// Console easter egg"
 * comments, and the markup/copy added for it). They deliberately do not scan
 * the rest of landing/index.html's pre-existing markup/scripts.
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

const BOOTSTRAP_START = HTML.indexOf("// Lazy tool bootstrap:");
const BOOTSTRAP_END = HTML.indexOf("// Console easter egg");
if (BOOTSTRAP_START === -1 || BOOTSTRAP_END === -1 || BOOTSTRAP_END <= BOOTSTRAP_START) {
  throw new Error("Could not locate the inline-tool bootstrap script block markers in landing/index.html");
}
const BOOTSTRAP = HTML.slice(BOOTSTRAP_START, BOOTSTRAP_END);
const BOOTSTRAP_NO_COMMENTS = stripJsComments(BOOTSTRAP);

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

describe("landing inline tool — always visible (no morph gate)", () => {
  test("#demo-tool exists and is NOT hidden behind a morph", () => {
    const toolMatch = HTML.match(/<div[^>]*id\s*=\s*["']demo-tool["'][^>]*>/);
    assert.ok(toolMatch, "#demo-tool must exist");
    assert.ok(
      !/\bhidden\b/.test(toolMatch[0]),
      "#demo-tool must NOT carry the hidden attribute — the tool is visible from page load",
    );
  });

  test("the morph mechanism is gone (no #cta-web, no #demo-example, no .is-live)", () => {
    assert.ok(!HTML.includes('id="cta-web"'), "the #cta-web \"Clean a URL\" anchor must be removed");
    assert.ok(!HTML.includes('id="demo-example"'), "the static #demo-example illustration must be removed");
    assert.ok(!/\.demo\.is-live|classList\.add\(\s*['"]is-live/.test(HTML), "the .is-live morph state must be gone");
    assert.ok(!/\benterLiveMode\b/.test(HTML), "the enterLiveMode() morph step must be gone");
  });

  test("the Clean and Copy controls are real <button> elements (keyboard-operable)", () => {
    assert.ok(/<button[^>]*id\s*=\s*["']clean-btn["']/.test(HTML), "clean-btn must be a <button>");
    assert.ok(/<button[^>]*id\s*=\s*["']copy-btn["']/.test(HTML), "copy-btn must be a <button>");
  });

  test("the result message announces changes to assistive tech", () => {
    const resultMessageTag = HTML.match(/<p[^>]*id\s*=\s*["']result-message["'][^>]*>/);
    assert.ok(resultMessageTag, "result-message element must exist");
    assert.ok(/aria-live\s*=\s*["']polite["']/.test(resultMessageTag[0]), "result-message must have aria-live=\"polite\"");
  });
});

describe("landing inline tool — single-line URL input", () => {
  test("#url-input is a single-line <input>, never a <textarea>", () => {
    assert.ok(
      /<input[^>]*id\s*=\s*["']url-input["'][^>]*>/i.test(HTML),
      "#url-input must be an <input> element (single line)",
    );
    assert.ok(
      !/<textarea[^>]*id\s*=\s*["']url-input["']/i.test(HTML),
      "#url-input must NOT be a <textarea> (the tall multi-line control was replaced)",
    );
  });

  test("#url-input keeps its type/spellcheck/autocomplete attributes", () => {
    const inputMatch = HTML.match(/<input[^>]*id\s*=\s*["']url-input["'][^>]*>/i);
    assert.ok(inputMatch, "#url-input must exist");
    assert.ok(/type\s*=\s*["']url["']/.test(inputMatch[0]), "#url-input must be type=\"url\"");
    assert.ok(/spellcheck\s*=\s*["']false["']/.test(inputMatch[0]), "#url-input must set spellcheck=\"false\"");
    assert.ok(/autocomplete\s*=\s*["']off["']/.test(inputMatch[0]), "#url-input must set autocomplete=\"off\"");
  });

  test("pressing Enter in the input triggers a #clean-btn click (landing-only handler)", () => {
    assert.ok(
      /addEventListener\(\s*['"]keydown['"]/.test(BOOTSTRAP),
      "the bootstrap script must wire a keydown handler for Enter-to-clean",
    );
    assert.ok(
      /e\.key\s*===\s*['"]Enter['"]/.test(BOOTSTRAP),
      "the keydown handler must act on the Enter key",
    );
  });
});

describe("landing inline tool — lazy load on first interaction", () => {
  test("the engine bundle and the real UI module load only inside startTool(), never at module scope", () => {
    const startToolMatch = BOOTSTRAP.match(/function startTool\s*\([^)]*\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(startToolMatch, "a startTool() function must exist");
    assert.ok(
      startToolMatch[0].includes("./clean/engine/cleaner-bundle.js"),
      "startTool() must load the vendored engine bundle from ./clean/engine/cleaner-bundle.js",
    );
    assert.ok(
      /import\(\s*['"]\.\/clean\/ui\.js['"]\s*\)/.test(startToolMatch[0]),
      "startTool() must dynamically import the real controller from ./clean/ui.js",
    );
    assert.ok(
      /\bui\.init\(\)/.test(startToolMatch[0]),
      "startTool() must call the real controller's init() once the module is imported",
    );

    const outsideStartTool = BOOTSTRAP.replace(startToolMatch[0], "");
    assert.ok(
      !outsideStartTool.includes("cleaner-bundle.js") && !outsideStartTool.includes("./clean/ui.js"),
      "the engine bundle/UI module must be referenced only inside startTool(), never elsewhere in the bootstrap script",
    );
  });

  test("startTool() is only invoked from bootstrap(), never eagerly at module scope", () => {
    const bootstrapFn = BOOTSTRAP.match(/function bootstrap\s*\([^)]*\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(bootstrapFn, "a bootstrap() function must exist");
    assert.ok(
      bootstrapFn[0].includes("startTool("),
      "bootstrap() (the first-interaction handler) must call startTool() so the engine loads on interaction, not at page load",
    );

    // The only startTool() references are its own definition and the bootstrap()
    // invocation — nothing runs it at module top level.
    const invocations = (BOOTSTRAP_NO_COMMENTS.match(/startTool\(/g) || []).length;
    const definition = (BOOTSTRAP_NO_COMMENTS.match(/function startTool\(/g) || []).length;
    assert.equal(
      invocations - definition,
      1,
      "startTool() must be invoked exactly once (from bootstrap), never eagerly at module scope",
    );
  });

  test("the tool loads on first interaction (focusin + pointerdown), and the listeners are one-shot", () => {
    assert.ok(
      /addEventListener\(\s*['"]focusin['"]\s*,\s*bootstrap\s*\)/.test(BOOTSTRAP),
      "the tool must listen for the first focusin (focusin bubbles, so the input is covered)",
    );
    assert.ok(
      /addEventListener\(\s*['"]pointerdown['"]\s*,\s*bootstrap\s*\)/.test(BOOTSTRAP),
      "the tool must listen for the first pointerdown inside the container",
    );
    const bootstrapFn = BOOTSTRAP.match(/function bootstrap\s*\([^)]*\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(bootstrapFn, "a bootstrap() function must exist");
    assert.ok(
      /removeEventListener\(\s*['"]focusin['"]/.test(bootstrapFn[0]) &&
        /removeEventListener\(\s*['"]pointerdown['"]/.test(bootstrapFn[0]),
      "bootstrap() must remove BOTH its listeners on first fire so ui.js's handlers take over cleanly",
    );
  });

  test("an eager Clean-before-load click is replayed once after init() binds the real handler", () => {
    const bootstrapFn = BOOTSTRAP.match(/function bootstrap\s*\([^)]*\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(bootstrapFn, "a bootstrap() function must exist");
    assert.ok(
      /pendingClean\s*=\s*true/.test(bootstrapFn[0]),
      "bootstrap() must set a pendingClean flag when the initiating pointerdown was on #clean-btn",
    );
    assert.ok(
      /clean-btn/.test(bootstrapFn[0]),
      "bootstrap() must detect the #clean-btn interaction",
    );
    // The flag is cleared before the replay so a clean can never fire twice.
    assert.ok(
      /pendingClean\s*=\s*false/.test(bootstrapFn[0]),
      "the pendingClean flag must be cleared before the replay to guard against double-cleaning",
    );
  });
});

describe("landing inline tool — does not reimplement the cleaner", () => {
  test("no hand-rolled renderer lives inline (ui.js renders everything)", () => {
    assert.ok(!/function renderResult\b/.test(BOOTSTRAP), "no lightweight renderResult() may exist (ui.js renders)");
    assert.ok(!/function renderBefore\b/.test(BOOTSTRAP), "no lightweight renderBefore() may exist");
    assert.ok(!/function renderAfter\b/.test(BOOTSTRAP), "no lightweight renderAfter() may exist");
    assert.ok(!HTML.includes('id="demo-open-full"'), "no #demo-open-full \"open the full tool\" link may exist");
    assert.ok(!/open the full tool/i.test(BOOTSTRAP_NO_COMMENTS), "no \"open the full tool\" fallback copy may remain");
  });
});

describe("landing inline tool — hosts the real controller's full markup", () => {
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

  test("CSS restores [hidden] semantics for .btn so the opt-out button hides when not injected", () => {
    // Regression guard for the live bug: `.btn { display: inline-flex }`
    // overrides the UA `[hidden]` rule, so copy-no-referral-btn stayed visible
    // even when hidden. The landing stylesheet must neutralize this.
    const styleMatch = HTML.match(/<style[\s\S]*?<\/style>/i);
    assert.ok(styleMatch, "landing/index.html must have a <style> block");
    assert.ok(
      /\.btn\[hidden\]\s*\{[^}]*display:\s*none/i.test(styleMatch[0]),
      "landing CSS must include `.btn[hidden] { display: none }` so the hidden opt-out button does not show",
    );
  });
});

describe("landing inline tool — security (AGENTS.md)", () => {
  test("never assigns innerHTML with dynamic data", () => {
    assert.ok(!/\.innerHTML\s*=/.test(BOOTSTRAP), "the bootstrap script must render via textContent/createElement, never innerHTML");
  });

  test("never calls eval or new Function", () => {
    assert.ok(!/\beval\s*\(/.test(BOOTSTRAP), "the bootstrap script must not call eval(");
    assert.ok(!/new\s+Function\s*\(/.test(BOOTSTRAP), "the bootstrap script must not construct new Function(");
  });

  test("wires events via addEventListener only", () => {
    assert.ok(BOOTSTRAP.includes("addEventListener"), "the bootstrap script must attach handlers via addEventListener");
    assert.ok(!/\.on(click|keydown|keyup|submit)\s*=/.test(BOOTSTRAP), "the bootstrap script must not assign .onclick/.onkeydown/... handlers directly");
  });

  test("the fallback message is rendered via textContent, never concatenated into markup", () => {
    assert.ok(BOOTSTRAP.includes(".textContent = text"), "the graceful-degradation message must be assigned via .textContent");
    assert.ok(!/(innerHTML|outerHTML)/.test(BOOTSTRAP_NO_COMMENTS), "the bootstrap script's executable code must not touch innerHTML/outerHTML at all");
  });

  test("landing/index.html has no inline event handler attributes", () => {
    assert.ok(
      !/\bon[a-z]+\s*=\s*["']/i.test(HTML),
      "index.html must not use inline event handler attributes (onclick=, onload=, ...)",
    );
  });

  test("the dynamically injected engine <script> src is same-origin, not a CDN/external host", () => {
    const scriptSrcMatch = BOOTSTRAP.match(/script\.src\s*=\s*['"][^'"]+['"]/);
    assert.ok(scriptSrcMatch, "startTool() must set script.src");
    assert.ok(!/https?:\/\//.test(scriptSrcMatch[0]), "script.src must not be an absolute/external URL");
    assert.ok(scriptSrcMatch[0].includes("./clean/engine/"), "script.src must point at ./clean/engine/");
  });

  test("the dynamically imported UI module is same-origin", () => {
    const importMatch = BOOTSTRAP.match(/import\(\s*['"]([^'"]+)['"]\s*\)/);
    assert.ok(importMatch, "startTool() must dynamically import the UI module");
    assert.ok(importMatch[1].startsWith("./"), `the imported UI module must be same-origin relative, got: ${importMatch[1]}`);
  });
});

describe("landing inline tool — copy style constraints", () => {
  test("no em-dash in the bootstrap script's user-facing strings (comments excluded)", () => {
    assert.ok(!BOOTSTRAP_NO_COMMENTS.includes("—"), "the bootstrap script's copy strings must not contain an em-dash");
  });

  test("no double-hyphen dash in the bootstrap script's user-facing strings (comments excluded)", () => {
    assert.ok(!BOOTSTRAP_NO_COMMENTS.includes("--"), "the bootstrap script's copy strings must not contain \"--\"");
  });

  test("added tool markup copy (labels, button text, disclaimers) has no em-dash", () => {
    const addedIds = ["url-input", "clean-btn", "copy-btn", "copy-no-referral-btn", "report-link", "bk"];
    for (const id of addedIds) {
      const tagMatch = HTML.match(new RegExp(`<[a-z]+[^>]*id\\s*=\\s*["']${id}["'][^>]*>([^<]*)`, "i"));
      assert.ok(tagMatch, `element #${id} must exist`);
      assert.ok(!tagMatch[0].includes("—"), `#${id} markup must not contain an em-dash`);
    }
  });
});
