/**
 * MUGA — #1388 (triage 2026-09-24, REDUCED SCOPE): toast button click
 * handlers must reject synthetic (non-isTrusted) clicks.
 *
 * Triage decision: "An `if (!e.isTrusted) return;` guard in both toast
 * builders is enough; the shadow-root rewrite is not needed." This covers
 * BOTH toast builders in src/content/cleaner.js:
 *   - showAffiliateNotice (generic affiliate-tag toast: Allow/Block/Dismiss)
 *   - showAutoInjectNotice (auto-injected-referral-tag toast: Keep/Remove/Dismiss)
 *
 * Without the guard, a hostile page could script-click the toast's own
 * buttons (e.g. `document.querySelector('#muga-notice button').click()`)
 * to force a choice on the user's behalf — writing an allow/deny-list entry
 * or dismissing the toast without real user interaction.
 *
 * ## Why a `vm` harness
 *
 * Same rationale as tests/unit/content-clipboard-sync-throw.test.mjs:
 * content/cleaner.js is a raw classic script (not an ES module, cannot be
 * imported), so we execute its source in a `vm` context with minimal
 * browser-global stand-ins, including a small real DOM-element shim that
 * supports createElement/appendChild/querySelectorAll/getElementById and a
 * `.click({ isTrusted })` helper — enough to build and click the actual
 * toast the real code constructs, without a jsdom/happy-dom dependency
 * (neither is installed in this repo).
 *
 * cleaner.js exposes two test-only runtime-message hooks for this purpose
 * (mirroring the pre-existing SHOW_TEST_TOAST hook):
 *   - SHOW_TEST_TOAST            -> showAffiliateNotice() with fixed data
 *   - SHOW_TEST_AUTOINJECT_TOAST -> showAutoInjectNotice() with fixed data
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cleanerSource = readFileSync(join(__dirname, "../../src/content/cleaner.js"), "utf8");

function mockFetch(url) {
  if (url.includes("domain-rules.json")) return Promise.resolve({ json: () => Promise.resolve([]) });
  if (url.includes("path-strip-rules.json")) return Promise.resolve({ json: () => Promise.resolve([]) });
  if (url.includes("path-affiliate-rules.json")) return Promise.resolve({ json: () => Promise.resolve([]) });
  return Promise.reject(new Error("unexpected fetch: " + url));
}

/** Minimal real-enough DOM element: createElement/appendChild/querySelectorAll/click. */
function makeElement(tag) {
  const el = {
    tagName: tag,
    style: {},
    dataset: {},
    children: [],
    parent: null,
    listeners: {},
    id: "",
    textContent: "",
    tabIndex: 0,
    removed: false,
    setAttribute() {},
    getAttribute() { return null; },
    appendChild(child) {
      child.parent = el;
      el.children.push(child);
      return child;
    },
    remove() {
      el.removed = true;
      if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el);
    },
    addEventListener(type, fn) {
      (el.listeners[type] = el.listeners[type] || []).push(fn);
    },
    focus() {},
    querySelectorAll(selector) {
      // Only selector actually used by cleaner.js's toast builders.
      assert.equal(selector, "button[data-choice]");
      const results = [];
      (function walk(node) {
        if (!node.children) return;
        for (const c of node.children) {
          if (c.tagName === "button" && c.dataset.choice !== undefined) results.push(c);
          walk(c);
        }
      })(el);
      return results;
    },
    click(opts = {}) {
      const isTrusted = opts.isTrusted !== undefined ? opts.isTrusted : true;
      const evt = { isTrusted, type: "click", target: el };
      (el.listeners.click || []).forEach((fn) => fn(evt));
    },
  };
  return el;
}

function findById(root, id) {
  if (root.id === id) return root;
  if (!root.children) return null;
  for (const c of root.children) {
    const found = findById(c, id);
    if (found) return found;
  }
  return null;
}

/**
 * Runs content/cleaner.js in a vm sandbox, dispatches the given test-toast
 * runtime message, and returns handles to the rendered toast plus a spy of
 * every chrome.runtime.sendMessage call.
 */
function runToastTest({ messageType }) {
  return new Promise((resolve, reject) => {
    let messageListener;
    const sentMessages = [];

    const body = makeElement("body");
    const fakeDocument = {
      addEventListener: () => {},
      getElementById: (id) => findById(body, id),
      createElement: (tag) => makeElement(tag),
      createTextNode: (text) => ({ nodeType: 3, textContent: text }),
      body,
      documentElement: {},
      querySelector: () => null,
      readyState: "complete",
      referrer: "",
    };

    const fakeLocation = { href: "https://page.example/", hostname: "page.example", pathname: "/" };
    const fakeWindow = {
      location: fakeLocation,
      getSelection: () => ({ toString: () => "" }),
      open: () => {},
    };
    fakeWindow.self = fakeWindow;
    fakeWindow.top = fakeWindow;

    const fakeChrome = {
      runtime: {
        id: "test-ext-id",
        lastError: null,
        getURL: (path) => path,
        onMessage: { addListener: (fn) => { messageListener = fn; } },
        sendMessage: (msg, cb) => {
          // getPrefs is cleaner.js's own internal prefs-cache fetch (#142),
          // unrelated to the toast click handlers under test here.
          if (msg && msg.type === "getPrefs" && typeof cb === "function") {
            cb({ enabled: true, onboardingDone: true });
            return Promise.resolve({ ok: true });
          }
          sentMessages.push(msg);
          return Promise.resolve({ ok: true });
        },
      },
      storage: {
        sync: { get: (defaults, cb) => cb(defaults) },
        onChanged: { addListener: () => {} },
      },
    };

    const sandbox = {
      window: fakeWindow,
      document: fakeDocument,
      chrome: fakeChrome,
      navigator: { language: "en" },
      location: fakeLocation,
      history: { state: null, replaceState: () => {} },
      NodeFilter: { SHOW_TEXT: 4 },
      URL,
      console,
      setTimeout,
      clearTimeout,
      fetch: mockFetch,
    };

    vm.createContext(sandbox);
    try {
      vm.runInContext(cleanerSource, sandbox, { filename: "content/cleaner.js" });
    } catch (err) {
      reject(err);
      return;
    }

    setTimeout(() => {
      if (typeof messageListener !== "function") {
        reject(new Error("chrome.runtime.onMessage listener was not registered"));
        return;
      }
      messageListener({ type: messageType }, { id: "test-ext-id" }, () => {});
      setTimeout(() => {
        const notice = findById(body, "muga-notice");
        if (!notice) {
          reject(new Error(`toast (#muga-notice) was not rendered for ${messageType}`));
          return;
        }
        const buttons = notice.querySelectorAll("button[data-choice]");
        const dismiss = findById(body, "muga-dismiss");
        resolve({ notice, buttons, dismiss, sentMessages });
      }, 20);
    }, 20);
  });
}

