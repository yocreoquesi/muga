/**
 * MUGA: muga.app response-header guard.
 *
 * The landing is served by the Cloudflare Pages project "muga-landing", whose
 * build output directory is `landing/`, so `landing/_headers` is the ONLY place
 * its response headers come from. This file replaces the old
 * landing-worker-headers guard, which asserted a Worker's headers: that Worker
 * was never deployed (every `deploy-landing` run skipped for want of
 * CLOUDFLARE_API_TOKEN) and its green test hid the fact that muga.app was
 * shipping with no CSP at all.
 *
 * The lesson those two facts encode: a header guard is only worth anything if
 * it reads the file the serving platform actually consumes. Everything below
 * reads `landing/_headers`.
 *
 * Two couplings are pinned here because both fail silently in production and
 * nowhere else:
 *   - webfonts <-> CSP: the page loads Archivo and IBM Plex Mono from Google
 *     Fonts, so style-src must admit the stylesheet host and font-src the file
 *     host, or the browser blocks them and the page renders in the fallback
 *     stack with nothing logged anywhere.
 *   - the /clean contract (#1082): index.html, ui.js and the vendored engine
 *     only agree when they ship together, and Pages caches static assets for
 *     four hours by default, so the JS must be told to revalidate.
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

/** Pages reads _headers from the root of the build output directory. */
const HEADERS_FILE = "landing/_headers";

const HTML = readFileSync(join(ROOT, "landing/index.html"), "utf8");
const HEADERS = readFileSync(join(ROOT, HEADERS_FILE), "utf8");

const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com";
const GOOGLE_FONTS_FILES = "https://fonts.gstatic.com";
const ASSET_HOST = "https://rules.muga.app";

/** Lines, comment-free and end-of-line agnostic.
 *
 * Splitting on "\n" alone leaves a trailing "\r" on a CRLF working copy, and
 * JS's `.` excludes line terminators, so `(.+)$` quietly stops matching and
 * every header reads as absent. This passed CI on Linux and failed on every
 * Windows checkout until the split was fixed: the same shape of silent,
 * environment-only failure the headers themselves had. Comments must never
 * satisfy a check either. */
function rules() {
  return HEADERS.split(/\r?\n/).filter((l) => !l.trim().startsWith("#"));
}

/** The value of a header as declared under the given path pattern. */
function headerFor(pathPattern, name) {
  const lines = rules();
  const start = lines.findIndex((l) => l.trim() === pathPattern);
  if (start === -1) return null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    // A non-indented, non-empty line starts the next path block.
    if (!/^\s/.test(line)) break;
    const m = line.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
    if (m && m[1].toLowerCase() === name.toLowerCase()) return m[2].trim();
  }
  return null;
}

