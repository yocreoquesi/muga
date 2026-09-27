/**
 * MUGA — screenshot tooling hardening unit tests (#1489)
 *
 * Covers the pure/extractable pieces of tools/screenshots/render.mjs and
 * tools/screenshots/fetch-fonts.mjs that were hardened per the native
 * review of PR #1469 (review-b66e6945d2d714ae):
 *
 *   isContained()          - static-server path containment (no sibling-prefix escape)
 *   matchingJobs()         - --filter selection (empty match must be detectable)
 *   isFontCacheComplete()  - font cache validity (whole set, not just fonts.css)
 *   fetchOk()              - fetch() that fails loudly on a non-2xx response
 *
 * Run with: npm test
 */

import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const renderUrl = pathToFileURL(resolve(ROOT, "tools/screenshots/render.mjs")).href;
const fetchFontsUrl = pathToFileURL(resolve(ROOT, "tools/screenshots/fetch-fonts.mjs")).href;

const { isContained, matchingJobs } = await import(renderUrl);
const { isFontCacheComplete, fetchOk, FONT_FILES } = await import(fetchFontsUrl);

describe("render.mjs: isContained (static server containment)", () => {
  test("allows a file inside the root", () => {
    const here = path.resolve("/a/b");
    assert.equal(isContained(here, path.join(here, "stage.html")), true);
  });

  test("allows a nested file inside the root", () => {
    const here = path.resolve("/a/b");
    assert.equal(isContained(here, path.join(here, "fonts", "Archivo-var.woff2")), true);
  });

  test("rejects a real parent-directory escape", () => {
    const here = path.resolve("/a/b");
    assert.equal(isContained(here, path.resolve("/a/secret.txt")), false);
  });

  test("rejects a sibling folder that only shares a name prefix (#1489 regression)", () => {
    // Bug: "/a/bEvil/x".startsWith("/a/b") is true, so the old check let this through.
    const here = path.resolve("/a/b");
    const sibling = path.resolve("/a/bEvil/x");
    assert.equal(isContained(here, sibling), false);
  });

  test("allows the root itself", () => {
    const here = path.resolve("/a/b");
    assert.equal(isContained(here, here), true);
  });
});

describe("render.mjs: matchingJobs (--filter)", () => {
  const jobs = [{ out: "store-1-clean-links-1280x800.png" }, { out: "promo-small-440x280.png" }, { out: "promo-marquee-1400x560.png" }];

  test("returns every job when the filter is empty", () => {
    assert.deepEqual(matchingJobs(jobs, ""), jobs);
  });

  test("returns only jobs whose output name contains the filter", () => {
    const matched = matchingJobs(jobs, "promo");
    assert.equal(matched.length, 2);
    assert.ok(matched.every((j) => j.out.includes("promo")));
  });

  test("returns an empty array when nothing matches, so the caller can detect and exit non-zero", () => {
    const matched = matchingJobs(jobs, "does-not-exist");
    assert.deepEqual(matched, []);
  });
});

describe("fetch-fonts.mjs: isFontCacheComplete", () => {
  test("is incomplete when the directory is empty", () => {
    assert.equal(isFontCacheComplete([]), false);
  });

  test("is incomplete when only fonts.css exists (#1489 regression: interrupted download)", () => {
    assert.equal(isFontCacheComplete(["fonts.css"]), false);
  });

  test("is incomplete when one woff2 face is missing", () => {
    const partial = FONT_FILES.filter((f) => f !== "IBMPlexMono-600.woff2");
    assert.equal(isFontCacheComplete(partial), false);
  });

  test("is complete when every expected file is present", () => {
    assert.equal(isFontCacheComplete(FONT_FILES), true);
  });

  test("is complete when extra unrelated files are also present", () => {
    assert.equal(isFontCacheComplete([...FONT_FILES, "README.txt"]), true);
  });
});

describe("fetch-fonts.mjs: fetchOk", () => {
  const originalFetch = globalThis.fetch;
  after(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns the response when ok", async () => {
    globalThis.fetch = async () => new Response("body", { status: 200 });
    const res = await fetchOk("https://example.test/ok");
    assert.equal(res.ok, true);
  });

  test("throws loudly on a 404 instead of letting the caller write the error body to disk", async () => {
    globalThis.fetch = async () => new Response("Not Found", { status: 404, statusText: "Not Found" });
    await assert.rejects(() => fetchOk("https://example.test/missing"), /404/);
  });

  test("throws loudly on a 500", async () => {
    globalThis.fetch = async () => new Response("boom", { status: 500, statusText: "Internal Server Error" });
    await assert.rejects(() => fetchOk("https://example.test/broken"), /500/);
  });

  test("error message names the failing URL", async () => {
    globalThis.fetch = async () => new Response("", { status: 403, statusText: "Forbidden" });
    await assert.rejects(() => fetchOk("https://example.test/blocked"), /example\.test\/blocked/);
  });
});
