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
  findSpFreeAcceptTarget,
  findDidomiFreeAcceptTarget,
  hasFreeRejectControl,
  hasPayOption,
  isPaywallFrame,
  isDidomiPaywallContext,
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

  test("real-wall DE free-accept labels classify as ACCEPT (faz/sueddeutsche: 'einverstanden')", () => {
    // Captured on real Sourcepoint consent-or-pay walls (engram id 1339/1341):
    // faz.net "Einverstanden", sueddeutsche.de "Ich bin einverstanden".
    for (const text of ["Einverstanden", "Ich bin einverstanden", "Alle akzeptieren und weiter"]) {
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
    // NOTE: two phrases were retired from this unknown-locale list as the
    // module's coverage grew — "Continuar de todos modos" (ES "continuar" is
    // now an accept token) and "Non merci" (FR soft-decline, now a REJECT token
    // per the F1 negated-accept/soft-decline fix). Both are recognized labels
    // now, so neither is an unrecognized-locale example any longer. Dutch stays
    // outside this module's covered locales.
    assert.equal(classifyConsentButton("Toch doorgaan"), BUTTON_KIND.UNKNOWN);
    assert.equal(classifyConsentButton("Some unrelated label"), BUTTON_KIND.UNKNOWN);
  });

  test("FIX 3: accept tokens are WORD-BOUNDARY-safe — 'und weiter' does NOT match inside 'Verwendung und Weitergabe' (real welt.de collision)", () => {
    // The ad-partner data-sharing toggle "Verwendung und Weitergabe von
    // Nutzerkennungen zu Werbezwecken" (welt.de) is NOT a free-accept control;
    // the bare substring "und weiter" used to misclassify it as ACCEPT.
    assert.equal(
      classifyConsentButton("Verwendung und Weitergabe von Nutzerkennungen zu Werbezwecken"),
      BUTTON_KIND.UNKNOWN,
    );
  });

  test("FIX 3: 'consent' does NOT match inside 'Consenthub' (real Utiq partner-link collision)", () => {
    assert.equal(classifyConsentButton("Utiq Consenthub"), BUTTON_KIND.UNKNOWN);
  });

  test("FIX 3: the word-boundary tightening fixed the bare-substring 'continue'-inside-'continuer' false-match; the FR/ES/IT locale-widening slice later added 'continuer' itself as a genuine FR accept token", () => {
    // Previously documented as a KNOWN LIMITATION (bare-substring match) and
    // resolved by the word-boundary tightening (proven below:
    // "continuellement" still resolves UNKNOWN — "continue" does not
    // boundary-match inside it). Separately, the FR/ES/IT locale-widening
    // slice (see file docblock) added "continuer" as its own recognized FR
    // accept token, so "D'accord et continuer" now legitimately classifies
    // ACCEPT via that token — not via the old EN-token boundary bug.
    assert.equal(classifyConsentButton("D'accord et continuer"), BUTTON_KIND.ACCEPT);
    assert.equal(classifyConsentButton("Poursuite continuellement"), BUTTON_KIND.UNKNOWN);
  });

  test("FIX 3: word-boundary matching still accepts a legitimate free-accept label ('Continue to Europe', 'Accept & continue')", () => {
    assert.equal(classifyConsentButton("Continue to Europe"), BUTTON_KIND.ACCEPT);
    assert.equal(classifyConsentButton("Accept & continue"), BUTTON_KIND.ACCEPT);
    assert.equal(classifyConsentButton("Zustimmen und weiter"), BUTTON_KIND.ACCEPT);
  });

  test("FIX F4: the word boundary is Unicode-letter-aware — an accept token followed by an umlaut/accent is NOT a match", () => {
    // ASCII-only boundaries treated ä/ö/ü/ß as word boundaries, so "consent"
    // false-matched inside "Consentüberprüfung" (an SP compound label). Letters
    // (incl. umlauts/accents) must count as word chars, not boundaries.
    assert.equal(classifyConsentButton("Consentüberprüfung"), BUTTON_KIND.UNKNOWN);
    assert.equal(classifyConsentButton("Zustimmenüberprüfung erforderlich"), BUTTON_KIND.UNKNOWN);
    assert.equal(classifyConsentButton("Akzeptierenüberprüfung"), BUTTON_KIND.UNKNOWN);
  });

  test("FIX F4: real accented/umlaut-adjacent free-accept positives still classify ACCEPT", () => {
    for (const text of [
      "Accept & continue",
      "Zustimmen und weiter",
      "einverstanden",
      "Ich bin einverstanden",
      "Continue to Europe",
    ]) {
      assert.equal(classifyConsentButton(text), BUTTON_KIND.ACCEPT, text);
    }
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

// ── Locale widening: FR/ES/IT word-list DATA (comments-and-DATA-only slice) ─
//
// NOT yet real-site-verified (see the file's docblock honest note) — only
// the DE tokens have passed a real-EU headed smoke (faz.net, sueddeutsche.de).
// These tests prove the DATA classifies correctly in isolation; they do not
// claim real-wall verification for FR/ES/IT.

describe("classifyConsentButton — locale widening: FR accept tokens", () => {
  test("plain FR accept tokens classify ACCEPT", () => {
    for (const text of [
      "Accepter",
      "Tout accepter",
      "J'accepte",
      "Continuer",
      "Consentir",
    ]) {
      assert.equal(classifyConsentButton(text), BUTTON_KIND.ACCEPT, text);
    }
  });
});

describe("classifyConsentButton — locale widening: ES accept tokens", () => {
  test("plain ES accept tokens classify ACCEPT", () => {
    for (const text of [
      "Aceptar",
      "Aceptar todo",
      "Acepto",
      "Continuar",
      "Consentir",
      "Estoy de acuerdo",
    ]) {
      assert.equal(classifyConsentButton(text), BUTTON_KIND.ACCEPT, text);
    }
  });
});

describe("classifyConsentButton — locale widening: IT accept tokens", () => {
  test("plain IT accept tokens classify ACCEPT", () => {
    for (const text of ["Accetta", "Accetta tutto", "Acconsento", "Continua"]) {
      assert.equal(classifyConsentButton(text), BUTTON_KIND.ACCEPT, text);
    }
  });
});

describe("classifyConsentButton — locale widening: FR/ES/IT reject tokens veto (checked before accept, deny-wins)", () => {
  test("every new FR/ES/IT REJECT_TOKENS literal alone classifies as REJECT", () => {
    const NEW_REJECT_LOCALE_LABELS = [
      "Refuser",
      "Tout refuser",
      "Continuer sans accepter",
      "Poursuivre sans accepter",
      "Rechazar",
      "Rechazar todo",
      "Solo necesarias",
      "Solo esenciales",
      "Continuar sin aceptar",
      "Rifiuta",
      "Rifiuta tutto",
      "Solo necessari",
      "Continua senza accettare",
    ];
    for (const text of NEW_REJECT_LOCALE_LABELS) {
      assert.equal(classifyConsentButton(text), BUTTON_KIND.REJECT, text);
    }
  });
});

describe("classifyConsentButton — locale widening: FR/ES/IT settings tokens excluded before accept", () => {
  test("every new FR/ES/IT SETTINGS_TOKENS literal alone classifies as SETTINGS", () => {
    const NEW_SETTINGS_LOCALE_LABELS = [
      "Paramétrer",
      "Gérer",
      "Personnaliser",
      "Configurar",
      "Gestionar",
      "Preferencias",
      "Ajustes",
      "Personalizar",
      "Impostazioni",
      "Gestisci",
      "Personalizza",
    ];
    for (const text of NEW_SETTINGS_LOCALE_LABELS) {
      assert.equal(classifyConsentButton(text), BUTTON_KIND.SETTINGS, text);
    }
  });
});

describe("classifyConsentButton — locale widening: FR/ES/IT pay/deny tokens win over accept (deny-precedence unchanged)", () => {
  test("every new FR/ES/IT PAY_DENY_TOKENS literal alone classifies as PAY", () => {
    const NEW_PAY_LOCALE_LABELS = [
      "Abonnement",
      "S'abonner",
      "Payer",
      "Sans publicité",
      "Suscribir",
      "Suscripción",
      "Pagar",
      "Sin publicidad",
      "Abbonamento",
      "Abbonati",
      "Paga",
      "Senza pubblicità",
    ];
    for (const text of NEW_PAY_LOCALE_LABELS) {
      assert.equal(classifyConsentButton(text), BUTTON_KIND.PAY, text);
    }
  });

  test("ADVERSARIAL: an FR/ES/IT accept token co-occurring with a new pay token classifies as PAY (deny wins)", () => {
    assert.equal(classifyConsentButton("Accepter l'abonnement"), BUTTON_KIND.PAY);
    assert.equal(classifyConsentButton("Aceptar la suscripción"), BUTTON_KIND.PAY);
    assert.equal(classifyConsentButton("Accetta l'abbonamento"), BUTTON_KIND.PAY);
  });

  test("every new FR/ES/IT PERIOD_TOKENS literal alone classifies as PAY", () => {
    const NEW_PERIOD_LOCALE_LABELS = [
      "par mois",
      "par an",
      "al mes",
      "al año",
      "mensual",
      "anual",
      "al mese",
      "all'anno",
      "mensile",
      "annuale",
    ];
    for (const period of NEW_PERIOD_LOCALE_LABELS) {
      assert.equal(classifyConsentButton(`Continuer ${period}`), BUTTON_KIND.PAY, period);
    }
  });
});

describe("classifyConsentButton — locale widening: ADVERSARIAL collision negatives (a word CONTAINING an accept token substring must not classify accept)", () => {
  test("FR: 'Continuer sans accepter' / 'Poursuivre sans accepter' embed the accept tokens 'continuer'/'accepter' but classify REJECT (reject-literal precedence)", () => {
    assert.equal(classifyConsentButton("Continuer sans accepter"), BUTTON_KIND.REJECT);
    assert.equal(classifyConsentButton("Poursuivre sans accepter"), BUTTON_KIND.REJECT);
  });

  test("ES: 'Continuar sin aceptar' embeds the accept tokens 'continuar'/'aceptar' but classifies REJECT", () => {
    assert.equal(classifyConsentButton("Continuar sin aceptar"), BUTTON_KIND.REJECT);
  });

  test("IT: 'Continua senza accettare' embeds the accept token 'continua' (word-boundary-safe: 'accetta' does NOT match inside 'accettare') but classifies REJECT", () => {
    assert.equal(classifyConsentButton("Continua senza accettare"), BUTTON_KIND.REJECT);
  });

  test("'accetta' does not word-boundary-match inside 'accettare' on its own (no trailing reject context) — resolves UNKNOWN, never a false ACCEPT", () => {
    assert.equal(classifyConsentButton("Accettare"), BUTTON_KIND.UNKNOWN);
  });
});

// ── F1 (2026-07 adversarial review) — negated-accept / soft-decline labels ───
//
// A NEGATED accept ("No acepto", "Nicht akzeptieren", "Non acconsento") embeds
// an ACCEPT_TOKENS substring, and a bare decline ("No, gracias", "Non merci")
// matched nothing at all — so without an explicit reject token these classified
// ACCEPT or UNKNOWN and slipped past hasFreeRejectControl, silently defeating
// the L3 last-resort reject veto on a multi-control wall. They must classify
// REJECT.
describe("classifyConsentButton — F1: negated-accept / soft-decline labels classify REJECT (must never read as accept)", () => {
  const rejectLabels = [
    // ES
    "No acepto", "no acepto", "Seguir sin aceptar", "Navegar sin aceptar", "No, gracias", "No gracias",
    // DE
    "Nicht akzeptieren", "Nicht zustimmen", "Ohne zu akzeptieren", "Nein danke", "Nein, danke",
    // FR
    "Sans accepter", "Non merci", "Non, merci",
    // IT
    "Non acconsento", "Non accetto", "No accetto", "No grazie", "No, grazie",
    // EN
    "Do not accept", "Don't accept", "Without accepting", "No thanks", "No, thanks",
  ];
  for (const label of rejectLabels) {
    test(`"${label}" classifies REJECT, not ACCEPT/UNKNOWN`, () => {
      assert.equal(classifyConsentButton(label), BUTTON_KIND.REJECT);
    });
  }
});

// The concrete F1 fail-open this closes: a >=3-control Didomi wall whose free
// decline is a low-prominence "No acepto" anchor (no didomi-notice- id). Before
// the fix it classified accept, so hasFreeRejectControl returned false and the
// L3 last-resort veto was silently defeated even though a free reject existed.
describe("hasFreeRejectControl — F1: a negated-accept free-decline control still vetoes (L3 last-resort holds on dark-pattern layouts)", () => {
  test("agree + reject-and-pay + a free 'No acepto' anchor -> a free reject IS detected (veto)", () => {
    assert.equal(
      hasFreeRejectControl([
        { text: "Aceptar", actionable: true },
        { text: "Rechazar y suscribirse", actionable: true },
        { text: "No acepto", actionable: true },
      ]),
      true,
    );
  });

  test("DE dark-pattern: a free 'Nicht akzeptieren' link vetoes", () => {
    assert.equal(hasFreeRejectControl([{ text: "Nicht akzeptieren", actionable: true }]), true);
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

// ── findSpFreeAcceptTarget — SP-STRUCTURAL decision-button targeting (FIX 2) ─
//
// Candidate sets below mirror the REAL SP decision buttons captured on live EU
// consent-or-pay walls (engram id 1339/1341). Decision buttons carry an
// `spChoice` (the sp_choice_type_<N> suffix); incidental links carry spChoice:""
// (Datenschutz / Impressum / FAQ / Privacy Center / login) and must be ignored.

describe("findSpFreeAcceptTarget — real hard walls FIRE on the sp_choice_type_11 accept", () => {
  test("faz.net shape: [11 'Einverstanden'][link 'Kostenfrei testen'] + incidental links -> single, target is the type-11 accept", () => {
    const candidates = [
      { text: "Einverstanden", spChoice: "11", actionable: true, ref: "accept" },
      { text: "Kostenfrei testen", spChoice: "link", actionable: true, ref: "trial" },
      // incidental links (NO spChoice) — the exact class that used to veto every real wall:
      { text: "Datenschutzerklärung", spChoice: "", actionable: true, ref: "privacy" },
      { text: "Impressum", spChoice: "", actionable: true, ref: "imprint" },
      { text: "FAQ", spChoice: "", actionable: true, ref: "faq" },
      { text: "Privacy Center", spChoice: "", actionable: true, ref: "pc" },
    ];
    const r = findSpFreeAcceptTarget(candidates);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.SINGLE);
    assert.equal(r.target.ref, "accept");
  });

  test("sueddeutsche.de shape: [11 'Ich bin einverstanden'][9 'Jetzt testen'][9 'Login'] -> single, target is the type-11 accept", () => {
    const candidates = [
      { text: "Ich bin einverstanden", spChoice: "11", actionable: true, ref: "accept" },
      { text: "Jetzt testen", spChoice: "9", actionable: true, ref: "trial" },
      { text: "Login", spChoice: "9", actionable: true, ref: "login" },
      { text: "Jetzt kostenlos testen", spChoice: "5", actionable: false, ref: "hidden" },
    ];
    const r = findSpFreeAcceptTarget(candidates);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.SINGLE);
    assert.equal(r.target.ref, "accept");
  });

  test("FIX 2: incidental privacy/imprint/FAQ links NEVER trigger the ambiguity veto (the whole recalibration)", () => {
    const candidates = [
      { text: "Einwilligen und weiter", spChoice: "11", actionable: true, ref: "accept" },
      { text: "Jetzt abonnieren", spChoice: "9", actionable: true, ref: "pay" },
      { text: "unserer Datenschutzerklärung", spChoice: "", actionable: true },
      { text: "Некоторая ссылка", spChoice: "", actionable: true },
      { text: "", spChoice: "", actionable: true }, // an icon-only incidental control
    ];
    assert.equal(findSpFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.SINGLE);
  });
});

describe("findSpFreeAcceptTarget — safe VETOES (fail-closed within the SP decision set)", () => {
  test("zeit/spiegel/welt shape: a Settings (type 12) choice in the decision set -> ambiguous VETO (a free reject is reachable)", () => {
    const candidates = [
      { text: "Zustimmen und weiter", spChoice: "11", actionable: true, ref: "accept" },
      { text: "zeit.de werbefrei abonnieren", spChoice: "9", actionable: true, ref: "pay" },
      { text: "Einstellungen", spChoice: "12", actionable: true, ref: "settings" },
    ];
    assert.equal(findSpFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.AMBIGUOUS);
  });

  test("a Reject-all (type 13) choice in the decision set -> ambiguous VETO", () => {
    const candidates = [
      { text: "Alle akzeptieren", spChoice: "11", actionable: true, ref: "accept" },
      { text: "Abonnieren", spChoice: "9", actionable: true, ref: "pay" },
      { text: "Alle ablehnen", spChoice: "13", actionable: true, ref: "reject" },
    ];
    assert.equal(findSpFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.AMBIGUOUS);
  });

  test("a reject/settings TOKEN inside the decision set vetoes even if the choice-type is unusual", () => {
    const candidates = [
      { text: "Akzeptieren", spChoice: "11", actionable: true, ref: "accept" },
      { text: "Nur notwendige", spChoice: "7", actionable: true, ref: "reject" },
    ];
    assert.equal(findSpFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.AMBIGUOUS);
  });

  test("DENY-PRECEDENCE: a type-11 button whose text carries a price/pay token -> ambiguous VETO (never clicks a paid tier)", () => {
    const candidates = [
      { text: "Zustimmen für 9,99 EUR pro Monat", spChoice: "11", actionable: true, ref: "trap" },
      { text: "Weiter", spChoice: "9", actionable: true, ref: "other" },
    ];
    assert.equal(findSpFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.AMBIGUOUS);
  });

  test("no alternative decision button (a lone accept-all, no pay/login path) -> noop (not a consent-or-pay wall)", () => {
    const candidates = [{ text: "Akzeptieren", spChoice: "11", actionable: true, ref: "accept" }];
    assert.equal(findSpFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.NOOP);
  });

  test("two VISIBLE type-11 accept buttons -> ambiguous, never guesses", () => {
    const candidates = [
      { text: "Akzeptieren", spChoice: "11", actionable: true, ref: "a" },
      { text: "Einverstanden", spChoice: "11", actionable: true, ref: "b" },
      { text: "Abonnieren", spChoice: "9", actionable: true, ref: "pay" },
    ];
    assert.equal(findSpFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.AMBIGUOUS);
  });

  test("a hidden desktop/mobile duplicate type-11 is excluded; only the actionable one counts -> single", () => {
    const candidates = [
      { text: "Zustimmen und weiter", spChoice: "11", actionable: false, ref: "mobile-hidden" },
      { text: "Zustimmen und weiter", spChoice: "11", actionable: true, ref: "desktop-visible" },
      { text: "Abonnieren", spChoice: "9", actionable: true, ref: "pay" },
    ];
    const r = findSpFreeAcceptTarget(candidates);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.SINGLE);
    assert.equal(r.target.ref, "desktop-visible");
  });

  test("a wall with NO sp_choice_type_* decision buttons (generic frame) -> noop", () => {
    const candidates = [
      { text: "Continue", spChoice: "", actionable: true },
      { text: "Accept", spChoice: "", actionable: true },
    ];
    assert.equal(findSpFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.NOOP);
  });

  test("the click target is ALWAYS the type-11 accept — a pay/link choice is never returned", () => {
    const candidates = [
      { text: "Einverstanden", spChoice: "11", actionable: true, ref: "accept" },
      { text: "Kostenfrei testen", spChoice: "link", actionable: true, ref: "trial" },
    ];
    const r = findSpFreeAcceptTarget(candidates);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.SINGLE);
    assert.notEqual(r.target.ref, "trial");
    assert.equal(r.target.ref, "accept");
  });

  test("malformed/missing input never throws, resolves to noop", () => {
    assert.doesNotThrow(() => findSpFreeAcceptTarget(null));
    assert.doesNotThrow(() => findSpFreeAcceptTarget(undefined));
    assert.doesNotThrow(() => findSpFreeAcceptTarget([null, 42, "x", {}]));
    assert.equal(findSpFreeAcceptTarget(null).status, ACCEPT_TARGET_STATUS.NOOP);
    assert.equal(findSpFreeAcceptTarget([null, 42, "x", {}]).status, ACCEPT_TARGET_STATUS.NOOP);
  });
});

// ── findDidomiFreeAcceptTarget — Didomi TOP-frame decision-button targeting ─
//
// Candidate sets below mirror the REAL Didomi decision buttons captured on a
// 2026-07 live headed EU probe of Spanish newspapers (docs/DESIGN-cookie-
// consent-didomi-paywall-accept.md — lavanguardia/abc/elmundo). Decision
// buttons carry a stable `id` starting with `didomi-notice-`; incidental
// links (login, cookie policy, "our N partners") carry NO such id and must
// never veto.

describe("findDidomiFreeAcceptTarget — real hard walls FIRE on the didomi-notice-agree-button", () => {
  test("abc shape: agree + disagree-as-pay ('Rechazar y pagar'), NO learn-more -> single, target is the agree button", () => {
    const candidates = [
      { id: "didomi-notice-agree-button", text: "Aceptar y continuar", actionable: true, ref: "accept" },
      { id: "didomi-notice-disagree-button", text: "Rechazar y pagar", actionable: true, ref: "pay" },
    ];
    const r = findDidomiFreeAcceptTarget(candidates);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.SINGLE);
    assert.equal(r.target.ref, "accept");
  });

  test("incidental links (no didomi-notice- id, e.g. 'Iniciar sesión'/'Política de cookies') never veto", () => {
    const candidates = [
      { id: "didomi-notice-agree-button", text: "Aceptar", actionable: true, ref: "accept" },
      { id: "didomi-notice-disagree-button", text: "Rechazar y suscribirse", actionable: true, ref: "pay" },
      { id: "", text: "Iniciar sesión", actionable: true },
      { id: "some-other-widget-login", text: "Ver nuestros 764 socios", actionable: true },
      { id: "", text: "Política de cookies", actionable: true },
    ];
    const r = findDidomiFreeAcceptTarget(candidates);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.SINGLE);
    assert.equal(r.target.ref, "accept");
  });

  test("elmundo shape: a duplicate custom ue-accept-notice-button (no didomi-notice- id) does not create a second accept in scope -> single", () => {
    const candidates = [
      { id: "ue-accept-notice-button", text: "Aceptar y continuar", actionable: true, ref: "ue-accept" },
      { id: "didomi-notice-agree-button", text: "Aceptar y continuar", actionable: true, ref: "accept" },
      { id: "ue-disagree-notice-button", text: "Rechazar y suscribirse", actionable: true, ref: "ue-disagree" },
      { id: "didomi-notice-disagree-button", text: "Rechazar y suscribirse", actionable: true, ref: "pay" },
    ];
    const r = findDidomiFreeAcceptTarget(candidates);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.SINGLE);
    assert.equal(r.target.ref, "accept");
  });
});

