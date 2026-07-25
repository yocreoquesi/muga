/**
 * MUGA — Cookie Consent Minimizer: per-site exemption in child frames
 * (cookie-consent-all-frames FIX A, adversarial-review FINDING 1 HIGH)
 *
 * Now that content/cookie-noise.js runs `all_frames: true`, its
 * `computeGate()` used to read `window.__mugaCleaner` (ABSENT in child
 * frames — cleaner-bundle.js stays top-frame-only) and `location.hostname`
 * (the CMP vendor's OWN host in a cross-origin consent iframe, not the
 * paused site's) — so a user's per-site pause / allowlist exemption was
 * silently bypassed inside the very iframe where the consent dialog
 * renders.
 *
 * This is a behavioral regression test: it EXECUTES the real
 * content/cookie-noise.js source via `vm.runInContext` (content scripts
 * cannot be imported as ES modules — see AGENTS.md and the #951 precedent
 * in tests/unit/content-cleaner-patterns.test.mjs) with a mocked
 * window/document/location/chrome, and captures the `enabled` field of the
 * dispatched `muga:cookie-gate` CustomEvent.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cookieNoiseSource = readFileSync(
  join(__dirname, "../../src/content/cookie-noise.js"),
  "utf8",
);

/**
 * Runs the real cookie-noise.js source in an isolated vm context and
 * resolves with the `enabled` field of the `muga:cookie-gate` CustomEvent
 * it dispatches.
 *
 * @param {{
 *   isTopFrame: boolean,
 *   ownHostname?: string,
 *   ancestorOrigins?: string[]|null,
 *   whitelist?: string[],
 *   mugaCleaner?: {isSiteFullyExempt: (hostname: string, prefs: object) => boolean}|null,
 * }} options
 */
function runCookieNoiseIsolated({
  isTopFrame,
  ownHostname = "example.com",
  ancestorOrigins = null,
  whitelist = [],
  mugaCleaner = null,
} = {}) {
  return new Promise((resolve, reject) => {
    const fakeLocation = { hostname: ownHostname };
    if (ancestorOrigins !== null) fakeLocation.ancestorOrigins = ancestorOrigins;

    const fakeWindow = {};
    fakeWindow.self = fakeWindow;
    // A DIFFERENT object reference than `self` simulates a child frame —
    // real browsers never make window.top === window.self true unless this
    // really is the top frame.
    fakeWindow.top = isTopFrame ? fakeWindow : {};
    fakeWindow.location = fakeLocation;
    if (mugaCleaner) fakeWindow.__mugaCleaner = mugaCleaner;

    const fakeDocument = new EventTarget();
    fakeDocument.getElementById = () => null;
    fakeDocument.querySelector = () => null;
    fakeDocument.documentElement = {};
    fakeDocument.body = {};
    fakeDocument.readyState = "complete";

    let gateEnabled = null;
    let gateEventCount = 0;
    fakeDocument.addEventListener("muga:cookie-gate", (e) => {
      gateEventCount += 1;
      gateEnabled = e.detail.enabled;
    });

    const fakeChrome = {
      runtime: {
        lastError: null,
        getManifest: () => ({ manifest_version: 3 }), // Chrome MV3, not Firefox
        sendMessage: (msg, cb) => {
          if (msg && msg.type === "getPrefs" && typeof cb === "function") {
            cb({
              enabled: true,
              onboardingDone: true,
              modeActive: true,
              whitelist,
            });
          }
        },
      },
      storage: {
        onChanged: { addListener: () => {} },
      },
    };

    const sandbox = {
      window: fakeWindow,
      document: fakeDocument,
      location: fakeLocation,
      chrome: fakeChrome,
      CustomEvent,
      crypto,
      Uint8Array,
      URL,
      console,
      setTimeout,
      clearTimeout,
    };

    vm.createContext(sandbox);
    try {
      vm.runInContext(cookieNoiseSource, sandbox, { filename: "content/cookie-noise.js" });
    } catch (err) {
      reject(err);
      return;
    }

    setTimeout(() => resolve({ gateEnabled, gateEventCount }), 10);
  });
}

describe("cookie-noise child-frame exemption (FIX A) — top-host exempt + CMP in child frame", () => {
  test("gate stays CLOSED in the child frame when the TOP-frame host is on the whitelist", async () => {
    const { gateEnabled, gateEventCount } = await runCookieNoiseIsolated({
      isTopFrame: false,
      ownHostname: "cmp-vendor.example", // the child frame's OWN host (irrelevant)
      ancestorOrigins: ["https://real-site.example"], // real top-site host
      whitelist: ["real-site.example"], // user paused/allowlisted the TOP site
    });
    assert.equal(gateEventCount, 1, "must dispatch exactly one muga:cookie-gate event");
    assert.equal(gateEnabled, false, "the gate must stay CLOSED — the user paused this site");
  });
});

describe("cookie-noise child-frame exemption (FIX A) — non-exempt site opens the gate", () => {
  test("gate OPENS in the child frame when the TOP-frame host is NOT exempt", async () => {
    const { gateEnabled } = await runCookieNoiseIsolated({
      isTopFrame: false,
      ownHostname: "cmp-vendor.example",
      ancestorOrigins: ["https://real-site.example"],
      whitelist: [], // not exempt
    });
    assert.equal(gateEnabled, true, "the gate must open — the mode is active and the site isn't exempt");
  });
});

describe("cookie-noise child-frame exemption (FIX A) — undeterminable top host fails closed", () => {
  test("gate stays CLOSED when location.ancestorOrigins is absent (e.g. Firefox)", async () => {
    const { gateEnabled } = await runCookieNoiseIsolated({
      isTopFrame: false,
      ancestorOrigins: null,
      whitelist: [],
    });
    assert.equal(gateEnabled, false, "an undeterminable top host must fail closed (treated as exempt)");
  });

  test("gate stays CLOSED when location.ancestorOrigins is an empty list", async () => {
    const { gateEnabled } = await runCookieNoiseIsolated({
      isTopFrame: false,
      ancestorOrigins: [],
      whitelist: [],
    });
    assert.equal(gateEnabled, false, "an empty ancestorOrigins list must fail closed (treated as exempt)");
  });
});

describe("cookie-noise child-frame exemption (FIX A) — top frame is unchanged", () => {
  test("top frame still uses window.__mugaCleaner.isSiteFullyExempt + location.hostname (exempt case)", async () => {
    const { gateEnabled } = await runCookieNoiseIsolated({
      isTopFrame: true,
      ownHostname: "real-site.example",
      mugaCleaner: {
        isSiteFullyExempt: (hostname) => hostname === "real-site.example",
      },
    });
    assert.equal(gateEnabled, false, "top frame must still honor window.__mugaCleaner's exemption");
  });

  test("top frame with NO window.__mugaCleaner attached yet: exemption no-ops (byte-identical pre-fix behavior)", async () => {
    const { gateEnabled } = await runCookieNoiseIsolated({
      isTopFrame: true,
      ownHostname: "real-site.example",
      mugaCleaner: null,
    });
    assert.equal(gateEnabled, true, "top frame without __mugaCleaner must behave exactly as before this fix");
  });
});
