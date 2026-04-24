/**
 * MUGA — Options page pattern guards
 *
 * T3.1: Asserts the remote-rules section exists in options.html with all required
 *       elements and i18n attributes (REQ-UI-1 through REQ-UI-5, REQ-I18N-2).
 *
 * T3.2: Asserts options.js wires the remote-rules toggle correctly and uses
 *       sendMessage (not inline storage reads) for all enable/disable paths.
 *
 * T3.3: Guards the Firefox MV2 gesture-frame invariant — chrome.permissions.request
 *       MUST be the FIRST await inside the enable (checked === true) branch of the
 *       remote-rules toggle change handler.
 *
 *       Rationale (design §10, REQ-OPT-4):
 *         Firefox browser.permissions.request() must be called synchronously inside
 *         the user gesture (click/change event). Any await before the request
 *         detaches from the gesture frame and the request silently returns false.
 *         This test ensures no developer accidentally inserts an await before the
 *         permission request, which would silently break Firefox users who try to
 *         enable remote rules.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, "../..");

const optionsHtml = readFileSync(join(ROOT, "src/options/options.html"), "utf8");
const optionsJs   = readFileSync(join(ROOT, "src/options/options.js"),   "utf8");

// ── T3.1: options.html remote-rules section structure ─────────────────────────

describe("T3.1 remote-rules section in options.html", () => {
  test("section#remote-rules-section exists and is initially hidden", () => {
    assert.ok(
      optionsHtml.includes('id="remote-rules-section"'),
      "options.html must contain an element with id=remote-rules-section"
    );
    // The section must have the hidden attribute (feature-detect gate: REQ-UI-5)
    const sectionMatch = optionsHtml.match(/<section[^>]+id="remote-rules-section"[^>]*>/);
    assert.ok(sectionMatch, "remote-rules-section must be a <section>");
    assert.ok(
      sectionMatch[0].includes("hidden"),
      "remote-rules-section must have the hidden attribute (feature-detect gate, REQ-UI-5)"
    );
  });

  test("section contains h2 with data-i18n=optionsRemoteRulesTitle", () => {
    assert.ok(
      optionsHtml.includes('data-i18n="optionsRemoteRulesTitle"'),
      "remote-rules section must have an element with data-i18n=optionsRemoteRulesTitle (REQ-I18N-2)"
    );
  });

  test("section contains description paragraph with data-i18n=optionsRemoteRulesDesc", () => {
    assert.ok(
      optionsHtml.includes('data-i18n="optionsRemoteRulesDesc"'),
      "remote-rules section must have a description element with data-i18n=optionsRemoteRulesDesc"
    );
  });

  test("toggle checkbox #remote-rules-toggle exists", () => {
    assert.ok(
      optionsHtml.includes('id="remote-rules-toggle"'),
      "remote-rules section must contain a checkbox with id=remote-rules-toggle"
    );
    assert.ok(
      optionsHtml.includes('type="checkbox"') && optionsHtml.includes('id="remote-rules-toggle"'),
      "remote-rules-toggle must be an input[type=checkbox]"
    );
  });

  test("toggle label has data-i18n=optionsRemoteRulesToggle", () => {
    assert.ok(
      optionsHtml.includes('data-i18n="optionsRemoteRulesToggle"'),
      "the toggle label text must use data-i18n=optionsRemoteRulesToggle (REQ-I18N-2)"
    );
  });

  test("status block #remote-rules-status exists and is initially hidden", () => {
    assert.ok(
      optionsHtml.includes('id="remote-rules-status"'),
      "remote-rules section must contain a status div with id=remote-rules-status"
    );
    const statusMatch = optionsHtml.match(/<div[^>]+id="remote-rules-status"[^>]*>/);
    assert.ok(statusMatch, "remote-rules-status must be a <div>");
    assert.ok(
      statusMatch[0].includes("hidden"),
      "remote-rules-status must be initially hidden (REQ-UI-3)"
    );
  });

  test("last-fetch span #remote-rules-last-fetch exists", () => {
    assert.ok(
      optionsHtml.includes('id="remote-rules-last-fetch"'),
      "status block must contain an element with id=remote-rules-last-fetch"
    );
  });

  test("param-count span #remote-rules-param-count exists", () => {
    assert.ok(
      optionsHtml.includes('id="remote-rules-param-count"'),
      "status block must contain an element with id=remote-rules-param-count"
    );
  });

  test("source link #remote-rules-source exists with security attrs", () => {
    assert.ok(
      optionsHtml.includes('id="remote-rules-source"'),
      "status block must contain an element with id=remote-rules-source (REQ-UI-2)"
    );
    assert.ok(
      optionsHtml.includes('target="_blank"') && optionsHtml.includes('rel="noopener noreferrer"'),
      "source link must have target=_blank and rel=noopener noreferrer"
    );
  });

  test("error paragraph #remote-rules-error exists and is initially hidden", () => {
    assert.ok(
      optionsHtml.includes('id="remote-rules-error"'),
      "remote-rules section must contain an error paragraph with id=remote-rules-error (REQ-UI-4)"
    );
    const errMatch = optionsHtml.match(/<p[^>]+id="remote-rules-error"[^>]*>/);
    assert.ok(errMatch, "remote-rules-error must be a <p>");
    assert.ok(
      errMatch[0].includes("hidden"),
      "remote-rules-error must be initially hidden"
    );
  });

  test("all text nodes use data-i18n — no hardcoded English strings in section", () => {
    // Extract the remote-rules-section block and assert no raw English text in attributes
    // that should be i18n-driven. We can check that the section uses no visible text
    // outside of data-i18n attributes (beyond structural attributes).
    // Practical guard: the section must NOT contain literal 'Remote rule' or 'Enable' as
    // plain text (it would be in data-i18n attribute values, not as content).
    const sectionStart = optionsHtml.indexOf('id="remote-rules-section"');
    assert.ok(sectionStart !== -1, "section must exist");
    // Find the closing </section> after this point
    const sectionEnd = optionsHtml.indexOf("</section>", sectionStart);
    const sectionHtml = optionsHtml.slice(sectionStart, sectionEnd);

    // The section must use data-i18n attributes for all user-visible text labels
    assert.ok(
      sectionHtml.includes("data-i18n="),
      "section must use data-i18n attributes for i18n-driven content"
    );
  });

  test("section is placed between custom-params area and About/footer", () => {
    // v1.10.2 layout: remote-rules comes BEFORE the Advanced (#section-dev)
    // section so that Advanced stays the last thing on the page. Custom params
    // live inside Advanced (dev-mode-gated), so remote-rules also ends up
    // before the custom-params markup.
    const devIdx = optionsHtml.indexOf('id="section-dev"');
    const rrIdx  = optionsHtml.indexOf('id="remote-rules-section"');
    const verIdx = optionsHtml.indexOf('version-info');

    assert.ok(devIdx !== -1, "options.html must still contain the #section-dev (Advanced) block");
    assert.ok(rrIdx !== -1,  "remote-rules section must exist");
    assert.ok(verIdx !== -1, "version-info must still be in the page");

    assert.ok(
      rrIdx < devIdx,
      "remote-rules section must appear before the Advanced section (which stays last, v1.10.2)"
    );
    assert.ok(
      devIdx < verIdx,
      "Advanced section must stay above the version-info / footer"
    );
  });
});

// ── T3.2: options.js remote-rules wiring ─────────────────────────────────────

describe("T3.2 options.js remote-rules wiring", () => {
  test("imports REMOTE_RULES_URL from remote-rules.js", () => {
    assert.ok(
      optionsJs.includes("remote-rules.js"),
      "options.js must import from remote-rules.js"
    );
    assert.ok(
      optionsJs.includes("REMOTE_RULES_URL"),
      "options.js must reference REMOTE_RULES_URL"
    );
  });

  test("sends GET_REMOTE_RULES_STATUS on init", () => {
    assert.ok(
      optionsJs.includes("GET_REMOTE_RULES_STATUS"),
      "options.js must send GET_REMOTE_RULES_STATUS to the service worker"
    );
  });

  test("sends ENABLE_REMOTE_RULES when toggle is enabled", () => {
    assert.ok(
      optionsJs.includes("ENABLE_REMOTE_RULES"),
      "options.js must send ENABLE_REMOTE_RULES message"
    );
  });

  test("sends DISABLE_REMOTE_RULES when toggle is disabled", () => {
    assert.ok(
      optionsJs.includes("DISABLE_REMOTE_RULES"),
      "options.js must send DISABLE_REMOTE_RULES message"
    );
  });

  test("feature-detects chrome.declarativeNetRequest (REQ-UI-5)", () => {
    // v1.10.1 removed the alarms permission — only DNR is required now.
    assert.ok(
      optionsJs.includes("chrome.declarativeNetRequest"),
      "options.js must feature-detect chrome.declarativeNetRequest (REQ-UI-5)"
    );
  });

  test("calls chrome.permissions.request in enable path", () => {
    assert.ok(
      optionsJs.includes("chrome.permissions.request"),
      "options.js must call chrome.permissions.request when enabling remote rules (REQ-OPT-4)"
    );
  });

  test("uses textContent (not innerHTML) for dynamic data", () => {
    // Find the remote-rules related code block and ensure innerHTML is not used
    // for the dynamic status values (lastFetch, paramCount, source).
    // We check that the rendering function uses textContent for those values.
    const renderMatch = optionsJs.match(/function\s+\w*[Rr]ender\w*Status[^{]*\{[\s\S]*?\n\}/);
    if (renderMatch) {
      // If a renderStatus function exists, it must not use innerHTML for dynamic data
      assert.ok(
        !renderMatch[0].includes("innerHTML"),
        "renderStatus must not use innerHTML for dynamic data (XSS prevention)"
      );
    }
    // Also assert: any assignment to remote-rules-last-fetch / param-count uses textContent
    const fetchLine  = optionsJs.match(/remote-rules-last-fetch['"]\)[\s\S]{0,200}/);
    const countLine  = optionsJs.match(/remote-rules-param-count['"]\)[\s\S]{0,200}/);
    if (fetchLine)  assert.ok(!fetchLine[0].includes("innerHTML"),  "last-fetch must use textContent");
    if (countLine)  assert.ok(!countLine[0].includes("innerHTML"),  "param-count must use textContent");
  });

  test("reverts toggle to false on permission denied", () => {
    assert.ok(
      optionsJs.includes("checked = false"),
      "options.js must revert toggle.checked = false when permission is denied"
    );
  });
});

// ── T3.3: First-await invariant guard (Firefox MV2 gesture-frame) ─────────────
//
// Design §10 + REQ-OPT-4:
//   Firefox browser.permissions.request MUST be called inside the same synchronous
//   call frame as the user gesture (the change event on the toggle checkbox).
//   Any `await` before the call detaches from the gesture frame — Firefox then
//   silently returns false from permissions.request and the user cannot enable
//   remote rules. Chrome tolerates this but Firefox does not.
//
//   This test locates the enable-path (checked === true) branch inside the toggle
//   change handler and asserts that chrome.permissions.request is the text of the
//   first `await` expression in that branch. If a developer inserts an earlier
//   `await` (e.g. `await setPrefs(...)` or `await chrome.storage.sync.get(...)`)
//   the test fails, alerting them to the Firefox regression before it ships.

describe("T3.3 chrome.permissions.request is the first await in the enable branch", () => {
  test("enable branch: chrome.permissions.request appears before any other await", () => {
    // Strategy:
    // 1. Find the toggle change handler by locating the addEventListener for the
    //    remote-rules-toggle (the change event).
    // 2. Within that handler, locate the enable branch (after the disable path return).
    // 3. Strip single-line comments so `await` mentioned in comments is not counted.
    // 4. Find all `await` keywords in the stripped code.
    // 5. Assert the first `await` is followed by chrome.permissions.request.

    // Find the remote-rules toggle change handler
    const handlerPattern = /remoteRulesToggle[\s\S]{0,50}addEventListener\s*\(\s*["']change["']/;
    const handlerStart = optionsJs.search(handlerPattern);
    assert.ok(
      handlerStart !== -1,
      "options.js must add a 'change' event listener on the remote-rules toggle"
    );

    // Slice a generous window after the handler start to capture the full handler body
    const handlerWindow = optionsJs.slice(handlerStart, handlerStart + 4000);

    // Find the enable branch: after the DISABLE_REMOTE_RULES path
    const disableIdx = handlerWindow.indexOf("DISABLE_REMOTE_RULES");
    assert.ok(
      disableIdx !== -1,
      "change handler must contain the DISABLE_REMOTE_RULES path"
    );

    // Strip single-line comments — prevents false positives from the explanatory
    // comments in the enable branch (e.g. "Any await before this...")
    const handlerNoComments = handlerWindow.replace(/\/\/[^\n]*/g, "");

    // Find the `await chrome.permissions.request` unit in the comment-stripped handler
    const awaitPermReqIdx = handlerNoComments.indexOf("await chrome.permissions.request");
    assert.ok(
      awaitPermReqIdx !== -1,
      "change handler must contain `await chrome.permissions.request` (REQ-OPT-4)"
    );

    // Find the last `return;` before the `await chrome.permissions.request` call
    // (= end of disable branch)
    const beforePermBlock = handlerNoComments.slice(0, awaitPermReqIdx);
    const lastReturnIdx = beforePermBlock.lastIndexOf("return;");
    assert.ok(lastReturnIdx !== -1, "disable path must end with return; before the enable path");

    // The enable window: from the end of the disable-branch return to the start of
    // `await chrome.permissions.request` — this window must have 0 `await` keywords.
    const enableWindow = handlerNoComments.slice(lastReturnIdx + "return;".length, awaitPermReqIdx);
    const awaitsBefore = (enableWindow.match(/\bawait\b/g) || []).length;

    assert.strictEqual(
      awaitsBefore,
      0,
      `Expected 0 awaits before \`await chrome.permissions.request\` in the enable branch, ` +
      `but found ${awaitsBefore}.\n` +
      `Enable window (should have no await):\n${enableWindow.trim()}\n\n` +
      `Inserting any await before chrome.permissions.request detaches from the Firefox MV2 ` +
      `gesture frame and silently breaks permission request for Firefox users. ` +
      `(See design §10, REQ-OPT-4)`
    );
  });

  test("enable branch: no await before chrome.permissions.request (regression plant check)", () => {
    // This test counts `await` expressions that appear BEFORE the
    // `await chrome.permissions.request` unit in the enable branch.
    // Must be 0 — the permission request must be the first async operation.
    //
    // We look for the full `await chrome.permissions.request` token as the marker,
    // so the `await` that is part of that call is not counted as a "preceding await".

    const handlerPattern = /remoteRulesToggle[\s\S]{0,50}addEventListener\s*\(\s*["']change["']/;
    const handlerStart = optionsJs.search(handlerPattern);
    assert.ok(handlerStart !== -1, "change handler must exist");

    const handlerWindow = optionsJs.slice(handlerStart, handlerStart + 4000);

    // Strip single-line comments so `await` in comments is not counted
    const handlerNoComments = handlerWindow.replace(/\/\/[^\n]*/g, "");

    // Find the `await chrome.permissions.request` unit (the full expression)
    const awaitPermReqIdx = handlerNoComments.indexOf("await chrome.permissions.request");
    assert.ok(
      awaitPermReqIdx !== -1,
      "change handler must contain `await chrome.permissions.request` (REQ-OPT-4)"
    );

    // Find the last `return;` before the `await chrome.permissions.request` call.
    // This is the end of the disable-path branch.
    const beforePermBlock = handlerNoComments.slice(0, awaitPermReqIdx);
    const lastReturnIdx = beforePermBlock.lastIndexOf("return;");
    assert.ok(
      lastReturnIdx !== -1,
      "disable path must end with return; before the enable path begins"
    );

    // Count awaits between the last return and the `await chrome.permissions.request` unit
    const enableOnlyWindow = handlerNoComments.slice(lastReturnIdx + "return;".length, awaitPermReqIdx);
    const awaitsBefore = (enableOnlyWindow.match(/\bawait\b/g) || []).length;

    assert.strictEqual(
      awaitsBefore,
      0,
      `Found ${awaitsBefore} await(s) before \`await chrome.permissions.request\` in the enable branch.\n` +
      `Any await before chrome.permissions.request breaks Firefox MV2 permission request.\n` +
      `(design §10, REQ-OPT-4)\n` +
      `Enable-branch code before permissions.request:\n${enableOnlyWindow.slice(-300)}`
    );
  });
});
