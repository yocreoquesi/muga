/**
 * MUGA — Cookie Consent Minimizer: bounded give-up fallback
 * (cookie-consent-all-frames FIX C, adversarial-review LOW)
 *
 * `armGiveUp()` (content/cookie-noise-mainworld.js, Chrome MAIN world) and
 * `fxArmGiveUp()` (content/cookie-noise.js, Firefox isolated-world reject
 * path) both only schedule their give-up timer on the `DOMContentLoaded`
 * event when `document.readyState === "loading"` at arm-time. If a frame
 * never reaches `DOMContentLoaded` (e.g. a pending subresource that never
 * settles in a sandboxed child frame — plausible now that these scripts run
 * `all_frames: true`), the give-up timer is NEVER armed and the
 * MutationObserver runs for the whole page lifetime instead of disconnecting
 * after the give-up window.
 *
 * This is a behavioral regression test: it EXECUTES the real content
 * scripts via `vm.runInContext` with `node:test`'s mock timers, arms the
 * observer, and advances virtual time WITHOUT ever dispatching
 * `DOMContentLoaded` — the observer must still disconnect within the give-up
 * window.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainworldSource = readFileSync(
  join(__dirname, "../../src/content/cookie-noise-mainworld.js"),
  "utf8",
);
const isolatedSource = readFileSync(join(__dirname, "../../src/content/cookie-noise.js"), "utf8");

const GIVE_UP_AFTER_DOM_READY_MS = 10000;

class FakeMutationObserver {
  constructor(cb) {
    this.cb = cb;
    this.disconnected = false;
    FakeMutationObserver.instances.push(this);
  }
  observe() {
    // no-op — this test never simulates a real DOM mutation
  }
  disconnect() {
    this.disconnected = true;
  }
}
FakeMutationObserver.instances = [];

function makeFakeDocument() {
  const doc = new EventTarget();
  doc.readyState = "loading";
  doc.getElementById = () => null;
  doc.querySelector = () => null;
  doc.documentElement = {};
  doc.body = { classList: { contains: () => false } };
  return doc;
}

describe("cookie-noise-mainworld.js armGiveUp() — bounded fallback (FIX C)", () => {
  test("disconnects the observer within the give-up window even if DOMContentLoaded never fires", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    FakeMutationObserver.instances = [];

    const fakeDocument = makeFakeDocument();
    const fakeWindow = {};
    fakeWindow.self = fakeWindow;
    fakeWindow.top = fakeWindow;

    const sandbox = {
      window: fakeWindow,
      document: fakeDocument,
      MutationObserver: FakeMutationObserver,
      CustomEvent,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      console,
    };

    vm.createContext(sandbox);
    vm.runInContext(mainworldSource, sandbox, { filename: "content/cookie-noise-mainworld.js" });

    // Open the gate directly (bypassing the nonce handshake — this test only
    // exercises the give-up timer, not the handshake itself, which is
    // covered elsewhere): dispatch the nonce, then the matching gate event.
    fakeDocument.dispatchEvent(new CustomEvent("muga:cookie-gate:nonce", { detail: { nonce: "t" } }));
    fakeDocument.dispatchEvent(
      new CustomEvent("muga:cookie-gate", {
        detail: { enabled: true, didomiMinimumGateOpen: false, nonce: "t" },
      }),
    );

    assert.equal(FakeMutationObserver.instances.length, 1, "the gate opening must start the observer");
    const observer = FakeMutationObserver.instances[0];
    assert.equal(observer.disconnected, false, "must not be disconnected immediately after arming");

    // document.readyState stays "loading" for the rest of this test — a
    // real DOMContentLoaded is never dispatched.
    t.mock.timers.tick(GIVE_UP_AFTER_DOM_READY_MS);

    assert.equal(
      observer.disconnected,
      true,
      "the observer must disconnect within the give-up window even though DOMContentLoaded never fired",
    );
  });
});

describe("cookie-noise.js fxArmGiveUp() — bounded fallback (FIX C, Firefox path)", () => {
  test("disconnects the Firefox observer within the give-up window even if DOMContentLoaded never fires", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    FakeMutationObserver.instances = [];

    const fakeDocument = makeFakeDocument();
    const fakeLocation = { hostname: "example.com" };
    const fakeWindow = { location: fakeLocation, wrappedJSObject: {} };
    fakeWindow.self = fakeWindow;
    fakeWindow.top = fakeWindow;

    const fakeChrome = {
      runtime: {
        lastError: null,
        getManifest: () => ({ manifest_version: 2 }), // Firefox MV2
        sendMessage: (msg, cb) => {
          if (msg && msg.type === "getPrefs" && typeof cb === "function") {
            cb({ enabled: true, onboardingDone: true, modeActive: true, whitelist: [] });
          }
        },
      },
      storage: { onChanged: { addListener: () => {} } },
    };

    const sandbox = {
      window: fakeWindow,
      document: fakeDocument,
      location: fakeLocation,
      chrome: fakeChrome,
      MutationObserver: FakeMutationObserver,
      CustomEvent,
      crypto,
      Uint8Array,
      URL,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      console,
    };

    vm.createContext(sandbox);
    vm.runInContext(isolatedSource, sandbox, { filename: "content/cookie-noise.js" });

    assert.equal(FakeMutationObserver.instances.length, 1, "an active gate on Firefox must start the observer");
    const observer = FakeMutationObserver.instances[0];
    assert.equal(observer.disconnected, false, "must not be disconnected immediately after arming");

    t.mock.timers.tick(GIVE_UP_AFTER_DOM_READY_MS);

    assert.equal(
      observer.disconnected,
      true,
      "the Firefox observer must disconnect within the give-up window even though DOMContentLoaded never fired",
    );
  });
});
