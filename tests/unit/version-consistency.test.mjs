/**
 * MUGA — Version consistency test
 *
 * Ensures the version string is identical across every file that carries it.
 * If this test fails after a version bump, it means you forgot to update one
 * or more files. The canonical source of truth is package.json.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

function read(relPath) {
  return readFileSync(join(root, relPath), "utf8");
}

function readJSON(relPath) {
  return JSON.parse(read(relPath));
}

// Canonical version from package.json
const VERSION = readJSON("package.json").version;

describe("Version consistency — all files must match package.json", () => {

  test(`package.json is ${VERSION}`, () => {
    assert.ok(VERSION.match(/^\d+\.\d+\.\d+$/), "Version must be semver (X.Y.Z)");
  });

  test("src/manifest.json matches", () => {
    const v = readJSON("src/manifest.json").version;
    assert.equal(v, VERSION, `manifest.json has "${v}", expected "${VERSION}"`);
  });

  test("src/manifest.v2.json matches", () => {
    const v = readJSON("src/manifest.v2.json").version;
    assert.equal(v, VERSION, `manifest.v2.json has "${v}", expected "${VERSION}"`);
  });

  test("README.md badge matches", () => {
    const readme = read("README.md");
    const match = readme.match(/version-(\d+\.\d+\.\d+)/);
    assert.ok(match, "README.md must contain a version badge");
    assert.equal(match[1], VERSION, `README badge has "${match[1]}", expected "${VERSION}"`);
  });

  test("CHANGELOG.md has an entry for the current version", () => {
    const changelog = read("CHANGELOG.md");
    assert.ok(
      changelog.includes(`## [${VERSION}]`),
      `CHANGELOG.md must contain a "## [${VERSION}]" section header`
    );
  });

  test("CHANGELOG.md entry for current version has a date", () => {
    const changelog = read("CHANGELOG.md");
    const re = new RegExp(`## \\[${VERSION.replace(/\./g, "\\.")}\\] - (\\d{4}-\\d{2}-\\d{2})`);
    const match = changelog.match(re);
    assert.ok(match, `CHANGELOG.md entry for ${VERSION} must include a date (YYYY-MM-DD)`);
  });

  test("CHANGELOG.md entry for current version is not empty", () => {
    const changelog = read("CHANGELOG.md");
    const escapedVersion = VERSION.replace(/\./g, "\\.");
    // Extract content between this version header and the next version header (or EOF)
    const re = new RegExp(`## \\[${escapedVersion}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`);
    const match = changelog.match(re);
    assert.ok(match, `CHANGELOG.md must have content under [${VERSION}]`);
    const body = match[1].trim();
    assert.ok(body.length > 50, `CHANGELOG.md entry for ${VERSION} must have meaningful content (got ${body.length} chars)`);
  });

  test("CHANGELOG.md entry for current version has at least one subsection", () => {
    const changelog = read("CHANGELOG.md");
    const escapedVersion = VERSION.replace(/\./g, "\\.");
    const re = new RegExp(`## \\[${escapedVersion}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`);
    const match = changelog.match(re);
    assert.ok(match);
    const body = match[1];
    // Must have at least one ### heading (Features, Fixes, Tests, etc.)
    assert.ok(
      /### \w+/.test(body),
      `CHANGELOG.md entry for ${VERSION} must have at least one ### subsection (Features, Fixes, Tests, etc.)`
    );
  });

  test("docs/index.html softwareVersion matches", () => {
    const html = read("docs/index.html");
    const match = html.match(/"softwareVersion":\s*"(\d+\.\d+\.\d+)"/);
    assert.ok(match, "docs/index.html must contain a softwareVersion in JSON-LD");
    assert.equal(match[1], VERSION, `softwareVersion has "${match[1]}", expected "${VERSION}"`);
  });

  test("docs/store-listing.md version matches", () => {
    const listing = read("docs/store-listing.md");
    const match = listing.match(/> Version:\s*(\d+\.\d+\.\d+)/);
    assert.ok(match, "store-listing.md must contain a '> Version:' line");
    assert.equal(match[1], VERSION, `store-listing.md has "${match[1]}", expected "${VERSION}"`);
  });

  test("src/privacy/privacy.html version matches", () => {
    const html = read("src/privacy/privacy.html");
    const match = html.match(/Version\s+(\d+\.\d+\.\d+)/);
    assert.ok(match, "privacy.html must contain a Version string");
    assert.equal(match[1], VERSION, `privacy.html has "${match[1]}", expected "${VERSION}"`);
  });

  test("docs/privacy-page.html version matches", () => {
    const html = read("docs/privacy-page.html");
    const match = html.match(/Version\s+(\d+\.\d+\.\d+)/);
    assert.ok(match, "privacy-page.html must contain a Version string");
    assert.equal(match[1], VERSION, `privacy-page.html has "${match[1]}", expected "${VERSION}"`);
  });
});

describe("Version consistency — README badges", () => {

  test("README.md Chrome badge links to Chrome Web Store (not Coming Soon)", () => {
    const readme = read("README.md");
    assert.ok(
      readme.includes("chromewebstore.google.com/detail"),
      "Chrome badge must link to Chrome Web Store, not '#installation'"
    );
    assert.ok(
      !readme.includes("Coming_soon"),
      "Chrome badge must not say 'Coming soon'"
    );
  });

  test("README.md Firefox badge links to AMO", () => {
    const readme = read("README.md");
    assert.ok(
      readme.includes("addons.mozilla.org/firefox/addon/muga"),
      "Firefox badge must link to AMO"
    );
  });

  test("README.md test count badge is not stale (within 50 of actual)", () => {
    const readme = read("README.md");
    const match = readme.match(/tests-(\d+)_pass/);
    assert.ok(match, "README must have a tests badge");
    const badgeCount = parseInt(match[1], 10);

    // Compute the floor dynamically from the number of test() calls across
    // all unit test files rather than hard-coding a magic number that goes
    // stale every time a new test file is added.
    //
    // Staleness protocol: if this assertion fails, the README badge is more
    // than 50 tests behind the actual count. Update the badge and re-run.
    // The computed floor is intentionally conservative (counts `test(` call
    // sites, not nested sub-tests) so a ±50 window is reasonable.
    const unitDir = join(__dirname, ".");
    const unitFiles = readdirSync(unitDir).filter(f => f.endsWith(".test.mjs"));
    let computedCount = 0;
    for (const f of unitFiles) {
      const src = readFileSync(join(unitDir, f), "utf8");
      // Count top-level test( calls; this under-counts nested describe tests
      // but provides a stable lower bound for the badge floor.
      const matches = src.match(/\btest\(/g);
      computedCount += matches ? matches.length : 0;
    }
    const floor = Math.max(computedCount - 50, 0);

    assert.ok(
      badgeCount >= floor,
      `Badge shows ${badgeCount} tests — likely stale. Computed floor: ${floor} (actual test() sites: ${computedCount}). Update the README badge.`
    );
  });
});

describe("Version consistency — release workflow", () => {

  test("release.yml submits to Firefox AMO", () => {
    const yml = read(".github/workflows/release.yml");
    assert.ok(yml.includes("web-ext sign"), "release.yml must run web-ext sign for AMO");
    assert.ok(yml.includes("AMO_JWT_ISSUER"), "release.yml must reference AMO_JWT_ISSUER secret");
  });

  test("release.yml submits to Chrome Web Store", () => {
    const yml = read(".github/workflows/release.yml");
    assert.ok(yml.includes("chromewebstore"), "release.yml must call CWS API");
    assert.ok(yml.includes("CWS_CLIENT_ID"), "release.yml must reference CWS_CLIENT_ID secret");
  });

  test("release.yml uploads source code for AMO review", () => {
    const yml = read(".github/workflows/release.yml");
    assert.ok(yml.includes("upload-source-code"), "release.yml must upload source code to AMO");
  });
});

describe("Version consistency — build artifacts", () => {

  test("release.yml builds both Chrome and Firefox on tag push", () => {
    const yml = read(".github/workflows/release.yml");
    assert.ok(yml.includes("build:chrome"), "release.yml must run build:chrome");
    assert.ok(yml.includes("build:firefox"), "release.yml must run build:firefox");
  });

  test("release.yml creates a GitHub Release with artifacts", () => {
    const yml = read(".github/workflows/release.yml");
    assert.ok(yml.includes("action-gh-release"), "release.yml must use gh-release action");
    assert.ok(yml.includes("-chrome.zip"), "release.yml must upload Chrome zip");
    assert.ok(yml.includes("-firefox.zip"), "release.yml must upload Firefox zip");
  });

  test("release.yml runs tests before building", () => {
    const yml = read(".github/workflows/release.yml");
    const testIdx = yml.indexOf("npm test");
    const buildIdx = yml.indexOf("build:chrome");
    assert.ok(testIdx > 0, "release.yml must run npm test");
    assert.ok(testIdx < buildIdx, "npm test must run before build:chrome");
  });
});
