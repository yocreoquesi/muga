/**
 * Selenium/geckodriver fixtures for MUGA Firefox extension E2E smoke tests
 * (#1128, slice 1).
 *
 * Chosen design (engram sdd/firefox-webext-smoke/explore): Selenium
 * WebDriver + geckodriver, headless Firefox, driver.installAddon(dir, true).
 * Rejected: web-ext run, playwright-webextext.
 *
 * Firefox internal add-on UUID gotcha:
 * -------------------------------------
 * The `browser_specific_settings.gecko.id` in the manifest ("muga@..." here)
 * is the extension's STABLE ID, but it is NOT the host segment used in
 * moz-extension://<host>/... URLs. Firefox maps each installed extension ID
 * to a randomly-generated internal UUID (stored in the
 * `extensions.webextensions.uuids` pref) and uses THAT UUID as the
 * moz-extension:// host. A fresh temporary install normally gets a fresh
 * random UUID, which would make the extension origin non-deterministic
 * across runs.
 *
 * Firefox honors a PRESET mapping in that same pref: if we set
 * `extensions.webextensions.uuids` to `{"<gecko-id>": "<our-chosen-uuid>"}`
 * as a profile preference BEFORE the browser starts, Firefox uses our UUID
 * instead of generating a random one. That is what makes the extension
 * origin deterministic here — not the gecko id itself.
 */

import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SRC_DIR = path.join(REPO_ROOT, "src");
const MANIFEST_V2_PATH = path.join(SRC_DIR, "manifest.v2.json");

// Fixed internal UUID we preset via extensions.webextensions.uuids so
// moz-extension://<this>/... is deterministic across runs. Not meaningful
// beyond being a valid UUID string.
export const FIXED_EXTENSION_UUID = "3a9f7a10-3f4c-4c8e-9b1a-8f5a3c9d2e11";

/**
 * Reads the Firefox (MV2) manifest and returns its declared gecko id.
 */
export function readGeckoId() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_V2_PATH, "utf8"));
  const geckoId = manifest?.browser_specific_settings?.gecko?.id;
  if (!geckoId) {
    throw new Error(`manifest.v2.json is missing browser_specific_settings.gecko.id at ${MANIFEST_V2_PATH}`);
  }
  return geckoId;
}

/**
 * Builds an ISOLATED temp copy of src/ with manifest.json overwritten by
 * manifest.v2.json's content, for loading into Firefox. This avoids the
 * collision/dirty-tree risk of scripts/with-firefox-manifest.sh, which
 * swaps the TRACKED src/manifest.json in place.
 *
 * @returns {Promise<string>} path to the temp extension directory
 */
export async function buildFirefoxExtensionDir() {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "muga-ff-ext-"));
  const extDir = path.join(tmpRoot, "src");
  await fsp.cp(SRC_DIR, extDir, { recursive: true });

  const manifestV2Raw = await fsp.readFile(MANIFEST_V2_PATH, "utf8");
  await fsp.writeFile(path.join(extDir, "manifest.json"), manifestV2Raw, "utf8");

  return extDir;
}

async function removeDirSafe(dir) {
  if (!dir) return;
  await fsp.rm(path.dirname(dir), { recursive: true, force: true });
}

/**
 * Launches headless Firefox with the MUGA extension loaded (as a temporary
 * add-on) and the internal UUID pinned to FIXED_EXTENSION_UUID.
 *
 * @returns {Promise<{driver: import('selenium-webdriver').WebDriver, extDir: string, geckoId: string, extensionOrigin: string}>}
 */
export async function launchFirefoxWithExtension() {
  const geckoId = readGeckoId();
  const extDir = await buildFirefoxExtensionDir();

  const options = new firefox.Options();
  options.addArguments("-headless");
  options.setPreference("extensions.webextensions.uuids", JSON.stringify({ [geckoId]: FIXED_EXTENSION_UUID }));
  // Allow the temporary install to run without additional prompts.
  options.setPreference("xpinstall.signatures.required", false);

  const firefoxBinary = process.env.MUGA_FIREFOX_BINARY;
  if (firefoxBinary) {
    options.setBinary(firefoxBinary);
  }

  const driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).build();

  await driver.installAddon(extDir, /* temporary */ true);

  const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

  return { driver, extDir, geckoId, extensionOrigin };
}

/**
 * Completes onboarding by setting the same storage flags the Chromium
 * fixture sets (tests/e2e/fixtures.mjs's completeOnboarding), via
 * chrome.storage (the WebExtension polyfill exposes `chrome.*` in Firefox
 * too, see src/lib/browser-polyfill.min.js).
 *
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {string} extensionOrigin - e.g. "moz-extension://<uuid>"
 * @param {{enableFeature?: boolean}} [opts]
 */
export async function completeOnboarding(driver, extensionOrigin, { enableFeature = true } = {}) {
  await driver.get(`${extensionOrigin}/popup/popup.html`);

  await driver.executeAsyncScript(
    (enableFeatureArg, callback) => {
      chrome.storage.sync.set(
        {
          enabled: true,
          cookieConsentMinimizerEnabled: enableFeatureArg,
          injectOwnAffiliate: false,
          notifyForeignAffiliate: false,
          language: "en",
        },
        () => {
          chrome.storage.local.set(
            {
              mugaConsent: {
                onboardingDone: true,
                consentVersion: "1.2",
                consentDate: Date.now(),
              },
            },
            () => {
              chrome.storage.sync.set({ onboardingDone: true }, () => callback());
            }
          );
        }
      );
    },
    enableFeature
  );

  // Mirrors tests/e2e/helpers/dnr-propagation.mjs's waitForDnrPropagation:
  // no observable signal exists for prefs-cache/DNR propagation after a
  // storage.set call, so a short fixed settle window is used (#824 debt).
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/**
 * Tears down the driver and removes the temp extension directory.
 */
export async function teardown(driver, extDir) {
  try {
    if (driver) await driver.quit();
  } finally {
    await removeDirSafe(extDir);
  }
}
