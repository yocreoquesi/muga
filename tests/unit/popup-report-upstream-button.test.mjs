/**
 * MUGA — Popup "Report upstream" button per Suspicious-params row (#537).
 *
 * The button opens a deep-linked GitHub issue in a new tab pre-filled with
 * ONLY the param name and the count of distinct first-party domains the
 * user observed it on. No value, no hash, no domain history.
 *
 * These structural tests pin:
 *   - the i18n keys exist (en + es non-empty) for the button + body copy
 *   - the popup JS contains the marker class for the button so future
 *     refactors keep it discoverable
 *   - the popup JS references the deep-link URL host + the labels= query
 *     parameter so a refactor that breaks the GitHub deep-link surface
 *     fails this test, not just E2E
 *   - the popup JS imports buildUpstreamPayload (structural privacy)
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

test("report_upstream_issue_title: i18n key carries {paramName} and {count} placeholders (en + es)", () => {
  const k = TRANSLATIONS.report_upstream_issue_title;
  assert.ok(k, "report_upstream_issue_title must exist");
  for (const lang of ["en", "es"]) {
    assert.ok(typeof k[lang] === "string" && k[lang].length > 0, `${lang} non-empty`);
    assert.ok(k[lang].includes("{paramName}"), `${lang} must include {paramName}`);
    assert.ok(k[lang].includes("{count}"), `${lang} must include {count}`);
  }
});

test("report_upstream_issue_body: i18n key carries {paramName} and {count} and a privacy disclaimer (en + es)", () => {
  const k = TRANSLATIONS.report_upstream_issue_body;
  assert.ok(k, "report_upstream_issue_body must exist");
  for (const lang of ["en", "es"]) {
    assert.ok(typeof k[lang] === "string" && k[lang].length > 0, `${lang} non-empty`);
    assert.ok(k[lang].includes("{paramName}"), `${lang} must include {paramName}`);
    assert.ok(k[lang].includes("{count}"), `${lang} must include {count}`);
  }
  // The privacy disclaimer is the whole point of the slice — assert that the
  // English body explicitly mentions that MUGA never sees the value.
  assert.match(k.en, /never sees? the value/i, "en body must carry the privacy disclaimer");
});

// ── JS surface ───────────────────────────────────────────────────────────────

test("popup.js declares a 'report-upstream-btn' class for the per-row button", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.ok(
    /report-upstream-btn/.test(popupSrc),
    "popup.js must reference the report-upstream-btn class so the button is discoverable",
  );
});

test("popup.js imports buildUpstreamPayload from csft-upstream module (structural privacy)", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.match(popupSrc, /buildUpstreamPayload/);
  assert.match(popupSrc, /csft-upstream/);
});

test("popup.js click-handler builds a github.com/yocreoquesi/muga/issues/new URL with labels=needs-triage", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.match(
    popupSrc,
    /github\.com\/yocreoquesi\/muga\/issues\/new/,
    "popup.js must build the canonical GitHub issue deep-link URL",
  );
  assert.match(
    popupSrc,
    /labels=needs-triage/,
    "popup.js must request the needs-triage label on the deep-linked issue",
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

test("popup.js references both i18n keys for the issue title and body templates", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.match(popupSrc, /report_upstream_issue_title/);
  assert.match(popupSrc, /report_upstream_issue_body/);
  assert.match(popupSrc, /report_upstream_btn/);
});

// ── HTML surface (regression guard for the host section) ─────────────────────

test("popup.html still exposes the suspicious-params section host (regression guard)", () => {
  const html = readFileSync(resolve(root, "src/popup/popup.html"), "utf8");
  assert.match(html, /id="suspicious-params-list"/);
});

// ── Behaviour: simulate the click handler end-to-end ─────────────────────────
//
// We simulate the deep-link construction the way popup.js does it. This guards
// the privacy contract at the wire level: the URL the user is sent to must
// contain ONLY the param name + count — never a value, hash, or domain.

test("simulated deep-link URL contains paramName + count, NEVER value/hash/domain", async () => {
  const { buildUpstreamPayload } = await import("../../src/lib/csft-upstream.js");
  const { t } = await import("../../src/lib/i18n.js");

  // Synthetic tracker state with privacy-sensitive fields.
  const SECRET_VALUE = "super-secret-uuid-aaaa-bbbb-cccc";
  const SECRET_HASH = "deadbeef".repeat(8);
  const SECRET_DOMAIN_A = "private-domain-a.example.test";
  const SECRET_DOMAIN_B = "private-domain-b.example.test";
  const SECRET_DOMAIN_C = "private-domain-c.example.test";

  const state = {
    uid: {
      domains: [SECRET_DOMAIN_A, SECRET_DOMAIN_B, SECRET_DOMAIN_C],
      values: [SECRET_HASH, SECRET_HASH + "1", SECRET_HASH + "2"],
      firstSeen: 1, lastSeen: 2, count: 3, entropyAvg: 4.2,
    },
  };

  const payload = buildUpstreamPayload(state, "uid");
  assert.equal(payload.firstPartyDomainCount, 3);

  const titleTpl = t("report_upstream_issue_title", "en");
  const bodyTpl = t("report_upstream_issue_body", "en");
  const title = titleTpl.replace("{paramName}", payload.paramName).replace("{count}", String(payload.firstPartyDomainCount));
  const body = bodyTpl.replace("{paramName}", payload.paramName).replace("{count}", String(payload.firstPartyDomainCount));
  const url = `https://github.com/yocreoquesi/muga/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=needs-triage`;

  // Positive assertions: param name + count survive the round-trip.
  assert.ok(url.includes(encodeURIComponent("uid")));
  assert.ok(url.includes(encodeURIComponent("3")));
  assert.match(url, /labels=needs-triage/);

  // Negative assertions: NO secret value, hash, or domain bleeds in.
  for (const secret of [SECRET_VALUE, SECRET_HASH, SECRET_DOMAIN_A, SECRET_DOMAIN_B, SECRET_DOMAIN_C]) {
    assert.ok(!url.includes(secret),
      `deep-link URL must not contain "${secret}"`);
    assert.ok(!url.includes(encodeURIComponent(secret)),
      `deep-link URL must not contain encoded form of "${secret}"`);
  }
});
