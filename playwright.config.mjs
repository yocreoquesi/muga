import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "src");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
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
