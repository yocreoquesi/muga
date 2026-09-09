import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "src");

export default defineConfig({
  testDir: "tests/e2e",

  // 30s was the budget for every test, and it is what actually failed on CI.
  //
  // The signature: the DNR and popup specs died at 29.4s, 30.1s, 30.2s — the
  // test timeout to three digits, on both the first attempt and the retry,
  // while the same specs passed locally in 5s and the whole 138-test suite ran
  // green in 2.8 minutes. A test that fails AT its timeout on a two-core shared
  // runner and nowhere else is not flaky, it is underfunded.
  //
  // What eats the budget there is real work, not politeness: loading an
  // unpacked extension, waiting for the install-time consent write to settle,
  // waking an MV3 service worker, letting updateDynamicRules propagate to the
  // point where a rule is MATCHABLE, and only then navigating. Locally that is
  // seconds; under xvfb on a runner shared with other jobs it is not.
  //
  // Raised only where the problem is. Local runs keep the tight budget, so a
  // genuinely slow test is still caught while writing it.
  timeout: process.env.CI ? 90_000 : 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // extensions require serial execution
  reporter: [["list"]],
  use: {
    headless: false, // Chrome extensions require headed mode
    viewport: { width: 800, height: 600 },
  },
  projects: [
    {
      name: "chromium",
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
