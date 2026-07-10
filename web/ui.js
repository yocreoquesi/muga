/** MUGA: Web-cleaner-tool UI wiring (#1029, Phase 4)
 *
 * Browser-only DOM glue for web/index.html. Depends SOLELY on
 * web/engine/adapter.js's stable `cleanUrl()` contract (design ADR-1) and
 * the pure web/ui-view.js formatter, never on `window.__mugaCleaner` or
 * `processUrl` directly. No knowledge of the underlying MUGA engine.
 *
 * Security (AGENTS.md): addEventListener only, no inline handlers, no
 * eval/new Function, every user-controlled string rendered via
 * textContent/createElement, never innerHTML with dynamic data.
 *
 * Not unit-testable under node:test (browser-only DOM access); covered
 * by tests/unit/web-ui-source-guard.test.mjs (structural readFileSync
 * checks) and the manual harness at tests/browser/web-clean.html.
 */

import { cleanUrl } from "./engine/adapter.js";
import { emptyStateView, formatCleanResult } from "./ui-view.js";

/** Removes all child nodes without ever assigning innerHTML with dynamic data. */
function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * Applies a CleanResultView (web/ui-view.js) to the DOM.
 *
 * @param {object} refs DOM element references (see init()).
 * @param {import("./ui-view.js").CleanResultView} view
 */
function render(refs, view) {
  refs.message.textContent = view.message;
  refs.message.classList.remove("is-error", "is-clean");
  if (view.state === "error") refs.message.classList.add("is-error");
  if (view.state === "clean") refs.message.classList.add("is-clean");

  const hasCleanUrl = view.state === "clean" && typeof view.cleanUrl === "string";
  refs.urlRow.classList.toggle("visible", hasCleanUrl);
  refs.urlBox.textContent = hasCleanUrl ? view.cleanUrl : "";
  refs.copyBtn.disabled = !hasCleanUrl;

  const showTransparency = view.state === "clean" && !view.noChanges;
  refs.transparency.classList.toggle("visible", showTransparency);

  clearChildren(refs.removedList);
  refs.removedBlock.hidden = view.removedList.length === 0;
  for (const paramName of view.removedList) {
    const li = document.createElement("li");
    li.textContent = paramName;
    refs.removedList.appendChild(li);
  }

  if (view.unwrapped && view.destinationHost) {
    refs.destinationLine.hidden = false;
    clearChildren(refs.destinationLine);
    refs.destinationLine.appendChild(document.createTextNode("Real destination: "));
    const hostEl = document.createElement("span");
    hostEl.className = "host";
    hostEl.textContent = view.destinationHost;
    refs.destinationLine.appendChild(hostEl);
  } else {
    refs.destinationLine.hidden = true;
    clearChildren(refs.destinationLine);
  }
}

function init() {
  const refs = {
    input: document.getElementById("url-input"),
    cleanBtn: document.getElementById("clean-btn"),
    copyBtn: document.getElementById("copy-btn"),
    message: document.getElementById("result-message"),
    urlRow: document.getElementById("result-url-row"),
    urlBox: document.getElementById("result-url-box"),
    transparency: document.getElementById("transparency"),
    removedBlock: document.getElementById("removed-block"),
    removedList: document.getElementById("removed-list"),
    destinationLine: document.getElementById("destination-line"),
  };

  let lastCleanUrl = null;

  render(refs, emptyStateView());

  function runClean() {
    const result = cleanUrl(refs.input.value);
    lastCleanUrl = result && result.ok && typeof result.cleanUrl === "string" ? result.cleanUrl : null;
    render(refs, formatCleanResult(result));
  }

  refs.cleanBtn.addEventListener("click", runClean);

  refs.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      runClean();
    }
  });

  refs.copyBtn.addEventListener("click", () => {
    if (!lastCleanUrl) return;
    const originalLabel = refs.copyBtn.textContent;
    navigator.clipboard.writeText(lastCleanUrl).then(() => {
      refs.copyBtn.textContent = "Copied";
      setTimeout(() => { refs.copyBtn.textContent = originalLabel; }, 1200);
    }).catch(() => {
      refs.copyBtn.textContent = "Copy failed";
      setTimeout(() => { refs.copyBtn.textContent = originalLabel; }, 1200);
    });
  });
}

document.addEventListener("DOMContentLoaded", init);
