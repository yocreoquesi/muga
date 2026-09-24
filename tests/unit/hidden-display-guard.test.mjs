/**
 * MUGA — [hidden]/display CSS guard (audit 2026-09-24)
 *
 * Root cause of the popup's "Looks like a creator referral. Kept." box
 * showing even with no referral (#preview-preserved in src/popup/popup.html):
 * `.preview-preserved { display: flex }` in popup.css overrides the UA
 * `[hidden]` rule (`[hidden] { display: none }`), so setting the `hidden`
 * attribute from JS no longer hides the element. This is a CSS trap that can
 * recur on any element that both (a) starts with a static `hidden` attribute
 * and (b) is matched by a class/id selector that sets a non-`none` `display`.
 *
 * This file statically scans src/popup/popup.html, src/options/options.html,
 * and src/onboarding/onboarding.html (plus each page's own stylesheet) for
 * every such element, and fails unless the stylesheet guards it — either a
 * specific `<selector>[hidden] { display: none }` override, or one global
 * `[hidden] { display: none !important }` rule (recommended: it protects
 * every future hidden element in that stylesheet, not just today's).
 *
 * There is no jsdom/browser in this test suite, so there is no behavioral
 * proxy for "computed style when hidden" — the committed HTML+CSS text is
 * the subject under test itself, same pattern as csp-inline-style-guard.test.mjs
 * and web-ui-source-guard.test.mjs. Exempted from the source-grep ratchet
 * (#824) accordingly — see tests/unit/source-grep-ratchet.test.mjs EXEMPT.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const PAGES = [
  { name: "popup", html: "src/popup/popup.html", css: "src/popup/popup.css" },
  { name: "options", html: "src/options/options.html", css: "src/options/options.css" },
  { name: "onboarding", html: "src/onboarding/onboarding.html", css: "src/onboarding/onboarding.css" },
];

// ── CSS parsing ──────────────────────────────────────────────────────────────

/** Strips /* *\/ CSS comments. */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Splits CSS text into { selector, decls } rules, flattening @-rule bodies
 * (e.g. @media) into their parent scan so nested rules are still found. The
 * @-rule's own condition (e.g. a reduced-motion media query) is discarded —
 * conservative, since a rule inside a media query is still a real display
 * override in the states where that query matches.
 */
function parseCssRules(css) {
  css = stripCssComments(css);
  const rules = [];
  function walk(str, start, end) {
    let j = start;
    while (j < end) {
      while (j < end && /\s/.test(str[j])) j++;
      if (j >= end) break;
      if (str[j] === "@") {
        let k = j;
        while (k < end && str[k] !== "{" && str[k] !== ";") k++;
        if (str[k] === ";") { j = k + 1; continue; }
        let depth = 1;
        let m = k + 1;
        while (m < end && depth > 0) {
          if (str[m] === "{") depth++;
          else if (str[m] === "}") depth--;
          m++;
        }
        walk(str, k + 1, m - 1);
        j = m;
        continue;
      }
      const braceIdx = str.indexOf("{", j);
      if (braceIdx === -1) break;
      const selector = str.slice(j, braceIdx).trim();
      let depth = 1;
      let k = braceIdx + 1;
      while (k < end && depth > 0) {
        if (str[k] === "{") depth++;
        else if (str[k] === "}") depth--;
        k++;
      }
      rules.push({ selector, decls: str.slice(braceIdx + 1, k - 1) });
      j = k;
    }
  }
  walk(css, 0, css.length);
  return rules;
}

/** Returns the last `display` declaration in a decl block, or null. */
function getDisplayDecl(decls) {
  const re = /display\s*:\s*([^;!]+?)\s*(!important)?\s*(?:;|$)/gi;
  let m;
  let last = null;
  while ((m = re.exec(decls))) {
    last = { value: m[1].trim().toLowerCase(), important: !!m[2] };
  }
  return last;
}

// ── HTML parsing ─────────────────────────────────────────────────────────────

/** Finds every element that carries a static `hidden` attribute in the raw HTML. */
function findHiddenElements(html) {
  const els = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const [, tag, attrs] = m;
    if (!/(^|\s)hidden(\s|=|\/|>|$)/.test(attrs)) continue;
    const idMatch = attrs.match(/\bid\s*=\s*["']([^"']+)["']/);
    const classMatch = attrs.match(/\bclass\s*=\s*["']([^"']+)["']/);
    els.push({
      tag,
      id: idMatch ? idMatch[1] : null,
      classes: classMatch ? classMatch[1].split(/\s+/).filter(Boolean) : [],
    });
  }
  return els;
}

