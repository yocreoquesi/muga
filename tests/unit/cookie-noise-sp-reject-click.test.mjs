/**
 * MUGA — Cookie Consent Minimizer: Sourcepoint reject-click DOM fallback
 *
 * Round-2 EU real-site verification (headed Playwright, pinknews.co.uk et
 * al.) found `window.__tcfapi("postRejectAll", ...)` does not dismiss
 * Sourcepoint's own UI on real deployments even when the call fires without
 * throwing. This is a behavioral regression test: it EXECUTES the real
 * content/cookie-noise.js source via `vm.runInContext` (content scripts
 * cannot be imported as ES modules — see AGENTS.md) with a mocked
 * window/document/chrome, injects fake `sp_choice_type_<N>` DOM candidates,
 * and asserts the reject-click dispatcher clicks the confirmed single "13"
 * ("Reject all") target — and ONLY that target, never "11" (accept) or "9"
 * (pay/subscribe) — while marking itself acted only after a real click.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cookieNoiseSource = readFileSync(join(__dirname, "../../src/content/cookie-noise.js"), "utf8");

class FakeMutationObserver {
  constructor(cb) {
    this.cb = cb;
    FakeMutationObserver.instances.push(this);
  }
  observe() {
    // no-op — no test here relies on a real DOM mutation firing the callback
  }
  disconnect() {
    this.disconnected = true;
  }
}
FakeMutationObserver.instances = [];

/**
 * A minimal fake DOM element satisfying every accessor
 * collectAcceptCandidates()/acceptSpChoice()/isAcceptCandidateActionable()
 * uses: getAttribute("class"/"aria-label"), .value, .textContent, .disabled,
 * .getClientRects(), and a spy-able .click().
 */
function makeSpButton({ choiceType, text, disabled = false, hasLayoutBox = true }) {
  let clicked = 0;
  return {
    _choiceType: choiceType,
    _text: text,
    disabled,
    textContent: text,
    value: "",
    getAttribute(name) {
      if (name === "class") return choiceType === null ? "text-link" : `some-class sp_choice_type_${choiceType} another-class`;
      if (name === "aria-label") return null;
      return null;
    },
    getClientRects() {
      return hasLayoutBox ? [{}] : [];
    },
    click() {
      clicked += 1;
    },
    get clickCount() {
      return clicked;
    },
  };
}

/**
 * Runs the real cookie-noise.js source in an isolated vm context, opens the
 * reject gate via the fake chrome.runtime.sendMessage getPrefs response, and
 * returns handles the test can use to simulate DOM state and drive the
 * MutationObserver-driven dispatcher.
 *
 * @param {{ spButtons?: object[], hasSpContainer?: boolean, gateEnabled?: boolean }} options
 */
