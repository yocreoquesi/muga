/**
 * MUGA — nightly real-site CMP canary Playwright config (#1129).
 *
 * Deliberately SEPARATE from playwright.config.mjs (the normal `npm run
 * test:e2e` config, testDir "tests/e2e"): this config's testDir is
 * "tests/canary", so the two suites never collide and the canary — which
 * hits real, uncontrolled third-party websites — can never be picked up by
 * the local/CI e2e gate.
 *
 * NON-BLOCKING BY DESIGN: this suite exists to raise a nightly drift alarm
 * (see tests/canary/cmp-canary.spec.mjs and tools/canary-report.mjs), never
 * to gate a PR or a release build. `retries: 2` absorbs real-world
 * navigation flakiness (DNS blips, slow real sites) — see
 * cmp-canary.spec.mjs for which failures are retry-worthy vs. recorded as
 * "inconclusive"/"fail" data.
 */

import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "src");

export default defineConfig({
  testDir: "tests/canary",
  timeout: 120_000,
  retries: 2,
  workers: 1, // extensions require serial execution (same constraint as playwright.config.mjs)
  reporter: [["list"]],
  use: {
    headless: false, // Chrome extensions require headed mode
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    {
      name: "cmp-canary",
      use: {
        launchOptions: {
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
            "--no-first-run",
            "--disable-search-engine-choice-screen",
          ],
        },
      },
    },
  ],
});
