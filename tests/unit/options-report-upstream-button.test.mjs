/**
 * MUGA — Settings "Report upstream" button per Activity suspicious-params
 * row (#1351, relocated from the popup, #521/#537).
 *
 * History:
 *   #537 — initial slice. Deep-link to GitHub with ONLY paramName +
 *          firstPartyDomainCount (privacy-locked via csft-upstream.js).
 *   #521 — evolved to use the structured `tracker-flag.yml` form
 *          template with richer prefill (domains list, entropy, count
 *          breakdown). The privacy contract is preserved by the
 *          user-mediated review step on github.com — MUGA never sends
 *          anything autonomously.
 *   #1351 — moved from the popup to Settings' Activity section, alongside
 *          the cross-site FREQUENCY subgroup it reads its prefill from.
 *          The ENTROPY subgroup stays in the popup (read-only, no report
 *          action) per the 2026-09-24 maintainer decision — entropy-flagged
 *          params were rarely in the tracker store this button reads from
 *          anyway, so report-upstream's natural home is with the frequency
 *          rows that moved.
 *
 * Sliced delivery note (#1351 stacked-PR re-slice): this is slice B — the
 * Settings-side action lands here, wired against the frequency panel this
 * slice also adds. The popup's OWN report-upstream button is still present
 * at this point (slice C retires it); the "popup no longer duplicates this"
 * guard is added there, once it is actually true.
 *
 * Structural tests pin the post-#1351 Settings-side contract:
 *   - i18n keys exist (en + es non-empty)
 *   - options.js declares the button class so future refactors keep it
 *     discoverable
 *   - options.js uses the `?template=tracker-flag.yml&...` URL pattern
 *   - options.js opens the deep-link via window.open with noopener+noreferrer
 *   - options.js writes to `chrome.storage.local.submittedParams` for
 *     local dedup (never to chrome.storage.sync; this is per-install
 *     UX state, not synced behaviour)
 *   - the "already-reported" label is rendered in place of the button
 *     when a paramName has been submitted previously from this install
 *
 * #1351 R3-tautological-deeplink-tests: the actual URL construction (the
 * 50-domain cap, the never-leak-hashes/timestamps contract) is no longer
 * reconstructed here — it moved into the pure, independently-tested
 * `buildTrackerFlagDeepLinkUrl` (src/lib/tracker-flag-deeplink.js,
 * tests/unit/tracker-flag-deeplink.test.mjs). Re-implementing that logic in
 * this file would only prove the test agrees with itself, not that
 * options.js's real behaviour is correct. This file now only pins that
 * options.js actually calls the real helper.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

import { makeChromeMock } from "./helpers/chrome-stub.mjs";
globalThis.chrome = makeChromeMock({ hasSession: false, promiseShape: true });

const { TRANSLATIONS } = await import("../../src/lib/i18n.js");

// ── i18n keys ────────────────────────────────────────────────────────────────

test("report_upstream_btn: i18n key exists with en + es non-empty", () => {
  const k = TRANSLATIONS.report_upstream_btn;
  assert.ok(k, "report_upstream_btn must exist");
  assert.ok(typeof k.en === "string" && k.en.length > 0, "en non-empty");
  assert.ok(typeof k.es === "string" && k.es.length > 0, "es non-empty");
});

test("report_upstream_already_reported: i18n key carries {date} placeholder (en + es)", () => {
  const k = TRANSLATIONS.report_upstream_already_reported;
  assert.ok(k, "report_upstream_already_reported must exist (#521)");
  for (const lang of ["en", "es"]) {
    assert.ok(typeof k[lang] === "string" && k[lang].length > 0, `${lang} non-empty`);
    assert.ok(k[lang].includes("{date}"), `${lang} must include {date} placeholder`);
  }
});

test("forget_reported_params_btn: i18n keys exist for the options-page reset (en + es)", () => {
  for (const key of ["forget_reported_params_btn", "forget_reported_params_done", "forget_reported_params_hint"]) {
    const k = TRANSLATIONS[key];
    assert.ok(k, `${key} must exist (#521)`);
    assert.ok(typeof k.en === "string" && k.en.length > 0, `${key}.en non-empty`);
    assert.ok(typeof k.es === "string" && k.es.length > 0, `${key}.es non-empty`);
  }
});

// ── JS surface ───────────────────────────────────────────────────────────────

test("options.js declares a 'report-upstream-btn' class for the per-row button", () => {
  const optionsSrc = readFileSync(resolve(root, "src/options/options.js"), "utf8");
  assert.match(optionsSrc, /report-upstream-btn/);
});

test("options.js's report-upstream path documents the tracker-flag.yml template (#521, not #537 legacy)", () => {
  const optionsSrc = readFileSync(resolve(root, "src/options/options.js"), "utf8");
  // #1351 R3: the URL is built by buildTrackerFlagDeepLinkUrl now (asserted
  // below and in tracker-flag-deeplink.test.mjs), not reconstructed here —
  // this only pins that buildReportUpstreamButton's own docblock still
  // names the template it delegates to, so the two never drift apart silently.
  const fnDocIdx = optionsSrc.lastIndexOf("/**", optionsSrc.indexOf("function buildReportUpstreamButton("));
  assert.ok(fnDocIdx !== -1, "buildReportUpstreamButton must have a docblock");
  const docSlice = optionsSrc.slice(fnDocIdx, optionsSrc.indexOf("function buildReportUpstreamButton("));
  assert.match(docSlice, /tracker-flag\.yml/, "the docblock must name the tracker-flag.yml form template (post-#521)");
  const upstreamFnIdx = optionsSrc.indexOf("function buildReportUpstreamButton");
  assert.ok(upstreamFnIdx > 0, "buildReportUpstreamButton function must exist");
  const fnSlice = optionsSrc.slice(upstreamFnIdx, upstreamFnIdx + 3000);
  assert.ok(
    !/\?title=[^"']*&body=/.test(fnSlice),
    "buildReportUpstreamButton must not use the legacy ?title=&body= URL shape (#537 pre-#521)",
  );
});

test("options.js opens the deep-link via window.open with noopener+noreferrer", () => {
  const optionsSrc = readFileSync(resolve(root, "src/options/options.js"), "utf8");
  assert.match(
    optionsSrc,
    /window\.open\([^)]*['"]_blank['"][^)]*noopener[^)]*noreferrer/,
    "options.js must call window.open(url, '_blank', 'noopener,noreferrer')",
  );
});

test("options.js references the dedup state path: chrome.storage.local.submittedParams", () => {
  const optionsSrc = readFileSync(resolve(root, "src/options/options.js"), "utf8");
  assert.match(optionsSrc, /submittedParams/, "options.js must read/write submittedParams (#521 dedup)");
  assert.match(
    optionsSrc,
    /chrome\.storage\.local\.(get|set)[^;]*submittedParams|submittedParams[^;]*chrome\.storage\.local/,
    "submittedParams must live in chrome.storage.local (per-install dedup), not sync",
  );
});

test("options.js renders the 'already reported' label in place of the button when applicable", () => {
  const optionsSrc = readFileSync(resolve(root, "src/options/options.js"), "utf8");
  assert.match(optionsSrc, /report-upstream-already-reported|report_upstream_already_reported/);
});

// ── HTML surface ─────────────────────────────────────────────────────────────

test("options.html exposes the suspicious-params Activity panel host (regression guard)", () => {
  const html = readFileSync(resolve(root, "src/options/options.html"), "utf8");
  assert.match(html, /id="suspicious-params-settings-list"/);
});

test("options.html exposes the 'forget reported params' button for the dedup reset", () => {
  const html = readFileSync(resolve(root, "src/options/options.html"), "utf8");
  assert.match(html, /id="forget-reported-params-btn"/);
});

// ── options.js actually calls the real helper (#1351 R3) ───────────────────
//
// The deep-link URL construction itself (the 50-domain cap, the
// never-leak-hashes/timestamps contract) is tested directly against the
// real implementation in tests/unit/tracker-flag-deeplink.test.mjs. What
// this file needs to pin is that options.js's click handler actually calls
// that helper instead of reconstructing the logic inline again.

test("options.js imports buildTrackerFlagDeepLinkUrl from the pure deep-link module", () => {
  const optionsSrc = readFileSync(resolve(root, "src/options/options.js"), "utf8");
  assert.match(
    optionsSrc,
    /import\s*\{\s*buildTrackerFlagDeepLinkUrl\s*\}\s*from\s*["']\.\.\/lib\/tracker-flag-deeplink\.js["']/,
    "options.js must import buildTrackerFlagDeepLinkUrl from ../lib/tracker-flag-deeplink.js",
  );
});

test("buildReportUpstreamButton's click handler calls the real helper, not a reimplementation", () => {
  const optionsSrc = readFileSync(resolve(root, "src/options/options.js"), "utf8");
  const fnStart = optionsSrc.indexOf("function buildReportUpstreamButton(");
  assert.ok(fnStart !== -1);
  const fnEnd = optionsSrc.indexOf("\nfunction ", fnStart + 1);
  const body = optionsSrc.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
  assert.match(
    body,
    /const\s+url\s*=\s*buildTrackerFlagDeepLinkUrl\(\s*paramName\s*,\s*trackerState\s*\)\s*;/,
    "the click handler must call buildTrackerFlagDeepLinkUrl(paramName, trackerState)",
  );
  // The old inline URLSearchParams construction must be gone from here —
  // it now lives ONLY in tracker-flag-deeplink.js.
  assert.doesNotMatch(body, /new URLSearchParams\(\)/, "URL construction must not be duplicated inline anymore");
});
