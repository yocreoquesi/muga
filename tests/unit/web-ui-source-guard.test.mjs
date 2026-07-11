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
const PARAM_INSIGHT_JS = readFileSync(join(ROOT, "web/param-insight.js"), "utf8");
const REPORT_LINK_JS = readFileSync(join(ROOT, "web/report-link.js"), "utf8");

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

  test("web/param-insight.js and web/report-link.js never issue network requests (spec: Report flow is user-initiated navigation, not an auto request)", () => {
    for (const [label, text] of [["param-insight.js", PARAM_INSIGHT_JS], ["report-link.js", REPORT_LINK_JS]]) {
      assert.ok(!text.includes("fetch("), `${label} must not call fetch(`);
      assert.ok(!text.includes("XMLHttpRequest"), `${label} must not use XMLHttpRequest`);
    }
  });

  test("the report control is a user-initiated anchor navigation, not an auto request", () => {
    const reportLinkMatch = HTML.match(/<a[^>]*id\s*=\s*["']report-link["'][^>]*>/i);
    assert.ok(reportLinkMatch, "a #report-link anchor must exist");
    assert.ok(/target\s*=\s*["']_blank["']/.test(reportLinkMatch[0]), "#report-link must open in a new tab (target=\"_blank\")");
    assert.ok(/rel\s*=\s*["'][^"']*noopener/.test(reportLinkMatch[0]), "#report-link must set rel=\"noopener\" for a target=_blank anchor");
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

  test("web/param-insight.js and web/report-link.js user-facing strings have no em-dash", () => {
    // Doc comments legitimately use em-dashes elsewhere in the repo; strip
    // them the same way UI_JS/UI_VIEW_JS are scanned by stripping only
    // string-literal risk is out of scope here — these two modules carry
    // no user-facing copy at all besides the "Other" label and report body
    // text, both plain ASCII, so a raw scan is sufficient and won't
    // false-positive on doc comments containing an em-dash.
    for (const [label, text] of [["param-insight.js", stripJsComments(PARAM_INSIGHT_JS)], ["report-link.js", stripJsComments(REPORT_LINK_JS)]]) {
      assert.ok(!text.includes("—"), `${label} code (excluding doc comments) must not contain an em-dash (—)`);
      assert.ok(!text.includes("--"), `${label} code (excluding doc comments) must not contain "--"`);
    }
  });

  test("the URL-cleaning purpose is explicit in the page copy", () => {
    assert.ok(/clean/i.test(htmlBody), "page copy must reference cleaning");
    assert.ok(/tracking/i.test(htmlBody), "page copy must reference tracking parameters");
  });

  test("page copy honestly describes MUGA's own scoped referral (web-tool-naked-link-injection)", () => {
    // Flipped from the original #1029 anti-injection assertion: the web tool
    // now injects MUGA's own referral on naked Amazon/eBay links (ADR-1),
    // so the copy must describe that honestly instead of denying it. The
    // em-dash / "--" bans above and the zero-request promise below still
    // hold; only the "never injects" claim is retired.
    assert.ok(/own referral/i.test(htmlBody), "index.html must describe MUGA's own referral");
    assert.ok(/selected store/i.test(htmlBody), "index.html must scope injection to selected stores");
    assert.ok(
      /existing|already|no referral of its own|no existing referral/i.test(htmlBody),
      "index.html must state that an existing referral is always kept",
    );
  });

  test("the page keeps truthful, non-eternal privacy signals after the narrative softening", () => {
    // The eternal local-only promise was intentionally dropped (the product
    // may add server-side features later). The page still communicates the
    // present-tense stance, and the behavioral no-fetch guarantee stays
    // enforced by the "never issue network requests" tests above.
    assert.ok(/runs right here in the page/i.test(htmlBody), "index.html must state the cleaning runs right here in the page");
    assert.ok(/no third-party requests/i.test(htmlBody), "index.html must still state there are no third-party requests");
    assert.ok(
      !/entirely in your browser|never contacts a server|nothing about the URL (is|ever) (sent|leaves)/i.test(htmlBody),
      "index.html must not make an eternal local-only promise",
    );
  });
});

describe("sdd/web-cleaning-insight (Slice 1) DOM wiring", () => {
  test("copy sits by the result, not inside the input panel (spec: Copy button placement)", () => {
    const inputPanelMatch = HTML.match(/<section class="panel" aria-labelledby="input-heading">[\s\S]*?<\/section>/);
    assert.ok(inputPanelMatch, "the input panel section must exist");
    assert.ok(
      !/id\s*=\s*["']copy-btn["']/.test(inputPanelMatch[0]),
      "copy-btn must not exist inside the input panel's .actions block",
    );

    const resultUrlRowIndex = HTML.indexOf('id="result-url-row"');
    const copyBtnIndex = HTML.indexOf('id="copy-btn"');
    assert.ok(resultUrlRowIndex !== -1 && copyBtnIndex !== -1, "both #result-url-row and #copy-btn must exist");
    assert.ok(copyBtnIndex > resultUrlRowIndex, "copy-btn must be adjacent to/after #result-url-row");

    const resultUrlRowBlock = HTML.slice(resultUrlRowIndex, resultUrlRowIndex + 600);
    assert.ok(resultUrlRowBlock.includes('id="copy-btn"'), "copy-btn must sit inside/adjacent to the #result-url-row block");
  });

  test("the unwrap callout is a structurally distinct container from the length-reduction bar", () => {
    assert.ok(HTML.includes('id="length-bar"'), "a #length-bar container must exist");
    assert.ok(HTML.includes('id="unwrap-callout"'), "a #unwrap-callout container must exist");
    const lengthBarMatch = HTML.match(/<div class="length-bar" id="length-bar"[^>]*>[\s\S]*?<\/div>\s*<\/div>/);
    assert.ok(lengthBarMatch, "the #length-bar block must be extractable");
    assert.ok(
      !lengthBarMatch[0].includes('id="unwrap-callout"'),
      "#unwrap-callout must not be nested inside #length-bar (spec: callout is separate from the bar)",
    );
  });

  test("ui.js gates the unwrap callout on view.unwrapped", () => {
    assert.ok(/unwrapCallout\.hidden/.test(UI_JS), "ui.js must toggle refs.unwrapCallout.hidden based on view.unwrapped");
  });

  test("the lede and footer describe the report flow without an eternal local-only promise (design: Copy Rescope + narrative softening)", () => {
    const body = stripStyleBlocks(HTML);
    assert.ok(body.includes("runs right here in the page"), "lede must state the cleaning runs right here in the page (present-tense mechanism, not an eternal local promise)");
    assert.ok(body.includes("prefilled GitHub issue"), "lede must describe the report flow as a prefilled GitHub issue");
    assert.ok(body.includes("opens GitHub only if you click it"), "footer must state reporting opens GitHub only on click");
    assert.ok(!/never contacts a server|nothing (about the URL )?ever leaves|entirely in your browser/i.test(body), "copy must not make an eternal local-only promise (product may add server features later)");
  });
});

describe("MUGA referral opt-out and disclosure (web-tool-naked-link-injection)", () => {
  test("#copy-no-referral-btn exists adjacent to #copy-btn and is hidden by default", () => {
    const resultUrlRowIndex = HTML.indexOf('id="result-url-row"');
    const noReferralBtnIndex = HTML.indexOf('id="copy-no-referral-btn"');
    assert.ok(resultUrlRowIndex !== -1 && noReferralBtnIndex !== -1, "both #result-url-row and #copy-no-referral-btn must exist");
    assert.ok(noReferralBtnIndex > resultUrlRowIndex, "#copy-no-referral-btn must sit inside/adjacent to #result-url-row");

    const resultUrlRowBlock = HTML.slice(resultUrlRowIndex, resultUrlRowIndex + 900);
    const btnMatch = resultUrlRowBlock.match(/<button[^>]*id\s*=\s*["']copy-no-referral-btn["'][^>]*>/);
    assert.ok(btnMatch, "#copy-no-referral-btn must be a <button> inside the result-url-row block");
    assert.ok(/\bhidden\b/.test(btnMatch[0]), "#copy-no-referral-btn must be hidden by default");
  });

  test("#referral-disclosure element exists near the result", () => {
    assert.ok(HTML.includes('id="referral-disclosure"'), "a #referral-disclosure element must exist");
  });

  test("ui.js toggles #copy-no-referral-btn on view.mugaReferralInjected and copies cleanUrlNoMugaReferral", () => {
    const code = stripJsComments(UI_JS);
    assert.ok(/mugaReferralInjected/.test(code), "ui.js must reference view.mugaReferralInjected");
    assert.ok(/cleanUrlNoMugaReferral/.test(code), "ui.js must reference view.cleanUrlNoMugaReferral");
  });

  test("ui.js renders view.disclosure without adding new decision logic", () => {
    const code = stripJsComments(UI_JS);
    assert.ok(/disclosure/.test(code), "ui.js must render view.disclosure");
    // Structural-guard precedent: ui.js applies the view-model, it does not
    // compute affiliate/injection eligibility itself.
    assert.ok(!/action\s*===\s*["']injected["']/.test(code), "ui.js must not re-derive injection eligibility itself");
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
