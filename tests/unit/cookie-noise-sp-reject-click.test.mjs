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
 *
 * MULTI-LAYER (#1123 follow-up): some Sourcepoint walls expose ONLY a "12"
 * ("Options"/"Manage") control, with the real "Reject all" one layer deeper
 * inside the privacy-manager panel that "12" opens. The dispatcher clicks a
 * single actionable "12" ONCE to reveal that panel (opening settings never
 * grants consent — monotone-safe), then the observer re-enters and clicks the
 * revealed single "13". Success (`_spRejectActed`) is still only ever marked
 * after a real "13" click, so a panel that never surfaces a "13" resolves to
 * a fail-closed NOOP — never an accept.
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

  test("MULTI-LAYER: only a single actionable '12' (Options), no '13' -> the '12' is clicked once to open the privacy-manager panel", () => {
    const optionsBtn = makeSpButton({ choiceType: "12", text: "Options" });
    runCookieNoiseWithSpButtons({ spButtons: [optionsBtn] });

    assert.equal(optionsBtn.clickCount, 1, "a single actionable '12' must be clicked once to reveal the deeper reject control");
  });

  test("MULTI-LAYER click-through: after opening the '12' panel, the revealed single '13' is clicked (and the '12' is not re-clicked)", () => {
    const optionsBtn = makeSpButton({ choiceType: "12", text: "Options" });
    // Mutable candidate set: the fixture's querySelectorAll returns this array
    // live, so pushing the revealed "13" after the panel "renders" mirrors the
    // real DOM mutation the observer reacts to.
    const buttons = [optionsBtn];
    runCookieNoiseWithSpButtons({ spButtons: buttons });

    // First dispatch opened the panel by clicking "12".
    assert.equal(optionsBtn.clickCount, 1);

    // The panel renders its "Reject all" — simulate the mutation.
    const rejectBtn = makeSpButton({ choiceType: "13", text: "Reject all" });
    buttons.push(rejectBtn);
    for (const observer of FakeMutationObserver.instances) observer.cb();

    assert.equal(rejectBtn.clickCount, 1, "the revealed single '13' must be clicked once");
    assert.equal(optionsBtn.clickCount, 1, "the '12' must never be re-clicked after the panel is open");
  });

  test("MULTI-LAYER idempotency: a second mutation while the panel is still '12'-only never re-clicks the '12'", () => {
    const optionsBtn = makeSpButton({ choiceType: "12", text: "Options" });
    const buttons = [optionsBtn];
    runCookieNoiseWithSpButtons({ spButtons: buttons });
    assert.equal(optionsBtn.clickCount, 1);

    // Another DOM mutation fires but no "13" has appeared yet — the guard must
    // prevent opening the panel a second time.
    for (const observer of FakeMutationObserver.instances) observer.cb();
    assert.equal(optionsBtn.clickCount, 1, "the '12' must be opened at most once");
  });

  test("MULTI-LAYER never-accept: if the opened '12' panel only ever reveals accept/pay controls (no '13'), nothing else is clicked", () => {
    const optionsBtn = makeSpButton({ choiceType: "12", text: "Options" });
    const buttons = [optionsBtn];
    runCookieNoiseWithSpButtons({ spButtons: buttons });
    assert.equal(optionsBtn.clickCount, 1);

    // Panel renders only an accept-all and a pay control — no reject path.
    const acceptBtn = makeSpButton({ choiceType: "11", text: "Accept all" });
    const payBtn = makeSpButton({ choiceType: "9", text: "Subscribe" });
    buttons.push(acceptBtn, payBtn);
    for (const observer of FakeMutationObserver.instances) observer.cb();

    assert.equal(acceptBtn.clickCount, 0, "an accept control must NEVER be clicked");
    assert.equal(payBtn.clickCount, 0, "a pay/subscribe control must NEVER be clicked");
  });

  test("MULTI-LAYER: a directly actionable '13' alongside a '12' is clicked directly — the '12' panel detour is never taken", () => {
    const optionsBtn = makeSpButton({ choiceType: "12", text: "Options" });
    const rejectBtn = makeSpButton({ choiceType: "13", text: "Reject all" });
    runCookieNoiseWithSpButtons({ spButtons: [optionsBtn, rejectBtn] });

    assert.equal(rejectBtn.clickCount, 1, "the direct '13' must be clicked");
    assert.equal(optionsBtn.clickCount, 0, "the '12' detour must not be taken when a one-click reject exists");
  });

  test("MULTI-LAYER options-ONLY scope: a '12' alongside an actionable accept '11' (consent-or-pay shape) -> the '12' is NEVER clicked", () => {
    const optionsBtn = makeSpButton({ choiceType: "12", text: "Settings" });
    const acceptBtn = makeSpButton({ choiceType: "11", text: "Accept all" });
    const payBtn = makeSpButton({ choiceType: "9", text: "Subscribe" });
    runCookieNoiseWithSpButtons({ spButtons: [acceptBtn, optionsBtn, payBtn] });

    assert.equal(optionsBtn.clickCount, 0, "must not open the '12' panel on a wall that also shows accept/pay");
    assert.equal(acceptBtn.clickCount, 0);
    assert.equal(payBtn.clickCount, 0);
  });

  test("MULTI-LAYER: two actionable '12' candidates, no '13' -> ambiguous, NEITHER options control is clicked (never guesses which panel)", () => {
    const optionsBtn1 = makeSpButton({ choiceType: "12", text: "Options" });
    const optionsBtn2 = makeSpButton({ choiceType: "12", text: "Manage" });
    runCookieNoiseWithSpButtons({ spButtons: [optionsBtn1, optionsBtn2] });

    assert.equal(optionsBtn1.clickCount, 0);
    assert.equal(optionsBtn2.clickCount, 0);
  });

  test("MULTI-LAYER: a non-actionable (hidden) '12' is never clicked", () => {
    const optionsBtn = makeSpButton({ choiceType: "12", text: "Options", hasLayoutBox: false });
    runCookieNoiseWithSpButtons({ spButtons: [optionsBtn] });

    assert.equal(optionsBtn.clickCount, 0);
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
