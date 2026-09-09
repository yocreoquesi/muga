/**
 * MUGA — every CSS custom property referenced by an extension surface resolves (#1260)
 *
 * Run with: npm test
 *
 * The defect this pins: `popup.css` referenced `var(--bg-2, rgba(0, 0, 0, 0.04))`
 * twice, for the Strip-locally and Report-upstream pill hovers. `--bg-2` is
 * defined in the MARKETING stylesheets (landing, web, docs), not in any
 * stylesheet the popup loads, so those rules always took the literal fallback.
 *
 * That literal is a light tint. The popup has a full dark theme built on
 * `--surface-*`, so in dark mode both pills got a near-white wash on a dark
 * card, and no amount of theme work would ever have reached them.
 *
 * ── What is actually asserted, and why it is not "every token is defined" ───
 *
 * The naive rule would also flag `var(--border-strong, var(--text-1))`, which
 * is fine: `--border-strong` is undefined, but the fallback is another token
 * that IS defined and IS theme-aware, so that declaration follows the theme
 * correctly. Banning it would be noise.
 *
 * The bug is narrower and worth naming exactly: a reference to an undefined
 * token whose fallback is a hardcoded literal (or absent) is frozen at one
 * theme. That is what these tests forbid.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Stylesheets an extension surface loads, each self-contained. */
const SHEETS = [
  "src/popup/popup.css",
  "src/options/options.css",
  "src/onboarding/onboarding.css",
];

/**
 * Every custom property DEFINED in a stylesheet.
 *
 * Deliberately not anchored to line start: onboarding.css packs several
 * definitions onto one line (`--surface-0: #FAFAFB; --surface-1: #FFFFFF; ...`).
 * An anchored pattern sees only the first of each line and reports the other
 * eleven as undefined, which is a false alarm this test must not raise.
 */
function definedTokens(css) {
  return new Set([...css.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

/** Every `var(--token, fallback)` reference, with its fallback text. */
function tokenRefs(css) {
  return [...css.matchAll(/var\(\s*(--[A-Za-z0-9-]+)\s*(?:,([^()]*(?:\([^()]*\))?[^()]*))?\)/g)]
    .map((m) => ({ token: m[1], fallback: (m[2] || "").trim() }));
}

describe("#1260 — CSS custom properties resolve in every extension surface", () => {

  for (const sheet of SHEETS) {
    const css = readFileSync(join(__dirname, "../../", sheet), "utf8");
    const defined = definedTokens(css);
    const refs = tokenRefs(css);

    test(`${sheet}: no reference falls back to a hardcoded literal`, () => {
      const frozen = refs
        .filter((r) => !defined.has(r.token))
        .filter((r) => !r.fallback.includes("var("))
        .map((r) => `var(${r.token}${r.fallback ? `, ${r.fallback}` : ""})`);

      assert.deepEqual(
        [...new Set(frozen)], [],
        `${sheet} references undefined tokens whose fallback is a literal, so these ` +
        `declarations are frozen at one theme and ignore dark mode. Either define the ` +
        `token in this stylesheet or fall back to one that is defined.`,
      );
    });

    test(`${sheet}: parses into a usable token set`, () => {
      // Guards the two helpers above. If a formatting change ever defeats the
      // definition pattern, every assertion in this file would silently pass
      // by finding nothing rather than by everything resolving.
      assert.ok(defined.size > 5, `expected ${sheet} to define tokens, found ${defined.size}`);
      assert.ok(refs.length > 5, `expected ${sheet} to reference tokens, found ${refs.length}`);
    });
  }

  test("popup.css uses --surface-2 for pill hovers, the themed sibling token", () => {
    // The specific regression. --surface-2 is what .recent-activity-copy:hover
    // already used, and it has a dark-mode value, so the pills now follow the
    // theme with the rest of the popup.
    const css = readFileSync(join(__dirname, "../../src/popup/popup.css"), "utf8");
    assert.ok(!css.includes("--bg-2"),
      "--bg-2 is a marketing-stylesheet token and is not defined in the popup");
    for (const cls of [".strip-locally-btn:hover:not(:disabled)", ".report-upstream-btn:hover:not(:disabled)"]) {
      const at = css.indexOf(cls);
      assert.ok(at !== -1, `${cls} must still exist`);
      assert.ok(css.slice(at, at + 120).includes("var(--surface-2)"),
        `${cls} must tint with the themed --surface-2`);
    }
  });
});