describe("findDidomiFreeAcceptTarget — safe VETOES (fail-closed within the didomi-notice- scope)", () => {
  test("ABSTAIN-on-learn-more BY ID: lavanguardia shape with a learn-more button whose label ('Más información') does NOT match SETTINGS_TOKENS still vetoes", () => {
    const candidates = [
      { id: "didomi-notice-agree-button", text: "Aceptar y continuar", actionable: true, ref: "accept" },
      { id: "didomi-notice-disagree-button", text: "Rechazar y suscribirse", actionable: true, ref: "pay" },
      { id: "didomi-notice-learn-more-button", text: "Más información", actionable: true, ref: "settings" },
    ];
    // Prove the label alone does not classify as settings (the key finding) —
    // the veto below must therefore come from the ID guard, not the token one.
    assert.equal(classifyConsentButton("Más información"), BUTTON_KIND.UNKNOWN);
    assert.equal(findDidomiFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.AMBIGUOUS);
  });

  test("a non-actionable (hidden) learn-more button does not veto", () => {
    const candidates = [
      { id: "didomi-notice-agree-button", text: "Aceptar", actionable: true, ref: "accept" },
      { id: "didomi-notice-disagree-button", text: "Rechazar y suscribirse", actionable: true, ref: "pay" },
      { id: "didomi-notice-learn-more-button", text: "Más información", actionable: false, ref: "hidden-settings" },
    ];
    const r = findDidomiFreeAcceptTarget(candidates);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.SINGLE);
    assert.equal(r.target.ref, "accept");
  });

  test("FREE-REJECT-DISAGREE: a bare 'Rechazar' (no pay/subscribe token) on the disagree button -> ambiguous (a free reject is reachable)", () => {
    const candidates = [
      { id: "didomi-notice-agree-button", text: "Aceptar y continuar", actionable: true, ref: "accept" },
      { id: "didomi-notice-disagree-button", text: "Rechazar", actionable: true, ref: "reject" },
    ];
    assert.equal(findDidomiFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.AMBIGUOUS);
  });

  test("DENY-PRECEDENCE: the agree button itself carrying a pay/price token -> ambiguous VETO (never clicks a paid tier)", () => {
    const candidates = [
      { id: "didomi-notice-agree-button", text: "Aceptar por 9,99 EUR al mes", actionable: true, ref: "trap" },
      { id: "didomi-notice-disagree-button", text: "Rechazar y suscribirse", actionable: true, ref: "pay" },
    ];
    assert.equal(findDidomiFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.AMBIGUOUS);
  });

  test("two VISIBLE didomi-notice-agree-button candidates -> ambiguous, never guesses", () => {
    const candidates = [
      { id: "didomi-notice-agree-button", text: "Aceptar", actionable: true, ref: "a" },
      { id: "didomi-notice-agree-button", text: "Aceptar y continuar", actionable: true, ref: "b" },
      { id: "didomi-notice-disagree-button", text: "Rechazar y suscribirse", actionable: true, ref: "pay" },
    ];
    assert.equal(findDidomiFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.AMBIGUOUS);
  });

  test("a hidden responsive duplicate agree button is excluded; only the actionable one counts -> single", () => {
    const candidates = [
      { id: "didomi-notice-agree-button", text: "Aceptar", actionable: false, ref: "mobile-hidden" },
      { id: "didomi-notice-agree-button", text: "Aceptar", actionable: true, ref: "desktop-visible" },
      { id: "didomi-notice-disagree-button", text: "Rechazar y suscribirse", actionable: true, ref: "pay" },
    ];
    const r = findDidomiFreeAcceptTarget(candidates);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.SINGLE);
    assert.equal(r.target.ref, "desktop-visible");
  });

  test("ZERO decision: no didomi-notice-* candidates at all -> noop", () => {
    const candidates = [
      { id: "", text: "Iniciar sesión", actionable: true },
      { id: "some-widget", text: "Aceptar", actionable: true },
    ];
    assert.equal(findDidomiFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.NOOP);
  });

  test("NO-ALTERNATIVE: a lone agree button with no other didomi-notice-* decision control -> noop (not a consent-or-pay wall)", () => {
    const candidates = [{ id: "didomi-notice-agree-button", text: "Aceptar", actionable: true, ref: "accept" }];
    assert.equal(findDidomiFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.NOOP);
  });

  test("zero actionable agree candidates (disagree present) -> noop", () => {
    const candidates = [
      { id: "didomi-notice-agree-button", text: "Aceptar", actionable: false, ref: "hidden" },
      { id: "didomi-notice-disagree-button", text: "Rechazar y suscribirse", actionable: true, ref: "pay" },
    ];
    assert.equal(findDidomiFreeAcceptTarget(candidates).status, ACCEPT_TARGET_STATUS.NOOP);
  });

  test("malformed/missing input never throws, resolves to noop", () => {
    assert.doesNotThrow(() => findDidomiFreeAcceptTarget(null));
    assert.doesNotThrow(() => findDidomiFreeAcceptTarget(undefined));
    assert.doesNotThrow(() => findDidomiFreeAcceptTarget([null, 42, "x", {}]));
    assert.equal(findDidomiFreeAcceptTarget(null).status, ACCEPT_TARGET_STATUS.NOOP);
    assert.equal(findDidomiFreeAcceptTarget([null, 42, "x", {}]).status, ACCEPT_TARGET_STATUS.NOOP);
  });
});

