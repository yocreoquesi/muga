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

  // Firefox 126+ gates WebDriver access to PRIVILEGED contexts (navigating to
  // moz-extension:// pages, which completeOnboarding() does to seed the
  // extension's chrome.storage) behind an explicit opt-in ENV VAR on the
  // Firefox process: MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1. Without it, FF 152+
  // rejects the navigation with UnsupportedOperationError ("Navigation ... is
  // not allowed in this context"). This supersedes the older
  // remote.system-access-check.enabled pref, which FF 152 no longer honors for
  // this. geckodriver passes the inherited process env to the Firefox it
  // launches, so setting it here (before Builder().build() spawns geckodriver)
  // reaches Firefox. A no-op on older Firefox that never gated on it.
  process.env.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS = "1";

  let driver;
  try {
    const options = new firefox.Options();
    options.addArguments("-headless");
    options.setPreference("extensions.webextensions.uuids", JSON.stringify({ [geckoId]: FIXED_EXTENSION_UUID }));
    // Allow the temporary install to run without additional prompts.
    options.setPreference("xpinstall.signatures.required", false);

    const firefoxBinary = process.env.MUGA_FIREFOX_BINARY;
    if (firefoxBinary) {
      options.setBinary(firefoxBinary);
    }

    driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).build();

    await driver.installAddon(extDir, /* temporary */ true);

    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    return { driver, extDir, geckoId, extensionOrigin };
  } catch (err) {
    // The temp extension dir is created BEFORE the browser build/install; if
    // either throws, the caller never receives extDir and its
    // finally{ teardown } gets `undefined`, orphaning muga-ff-ext-* under
    // tmpdir. Clean up here so a failed launch leaves nothing behind.
    if (driver) {
      try {
        await driver.quit();
      } catch {
        // ignore — the driver may be only half-built
      }
    }
    await removeDirSafe(extDir);
    throw err;
  }
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
          cookieConsentMode: enableFeatureArg ? "reject-only" : "off",
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
 * Writes arbitrary keys directly into chrome.storage.sync (referer-beacon-privacy
 * PR 3). Separate from completeOnboarding (which only seeds the fixed set of
 * onboarding/consent keys shared with the cookie-consent smoke suite) so new
 * prefs (suppressReferer, blockBeacons, whitelist, blacklist) can be layered on
 * top without touching that shared fixture's contract.
 *
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {string} extensionOrigin - e.g. "moz-extension://<uuid>"
 * @param {object} values - plain object merged into chrome.storage.sync
 */
export async function setStorageSync(driver, extensionOrigin, values) {
  await driver.get(`${extensionOrigin}/popup/popup.html`);

  await driver.executeAsyncScript(
    (valuesArg, callback) => {
      chrome.storage.sync.set(valuesArg, () => callback());
    },
    values
  );

  // Mirrors completeOnboarding's settle-window comment: no observable signal
  // exists for prefs-cache invalidation / FF listener re-read after a
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
