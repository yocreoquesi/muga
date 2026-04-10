/**
 * MUGA: Tests for HTML sanitizer security and import validation robustness.
 *
 * sanitizeHTML (i18n.js) uses DOMParser which is browser-only, so we verify
 * the security-critical allowlists and patterns via source string inspection.
 * Import validation (options.js) is also browser-only, so we verify the
 * validation patterns exist in source and test extracted logic.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const I18N_SOURCE = readFileSync(join(__dirname, "../../src/lib/i18n.js"), "utf8");
const OPTIONS_SOURCE = readFileSync(join(__dirname, "../../src/options/options.js"), "utf8");

// ---------------------------------------------------------------------------
// sanitizeHTML security (i18n.js)
// ---------------------------------------------------------------------------
describe("sanitizeHTML security (i18n.js source verification)", () => {

  test("ALLOWED_TAGS only contains safe inline elements", () => {
    const match = I18N_SOURCE.match(/ALLOWED_TAGS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
    assert.ok(match, "ALLOWED_TAGS declaration must exist");
    const tags = match[1].match(/"([^"]+)"/g).map(s => s.replace(/"/g, ""));
    const SAFE_TAGS = new Set(["code", "br", "strong", "em", "a", "small", "span", "b", "i"]);
    for (const tag of tags) {
      assert.ok(SAFE_TAGS.has(tag), `Tag "${tag}" in ALLOWED_TAGS is not a safe inline element`);
    }
    // Must not contain dangerous tags
    const DANGEROUS = ["script", "iframe", "object", "embed", "form", "input", "img", "svg", "link", "meta", "base"];
    for (const tag of DANGEROUS) {
      assert.ok(!tags.includes(tag), `Dangerous tag "${tag}" must NOT be in ALLOWED_TAGS`);
    }
  });

  test("ALLOWED_ATTRS does not contain style, onclick, or event handlers", () => {
    const match = I18N_SOURCE.match(/ALLOWED_ATTRS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
    assert.ok(match, "ALLOWED_ATTRS declaration must exist");
    const attrs = match[1].match(/"([^"]+)"/g).map(s => s.replace(/"/g, ""));
    const FORBIDDEN = ["style", "onclick", "onload", "onerror", "onmouseover", "onfocus",
                        "onblur", "onsubmit", "onkeydown", "onkeyup", "onchange", "action",
                        "formaction", "srcdoc", "src", "data"];
    for (const attr of FORBIDDEN) {
      assert.ok(!attrs.includes(attr), `Attribute "${attr}" must NOT be in ALLOWED_ATTRS`);
    }
  });

  test("href validation rejects javascript: and data: protocols", () => {
    assert.ok(
      I18N_SOURCE.includes('if (!/^(https?:|\\.\\.\\/|#)/.test(href))'),
      "sanitizeHTML must validate href with protocol allowlist"
    );
  });

  test("sanitizeHTML uses DOMParser for safe parsing (not innerHTML assignment)", () => {
    assert.ok(
      I18N_SOURCE.includes("new DOMParser().parseFromString(html"),
      "sanitizeHTML must use DOMParser for HTML parsing"
    );
  });

  test("non-HTML keys use textContent (not innerHTML)", () => {
    // applyTranslations must use textContent for regular keys
    assert.ok(
      I18N_SOURCE.includes("el.textContent = value"),
      "Regular i18n keys must use textContent, not innerHTML"
    );
  });

  test("only known keys are treated as HTML (HTML_KEYS gate)", () => {
    const match = I18N_SOURCE.match(/HTML_KEYS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
    assert.ok(match, "HTML_KEYS declaration must exist");
    const keys = match[1].match(/"([^"]+)"/g).map(s => s.replace(/"/g, ""));
    // Must be a small, finite set
    assert.ok(keys.length <= 10, `HTML_KEYS has ${keys.length} entries, expected <= 10`);
    // innerHTML assignment must be gated by HTML_KEYS check
    assert.ok(
      I18N_SOURCE.includes("if (HTML_KEYS.has(key))"),
      "innerHTML must only be used when key is in HTML_KEYS"
    );
  });

  test("no inline style attributes in translation strings", () => {
    // Verify no translation value contains style= (now uses CSS classes)
    const styleInTranslation = /style\s*=\s*"/;
    const translationBlock = I18N_SOURCE.match(/export const TRANSLATIONS = \{([\s\S]*?)\n\};/);
    assert.ok(translationBlock, "TRANSLATIONS block must exist");
    assert.ok(
      !styleInTranslation.test(translationBlock[1]),
      "No translation string should contain inline style attributes (use CSS classes instead)"
    );
  });
});

// ---------------------------------------------------------------------------
// Import validation (options.js)
// ---------------------------------------------------------------------------
describe("import validation robustness (options.js source verification)", () => {

  test("import checks for muga flag in imported data", () => {
    assert.ok(
      OPTIONS_SOURCE.includes("data.muga"),
      "Import must check for .muga flag to validate file format"
    );
  });

  test("import validates array types for lists", () => {
    assert.ok(
      OPTIONS_SOURCE.includes("Array.isArray"),
      "Import must validate arrays with Array.isArray"
    );
  });

  test("import enforces size limits on lists", () => {
    // Must have numeric limits to prevent DoS via huge imports
    const hasLimit = /\.length\s*>\s*\d+/.test(OPTIONS_SOURCE) || /\.slice\(0,\s*\d+\)/.test(OPTIONS_SOURCE);
    assert.ok(hasLimit, "Import must enforce size limits on imported lists");
  });

  test("import validates entries with printable ASCII check", () => {
    assert.ok(
      OPTIONS_SOURCE.includes("isValidListEntry") || OPTIONS_SOURCE.includes(/[\x20-\x7E]/),
      "Import must validate entries are printable ASCII"
    );
  });

  test("import validates boolean keys by type", () => {
    assert.ok(
      OPTIONS_SOURCE.includes("typeof") && OPTIONS_SOURCE.includes("boolean"),
      "Import must validate boolean keys by type"
    );
  });
});

// ---------------------------------------------------------------------------
// sanitizeHTML — malicious input defense (source-level verification)
//
// sanitizeHTML uses DOMParser (browser-only) and is not exported, so these
// tests verify the security properties by inspecting the implementation
// source — the same approach used by the allowlist tests above.
// Each test maps 1:1 to a specific XSS defense layer.
// ---------------------------------------------------------------------------
describe("sanitizeHTML — malicious input defense", () => {

  test("strips <img> tags (not in ALLOWED_TAGS)", () => {
    // img is absent from ALLOWED_TAGS → walk() calls replaceWith(...childNodes)
    const match = I18N_SOURCE.match(/ALLOWED_TAGS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
    assert.ok(match, "ALLOWED_TAGS declaration must exist");
    const tags = match[1].match(/"([^"]+)"/g).map(s => s.replace(/"/g, ""));
    assert.ok(!tags.includes("img"), "<img> must not be in ALLOWED_TAGS");
    // The walk uses replaceWith to preserve child text, stripping the element
    assert.ok(
      I18N_SOURCE.includes("child.replaceWith(...child.childNodes)"),
      "walk must use replaceWith to strip disallowed tags while keeping text"
    );
  });

  test("strips <script> tags entirely", () => {
    const match = I18N_SOURCE.match(/ALLOWED_TAGS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
    assert.ok(match, "ALLOWED_TAGS declaration must exist");
    const tags = match[1].match(/"([^"]+)"/g).map(s => s.replace(/"/g, ""));
    assert.ok(!tags.includes("script"), "<script> must not be in ALLOWED_TAGS");
  });

  test("strips <svg> tags with onload", () => {
    // svg is not in ALLOWED_TAGS (tag stripped) AND onload is not in ALLOWED_ATTRS
    const tagsMatch = I18N_SOURCE.match(/ALLOWED_TAGS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
    const attrsMatch = I18N_SOURCE.match(/ALLOWED_ATTRS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
    assert.ok(tagsMatch && attrsMatch, "ALLOWED_TAGS and ALLOWED_ATTRS must exist");
    const tags = tagsMatch[1].match(/"([^"]+)"/g).map(s => s.replace(/"/g, ""));
    const attrs = attrsMatch[1].match(/"([^"]+)"/g).map(s => s.replace(/"/g, ""));
    assert.ok(!tags.includes("svg"), "<svg> must not be in ALLOWED_TAGS");
    assert.ok(!attrs.includes("onload"), "onload must not be in ALLOWED_ATTRS");
  });

  test("strips <object> and <embed> tags", () => {
    const match = I18N_SOURCE.match(/ALLOWED_TAGS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
    assert.ok(match, "ALLOWED_TAGS declaration must exist");
    const tags = match[1].match(/"([^"]+)"/g).map(s => s.replace(/"/g, ""));
    assert.ok(!tags.includes("object"), "<object> must not be in ALLOWED_TAGS");
    assert.ok(!tags.includes("embed"), "<embed> must not be in ALLOWED_TAGS");
  });

  test("removes javascript: href from <a> tags", () => {
    // href validation rejects any scheme not matching /^(https?:|\.\.\/|#)/
    assert.ok(
      I18N_SOURCE.includes('if (!/^(https?:|\\.\\.\\/|#)/.test(href)) child.removeAttribute("href")'),
      "sanitizeHTML must remove href when scheme is not https?:, ../, or #"
    );
  });

  test("removes data: href from <a> tags", () => {
    // data: does not match /^(https?:|\.\.\/|#)/ → href removed
    // Verified by same regex guard checked in test above; explicitly assert
    // the regex does NOT accidentally permit data: by testing it here
    const hrefRegex = /^(https?:|\.\.\/|#)/;
    assert.ok(!hrefRegex.test("data:text/html,<script>alert(1)</script>"), "data: must not pass href regex");
    // And confirm the guard is present in source
    assert.ok(
      I18N_SOURCE.includes("if (!/^(https?:|\\.\\.\\/|#)/.test(href))"),
      "href scheme guard must exist in source"
    );
  });

  test("removes vbscript: href from <a> tags", () => {
    const hrefRegex = /^(https?:|\.\.\/|#)/;
    assert.ok(!hrefRegex.test("vbscript:MsgBox(1)"), "vbscript: must not pass href regex");
    assert.ok(
      I18N_SOURCE.includes("if (!/^(https?:|\\.\\.\\/|#)/.test(href))"),
      "href scheme guard must exist in source"
    );
  });

  test("preserves valid https: href on <a> tags", () => {
    // https: DOES match the allowlist regex
    const hrefRegex = /^(https?:|\.\.\/|#)/;
    assert.ok(hrefRegex.test("https://example.com"), "https: must pass href regex");
    assert.ok(hrefRegex.test("http://example.com"), "http: must pass href regex");
  });

  test("strips nested dangerous tags inside allowed tags", () => {
    // walk() recurses into allowed children, so nested disallowed tags are
    // also stripped. Verify recursion exists.
    assert.ok(
      I18N_SOURCE.includes("walk(child)"),
      "walk must recurse into allowed children to strip nested dangerous tags"
    );
    // And <img> is not in ALLOWED_TAGS regardless of nesting
    const match = I18N_SOURCE.match(/ALLOWED_TAGS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
    const tags = match[1].match(/"([^"]+)"/g).map(s => s.replace(/"/g, ""));
    assert.ok(!tags.includes("img"), "nested <img> is still stripped (not in ALLOWED_TAGS)");
  });

  test("strips event handler attributes from allowed tags", () => {
    // Attribute allowlist is enforced regardless of whether the tag is allowed.
    // onclick is not in ALLOWED_ATTRS.
    const match = I18N_SOURCE.match(/ALLOWED_ATTRS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
    assert.ok(match, "ALLOWED_ATTRS declaration must exist");
    const attrs = match[1].match(/"([^"]+)"/g).map(s => s.replace(/"/g, ""));
    const EVENT_HANDLERS = ["onclick", "onerror", "onload", "onmouseover", "onfocus",
                            "onblur", "onsubmit", "onkeydown", "onkeyup", "onchange"];
    for (const handler of EVENT_HANDLERS) {
      assert.ok(!attrs.includes(handler), `${handler} must not be in ALLOWED_ATTRS`);
    }
    // Confirm attribute removal code exists
    assert.ok(
      I18N_SOURCE.includes("child.removeAttribute(attr.name)"),
      "walk must remove non-allowlisted attributes"
    );
  });

  test("handles deeply nested malicious content — recursion verified", () => {
    // javascript: href inside deeply nested allowed tags is still stripped
    // because walk() recurses AND href guard runs on every allowed element
    assert.ok(
      I18N_SOURCE.includes("walk(child)"),
      "walk must recurse to handle deeply nested content"
    );
    assert.ok(
      I18N_SOURCE.includes('child.removeAttribute("href")'),
      "href must be removed when it fails scheme validation, at any nesting depth"
    );
    // All nesting elements are in ALLOWED_TAGS, so they survive but href is stripped
    const match = I18N_SOURCE.match(/ALLOWED_TAGS\s*=\s*new\s+Set\(\[([^\]]+)\]\)/);
    const tags = match[1].match(/"([^"]+)"/g).map(s => s.replace(/"/g, ""));
    for (const tag of ["em", "strong", "a", "code"]) {
      assert.ok(tags.includes(tag), `<${tag}> must be in ALLOWED_TAGS`);
    }
  });

  test("handles empty input — sanitizeHTML uses DOMParser body.innerHTML", () => {
    // DOMParser on empty string returns empty body; innerHTML is ""
    // Verify the function reads doc.body.innerHTML as its return value
    assert.ok(
      I18N_SOURCE.includes("return doc.body.innerHTML"),
      "sanitizeHTML must return doc.body.innerHTML"
    );
    assert.ok(
      I18N_SOURCE.includes('new DOMParser().parseFromString(html, "text/html")'),
      "sanitizeHTML must use DOMParser.parseFromString"
    );
  });

  test("handles plain text (no HTML) — text nodes pass through untouched", () => {
    // walk() only processes nodeType === 1 (Element); text nodes (nodeType === 3)
    // are untouched, so plain text survives as-is in body.innerHTML
    assert.ok(
      I18N_SOURCE.includes("child.nodeType === 1"),
      "walk must only process Element nodes (nodeType 1), leaving text nodes intact"
    );
  });
});
