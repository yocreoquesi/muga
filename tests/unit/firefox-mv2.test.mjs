/**
 * MUGA — Firefox MV2 Compatibility Tests
 *
 * Guards that must never regress for Firefox MV2 / Firefox Android:
 * DNR/contextMenus feature detection, chrome.* promise shim, polyfill loading,
 * and MV2 manifest structural invariants.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Source files for Firefox compatibility checks
const SERVICE_WORKER_SOURCE = readFileSync(
  join(__dirname, "../../src/background/service-worker.js"), "utf8"
);
const STORAGE_SOURCE = readFileSync(
  join(__dirname, "../../src/lib/storage.js"), "utf8"
);
const POPUP_HTML = readFileSync(
  join(__dirname, "../../src/popup/popup.html"), "utf8"
);
const OPTIONS_HTML = readFileSync(
  join(__dirname, "../../src/options/options.html"), "utf8"
);
const ONBOARDING_HTML = readFileSync(
  join(__dirname, "../../src/onboarding/onboarding.html"), "utf8"
);
const BACKGROUND_HTML = readFileSync(
  join(__dirname, "../../src/background/background.html"), "utf8"
);
const MANIFEST_V2 = require("../../src/manifest.v2.json");

// ---------------------------------------------------------------------------
// Firefox MV2 compatibility -- guards that must never be removed
// ---------------------------------------------------------------------------
describe("Firefox MV2 compatibility guards", () => {

  test("service-worker.js guards declarativeNetRequest with hasDNR check", () => {
    assert.ok(
      SERVICE_WORKER_SOURCE.includes('const hasDNR = typeof chrome.declarativeNetRequest !== "undefined"'),
      "service-worker.js must declare hasDNR guard for Firefox MV2 compatibility"
    );
  });

  test("syncCustomParamsDNR bails early when hasDNR is false", () => {
    const fnMatch = SERVICE_WORKER_SOURCE.match(
      /async function syncCustomParamsDNR[\s\S]*?if \(!hasDNR\) return;/
    );
    assert.ok(fnMatch, "syncCustomParamsDNR must check !hasDNR before any DNR call");
  });

  test("applyDnrState bails early when hasDNR is false", () => {
    const fnMatch = SERVICE_WORKER_SOURCE.match(
      /async function applyDnrState[\s\S]*?if \(!hasDNR\) return;/
    );
    assert.ok(fnMatch, "applyDnrState must check !hasDNR before any DNR call");
  });

  test("service-worker.js guards contextMenus with hasContextMenus check", () => {
    assert.ok(
      SERVICE_WORKER_SOURCE.includes('const hasContextMenus = typeof chrome.contextMenus !== "undefined"'),
      "service-worker.js must declare hasContextMenus guard for Firefox Android"
    );
  });

  test("syncContextMenus bails early when hasContextMenus is false", () => {
    const fnMatch = SERVICE_WORKER_SOURCE.match(
      /async function syncContextMenus[\s\S]*?if \(!hasContextMenus\) return;/
    );
    assert.ok(fnMatch, "syncContextMenus must check !hasContextMenus before any contextMenus call");
  });

  test("contextMenus.onClicked listener is guarded", () => {
    assert.ok(
      SERVICE_WORKER_SOURCE.includes("if (hasContextMenus) chrome.contextMenus.onClicked"),
      "contextMenus.onClicked must be guarded with hasContextMenus"
    );
  });

  test("commands.onCommand listener is guarded for Firefox Android", () => {
    assert.ok(
      SERVICE_WORKER_SOURCE.includes("if (chrome.commands) chrome.commands.onCommand"),
      "commands.onCommand must be guarded for Firefox Android"
    );
  });

  test("actionApi fallback covers both MV3 and MV2 APIs", () => {
    assert.ok(
      SERVICE_WORKER_SOURCE.includes("chrome?.action") && SERVICE_WORKER_SOURCE.includes("chrome?.browserAction"),
      "actionApi must fall back from chrome.action (MV3) to chrome.browserAction (MV2)"
    );
  });

  test("storage.js contains Promise shim for chrome.storage in Firefox MV2", () => {
    assert.ok(
      STORAGE_SOURCE.includes("shimChromePromises"),
      "storage.js must contain the shimChromePromises IIFE for Firefox MV2 compatibility"
    );
  });

  test("shimChromePromises wraps chrome.runtime.sendMessage", () => {
    const shimBlock = STORAGE_SOURCE.slice(
      STORAGE_SOURCE.indexOf("shimChromePromises"),
      STORAGE_SOURCE.indexOf("// ── Sync:")
    );
    assert.ok(
      shimBlock.includes('wrapMethod(chrome.runtime, "sendMessage")'),
      "shim must wrap chrome.runtime.sendMessage for Firefox MV2"
    );
  });

  test("Promise shim wraps chrome.storage.sync and chrome.storage.local", () => {
    assert.ok(
      STORAGE_SOURCE.includes("chrome.storage?.sync") && STORAGE_SOURCE.includes("chrome.storage?.local"),
      "shim must wrap both chrome.storage.sync and chrome.storage.local"
    );
  });

  test("Promise shim wraps chrome.tabs.query for Firefox MV2", () => {
    assert.ok(
      STORAGE_SOURCE.includes("chrome.tabs") && STORAGE_SOURCE.includes('"query"'),
      "shim must wrap chrome.tabs.query for Firefox MV2"
    );
  });

  test("Promise shim detects environment once instead of probing per call", () => {
    assert.ok(
      STORAGE_SOURCE.includes("_nativePromises"),
      "shim must detect once whether chrome.* APIs return Promises natively"
    );
    // Must NOT probe inside wrapMethod (side-effectful methods like tabs.create
    // would execute twice: once for the probe, once for the callback wrap)
    const wrapMethodStart = STORAGE_SOURCE.indexOf("function wrapMethod");
    const wrapMethodEnd = STORAGE_SOURCE.indexOf("}", STORAGE_SOURCE.indexOf("return new Promise", wrapMethodStart));
    const wrapBody = STORAGE_SOURCE.slice(wrapMethodStart, wrapMethodEnd);
    assert.ok(
      !wrapBody.includes("original(...args);\n") || wrapBody.includes("_nativePromises"),
      "wrapMethod must not probe by calling original() without callback — use _nativePromises flag instead"
    );
  });

  test("sessionStorage ponyfill probes chrome.storage.session before using it", () => {
    assert.ok(
      STORAGE_SOURCE.includes("_hasSessionStorage"),
      "sessionStorage ponyfill must probe chrome.storage.session with a return-type check, not just truthiness"
    );
    assert.ok(
      STORAGE_SOURCE.includes('typeof probe.then === "function"'),
      "probe must verify the API returns a Promise"
    );
  });

  test("onboarding fallback exists independent of onInstalled", () => {
    // onInstalled is unreliable in Firefox MV2: ES modules load async and the
    // listener may be registered after the event fires. A top-level fallback
    // must check onboardingDone and open onboarding on every background load.
    const hasFallback = SERVICE_WORKER_SOURCE.includes("!prefs.onboardingDone") &&
      /\(async\s*\(\)\s*=>\s*\{[\s\S]*?onboardingDone[\s\S]*?tabs\.create/.test(SERVICE_WORKER_SOURCE);
    assert.ok(hasFallback,
      "service-worker.js must have a top-level async fallback that opens onboarding if onboardingDone is false -- onInstalled alone is not reliable in Firefox MV2");
  });

  test("onboarding fallback is AFTER onInstalled listener (not inside it)", () => {
    const onInstalledIdx = SERVICE_WORKER_SOURCE.indexOf("chrome.runtime.onInstalled.addListener");
    const fallbackIdx = SERVICE_WORKER_SOURCE.indexOf("Fallback: onInstalled is unreliable");
    assert.ok(onInstalledIdx > 0 && fallbackIdx > onInstalledIdx,
      "onboarding fallback must exist as a separate block after the onInstalled listener, not nested inside it");
  });

  test("manifest.v2.json uses persistent background page", () => {
    assert.equal(MANIFEST_V2.background.persistent, true,
      "Firefox MV2 must use persistent: true to avoid event page timing issues with ES modules");
  });
});

// ---------------------------------------------------------------------------
// Firefox MV2 — browser-polyfill.min.js must be loaded in all extension pages
// ---------------------------------------------------------------------------
describe("Firefox MV2 -- browser-polyfill loaded in all extension pages", () => {

  test("background.html loads browser-polyfill.min.js", () => {
    assert.ok(
      BACKGROUND_HTML.includes("browser-polyfill.min.js"),
      "background.html must load browser-polyfill.min.js"
    );
  });

  test("popup.html loads browser-polyfill.min.js", () => {
    assert.ok(
      POPUP_HTML.includes("browser-polyfill.min.js"),
      "popup.html must load browser-polyfill.min.js"
    );
  });

  test("options.html loads browser-polyfill.min.js", () => {
    assert.ok(
      OPTIONS_HTML.includes("browser-polyfill.min.js"),
      "options.html must load browser-polyfill.min.js"
    );
  });

  test("onboarding.html loads browser-polyfill.min.js", () => {
    assert.ok(
      ONBOARDING_HTML.includes("browser-polyfill.min.js"),
      "onboarding.html must load browser-polyfill.min.js"
    );
  });

  test("browser-polyfill loads BEFORE module scripts in popup.html", () => {
    const polyfillIdx = POPUP_HTML.indexOf("browser-polyfill.min.js");
    const moduleIdx = POPUP_HTML.indexOf('type="module"');
    assert.ok(polyfillIdx < moduleIdx,
      "browser-polyfill.min.js must load before type=\"module\" scripts in popup.html");
  });

  test("browser-polyfill loads BEFORE module scripts in options.html", () => {
    const polyfillIdx = OPTIONS_HTML.indexOf("browser-polyfill.min.js");
    const moduleIdx = OPTIONS_HTML.indexOf('type="module"');
    assert.ok(polyfillIdx < moduleIdx,
      "browser-polyfill.min.js must load before type=\"module\" scripts in options.html");
  });

  test("browser-polyfill loads BEFORE module scripts in onboarding.html", () => {
    const polyfillIdx = ONBOARDING_HTML.indexOf("browser-polyfill.min.js");
    const moduleIdx = ONBOARDING_HTML.indexOf('type="module"');
    assert.ok(polyfillIdx < moduleIdx,
      "browser-polyfill.min.js must load before type=\"module\" scripts in onboarding.html");
  });
});

// ---------------------------------------------------------------------------
// Firefox MV2 manifest — structural checks
// ---------------------------------------------------------------------------
describe("Firefox MV2 manifest structure", () => {

  test("manifest_version is 2", () => {
    assert.equal(MANIFEST_V2.manifest_version, 2);
  });

  test("background uses page (not service_worker)", () => {
    assert.ok(MANIFEST_V2.background.page, "MV2 manifest must use background.page, not service_worker");
    assert.equal(MANIFEST_V2.background.page, "background/background.html");
  });

  test("uses browser_action (not action)", () => {
    assert.ok(MANIFEST_V2.browser_action, "MV2 manifest must use browser_action");
    assert.equal(MANIFEST_V2.browser_action.default_popup, "popup/popup.html");
  });

  test("has gecko browser_specific_settings with ID", () => {
    assert.ok(MANIFEST_V2.browser_specific_settings?.gecko?.id,
      "MV2 manifest must have gecko ID");
  });

  test("strict_min_version is not higher than 128.0", () => {
    const minVersion = parseInt(MANIFEST_V2.browser_specific_settings.gecko.strict_min_version);
    assert.ok(minVersion <= 128,
      `strict_min_version (${minVersion}) must not exceed 128 to support Firefox ESR`);
  });

  test("browser-polyfill.min.js loads in document_start entry", () => {
    const startEntry = MANIFEST_V2.content_scripts.find(cs => cs.run_at === "document_start");
    assert.ok(startEntry, "must have a document_start content script entry");
    assert.ok(startEntry.js.includes("lib/browser-polyfill.min.js"),
      "document_start entry must include browser-polyfill.min.js");
  });

  test("version matches package.json", () => {
    const pkg = require("../../package.json");
    assert.equal(MANIFEST_V2.version, pkg.version,
      "manifest.v2.json version must match package.json");
  });
});
