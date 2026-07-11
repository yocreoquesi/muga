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
import { computeLengthReduction, emptyStateView, formatCleanResult } from "./ui-view.js";
import { buildParamInsight } from "./param-insight.js";
import { buildReportUrl } from "./report-link.js";

/** Removes all child nodes without ever assigning innerHTML with dynamic data. */
function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Builds one param-insight breakdown row (category label, params, and
 * optional why-description) via createElement only. */
function buildInsightRow(group) {
  const rowEl = document.createElement("div");
  rowEl.className = "breakdown-row";

  const catEl = document.createElement("span");
  catEl.className = "breakdown-cat";
  catEl.textContent = group.label;
  rowEl.appendChild(catEl);

  const paramsEl = document.createElement("span");
  paramsEl.className = "breakdown-params";
  paramsEl.textContent = group.params.join(", ");
  rowEl.appendChild(paramsEl);

  if (group.description) {
    const descEl = document.createElement("span");
    descEl.className = "breakdown-desc";
    descEl.textContent = group.description;
    rowEl.appendChild(descEl);
  }

  return rowEl;
}

/**
 * Applies a CleanResultView (web/ui-view.js) to the DOM.
 *
 * @param {object} refs DOM element references (see init()).
 * @param {import("./ui-view.js").CleanResultView} view
 * @param {string} originalUrl The raw text the user pasted, used for the
 *   length-reduction bar and the report link (adapter never echoes it back).
 */
function render(refs, view, originalUrl) {
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

  refs.removedBlock.hidden = view.removedList.length === 0;

  clearChildren(refs.paramInsight);
  if (hasCleanUrl) {
    for (const group of buildParamInsight(view.removedList)) {
      refs.paramInsight.appendChild(buildInsightRow(group));
    }
  }

  if (hasCleanUrl) {
    const lengthView = computeLengthReduction(originalUrl, view.cleanUrl);
    refs.lengthBar.hidden = false;
    refs.lengthBarHeadline.textContent = lengthView.label;
    const totalLen = lengthView.keptLen + lengthView.removedLen;
    const removedShare = totalLen === 0 ? 0 : (lengthView.removedLen / totalLen) * 100;
    refs.lengthBarKept.style.width = `${100 - removedShare}%`;
    refs.lengthBarRemoved.style.width = `${removedShare}%`;
  } else {
    refs.lengthBar.hidden = true;
    refs.lengthBarHeadline.textContent = "";
  }

  if (hasCleanUrl && view.unwrapped && view.destinationHost) {
    refs.unwrapCallout.hidden = false;
    clearChildren(refs.destinationLine);
    refs.destinationLine.appendChild(document.createTextNode("Real destination: "));
    const hostEl = document.createElement("span");
    hostEl.className = "host";
    hostEl.textContent = view.destinationHost;
    refs.destinationLine.appendChild(hostEl);
  } else {
    refs.unwrapCallout.hidden = true;
    clearChildren(refs.destinationLine);
  }

  if (hasCleanUrl) {
    refs.reportBlock.hidden = false;
    refs.reportLink.href = buildReportUrl({
      originalUrl,
      cleanUrl: view.cleanUrl,
      removed: view.removedList,
      unwrapped: view.unwrapped,
      destinationHost: view.destinationHost,
    });
  } else {
    refs.reportBlock.hidden = true;
    refs.reportLink.href = "#";
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
    paramInsight: document.getElementById("param-insight"),
    lengthBar: document.getElementById("length-bar"),
    lengthBarHeadline: document.getElementById("length-bar-headline"),
    lengthBarKept: document.getElementById("length-bar-kept"),
    lengthBarRemoved: document.getElementById("length-bar-removed"),
    unwrapCallout: document.getElementById("unwrap-callout"),
    destinationLine: document.getElementById("destination-line"),
    reportBlock: document.getElementById("report-block"),
    reportLink: document.getElementById("report-link"),
  };

  let lastCleanUrl = null;

  render(refs, emptyStateView(), "");

  function runClean() {
    const originalUrl = refs.input.value;
    const result = cleanUrl(originalUrl);
    lastCleanUrl = result && result.ok && typeof result.cleanUrl === "string" ? result.cleanUrl : null;
    render(refs, formatCleanResult(result), originalUrl);
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