/** One directive out of the site-wide CSP, e.g. "font-src". */
function cspDirective(name) {
  const csp = headerFor("/*", "Content-Security-Policy");
  assert.ok(csp, `${HEADERS_FILE} must declare a Content-Security-Policy under /*`);
  return csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `)) ?? null;
}

function externalStylesheetHosts() {
  const hosts = new Set();
  for (const m of HTML.matchAll(/<link\b[^>]*\bhref\s*=\s*"(https:\/\/[^"]+)"[^>]*>/gi)) {
    if (!/rel\s*=\s*"stylesheet"/i.test(m[0])) continue;
    hosts.add(new URL(m[1]).origin);
  }
  return hosts;
}

describe("muga.app response headers come from the file Pages reads", () => {
  test("the site-wide block declares every security header", () => {
    for (const name of [
      "Content-Security-Policy",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Strict-Transport-Security",
    ]) {
      assert.ok(
        headerFor("/*", name),
        `${HEADERS_FILE} must set ${name} under /*, or muga.app ships without it`,
      );
    }
  });

  test("clickjacking and MIME-sniffing defenses keep their values", () => {
    assert.equal(headerFor("/*", "X-Frame-Options"), "DENY");
    assert.equal(headerFor("/*", "X-Content-Type-Options"), "nosniff");
    assert.match(headerFor("/*", "Strict-Transport-Security"), /max-age=31536000/);
  });

  test("the CSP forbids framing and plugins", () => {
    assert.equal(cspDirective("frame-ancestors"), "frame-ancestors 'none'");
    assert.equal(cspDirective("object-src"), "object-src 'none'");
  });
});

describe("landing webfonts <-> CSP", () => {
  test("the landing still loads its fonts from Google Fonts (the premise below)", () => {
    // If the landing ever self-hosts or drops webfonts this fails, and the two
    // font entries in the CSP should be removed rather than left admitting
    // hosts nothing uses.
    assert.ok(
      externalStylesheetHosts().has(GOOGLE_FONTS_CSS),
      `landing/index.html no longer links ${GOOGLE_FONTS_CSS}. If deliberate, tighten style-src ` +
        `and font-src in ${HEADERS_FILE} and retire these checks.`,
    );
  });

  test("style-src admits the Google Fonts stylesheet host", () => {
    const styleSrc = cspDirective("style-src");
    assert.ok(
      styleSrc?.includes(GOOGLE_FONTS_CSS),
      `the page links ${GOOGLE_FONTS_CSS} but style-src does not admit it, so the stylesheet is ` +
        `blocked in production and the page silently renders in the fallback stack. Got: ${styleSrc}`,
    );
  });

  test("font-src admits the Google Fonts file host and is not 'none'", () => {
    const fontSrc = cspDirective("font-src");
    assert.ok(fontSrc, "CSP must declare font-src");
    assert.ok(
      fontSrc.includes(GOOGLE_FONTS_FILES),
      `the Google Fonts stylesheet pulls .woff2 files from ${GOOGLE_FONTS_FILES}; font-src must ` +
        `admit that host or every glyph is blocked. Got: ${fontSrc}`,
    );
    assert.ok(!/\bnone\b/.test(fontSrc), `font-src is "none" while the page loads webfonts. Got: ${fontSrc}`);
  });

  test("the CSP admits no external host beyond the asset host and the two font hosts", () => {
    const allowed = new Set([ASSET_HOST, GOOGLE_FONTS_CSS, GOOGLE_FONTS_FILES]);
    const csp = headerFor("/*", "Content-Security-Policy");
    const unexpected = [...csp.matchAll(/https:\/\/[^\s;']+/g)]
      .map((m) => m[0])
      .filter((h) => !allowed.has(h));
    assert.deepEqual(
      unexpected,
      [],
      `the CSP grew a new external origin. Each one is a place muga.app may talk to, so add it ` +
        `deliberately and update this list: ${unexpected.join(", ")}`,
    );
  });

  test("the landing loads no stylesheet from any other external origin", () => {
    const unexpected = [...externalStylesheetHosts()].filter((h) => h !== GOOGLE_FONTS_CSS);
    assert.deepEqual(unexpected, [], `landing/index.html links a stylesheet the CSP does not admit: ${unexpected.join(", ")}`);
  });
});

describe("the /clean contract revalidates (#1082)", () => {
  test("script and document types are told not to cache", () => {
    // Pages defaults static assets to max-age=14400, so without these a deploy
    // can run the new /clean page against a four-hour-old engine bundle.
    for (const pattern of ["/*.js", "/*.mjs", "/*.html"]) {
      const value = headerFor(pattern, "Cache-Control");
      assert.ok(
        value && /no-cache|max-age=0/.test(value),
        `${HEADERS_FILE} must force revalidation for ${pattern} or a stale bundle can outlive a ` +
          `deploy by four hours. Got: ${value}`,
      );
    }
  });
});

describe("the retired Worker deploy path stays retired", () => {
  test("no wrangler config or landing Worker remains", async () => {
    // Both described a deployment that never ran once. Leaving them in place
    // means two files claim to set muga.app's headers and only one is read.
    const { existsSync } = await import("node:fs");
    for (const p of ["wrangler.toml", "landing-worker", ".github/workflows/deploy-landing.yml"]) {
      assert.equal(
        existsSync(join(ROOT, p)),
        false,
        `${p} came back. muga.app is served by Cloudflare Pages from ${HEADERS_FILE}; a second ` +
          `header source is how the site ended up with no CSP for two months.`,
      );
    }
  });
});