function runCookieNoiseWithSpButtons({ spButtons = [], hasSpContainer = true, gateEnabled = true } = {}) {
  FakeMutationObserver.instances = [];

  const fakeLocation = { hostname: "example.com" };
  const fakeWindow = {};
  fakeWindow.self = fakeWindow;
  fakeWindow.top = fakeWindow; // top frame
  fakeWindow.location = fakeLocation;

  const fakeDocument = new EventTarget();
  fakeDocument.readyState = "complete";
  fakeDocument.documentElement = {};
  fakeDocument.body = { classList: { contains: () => false } };
  fakeDocument.getElementById = () => null;
  fakeDocument.querySelector = (selector) => {
    if (typeof selector === "string" && selector.includes("sp_message_container")) {
      return hasSpContainer ? {} : null;
    }
    return null;
  };
  fakeDocument.querySelectorAll = () => spButtons;

  const fakeChrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({ manifest_version: 3 }), // Chrome MV3, not Firefox
      sendMessage: (msg, cb) => {
        if (msg && msg.type === "getPrefs" && typeof cb === "function") {
          cb({ enabled: gateEnabled, onboardingDone: true, modeActive: true, whitelist: [] });
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
    console,
    setTimeout,
    clearTimeout,
  };

  vm.createContext(sandbox);
  vm.runInContext(cookieNoiseSource, sandbox, { filename: "content/cookie-noise.js" });

  return { sandbox };
}

describe("Sourcepoint reject-click DOM fallback — real content/cookie-noise.js execution", () => {
  test("a single actionable '13' (Reject all) button is clicked exactly once", () => {
    const rejectBtn = makeSpButton({ choiceType: "13", text: "Reject all" });
    const acceptBtn = makeSpButton({ choiceType: "11", text: "Accept all" });
    runCookieNoiseWithSpButtons({ spButtons: [acceptBtn, rejectBtn] });

    assert.equal(rejectBtn.clickCount, 1, "the confirmed single '13' target must be clicked");
    assert.equal(acceptBtn.clickCount, 0, "the '11' (accept) button must NEVER be clicked by this dispatcher");
  });

  test("a '9' (pay/subscribe) alternative alongside a single '13' does not block the reject-click", () => {
    const rejectBtn = makeSpButton({ choiceType: "13", text: "Reject all" });
    const payBtn = makeSpButton({ choiceType: "9", text: "Subscribe" });
    runCookieNoiseWithSpButtons({ spButtons: [payBtn, rejectBtn] });

    assert.equal(rejectBtn.clickCount, 1);
    assert.equal(payBtn.clickCount, 0, "the pay/subscribe control must NEVER be clicked");
  });

  test("only a '12' (Show options) choice, no '13' present -> NOOP, nothing clicked (second-layer flow deferred)", () => {
    const optionsBtn = makeSpButton({ choiceType: "12", text: "Options" });
    runCookieNoiseWithSpButtons({ spButtons: [optionsBtn] });

    assert.equal(optionsBtn.clickCount, 0, "the options control must never be clicked by this slice");
  });

  test("two actionable '13' candidates -> ambiguous, NEITHER is clicked (never guesses)", () => {
    const rejectBtn1 = makeSpButton({ choiceType: "13", text: "Reject all" });
    const rejectBtn2 = makeSpButton({ choiceType: "13", text: "Reject all" });
    runCookieNoiseWithSpButtons({ spButtons: [rejectBtn1, rejectBtn2] });

    assert.equal(rejectBtn1.clickCount, 0);
    assert.equal(rejectBtn2.clickCount, 0);
  });

  test("a non-actionable (display:none / zero layout box) '13' button is never clicked", () => {
    const hiddenRejectBtn = makeSpButton({ choiceType: "13", text: "Reject all", hasLayoutBox: false });
    runCookieNoiseWithSpButtons({ spButtons: [hiddenRejectBtn] });

    assert.equal(hiddenRejectBtn.clickCount, 0);
  });

  test("REGRESSION (real-site probe finding): a '13' button is clicked even when the sp_message_container DOM anchor is absent from THIS frame (container and buttons render in different frames on real deployments, e.g. pinknews.co.uk)", () => {
    const rejectBtn = makeSpButton({ choiceType: "13", text: "Reject all" });
    runCookieNoiseWithSpButtons({ spButtons: [rejectBtn], hasSpContainer: false });

    assert.equal(rejectBtn.clickCount, 1, "the dispatcher must not require the container div to be in the SAME frame as the buttons");
  });

  test("the reject master gate closed (feature disabled) -> never clicks, even with a confirmed single '13' target", () => {
    const rejectBtn = makeSpButton({ choiceType: "13", text: "Reject all" });
    runCookieNoiseWithSpButtons({ spButtons: [rejectBtn], gateEnabled: false });

    assert.equal(rejectBtn.clickCount, 0, "must never click when the master reject gate is closed");
  });

  test("incidental non-decision candidates (privacy/imprint links, no sp_choice class) never interfere with a real single '13' target", () => {
    const rejectBtn = makeSpButton({ choiceType: "13", text: "Reject all" });
    const privacyLink = makeSpButton({ choiceType: null, text: "Privacy Policy" });
    runCookieNoiseWithSpButtons({ spButtons: [privacyLink, rejectBtn] });

    assert.equal(rejectBtn.clickCount, 1);
  });

  test("re-running the dispatcher after a successful click never double-clicks (idempotent — the observer stops itself)", () => {
    const rejectBtn = makeSpButton({ choiceType: "13", text: "Reject all" });
    const { sandbox } = runCookieNoiseWithSpButtons({ spButtons: [rejectBtn] });
    assert.equal(rejectBtn.clickCount, 1);

    // Fire the MutationObserver callback again (simulating a subsequent DOM
    // mutation on the same page) — must be a no-op now that _spRejectActed.
    for (const observer of FakeMutationObserver.instances) observer.cb();
    void sandbox;
    assert.equal(rejectBtn.clickCount, 1, "must never click a second time after already having acted");
  });
});