// ── Selector matching (simple compound selectors only) ────────────────────────

/**
 * Matches a single simple/compound selector (e.g. "#id", ".a.b", "div.a")
 * against an element. Descendant/combinator selectors are out of scope
 * (conservative — they are not how any current bug in this codebase is
 * shaped, and adding them would require a real CSS engine).
 */
function selectorMatchesElement(selector, el) {
  if (/[\s>+~]/.test(selector)) return false;
  if (selector.includes("[hidden]")) return false; // handled separately as a guard
  selector = selector.replace(/::?[\w-]+(\([^)]*\))?/g, ""); // drop pseudo-classes/elements
  if (!selector) return false;
  const idPart = selector.match(/#([\w-]+)/);
  if (idPart && idPart[1] !== el.id) return false;
  const classParts = [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  for (const c of classParts) {
    if (!el.classes.includes(c)) return false;
  }
  const tagPart = selector.match(/^([a-zA-Z][\w-]*)/);
  if (tagPart && tagPart[1].toLowerCase() !== el.tag.toLowerCase()) return false;
  if (!idPart && classParts.length === 0 && !tagPart) return false;
  return true;
}

/** True if the stylesheet declares a global `[hidden] { display: none !important }` rule. */
function hasGlobalHiddenGuard(rules) {
  return rules.some((r) =>
    r.selector.split(",").map((s) => s.trim()).some((p) => {
      if (p !== "[hidden]") return false;
      const d = getDisplayDecl(r.decls);
      return d && d.value === "none" && d.important;
    })
  );
}

/** True if a specific `<selector-matching-el>[hidden] { display: none }` rule exists. */
function hasSpecificHiddenGuard(rules, el) {
  return rules.some((r) =>
    r.selector.split(",").map((s) => s.trim()).some((p) => {
      if (!p.includes("[hidden]")) return false;
      const withoutHidden = p.replace("[hidden]", "").trim();
      if (!withoutHidden) return false; // that's the global rule, handled above
      if (!selectorMatchesElement(withoutHidden, el)) return false;
      const d = getDisplayDecl(r.decls);
      return d && d.value === "none";
    })
  );
}

/** Every rule (not qualified by [hidden]) matching el whose display isn't "none". */
function findRiskyDisplayRules(rules, el) {
  const risky = [];
  for (const r of rules) {
    for (const p of r.selector.split(",").map((s) => s.trim())) {
      if (p.includes("[hidden]")) continue;
      if (!selectorMatchesElement(p, el)) continue;
      const d = getDisplayDecl(r.decls);
      if (d && d.value !== "none") risky.push({ selector: p, display: d.value, important: d.important });
    }
  }
  return risky;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("[hidden] elements never have their display overridden without a guard", () => {
  for (const page of PAGES) {
    const html = readFileSync(join(ROOT, page.html), "utf8");
    const css = readFileSync(join(ROOT, page.css), "utf8");
    const rules = parseCssRules(css);
    const hiddenEls = findHiddenElements(html);
    const globalGuard = hasGlobalHiddenGuard(rules);

    test(`${page.html}: every statically-hidden element with a display override is guarded`, () => {
      const violations = [];
      for (const el of hiddenEls) {
        const risky = findRiskyDisplayRules(rules, el);
        if (risky.length === 0) continue;
        if (globalGuard) continue;
        if (hasSpecificHiddenGuard(rules, el)) continue;
        violations.push(
          `<${el.tag}${el.id ? `#${el.id}` : ""}${el.classes.length ? `.${el.classes.join(".")}` : ""}> ` +
          `is hidden by default but ${risky.map((r) => `"${r.selector} { display: ${r.display} }"`).join(", ")} ` +
          `overrides the UA [hidden] rule with no [hidden]-qualified override in ${page.css}`
        );
      }
      assert.deepStrictEqual(
        violations,
        [],
        `${page.css} must either declare a global "[hidden] { display: none !important }" rule ` +
        `or a specific "<selector>[hidden] { display: none }" override for each element below:\n` +
        violations.join("\n")
      );
    });
  }
});
