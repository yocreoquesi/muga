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
import { readFileSync } from "node:fs";
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

  // The landing at muga.app is served by a Cloudflare Worker that deploys
  // landing/index.html via wrangler on push to main. The version stamps
  // here MUST match package.json so the public site never lags the release.
  test("landing/index.html softwareVersion matches", () => {
    const html = read("landing/index.html");
    const match = html.match(/"softwareVersion":\s*"(\d+\.\d+\.\d+)"/);
    assert.ok(match, "landing/index.html must contain a softwareVersion in JSON-LD");
    assert.equal(match[1], VERSION, `landing softwareVersion has "${match[1]}", expected "${VERSION}"`);
  });

  test("landing/index.html brand .ver tag matches", () => {
    const html = read("landing/index.html");
    const match = html.match(/<span class="ver">v(\d+\.\d+\.\d+)<\/span>/);
    assert.ok(match, "landing/index.html must contain a <span class=\"ver\">vX.Y.Z</span>");
    assert.equal(match[1], VERSION, `landing .ver has "${match[1]}", expected "${VERSION}"`);
  });

  test("landing/index.html hero eyebrow version matches", () => {
    const html = read("landing/index.html");
    const match = html.match(/class="dot"><\/span>\s*v(\d+\.\d+\.\d+)\s*·/);
    assert.ok(match, "landing/index.html hero eyebrow must contain 'vX.Y.Z ·'");
    assert.equal(match[1], VERSION, `landing eyebrow has "${match[1]}", expected "${VERSION}"`);
  });

  test("landing/index.html footer version matches", () => {
    const html = read("landing/index.html");
    const match = html.match(/<span>v(\d+\.\d+\.\d+)\s*·\s*published/);
    assert.ok(match, "landing/index.html footer must contain 'vX.Y.Z · published'");
    assert.equal(match[1], VERSION, `landing footer has "${match[1]}", expected "${VERSION}"`);
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

  test("README.md tests badge must NOT contain a hardcoded count (drift guard #828)", () => {
    // Hardcoded test-count numbers in the badge drift every time tests are added.
    // The badge was migrated to a non-numeric label ("tests-passing") in #828.
    // docs-claims.test.mjs enforces this invariant going forward; this test
    // mirrors it here so the version-consistency suite also catches regressions.
    const readme = read("README.md");
    const badgeLine = readme
      .split("\n")
      .find((l) => l.includes("img.shields.io") && l.toLowerCase().includes("test"));
    assert.ok(badgeLine, "README must have a shields.io tests badge line");
    const hasHardcodedNumber = /tests-\d+|tests_\d+|\d+_pass|\d+-pass/i.test(badgeLine);
    assert.ok(
      !hasHardcodedNumber,
      `Tests badge contains a hardcoded number that will drift: ${badgeLine.trim()}\n` +
        "Replace with a non-numeric label such as 'tests-passing'."
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

// Issue #616: regression guards against the silent CWS-upload failure that
// affected v1.13.4..v1.16.0 (HTTP 200 with itemError in body interpreted as
// success) and against the manifest.v2.json leaking into the Chrome bundle.
describe("Version consistency — CWS pipeline hardening (issue #616)", () => {

  test("release.yml routes CWS upload through cws-check-response.mjs", () => {
    const yml = read(".github/workflows/release.yml");
    const uploadStepIdx = yml.indexOf("Upload to Chrome Web Store");
    assert.ok(uploadStepIdx > 0, "Upload step must exist");
    // Inspect only the upload step body (until the next named step).
    const nextStepIdx = yml.indexOf("- name:", uploadStepIdx + 1);
    const uploadStep = yml.slice(uploadStepIdx, nextStepIdx);
    assert.ok(
      uploadStep.includes("scripts/cws-check-response.mjs"),
      "Upload step must invoke scripts/cws-check-response.mjs — never check $HTTP_CODE alone (issue #616)"
    );
  });

  test("release.yml routes CWS publish through cws-check-response.mjs", () => {
    const yml = read(".github/workflows/release.yml");
    const publishStepIdx = yml.indexOf("Publish on Chrome Web Store");
    assert.ok(publishStepIdx > 0, "Publish step must exist");
    const nextStepIdx = yml.indexOf("- name:", publishStepIdx + 1);
    const publishStep = yml.slice(publishStepIdx, nextStepIdx);
    assert.ok(
      publishStep.includes("scripts/cws-check-response.mjs"),
      "Publish step must invoke scripts/cws-check-response.mjs (same HTTP-200-with-errors quirk as upload)"
    );
  });

  test("release.yml CWS upload step does NOT gate on HTTP_CODE alone", () => {
    // The pre-#616 logic only ran `if [ "$HTTP_CODE" -ge 400 ]; then
    // result=failure`, which silently masked PKG_INVALID_ZIP responses that
    // CWS returns under HTTP 200. Keep that anti-pattern out.
    const yml = read(".github/workflows/release.yml");
    const uploadStepIdx = yml.indexOf("Upload to Chrome Web Store");
    const nextStepIdx = yml.indexOf("- name:", uploadStepIdx + 1);
    const uploadStep = yml.slice(uploadStepIdx, nextStepIdx);
    const hasInlineHttpGate = /if\s*\[\s*"\$HTTP_CODE"\s*-ge\s*400\s*\]/.test(
      uploadStep
    );
    assert.ok(
      !hasInlineHttpGate,
      "Upload step reintroduced inline HTTP_CODE gate — must defer to cws-check-response.mjs (issue #616)"
    );
  });

  test("build:chrome excludes manifest.v2.json from the Chrome bundle", () => {
    // manifest.v2.json is the Firefox MV2 manifest. It must not ship inside
    // the Chrome zip — it is build-time machinery, not extension content.
    const pkg = JSON.parse(read("package.json"));
    const buildChrome = pkg.scripts["build:chrome"];
    assert.ok(buildChrome, "package.json must define build:chrome");
    assert.match(
      buildChrome,
      /--ignore-files\s+[^&]*\bmanifest\.v2\.json\b/,
      "build:chrome --ignore-files must include manifest.v2.json"
    );
  });

  test("build:firefox excludes manifest.v2.json from the Firefox bundle", () => {
    // After with-firefox-manifest.sh swaps the MV2 manifest into place as
    // manifest.json, the file `manifest.v2.json` still exists in src/ and
    // would otherwise ship as a duplicate.
    const pkg = JSON.parse(read("package.json"));
    const buildFirefox = pkg.scripts["build:firefox"];
    assert.ok(buildFirefox, "package.json must define build:firefox");
    assert.match(
      buildFirefox,
      /--ignore-files\s+[^&]*\bmanifest\.v2\.json\b/,
      "build:firefox --ignore-files must include manifest.v2.json"
    );
  });
});
