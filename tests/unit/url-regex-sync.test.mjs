/**
 * MUGA — URL_RE sync regression test
 *
 * The URL regex used to extract http/https URLs from arbitrary text is
 * duplicated in two files:
 *   - src/background/service-worker.js  (used by the selection context menu fallback)
 *   - src/content/cleaner.js            (used by the copy handler in the IIFE)
 *
 * Content scripts cannot import ES modules, so the definition must live in
 * both files. This test asserts the two literals are identical so a bug fix
 * or tightening of the pattern (e.g., handling Unicode, trailing commas) is
 * never silently applied in only one place.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const swSource = readFileSync(
  join(__dirname, "../../src/background/service-worker.js"),
  "utf8"
);
const contentSource = readFileSync(
  join(__dirname, "../../src/content/cleaner.js"),
  "utf8"
);

/** Extracts the literal source of the URL_RE regex from a file's text. */
function extractUrlReLiteral(source) {
  // The regex literal contains escaped slashes (\/), so we cannot use a simple
  // "stop at /" heuristic. Instead we capture the known pattern directly.
  // The literal always follows: URL_RE = <literal>;
  // We match from "URL_RE = " to the end of the literal by finding the closing
  // /g (flags) that terminates the regex.
  const match = source.match(/\bURL_RE\s*=\s*(\/https\?[^;]+)/);
  if (!match) throw new Error("URL_RE not found in source");
  // Trim any trailing whitespace or semicolon
  return match[1].trim().replace(/;$/, "").trim();
}

/** Extracts the flags from a regex literal string like "/pattern/gi". */
function extractFlags(literal) {
  const lastSlash = literal.lastIndexOf("/");
  return literal.slice(lastSlash + 1);
}

describe("URL_RE sync — service-worker.js vs content/cleaner.js", () => {
  test("both files define URL_RE", () => {
    assert.ok(swSource.includes("URL_RE"), "service-worker.js must define URL_RE");
    assert.ok(contentSource.includes("URL_RE"), "content/cleaner.js must define URL_RE");
  });

  test("URL_RE literals are identical in both files", () => {
    const swLiteral = extractUrlReLiteral(swSource);
    const contentLiteral = extractUrlReLiteral(contentSource);
    assert.strictEqual(
      swLiteral,
      contentLiteral,
      `URL_RE literals diverged:\n  service-worker.js: ${swLiteral}\n  content/cleaner.js: ${contentLiteral}`
    );
  });

  test("URL_RE matches http and https URLs", () => {
    // Verify the extracted literal is semantically correct by re-evaluating it.
    // eval is intentionally used here: we need to reconstruct the RegExp from
    // the source literal to verify its semantics, not just its text.
    const literal = extractUrlReLiteral(swSource);
    // eslint-disable-next-line no-eval
    const makeRe = () => eval(literal);
    assert.ok(makeRe().test("https://example.com?utm_source=google"), "must match https URL");
    assert.ok(makeRe().test("http://foo.bar/path?q=1"), "must match http URL");
    assert.ok(!makeRe().test("ftp://example.com"), "must not match non-http(s) scheme");
  });

  test("URL_RE global flag is set in service-worker.js", () => {
    const literal = extractUrlReLiteral(swSource);
    assert.ok(
      extractFlags(literal).includes("g"),
      "URL_RE must have global flag for matchAll usage"
    );
  });

  test("URL_RE global flag is set in content/cleaner.js", () => {
    const literal = extractUrlReLiteral(contentSource);
    assert.ok(
      extractFlags(literal).includes("g"),
      "URL_RE must have global flag for matchAll usage"
    );
  });
});