// ── isDidomiPaywallContext — Didomi TOP-frame consent-or-pay context match ──

describe("isDidomiPaywallContext", () => {
  const PAY_CANDIDATES = [
    { id: "didomi-notice-agree-button", text: "Aceptar y continuar", actionable: true },
    { id: "didomi-notice-disagree-button", text: "Rechazar y suscribirse", actionable: true },
  ];

  test("top-frame + #didomi-host confirmed + a scoped pay-classified candidate -> true", () => {
    assert.equal(
      isDidomiPaywallContext({ isTopFrame: true, hasDidomiHost: true, candidates: PAY_CANDIDATES }),
      true,
    );
  });

  test("missing #didomi-host -> false, even with top-frame + pay signal", () => {
    assert.equal(
      isDidomiPaywallContext({ isTopFrame: true, hasDidomiHost: false, candidates: PAY_CANDIDATES }),
      false,
    );
  });

  test("NOT the top frame -> false (Didomi's banner never renders in a subframe)", () => {
    assert.equal(
      isDidomiPaywallContext({ isTopFrame: false, hasDidomiHost: true, candidates: PAY_CANDIDATES }),
      false,
    );
  });

  test("no pay signal (a plain accept/reject banner, no pay path) -> false — the reject engine owns this case", () => {
    const candidates = [
      { id: "didomi-notice-agree-button", text: "Aceptar", actionable: true },
      { id: "didomi-notice-disagree-button", text: "Rechazar", actionable: true },
    ];
    assert.equal(isDidomiPaywallContext({ isTopFrame: true, hasDidomiHost: true, candidates }), false);
  });

  test("an undeterminable frame identity (isTopFrame neither true nor false) fails closed to false", () => {
    assert.equal(isDidomiPaywallContext({ isTopFrame: undefined, hasDidomiHost: true, candidates: PAY_CANDIDATES }), false);
    assert.equal(isDidomiPaywallContext({}), false);
  });

  test("malformed/missing input never throws, resolves to false", () => {
    assert.doesNotThrow(() => isDidomiPaywallContext(null));
    assert.equal(isDidomiPaywallContext(null), false);
    assert.equal(isDidomiPaywallContext(undefined), false);
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

  // ── FIX 1 — the REAL percent-encoded consent_origin marker ────────────────
  // Captured verbatim from real EU Sourcepoint walls (engram id 1339/1341):
  // `consent/tcfv2` appears ONLY as `consent%2Ftcfv2` nested in consent_origin=.
  // The old literal-only match returned false on ALL of these (the empirical
  // reason the mode never fired). isPaywallFrame must now match them.
  const REAL_SP_FRAME_URLS = [
    "https://sp-spiegel-de.spiegel.de/index.html?hasCsp=true&message_id=1426772&consentUUID=null&consent_origin=https%3A%2F%2Fsp-spiegel-de.spiegel.de%2Fconsent%2Ftcfv2&preload_message=true&version=v1&consentLanguage=de",
    "https://consent.up.welt.de/index.html?hasCsp=true&message_id=1490207&consentUUID=null&consent_origin=https%3A%2F%2Fconsent.up.welt.de%2Fconsent%2Ftcfv2&version=v1",
    "https://consent-cdn.sueddeutsche.de/index.html?hasCsp=true&message_id=1495788&consentUUID=null&consent_origin=https%3A%2F%2Fconsent-cdn.sueddeutsche.de%2Fconsent%2Ftcfv2",
  ];

  for (const url of REAL_SP_FRAME_URLS) {
    test(`FIX 1: a real SP frame URL with the percent-encoded consent%2Ftcfv2 marker -> true (${url.split("/")[2]})`, () => {
      assert.equal(isPaywallFrame({ isTopFrame: false, frameUrl: url }), true);
    });
  }

  test("FIX 1: still false when hasCsp is present but there is no consent/tcfv2 marker in any form", () => {
    assert.equal(
      isPaywallFrame({ isTopFrame: false, frameUrl: "https://x.example.com/f.html?hasCsp=true&consent_origin=https%3A%2F%2Fx.example.com%2Fother" }),
      false,
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
    // Dutch "Toch doorgaan" — outside this module's covered locales, so it
    // classifies UNKNOWN (unlike "Non merci", now a recognized REJECT token).
    const r = findFreeAcceptTarget([{ text: "Toch doorgaan", actionable: true }]);
    assert.notEqual(r.status, ACCEPT_TARGET_STATUS.SINGLE);
    assert.equal(r.status, ACCEPT_TARGET_STATUS.AMBIGUOUS);
    assert.equal(r.target, null);
  });
});

// PROPERTY: deny-precedence must hold across the ENTIRE ACCEPT_TOKENS ×
// PAY_DENY_TOKENS cross-product, not just the sampled adversarial cases above.
// A label carrying BOTH an accept word and a pay/subscribe word (in either
// order) is a pay control and must NEVER classify "accept" — otherwise a pay
// button labelled with an accept word (e.g. "Accept subscription") could be
// clicked, committing the user. This exhaustively proves the pay check runs
// before, and wins over, the accept check for every token pair.
describe("PROPERTY: deny-precedence over the full ACCEPT x PAY_DENY cross-product", () => {
  test("every accept-token + pay-token label classifies as pay (both orderings), never accept", () => {
    const failures = [];
    for (const accept of ACCEPT_TOKENS) {
      for (const pay of PAY_DENY_TOKENS) {
        for (const label of [`${accept} ${pay}`, `${pay} ${accept}`]) {
          const kind = classifyConsentButton(label);
          if (kind !== "pay") failures.push(`"${label}" -> ${kind}`);
        }
      }
    }
    assert.deepEqual(
      failures,
      [],
      `deny-precedence must make every accept+pay label classify "pay":\n${failures.slice(0, 20).join("\n")}`
    );
  });
});
