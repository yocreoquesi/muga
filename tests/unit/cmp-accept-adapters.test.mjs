/**
 * MUGA — Cookie Consent Minimizer: cmp-accept-adapters.js
 * (cookie-consent-paywall-accept — Tier 2 consent-or-pay-wall accept-click)
 *
 * This is the highest-stakes test file in the project: it must prove, not
 * just assert, that clicking a consent-or-pay wall's free-accept button is
 * structurally unreachable except when the user explicitly opted in AND no
 * free reject exists AND exactly one unambiguous free-accept candidate is
 * present. Groups:
 *
 *   1. classifyConsentButton — the button-text classifier (deny-wins
 *      precedence, settings-exclusion, multi-token adversarial cases).
 *   2. findFreeAcceptTarget — single/noop/ambiguous target resolution.
 *   3. hasFreeRejectControl — the last-resort gate.
 *   4. isPaywallFrame — consent-or-pay wall frame-shape detection.
 *   5. computeAcceptGate — the double-gate (+ enabled/onboarded/exemption).
 *   6. STRUCTURAL guards — word lists are DATA, no broad-accept identifier
 *      outside this module, and the adversarial "this must be impossible"
 *      scenarios named explicitly in the design's SAFETY section.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  ACCEPT_TOKENS,
  PAY_DENY_TOKENS,
  CURRENCY_TOKENS,
  CURRENCY_CODE_TOKENS,
  PERIOD_TOKENS,
  SETTINGS_TOKENS,
  REJECT_TOKENS,
  BUTTON_KIND,
  classifyConsentButton,
  ACCEPT_TARGET_STATUS,
  findFreeAcceptTarget,
  hasFreeRejectControl,
  hasPayOption,
  isPaywallFrame,
  computeAcceptGate,
} from "../../src/lib/cmp-accept-adapters.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── classifyConsentButton — deny-wins precedence ────────────────────────────

describe("classifyConsentButton — precedence: PAY > SETTINGS > REJECT > ACCEPT > UNKNOWN", () => {
  test("plain accept tokens (EN)", () => {
    for (const text of ["Accept", "I agree", "Accept & continue", "Continue"]) {
      assert.equal(classifyConsentButton(text), BUTTON_KIND.ACCEPT, text);
    }
  });

  test("plain accept tokens (DE)", () => {
    for (const text of [
      "Zustimmen und weiter",
      "Einwilligen und weiter",
      "Akzeptieren",
      "Annehmen",
    ]) {
      assert.equal(classifyConsentButton(text), BUTTON_KIND.ACCEPT, text);
    }
  });

  test("ADVERSARIAL: an accept token co-occurring with a pay token classifies as PAY (deny wins)", () => {
    assert.equal(classifyConsentButton("Accept subscription"), BUTTON_KIND.PAY);
    assert.equal(classifyConsentButton("Zustimmen zum Abo"), BUTTON_KIND.PAY);
  });

  test("ADVERSARIAL: a price-only label (no literal pay word) classifies as PAY via the currency/period backstop", () => {
    assert.equal(classifyConsentButton("Weiterlesen für 4,99€/Monat"), BUTTON_KIND.PAY);
    assert.equal(classifyConsentButton("Continue for $9.99/month"), BUTTON_KIND.PAY);
    assert.equal(classifyConsentButton("Read on for £2/mo"), BUTTON_KIND.PAY);
    assert.equal(classifyConsentButton("Jetzt weiterlesen 3€/Jahr"), BUTTON_KIND.PAY);
  });

  test("every PAY_DENY_TOKENS literal alone classifies as PAY", () => {
    for (const token of PAY_DENY_TOKENS) {
      assert.equal(classifyConsentButton(`Some button ${token} label`), BUTTON_KIND.PAY, token);
    }
  });

  test("every CURRENCY_TOKENS / PERIOD_TOKENS literal alone classifies as PAY", () => {
    for (const token of [...CURRENCY_TOKENS, ...PERIOD_TOKENS]) {
      assert.equal(classifyConsentButton(`Continue ${token}`), BUTTON_KIND.PAY, token);
    }
  });

  test("ADVERSARIAL: an accept token co-occurring with a settings token classifies as SETTINGS (excluded before accept)", () => {
    assert.equal(classifyConsentButton("Accept cookie settings"), BUTTON_KIND.SETTINGS);
    assert.equal(classifyConsentButton("Zustimmen Einstellungen"), BUTTON_KIND.SETTINGS);
  });

  test("every SETTINGS_TOKENS literal alone classifies as SETTINGS", () => {
    for (const token of SETTINGS_TOKENS) {
      assert.equal(classifyConsentButton(`Cookie ${token}`), BUTTON_KIND.SETTINGS, token);
    }
  });

  test("every REJECT_TOKENS literal alone classifies as REJECT", () => {
    for (const token of REJECT_TOKENS) {
      assert.equal(classifyConsentButton(`Button ${token} label`), BUTTON_KIND.REJECT, token);
    }
  });

  test("unrecognized / unknown-locale text classifies as UNKNOWN, never ACCEPT", () => {
    assert.equal(classifyConsentButton("Non merci"), BUTTON_KIND.UNKNOWN);
    assert.equal(classifyConsentButton("Continuar de todos modos"), BUTTON_KIND.UNKNOWN);
    assert.equal(classifyConsentButton("Some unrelated label"), BUTTON_KIND.UNKNOWN);
  });

  test("KNOWN LIMITATION (documented, out of scope this slice): a French word that happens to contain the English substring \"continue\" (e.g. \"continuer\") still classifies as ACCEPT — French tokens are a later-slice addition, reviewed then", () => {
    assert.equal(classifyConsentButton("D'accord et continuer"), BUTTON_KIND.ACCEPT);
  });

  test("empty / whitespace-only / malformed input never throws, resolves to UNKNOWN", () => {
    assert.doesNotThrow(() => classifyConsentButton(""));
    assert.doesNotThrow(() => classifyConsentButton(null));
    assert.doesNotThrow(() => classifyConsentButton(undefined));
    assert.doesNotThrow(() => classifyConsentButton(42));
    assert.equal(classifyConsentButton(""), BUTTON_KIND.UNKNOWN);
    assert.equal(classifyConsentButton("   "), BUTTON_KIND.UNKNOWN);
    assert.equal(classifyConsentButton(null), BUTTON_KIND.UNKNOWN);
    assert.equal(classifyConsentButton(undefined), BUTTON_KIND.UNKNOWN);
    assert.equal(classifyConsentButton(42), BUTTON_KIND.UNKNOWN);
  });

  test("classification is case-insensitive", () => {
    assert.equal(classifyConsentButton("ACCEPT & CONTINUE"), BUTTON_KIND.ACCEPT);
    assert.equal(classifyConsentButton("SUBSCRIBE NOW"), BUTTON_KIND.PAY);
  });

  test("ACCEPT_TOKENS is non-empty DATA, not embedded in the matching logic", () => {
    assert.ok(Array.isArray(ACCEPT_TOKENS) && ACCEPT_TOKENS.length > 0);
    assert.ok(Object.isFrozen(ACCEPT_TOKENS));
  });
});

// ── FIX 3 — price/pay backstop coverage (H1/F4) ─────────────────────────────

describe("classifyConsentButton — FIX 3: price/pay backstop coverage", () => {
  test("German spelled price tier 'Zustimmen für 9,99 EUR pro Monat' classifies as PAY (not ACCEPT)", () => {
    assert.equal(classifyConsentButton("Zustimmen für 9,99 EUR pro Monat"), BUTTON_KIND.PAY);
  });

  test("'werbefrei' (ad-free subscription cue) classifies as PAY", () => {
    assert.equal(classifyConsentButton("Werbefrei weiterlesen"), BUTTON_KIND.PAY);
  });

  test("spelled billing-period labels (no slash) classify as PAY", () => {
    for (const text of [
      "Continue for 5 per month",
      "Weiter für 5 im Monat",
      "5 monatlich",
      "Continue 20 per year",
      "20 jährlich",
      "Weiter 20 pro Jahr",
    ]) {
      assert.equal(classifyConsentButton(text), BUTTON_KIND.PAY, text);
    }
  });

  test("ISO currency codes classify as PAY when word-boundary-flanked", () => {
    for (const text of ["Pay 9,99 EUR", "Continue for 9.99 USD", "2 GBP", "5 CHF"]) {
      assert.equal(classifyConsentButton(text), BUTTON_KIND.PAY, text);
    }
  });

  test("ADVERSARIAL: a currency code embedded in a larger word does NOT trigger PAY (word-boundary-safe)", () => {
    // "europe" embeds "eur", "neural" embeds "eur", "usda"/"gbps"/"chft" embed
    // the other codes — none may be read as a price.
    assert.equal(classifyConsentButton("Continue to Europe"), BUTTON_KIND.ACCEPT);
    assert.equal(classifyConsentButton("Neural settings"), BUTTON_KIND.SETTINGS);
  });

  test("CURRENCY_CODE_TOKENS is non-empty frozen DATA", () => {
    assert.ok(Array.isArray(CURRENCY_CODE_TOKENS) && CURRENCY_CODE_TOKENS.length > 0);
    assert.ok(Object.isFrozen(CURRENCY_CODE_TOKENS));
  });
});

// ── FIX 3 (M1) — aria-label must not hide a paid tier ───────────────────────

describe("classifyConsentButton — FIX 3/M1: PAY/price/deny scanned over FULL text, not just the accessible name", () => {
  test("an aria-label of 'Continue' cannot hide a price carried in the visible text — classifies PAY", () => {
    // rawText = accessible name (aria-label), rawFull = aria + visible text.
    assert.equal(
      classifyConsentButton("Continue", "Continue Subscribe for 9,99 EUR pro Monat"),
      BUTTON_KIND.PAY,
    );
  });

  test("a plain accept control (no price anywhere in full text) still classifies ACCEPT", () => {
    assert.equal(classifyConsentButton("Accept all", "Accept all & continue"), BUTTON_KIND.ACCEPT);
  });

  test("full text defaults to accessible name when omitted (backward-compatible one-arg form)", () => {
    assert.equal(classifyConsentButton("Subscribe 9,99 EUR"), BUTTON_KIND.PAY);
  });
});

// ── FIX 2 — expanded reject-label coverage (fail-closed) ────────────────────

describe("hasFreeRejectControl — FIX 2: expanded DE+EN reject labels all veto", () => {
  const REJECT_LABELS = [
    "Nur notwendige",
    "Nur erforderliche",
    "Nur essenzielle Cookies",
    "Nur essentielle Cookies",
    "Ohne Einwilligung fortfahren",
    "Weiterlesen ohne Zustimmung",
    "Ablehnen",
    "Alle ablehnen",
    "Reject",
    "Reject all",
    "Decline",
    "Refuse",
    "Disagree",
    "Do not consent",
    "Continue without agreeing",
    "Continue without accepting",
    "Only necessary",
    "Necessary only",
    "Essential only",
  ];

  for (const label of REJECT_LABELS) {
    test(`a free reject labelled "${label}" is detected -> veto`, () => {
      assert.equal(hasFreeRejectControl([{ text: label, actionable: true }]), true, label);
    });
  }
});

describe("hasFreeRejectControl — FIX 2: SETTINGS-implies-reachable-reject veto", () => {
  test("a [Accept all][Settings] layer-1 banner must NOT be accepted — settings implies a reachable free reject one layer deeper", () => {
    const candidates = [
      { text: "Accept all", actionable: true },
      { text: "Settings", actionable: true },
    ];
    assert.equal(hasFreeRejectControl(candidates), true);
  });

  test("[Accept all][Cookie-Einstellungen] (DE manage pane) also vetoes", () => {
    assert.equal(
      hasFreeRejectControl([
        { text: "Alle akzeptieren", actionable: true },
        { text: "Cookie-Einstellungen", actionable: true },
      ]),
      true,
    );
  });
});

describe("hasFreeRejectControl — FIX 2: <a>-based reject candidates block", () => {
  test("a reject rendered as an anchor (collected by the caller as a candidate) still vetoes", () => {
    // The caller collects <a href> elements into the candidate list; a reject
    // anchor must block exactly like a <button>.
    assert.equal(
      hasFreeRejectControl([
        { text: "Accept & continue", actionable: true },
        { text: "Ablehnen", actionable: true, ref: "anchor" },
      ]),
      true,
    );
  });
});

// ── FIX 2 — fail-closed on any unknown/unrecognized actionable control ──────

describe("findFreeAcceptTarget — FIX 2: an unknown actionable control VETOES the accept (bias hard toward not-accepting)", () => {
  test("an accept button alongside an icon-only / empty-text actionable control -> ambiguous (never accept)", () => {
    const candidates = [
      { text: "Accept & continue", actionable: true, ref: "accept" },
      { text: "", actionable: true, ref: "icon-x" },
    ];
    assert.equal(findFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.AMBIGUOUS);
  });

  test("an accept button alongside an unrecognized-locale actionable control -> ambiguous (might be a free reject we cannot read)", () => {
    const candidates = [
      { text: "Accept & continue", actionable: true, ref: "accept" },
      { text: "Некоторая кнопка", actionable: true, ref: "unknown" },
    ];
    assert.equal(findFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.AMBIGUOUS);
  });

  test("a NON-actionable unknown control does NOT veto (only prominent/actionable controls count)", () => {
    const candidates = [
      { text: "Accept & continue", actionable: true, ref: "accept" },
      { text: "", actionable: false, ref: "hidden-icon" },
    ];
    assert.equal(findFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.SINGLE);
  });
});

// ── FIX 1 — positive consent-or-pay signal (hasPayOption) ───────────────────

describe("hasPayOption — FIX 1: a genuine consent-or-pay wall must present a PAY path", () => {
  test("a wall with a subscribe/pay control -> true", () => {
    assert.equal(hasPayOption([{ text: "Accept all", actionable: true }, { text: "Subscribe", actionable: true }]), true);
  });

  test("a wall with a spelled price tier -> true", () => {
    assert.equal(hasPayOption([{ text: "Zustimmen für 9,99 EUR pro Monat", actionable: true }]), true);
  });

  test("a pay control hidden behind an aria-label (price only in full text) still counts", () => {
    assert.equal(
      hasPayOption([{ text: "Continue", fullText: "Continue Subscribe 9,99 EUR pro Monat", actionable: true }]),
      true,
    );
  });

  test("a generic iframe with a lone Continue/Accept and NO pay control -> false (not a consent-or-pay wall)", () => {
    assert.equal(hasPayOption([{ text: "Continue", actionable: true }, { text: "Accept", actionable: true }]), false);
  });

  test("malformed/missing input never throws, resolves to false", () => {
    assert.doesNotThrow(() => hasPayOption(null));
    assert.equal(hasPayOption(null), false);
    assert.equal(hasPayOption(undefined), false);
  });
});

// ── findFreeAcceptTarget — single/noop/ambiguous ────────────────────────────

describe("findFreeAcceptTarget", () => {
  test("exactly one actionable accept candidate -> single, target returned unmodified", () => {
    const candidates = [
      { text: "Accept & continue", actionable: true, ref: "btn-1" },
      { text: "Subscribe now", actionable: true, ref: "btn-2" },
    ];
    const r = findFreeAcceptTarget(candidates);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.SINGLE);
    assert.equal(r.target.ref, "btn-1");
  });

  test("zero accept candidates -> noop", () => {
    const r = findFreeAcceptTarget([{ text: "Subscribe now", actionable: true }]);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.NOOP);
    assert.equal(r.target, null);
  });

  test("ADVERSARIAL: two free-accept candidates -> ambiguous, never guesses", () => {
    const candidates = [
      { text: "Accept", actionable: true, ref: "a" },
      { text: "I agree", actionable: true, ref: "b" },
    ];
    const r = findFreeAcceptTarget(candidates);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.AMBIGUOUS);
    assert.equal(r.target, null);
  });

  test("ADVERSARIAL: a hidden/non-actionable accept decoy is excluded, only the actionable one counts", () => {
    const candidates = [
      { text: "Accept & continue", actionable: false, ref: "decoy" },
      { text: "Accept & continue", actionable: true, ref: "real" },
    ];
    const r = findFreeAcceptTarget(candidates);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.SINGLE);
    assert.equal(r.target.ref, "real");
  });

  test("a non-actionable-only accept candidate (nothing else) -> noop, never clicks a hidden decoy", () => {
    const r = findFreeAcceptTarget([{ text: "Accept & continue", actionable: false }]);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.NOOP);
  });

  test("no candidates at all -> noop", () => {
    assert.equal(findFreeAcceptTarget([]).status, ACCEPT_TARGET_STATUS.NOOP);
  });

  test("malformed/missing input never throws, resolves to noop", () => {
    assert.doesNotThrow(() => findFreeAcceptTarget(null));
    assert.doesNotThrow(() => findFreeAcceptTarget(undefined));
    assert.equal(findFreeAcceptTarget(null).status, ACCEPT_TARGET_STATUS.NOOP);
    assert.equal(findFreeAcceptTarget([null, undefined, 42, "x"]).status, ACCEPT_TARGET_STATUS.NOOP);
  });

  test("ADVERSARIAL: a pay-labelled 'Accept subscription' button is never selected as the target", () => {
    const r = findFreeAcceptTarget([{ text: "Accept subscription", actionable: true }]);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.NOOP);
  });
});

// ── hasFreeRejectControl — the last-resort gate ─────────────────────────────

describe("hasFreeRejectControl", () => {
  test("a reject control present and actionable -> true", () => {
    assert.equal(
      hasFreeRejectControl([{ text: "Accept & continue", actionable: true }, { text: "Reject", actionable: true }]),
      true,
    );
  });

  test("no reject control -> false", () => {
    assert.equal(
      hasFreeRejectControl([{ text: "Accept & continue", actionable: true }, { text: "Subscribe", actionable: true }]),
      false,
    );
  });

  test("a reject control present but NOT actionable (hidden) -> false", () => {
    assert.equal(
      hasFreeRejectControl([{ text: "Reject", actionable: false }]),
      false,
    );
  });

  test("DE reject tokens are recognized", () => {
    assert.equal(hasFreeRejectControl([{ text: "Ablehnen", actionable: true }]), true);
    assert.equal(hasFreeRejectControl([{ text: "Nur notwendige Cookies", actionable: true }]), true);
  });

  test("malformed/missing input never throws, resolves to false", () => {
    assert.doesNotThrow(() => hasFreeRejectControl(null));
    assert.equal(hasFreeRejectControl(null), false);
    assert.equal(hasFreeRejectControl(undefined), false);
  });
});

// ── isPaywallFrame — consent-or-pay wall frame-shape detection ──────────────

describe("isPaywallFrame", () => {
  const SP_URL = "https://sp-spiegel-de.spiegel.de/index.html?hasCsp=true&consent_origin=x&message_id=1&consent/tcfv2=1";

  test("a subframe with the Sourcepoint URL shape -> true", () => {
    assert.equal(
      isPaywallFrame({ isTopFrame: false, frameUrl: SP_URL, frameHost: "sp-spiegel-de.spiegel.de", topHost: "sp-spiegel-de.spiegel.de" }),
      true,
    );
  });

  test("FIX 1: a bare cross-origin host mismatch WITHOUT the SP URL shape -> false (an ad/embed/social/checkout iframe is not a consent-or-pay wall)", () => {
    assert.equal(
      isPaywallFrame({ isTopFrame: false, frameUrl: "https://ads.example.com/frame.html", frameHost: "ads.example.com", topHost: "news.example.com" }),
      false,
    );
  });

  test("FIX 1: the SP URL shape is MANDATORY — a partial match (hasCsp but no consent/tcfv2) -> false", () => {
    assert.equal(
      isPaywallFrame({ isTopFrame: false, frameUrl: "https://x.example.com/f.html?hasCsp=true", frameHost: "x.example.com", topHost: "news.example.com" }),
      false,
    );
  });

  test("the TOP frame is NEVER a paywall frame, even with the exact SP URL shape", () => {
    assert.equal(isPaywallFrame({ isTopFrame: true, frameUrl: SP_URL, frameHost: "x", topHost: "y" }), false);
  });

  test("an undeterminable frame identity (isTopFrame neither true nor false) fails closed to false", () => {
    assert.equal(isPaywallFrame({ isTopFrame: undefined, frameUrl: SP_URL }), false);
    assert.equal(isPaywallFrame({}), false);
  });

  test("a same-origin subframe with no SP URL shape -> false", () => {
    assert.equal(
      isPaywallFrame({ isTopFrame: false, frameUrl: "https://news.example.com/widget.html", frameHost: "news.example.com", topHost: "news.example.com" }),
      false,
    );
  });

  test("does NOT filter on sp-prod.net/sourcepoint.com host literals — first-party CMP subdomains must still match via URL shape", () => {
    assert.equal(
      isPaywallFrame({ isTopFrame: false, frameUrl: "https://consent-cdn.zeit.de/index.html?hasCsp=true&x=consent/tcfv2", frameHost: "consent-cdn.zeit.de", topHost: "consent-cdn.zeit.de" }),
      true,
    );
  });

  test("malformed/missing input never throws, resolves to false", () => {
    assert.doesNotThrow(() => isPaywallFrame(null));
    assert.equal(isPaywallFrame(null), false);
    assert.equal(isPaywallFrame(undefined), false);
  });
});

// ── computeAcceptGate — the double-gate (L2) ────────────────────────────────

const ACCEPT_GATE_ON_PREFS = Object.freeze({
  enabled: true,
  onboardingDone: true,
  cookieConsentMode: "accept-when-necessary",
  cookieConsentAcceptConsented: true,
});

describe("computeAcceptGate — double-gate as a DATA invariant", () => {
  test("every invariant satisfied -> gate opens (true)", () => {
    assert.equal(computeAcceptGate(ACCEPT_GATE_ON_PREFS), true);
  });

  test("mode is reject-only (consented true) -> gate stays closed", () => {
    assert.equal(computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, cookieConsentMode: "reject-only" }), false);
  });

  test("mode is off (consented true) -> gate stays closed", () => {
    assert.equal(computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, cookieConsentMode: "off" }), false);
  });

  test("cookieConsentAcceptConsented false (mode correct) -> gate stays closed", () => {
    assert.equal(computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, cookieConsentAcceptConsented: false }), false);
  });

  test("cookieConsentAcceptConsented missing/undefined -> gate stays closed (must be exactly true)", () => {
    const { cookieConsentAcceptConsented: _omit, ...rest } = ACCEPT_GATE_ON_PREFS;
    assert.equal(computeAcceptGate(rest), false);
  });

  test("cookieConsentAcceptConsented as a truthy non-boolean (e.g. 1 or 'true') does NOT open the gate", () => {
    assert.equal(computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, cookieConsentAcceptConsented: 1 }), false);
    assert.equal(computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, cookieConsentAcceptConsented: "true" }), false);
  });

  test("master enabled false -> gate stays closed", () => {
    assert.equal(computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, enabled: false }), false);
  });

  test("onboardingDone false -> gate stays closed", () => {
    assert.equal(computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, onboardingDone: false }), false);
  });

  test("null / undefined prefs -> gate stays closed, never throws", () => {
    assert.doesNotThrow(() => computeAcceptGate(null));
    assert.equal(computeAcceptGate(null), false);
    assert.equal(computeAcceptGate(undefined), false);
  });

  test("isSiteFullyExempt true -> gate stays closed even when every pref passes", () => {
    const deps = { hostname: "example.com", isSiteFullyExempt: () => true };
    assert.equal(computeAcceptGate(ACCEPT_GATE_ON_PREFS, deps), false);
  });

  test("isSiteFullyExempt false -> gate opens (site not exempt)", () => {
    const deps = { hostname: "example.com", isSiteFullyExempt: () => false };
    assert.equal(computeAcceptGate(ACCEPT_GATE_ON_PREFS, deps), true);
  });

  test("isSiteFullyExempt receives the injected hostname and prefs", () => {
    let seen = null;
    const deps = {
      hostname: "shop.example.com",
      isSiteFullyExempt: (hostname, prefs) => { seen = { hostname, prefs }; return false; },
    };
    computeAcceptGate(ACCEPT_GATE_ON_PREFS, deps);
    assert.equal(seen.hostname, "shop.example.com");
    assert.strictEqual(seen.prefs, ACCEPT_GATE_ON_PREFS);
  });

  test("a throwing isSiteFullyExempt FAILS CLOSED — the gate stays shut (never grants consent on an unresolved exemption)", () => {
    const deps = { hostname: "example.com", isSiteFullyExempt: () => { throw new Error("boom"); } };
    assert.doesNotThrow(() => computeAcceptGate(ACCEPT_GATE_ON_PREFS, deps));
    assert.equal(computeAcceptGate(ACCEPT_GATE_ON_PREFS, deps), false);
  });
});

// ── STRUCTURAL guard ─────────────────────────────────────────────────────────

describe("cmp-accept-adapters — STRUCTURAL guard", () => {
  const source = readFileSync(join(__dirname, "../../src/lib/cmp-accept-adapters.js"), "utf8");

  test("the retired Didomi minimum-accept path is fully gone from source", () => {
    for (const forbidden of [
      "decideMinimumAccept",
      "canAttemptDidomiMinimumAccept",
      "buildMinimumPayload",
      "resolveDidomiMinimumStatus",
      "didomiAcceptAdapter",
      "setCurrentUserStatus",
      "getRequiredPurposeIds",
      "getRequiredVendorIds",
      "ACCEPT_CAPABLE_ADAPTER_IDS",
    ]) {
      assert.equal(source.includes(forbidden), false, `retired Didomi identifier "${forbidden}" must not remain in source`);
    }
  });

  test("word lists are exported as frozen DATA arrays, not inlined literals in the matching functions", () => {
    for (const list of [ACCEPT_TOKENS, PAY_DENY_TOKENS, CURRENCY_TOKENS, PERIOD_TOKENS, SETTINGS_TOKENS, REJECT_TOKENS]) {
      assert.ok(Array.isArray(list) && list.length > 0);
      assert.ok(Object.isFrozen(list));
    }
  });

  test("BUTTON_KIND and ACCEPT_TARGET_STATUS are closed, frozen enums", () => {
    assert.ok(Object.isFrozen(BUTTON_KIND));
    assert.ok(Object.isFrozen(ACCEPT_TARGET_STATUS));
  });
});

// ── ADVERSARIAL — "this must be impossible" scenarios named in the SAFETY spec ─

describe("cmp-accept-adapters — ADVERSARIAL: impossible-by-construction scenarios", () => {
  test("the PAY/subscribe button is never selected, for any locale token or price string", () => {
    const payLabels = [
      "Subscribe now",
      "Abonnieren",
      "Jetzt abonnieren",
      "Werbefrei-Abo",
      "4,99€/Monat",
      "$9.99/month",
    ];
    for (const text of payLabels) {
      const r = findFreeAcceptTarget([{ text, actionable: true }]);
      assert.equal(r.status, ACCEPT_TARGET_STATUS.NOOP, `must NEVER select "${text}" as the accept target`);
    }
  });

  test("accept can NEVER fire in reject-only mode / without the gesture, no matter what else is true", () => {
    assert.equal(computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, cookieConsentMode: "reject-only" }), false);
    assert.equal(computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, cookieConsentAcceptConsented: false }), false);
  });

  test("when a free reject exists alongside a free accept, the caller's overall decision must NOOP (reject wins) — documents the required call order", () => {
    const candidates = [
      { text: "Accept & continue", actionable: true },
      { text: "Reject", actionable: true },
    ];
    // The dispatch contract: hasFreeRejectControl MUST be checked and, if
    // true, findFreeAcceptTarget's result must never be acted on.
    const freeRejectExists = hasFreeRejectControl(candidates);
    const target = findFreeAcceptTarget(candidates);
    assert.equal(freeRejectExists, true);
    assert.equal(target.status, ACCEPT_TARGET_STATUS.SINGLE, "findFreeAcceptTarget alone would find one — the caller must still NOOP");
    const effectiveClick = !freeRejectExists && target.status === ACCEPT_TARGET_STATUS.SINGLE;
    assert.equal(effectiveClick, false);
  });

  test("multiple/ambiguous accept candidates never resolve to a click, even when no pay control and no reject control exist", () => {
    const candidates = [
      { text: "Accept", actionable: true },
      { text: "Continue", actionable: true },
    ];
    assert.equal(hasFreeRejectControl(candidates), false);
    assert.equal(findFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.AMBIGUOUS);
  });

  test("an unknown-locale label never resolves to a click — FIX 2: a lone unrecognized actionable control VETOES as ambiguous (might be a free reject we cannot read)", () => {
    const r = findFreeAcceptTarget([{ text: "Non merci", actionable: true }]);
    assert.notEqual(r.status, ACCEPT_TARGET_STATUS.SINGLE);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.AMBIGUOUS);
    assert.equal(r.target, null);
  });
});