describe("#1388 — showAffiliateNotice (generic affiliate toast): rejects synthetic clicks", () => {
  test("synthetic click on Allow (data-choice=original) does NOT send ADD_TO_WHITELIST and does not dismiss the toast", async () => {
    const { notice, buttons, sentMessages } = await runToastTest({ messageType: "SHOW_TEST_TOAST" });
    const allowBtn = buttons.find((b) => b.dataset.choice === "original");
    assert.ok(allowBtn, "Allow button must exist");
    allowBtn.click({ isTrusted: false });
    assert.deepEqual(sentMessages, [], "synthetic click must not send any runtime message");
    assert.equal(notice.removed, false, "synthetic click must not dismiss the toast");
  });

  test("synthetic click on Block (data-choice=clean) does NOT send ADD_TO_BLACKLIST and does not dismiss the toast", async () => {
    const { notice, buttons, sentMessages } = await runToastTest({ messageType: "SHOW_TEST_TOAST" });
    const blockBtn = buttons.find((b) => b.dataset.choice === "clean");
    assert.ok(blockBtn, "Block button must exist");
    blockBtn.click({ isTrusted: false });
    assert.deepEqual(sentMessages, [], "synthetic click must not send any runtime message");
    assert.equal(notice.removed, false, "synthetic click must not dismiss the toast");
  });

  test("synthetic click on Dismiss does not dismiss the toast", async () => {
    const { notice, dismiss } = await runToastTest({ messageType: "SHOW_TEST_TOAST" });
    assert.ok(dismiss, "Dismiss button must exist");
    dismiss.click({ isTrusted: false });
    assert.equal(notice.removed, false, "synthetic dismiss click must not remove the toast");
  });

  test("sanity: a REAL (isTrusted) click on Allow still sends ADD_TO_WHITELIST and dismisses the toast", async () => {
    const { notice, buttons, sentMessages } = await runToastTest({ messageType: "SHOW_TEST_TOAST" });
    const allowBtn = buttons.find((b) => b.dataset.choice === "original");
    allowBtn.click({ isTrusted: true });
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].type, "ADD_TO_WHITELIST");
    assert.equal(notice.removed, true, "real click must dismiss the toast");
  });

  test("sanity: a REAL (isTrusted) click on Dismiss removes the toast", async () => {
    const { notice, dismiss } = await runToastTest({ messageType: "SHOW_TEST_TOAST" });
    dismiss.click({ isTrusted: true });
    assert.equal(notice.removed, true);
  });
});

describe("#1388 — showAutoInjectNotice (auto-injected-referral toast): rejects synthetic clicks", () => {
  test("synthetic click on Remove (data-choice=clean) does NOT send ADD_TO_BLACKLIST and does not dismiss the toast", async () => {
    const { notice, buttons, sentMessages } = await runToastTest({ messageType: "SHOW_TEST_AUTOINJECT_TOAST" });
    const removeBtn = buttons.find((b) => b.dataset.choice === "clean");
    assert.ok(removeBtn, "Remove button must exist");
    removeBtn.click({ isTrusted: false });
    assert.deepEqual(sentMessages, [], "synthetic click must not send any runtime message");
    assert.equal(notice.removed, false, "synthetic click must not dismiss the toast");
  });

  test("synthetic click on Dismiss does not dismiss the toast", async () => {
    const { notice, dismiss } = await runToastTest({ messageType: "SHOW_TEST_AUTOINJECT_TOAST" });
    dismiss.click({ isTrusted: false });
    assert.equal(notice.removed, false, "synthetic dismiss click must not remove the toast");
  });

  test("sanity: a REAL (isTrusted) click on Remove still sends ADD_TO_BLACKLIST with scopedBlacklistEntry", async () => {
    const { notice, buttons, sentMessages } = await runToastTest({ messageType: "SHOW_TEST_AUTOINJECT_TOAST" });
    const removeBtn = buttons.find((b) => b.dataset.choice === "clean");
    removeBtn.click({ isTrusted: true });
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].type, "ADD_TO_BLACKLIST");
    assert.equal(sentMessages[0].tag, "amazon.es::tag::someplatform-21");
    assert.equal(notice.removed, true, "real click must dismiss the toast");
  });
});
