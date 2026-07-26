/**
 * Minimal fake DOM for exercising cookie-noise.js's toggle-sweep helpers
 * (cookie-consent-toggle-reject, PR 2) via `vm.runInContext` — mirrors the
 * existing `vm.runInContext` precedent in
 * tests/unit/cookie-noise-frame-exemption.test.mjs, extended with just
 * enough of a CSS selector engine to support the small set of selector
 * shapes this feature actually uses: tag names, `#id`, `.class`,
 * `[attr]` / `[attr="value"]` / `[attr='value']`, the `:checked` pseudo,
 * and comma-separated OR groups. Deliberately NOT a general CSS engine —
 * no descendant/child combinators, no other pseudo-classes.
 *
 * Usage:
 *   import { FakeElement, FakeDocument } from "./helpers/fake-dom.mjs";
 *   const doc = new FakeDocument();
 *   const panel = doc.createElement("div", { id: "panel" });
 *   doc.documentElement.appendChild(panel);
 */

/**
 * Parses a single compound selector (no combinators) into its parts.
 * @param {string} sel
 * @returns {{ tag: string|null, id: string|null, classes: string[], attrs: Array<{name: string, value: string|null}>, pseudos: string[] }}
 */
function parseCompoundSelector(sel) {
  const tokenRe = /(#[\w-]+)|(\.[\w-]+)|(:[\w-]+)|(\[[^\]]+\])|([a-zA-Z][\w-]*)/g;
  const result = { tag: null, id: null, classes: [], attrs: [], pseudos: [] };
  let m;
  while ((m = tokenRe.exec(sel)) !== null) {
    const tok = m[0];
    if (tok.startsWith("#")) {
      result.id = tok.slice(1);
    } else if (tok.startsWith(".")) {
      result.classes.push(tok.slice(1));
    } else if (tok.startsWith(":")) {
      result.pseudos.push(tok.slice(1));
    } else if (tok.startsWith("[")) {
      const inner = tok.slice(1, -1);
      const eq = inner.indexOf("=");
      if (eq === -1) {
        result.attrs.push({ name: inner.trim(), value: null });
      } else {
        const name = inner.slice(0, eq).trim();
        let value = inner.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        result.attrs.push({ name, value });
      }
    } else {
      result.tag = tok;
    }
  }
  return result;
}

function elementMatchesCompound(el, compound) {
  if (compound.tag && el.tagName.toLowerCase() !== compound.tag.toLowerCase()) return false;
  if (compound.id && el.getAttribute("id") !== compound.id) return false;
  if (compound.classes.length > 0) {
    const cls = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
    for (const c of compound.classes) {
      if (!cls.includes(c)) return false;
    }
  }
  for (const a of compound.attrs) {
    const val = el.getAttribute(a.name);
    if (val === null) return false;
    if (a.value !== null && val !== a.value) return false;
  }
  for (const p of compound.pseudos) {
    if (p === "checked") {
      if (el.checked !== true) return false;
    }
  }
  return true;
}

function matchesSelectorGroup(el, selector) {
  if (typeof selector !== "string" || selector.length === 0) return false;
  const groups = selector.split(",").map((s) => s.trim()).filter(Boolean);
  return groups.some((g) => elementMatchesCompound(el, parseCompoundSelector(g)));
}

export class FakeElement extends EventTarget {
  constructor(tag, attrs = {}) {
    super();
    this.tagName = tag;
    this._attrs = new Map();
    for (const [k, v] of Object.entries(attrs)) this._attrs.set(k, String(v));
    this.children = [];
    this.parentNode = null;
    this.checked = tag.toLowerCase() === "input" && attrs.checked === true;
    this.value = "";
    this.disabled = attrs.disabled === true;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null;
  }

  setAttribute(name, value) {
    this._attrs.set(name, String(value));
  }

  hasAttribute(name) {
    return this._attrs.has(name);
  }

  matches(selector) {
    return matchesSelectorGroup(this, selector);
  }

  querySelectorAll(selector) {
    const results = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (matchesSelectorGroup(child, selector)) results.push(child);
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  getClientRects() {
    return [{ width: 10, height: 10 }];
  }

  click() {
    this.dispatchEvent(new Event("click", { bubbles: true }));
  }
}

export class FakeDocument extends EventTarget {
  constructor() {
    super();
    this.documentElement = new FakeElement("html");
    this.body = new FakeElement("body");
    this.documentElement.appendChild(this.body);
    this.readyState = "complete";
  }

  createElement(tag, attrs = {}) {
    return new FakeElement(tag, attrs);
  }

  getElementById(id) {
    return this.documentElement.querySelector(`#${id}`);
  }

  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }
}
