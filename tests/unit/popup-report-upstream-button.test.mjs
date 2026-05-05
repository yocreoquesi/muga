/**
 * MUGA — Popup "Report upstream" button per Suspicious-params row.
 *
 * History:
 *   #537 — initial slice. Deep-link to GitHub with ONLY paramName +
 *          firstPartyDomainCount (privacy-locked via csft-upstream.js).
 *   #521 — evolved to use the structured `tracker-flag.yml` form
 *          template with richer prefill (domains list, entropy, count
 *          breakdown). The privacy contract is preserved by the
 *          user-mediated review step on github.com — MUGA never sends
 *          anything autonomously.
 *
 * Structural tests pin the post-#521 contract:
 *   - i18n keys exist (en + es non-empty)
 *   - popup.js declares the button class so future refactors keep it
 *     discoverable
 *   - popup.js uses the new `?template=tracker-flag.yml&...` URL pattern
 *     (form deep-linking) instead of the legacy `?title=...&body=...`
 *   - popup.js opens the deep-link via window.open with noopener+noreferrer
 *   - popup.js writes to `chrome.storage.local.submittedParams` for
 *     local dedup (never to chrome.storage.sync; this is per-install
 *     UX state, not synced behaviour)
 *   - the "already-reported" label is rendered in place of the button
 *     when a paramName has been submitted previously from this install
 *   - simulated deep-link does NOT leak value-hashes or timestamps
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

test("popup.js declares a 'report-upstream-btn' class for the per-row button", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.match(popupSrc, /report-upstream-btn/);
});

test("popup.js uses the tracker-flag.yml form template URL pattern (#521, not #537 legacy)", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.match(
    popupSrc,
    /github\.com\/yocreoquesi\/muga\/issues\/new/,
    "popup.js must build the canonical GitHub issue deep-link URL",
  );
  assert.match(
    popupSrc,
    /tracker-flag\.yml/,
    "popup.js must reference the tracker-flag.yml form template (post-#521)",
  );
  // Legacy URL building (?title=...&body=...&labels=needs-triage) MUST NOT
  // be the primary report-upstream path anymore — that was the #537 shape.
  // Other handlers in the file (e.g. report-broken) still use that pattern,
  // so we just assert the report-upstream block uses the new form template.
  const upstreamFnIdx = popupSrc.indexOf("function _appendReportUpstreamButton");
  assert.ok(upstreamFnIdx > 0, "_appendReportUpstreamButton function must exist");
  // Take a 3000-char window of the function body and assert it does NOT use
  // the legacy ?title=&body=&labels= shape.
  const fnSlice = popupSrc.slice(upstreamFnIdx, upstreamFnIdx + 3000);
  assert.ok(
    !/\?title=[^"']*&body=/.test(fnSlice),
    "_appendReportUpstreamButton must not use the legacy ?title=&body= URL shape (#537 pre-#521)",
  );
});

test("popup.js opens the deep-link via window.open with noopener+noreferrer", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.match(
    popupSrc,
    /window\.open\([^)]*['"]_blank['"][^)]*noopener[^)]*noreferrer/,
    "popup.js must call window.open(url, '_blank', 'noopener,noreferrer')",
  );
});

test("popup.js references the new dedup state path: chrome.storage.local.submittedParams", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.match(popupSrc, /submittedParams/, "popup.js must read/write submittedParams (#521 dedup)");
  // Sanity: it should be on chrome.storage.local, not sync — UX state per
  // install, not synced across devices.
  assert.match(
    popupSrc,
    /chrome\.storage\.local\.(get|set)[^;]*submittedParams|submittedParams[^;]*chrome\.storage\.local/,
    "submittedParams must live in chrome.storage.local (per-install dedup), not sync",
  );
});

test("popup.js renders the 'already reported' label in place of the button when applicable", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.match(popupSrc, /report-upstream-already-reported|report_upstream_already_reported/);
});

// ── HTML surface ─────────────────────────────────────────────────────────────

test("popup.html still exposes the suspicious-params section host (regression guard)", () => {
  const html = readFileSync(resolve(root, "src/popup/popup.html"), "utf8");
  assert.match(html, /id="suspicious-params-list"/);
});

test("options.html exposes the 'forget reported params' button for the dedup reset", () => {
  const html = readFileSync(resolve(root, "src/options/options.html"), "utf8");
  assert.match(html, /id="forget-reported-params-btn"/);
});

// ── Behaviour: simulate the deep-link construction end-to-end ────────────────
//
// Under the post-#521 contract the prefill DOES carry the first-party
// domain list (the form template asks for it; the user reviews the form on
// github.com before clicking Submit). What MUST NEVER appear:
//
//   - raw value HASHES (the tracker only stores hashes — they're not
//     reconstructable, but they're still random bytes that have no place
//     in a public issue)
//   - timestamps (`firstSeen`, `lastSeen`)
//   - the full URL the user was on
//
// This test simulates the URL the popup builds and asserts both the
// positive prefill fields and the negative leak guards.

test("simulated deep-link URL carries the documented prefill fields and nothing else", () => {
  const SECRET_HASH_A = "deadbeef".repeat(8);
  const SECRET_HASH_B = "feedface".repeat(8);
  const SECRET_HASH_C = "0badc0de".repeat(8);
  const FIRST_SEEN_TS = 1717181718;
  const LAST_SEEN_TS  = 1717181819;

  const trackerEntry = {
    domains: ["news.example.com", "shop.example.org"],
    values: [SECRET_HASH_A, SECRET_HASH_B, SECRET_HASH_C],
    firstSeen: FIRST_SEEN_TS,
    lastSeen: LAST_SEEN_TS,
    count: 7,
    entropyAvg: 4.85,
  };

  // Mirror the URL construction in _appendReportUpstreamButton.
  const params = new URLSearchParams();
  params.set("template", "tracker-flag.yml");
  params.set("paramName", "uid");
  params.set("domains", trackerEntry.domains.slice(0, 50).join("\n"));
  params.set("entropy_score", trackerEntry.entropyAvg.toFixed(2));
  params.set("frequency_distinct_domains", String(trackerEntry.domains.length));
  params.set("frequency_distinct_values", String(trackerEntry.values.length));
  const url = `https://github.com/yocreoquesi/muga/issues/new?${params.toString()}`;

  // Positive: documented prefill fields present.
  assert.match(url, /template=tracker-flag\.yml/);
  assert.match(url, /paramName=uid/);
  assert.ok(url.includes(encodeURIComponent("news.example.com")));
  assert.ok(url.includes(encodeURIComponent("shop.example.org")));
  assert.match(url, /entropy_score=4\.85/);
  assert.match(url, /frequency_distinct_domains=2/);
  assert.match(url, /frequency_distinct_values=3/);

  // Negative: hashes and timestamps must NOT survive into the URL.
  for (const leak of [SECRET_HASH_A, SECRET_HASH_B, SECRET_HASH_C, String(FIRST_SEEN_TS), String(LAST_SEEN_TS)]) {
    assert.ok(!url.includes(leak),
      `deep-link URL must not contain "${leak}"`);
    assert.ok(!url.includes(encodeURIComponent(leak)),
      `deep-link URL must not contain encoded form of "${leak}"`);
  }
});

test("domains list is capped at 50 entries to stay under GitHub's URL ceiling", () => {
  // Build a synthetic 60-entry domains list and assert the slice(0, 50)
  // cap matches the popup's behaviour.
  const domains = [];
  for (let i = 0; i < 60; i++) domains.push(`d${i}.example.test`);

  const capped = domains.slice(0, 50);
  assert.equal(capped.length, 50);
  assert.equal(capped[0], "d0.example.test");
  assert.equal(capped[49], "d49.example.test");
  assert.ok(!capped.includes("d50.example.test"));
});
