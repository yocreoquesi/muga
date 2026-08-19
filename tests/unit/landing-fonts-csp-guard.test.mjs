/**
 * MUGA: Landing webfonts <-> Worker CSP coupling guard.
 *
 * muga.app is served by landing-worker/worker.js, which stamps a
 * Content-Security-Policy onto every response. The landing page loads its two
 * webfaces (Archivo + IBM Plex Mono) from Google Fonts, which means TWO
 * external origins have to be admitted by that CSP: the stylesheet host
 * (fonts.googleapis.com, via style-src) and the font-file host
 * (fonts.gstatic.com, via font-src). Nothing in the page fails loudly when
 * they drift apart: the browser silently blocks the request and the page
 * quietly renders in the fallback stack, on production only.
 *
 * tests/unit/landing-worker-headers.test.mjs asserts the Worker's headers in
 * isolation, and only pins frame-ancestors and object-src, so it cannot catch
 * this. These checks pin the coupling in both directions, and pin the total
 * external-origin surface so the CSP cannot quietly grow a new host.
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
const WORKER = readFileSync(join(ROOT, "landing-worker/worker.js"), "utf8");

const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com";
const GOOGLE_FONTS_FILES = "https://fonts.gstatic.com";

/** The CSP is built by string concatenation in the Worker, so it is
 * reassembled from the quoted segments between its key and the next header. */
function cspHeader() {
  const key = '"Content-Security-Policy":';
  const start = WORKER.indexOf(key);
  assert.ok(start !== -1, "worker.js must set a Content-Security-Policy header");
  const end = WORKER.indexOf('"X-Frame-Options"', start);
  assert.ok(end > start, "expected X-Frame-Options to follow the CSP in SECURITY_HEADERS");
  const body = WORKER.slice(start + key.length, end);
  return [...body.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");
}

/** Returns the source list of one CSP directive, e.g. "font-src". */
function directive(name) {
  const found = cspHeader()
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
  return found ?? null;
}

/** Every stylesheet the landing pulls from an external origin. */
function externalStylesheetHosts() {
  const hosts = new Set();
  for (const m of HTML.matchAll(/<link\b[^>]*\bhref\s*=\s*"(https:\/\/[^"]+)"[^>]*>/gi)) {
    if (!/rel\s*=\s*"stylesheet"/i.test(m[0])) continue;
    hosts.add(new URL(m[1]).origin);
  }
  return hosts;
}

const linksGoogleFonts = [...externalStylesheetHosts()].includes(GOOGLE_FONTS_CSS);

describe("landing webfonts <-> Worker CSP", () => {
  test("the landing still loads its fonts from Google Fonts (the premise of this file)", () => {
    // Not a requirement — if the landing ever self-hosts or drops webfonts this
    // will fail and the checks below should be retired along with the CSP
    // entries they guard, rather than left admitting hosts nothing uses.
    assert.equal(
      linksGoogleFonts,
      true,
      "landing/index.html no longer links fonts.googleapis.com. If that is intentional, tighten " +
        "style-src and font-src back down in landing-worker/worker.js and delete this file.",
    );
  });

  test("style-src admits the Google Fonts stylesheet host", () => {
    const styleSrc = directive("style-src");
    assert.ok(styleSrc, "CSP must declare style-src");
    assert.ok(
      styleSrc.includes(GOOGLE_FONTS_CSS),
      `landing/index.html links ${GOOGLE_FONTS_CSS} but style-src does not admit it, so the ` +
        `stylesheet is blocked in production and the page renders in the fallback stack. Got: ${styleSrc}`,
    );
  });

  test("font-src admits the Google Fonts file host", () => {
    const fontSrc = directive("font-src");
    assert.ok(fontSrc, "CSP must declare font-src");
    assert.ok(
      fontSrc.includes(GOOGLE_FONTS_FILES),
      `the Google Fonts stylesheet pulls its .woff2 files from ${GOOGLE_FONTS_FILES}; font-src ` +
        `must admit that host or every glyph is blocked. Got: ${fontSrc}`,
    );
  });

  test("font-src is not 'none' while the page loads webfonts", () => {
    const fontSrc = directive("font-src");
    assert.ok(
      !/\bnone\b/.test(fontSrc),
      `font-src is "none" but the landing loads webfonts. Got: ${fontSrc}`,
    );
  });

  test("the CSP admits no external host beyond the asset host and the two font hosts", () => {
    const allowed = new Set(["https://rules.muga.app", GOOGLE_FONTS_CSS, GOOGLE_FONTS_FILES]);
    const seen = [...cspHeader().matchAll(/https:\/\/[^\s;']+/g)].map((m) => m[0]);
    const unexpected = seen.filter((h) => !allowed.has(h));
    assert.deepEqual(
      unexpected,
      [],
      `the landing CSP grew a new external origin. Every host here is a place muga.app can talk ` +
        `to, so add it deliberately and update this list: ${unexpected.join(", ")}`,
    );
  });

  test("the landing loads no stylesheet from any other external origin", () => {
    const unexpected = [...externalStylesheetHosts()].filter((h) => h !== GOOGLE_FONTS_CSS);
    assert.deepEqual(
      unexpected,
      [],
      `landing/index.html links a stylesheet from an origin the Worker CSP does not admit: ${unexpected.join(", ")}`,
    );
  });
});
