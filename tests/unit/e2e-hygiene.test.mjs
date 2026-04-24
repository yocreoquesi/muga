/**
 * MUGA — E2E Hygiene Guard
 *
 * Asserts that E2E specs remain hermetic:
 *  1. No external service URLs (httpbin.org, example.com, example.net,
 *     or bare http:// navigations outside of page.route() stubs).
 *  2. No wall-clock waitForTimeout() calls with arguments ≥ 500 ms.
 *  3. playwright.config.mjs has a non-zero retries value or a
 *     process.env.CI conditional.
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
const e2eDir = join(root, "tests/e2e");

/** Read all *.mjs files in the e2e directory (exclude fixtures.mjs — not a spec). */
function readE2ESpecs() {
  const files = readdirSync(e2eDir).filter(
    (f) => f.endsWith(".mjs") && f !== "fixtures.mjs"
  );
  return files.map((f) => ({
    name: f,
    path: join(e2eDir, f),
    content: readFileSync(join(e2eDir, f), "utf8"),
  }));
}

const specs = readE2ESpecs();

// ---------------------------------------------------------------------------
// 1. No external service URLs outside of page.route() stubs
// ---------------------------------------------------------------------------

describe("E2E hygiene — no external service dependencies", () => {
  /**
   * Hosts that MUST be stubbed via page.route() or stubHost() before navigation.
   * A spec file is clean if: every host in this list that appears in a page.goto()
   * call in the file ALSO has a corresponding page.route() or stubHost() call
   * referencing the same host anywhere in the file.
   *
   * example.com is excluded from this list because it is used legitimately
   * as inline URL-tester input (not navigated to).
   */
  const FORBIDDEN_HOSTS = ["httpbin.org", "example.net"];

  for (const spec of specs) {
    test(`${spec.name} — no forbidden external navigations without route stubs`, () => {
      for (const host of FORBIDDEN_HOSTS) {
        const content = spec.content;

        // Check if this file navigates to the forbidden host
        const navigatesToHost = new RegExp(
          `page\\.goto\\s*\\(\\s*["'\`]https?://${host.replace(".", "\\.")}`
        ).test(content);

        if (!navigatesToHost) continue; // Host not used — nothing to check

        // The file navigates to this host: it MUST also stub it
        const hasStub =
          content.includes(`page.route("**/${host}/`) ||
          content.includes(`page.route('**/${host}/`) ||
          content.includes(`page.route(\`**/${host}/`) ||
          content.includes(`stubHost(page, "${host}"`) ||
          content.includes(`stubHost(page, '${host}'`);

        assert.ok(
          hasStub,
          `${spec.name} navigates to "${host}" but has no page.route() stub for it.\n` +
          `  Add: await page.route("**/${host}/**", route => route.fulfill({...}))\n` +
          `  or use the stubHost() helper before each page.goto() to that host.`
        );
      }
    });

    test(`${spec.name} — no bare http:// navigations`, () => {
      // Disallow page.goto("http://...") — all navigations should be https or chrome-extension://
      const lines = spec.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.match(/page\.goto\s*\(\s*["'`]http:\/\//)) continue;
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;

        assert.fail(
          `${spec.name}:${i + 1} — page.goto() with bare http:// found.\n` +
          `  Line: ${line.trim()}\n` +
          `  Use https:// or a chrome-extension:// URL, and stub with page.route() if needed.`
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. No waitForTimeout() calls with argument >= 500 ms
// ---------------------------------------------------------------------------

describe("E2E hygiene — no long waitForTimeout calls", () => {
  /**
   * Match waitForTimeout( followed by a numeric literal >= 500.
   * Accepts: waitForTimeout(500), waitForTimeout( 1000 ), waitForTimeout(2_000)
   * The REASON comment exemption: if the same line (or the line above) has
   * "// REASON:" we skip it — author has documented why it is necessary.
   */
  const TIMEOUT_RE = /waitForTimeout\s*\(\s*([\d_]+)\s*\)/g;

  for (const spec of specs) {
    test(`${spec.name} — no waitForTimeout >= 500 ms without justification`, () => {
      const lines = spec.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let match;
        const re = new RegExp(TIMEOUT_RE.source, "g");
        while ((match = re.exec(line)) !== null) {
          const raw = match[1].replace(/_/g, "");
          const ms = parseInt(raw, 10);
          if (ms < 500) continue;

          // Check for REASON exemption on this line or any of the 3 preceding lines
          // (a REASON comment may span multiple lines before the waitForTimeout call)
          const context3 = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
          const hasReason = context3.includes("// REASON:");

          assert.ok(
            hasReason,
            `${spec.name}:${i + 1} — waitForTimeout(${ms}) is >= 500 ms and has no REASON comment.\n` +
            `  Line: ${line.trim()}\n` +
            `  Either replace with a deterministic signal or add a "// REASON: <why>" comment.`
          );
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 3. playwright.config.mjs has non-zero retries
// ---------------------------------------------------------------------------

describe("E2E hygiene — playwright.config.mjs has retries configured", () => {
  test("retries is non-zero or uses process.env.CI conditional", () => {
    const configPath = join(root, "playwright.config.mjs");
    const content = readFileSync(configPath, "utf8");

    // Accept: retries: 1, retries: 2, retries: process.env.CI ? N : M (where N > 0)
    const hasRetries = /retries\s*:/.test(content);
    assert.ok(hasRetries, "playwright.config.mjs must contain a 'retries:' key");

    // Must NOT be a plain zero: retries: 0
    const isPlainZero = /retries\s*:\s*0\b/.test(content);
    assert.ok(
      !isPlainZero,
      "playwright.config.mjs has retries: 0. Set to 1, or use process.env.CI ? 1 : 0."
    );
  });
});
