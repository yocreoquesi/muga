/**
 * MUGA — regression guard: the "How to Verify" steps and every "zero
 * requests" promise must hold when a reader follows them (#1428).
 *
 *   (A) BUILD TRANSFORMS — the store package is not a byte copy of `src/`.
 *       `npm run build` also runs tools/strip-test-seams.mjs (rewrites
 *       lib/test-fixtures.js and the __MUGA_TRUSTED_KEYS__ seam in
 *       background/service-worker.js) and the Firefox build swaps in
 *       src/manifest.v2.json. The transparency report must name all of them
 *       and must not call the content bundle the only transformation.
 *   (B) ZERO REQUESTS — resolving a short link you open is on by default and
 *       contacts the shortener. Any sentence that promises zero outbound
 *       requests must also say the short-link switches have to be off (or
 *       that every toggle has to be off).
 *   (C) LANDING — no "No build step to hide anything" and no "Reproducible
 *       builds" claim while the repo documents no such procedure.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PREF_DEFAULTS } from "../../src/lib/prefs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
// assert.ok with a short message: doesNotMatch would dump the whole page.

const pkg = JSON.parse(read("package.json"));

describe("(A) transparency report names every build-time transformation", () => {
  test("source of truth: the store builds run strip-test-seams and the manifest swap", () => {
    assert.match(pkg.scripts["build:chrome"], /strip-test-seams\.mjs/);
    assert.match(pkg.scripts["build:firefox"], /strip-test-seams\.mjs/);
    assert.match(pkg.scripts["build:firefox"], /with-firefox-manifest\.sh/);
  });

  const html = read("docs/transparency.html");
  test("does not call the content bundle the only transformation", () => {
    assert.ok(!/only build-time transformation/i.test(html), "found " + /only build-time transformation/i);
  });
  for (const name of [
    "tools/strip-test-seams.mjs",
    "lib/test-fixtures.js",
    "background/service-worker.js",
    "manifest.v2.json",
  ]) {
    test(`names ${name}`, () => {
      assert.ok(html.includes(name), `docs/transparency.html should name ${name}`);
    });
  }
  test("does not tell readers the installed files match the raw source exactly", () => {
    assert.ok(!/diff the files against the published source\. They should match exactly/.test(html), "found " + /diff the files against the published source\. They should match exactly/);
  });
});

describe("(B) zero-request promises name the short-link switches", () => {
  test("source of truth: resolving opened short links is on by default", () => {
    assert.equal(PREF_DEFAULTS.resolveShortenersOnClick, true);
  });

  const ZERO_RE = /zero (?:outbound )?(?:network )?(?:requests|activity)|no outbound requests/i;
  const QUALIFIED_RE = /short[- ]link|shortener|every toggle|all of them/i;
  const DOCS = [
    "docs/transparency.html",
    "docs/faq.md",
    "docs/faq.html",
    "docs/privacy-page.html",
    "docs/tos.html",
    "src/privacy/tos.html",
    "src/privacy/privacy.html",
    "docs/data_architect.md",
    "README.md",
  ];

  for (const docPath of DOCS) {
    test(`${docPath}`, () => {
      const text = read(docPath).replace(/<[^>]+>/g, " ");
      const sentences = text.split(/(?<=[.!?])\s+|\n\s*\n/);
      const bad = sentences.filter((s) => ZERO_RE.test(s) && !QUALIFIED_RE.test(s));
      assert.deepStrictEqual(
        bad.map((s) => s.replace(/\s+/g, " ").trim()),
        [],
        `${docPath} promises zero requests without naming the short-link switches, ` +
          "but resolving a short link you open is on by default."
      );
    });
  }
});

describe("(C) landing makes no build claims the repo cannot back", () => {
  const html = read("landing/index.html");
  test("no 'No build step to hide anything'", () => {
    assert.ok(!/No build step to hide anything/i.test(html), "found " + /No build step to hide anything/i);
  });
  test("no reproducible-builds claim", () => {
    assert.ok(!/reproducible build/i.test(html), "found " + /reproducible build/i);
  });
});
