/**
 * MUGA: Cookie Consent Minimizer — isolated-world gatekeeper (#1027)
 *
 * Reads the user's prefs, computes the disabled-state gate, and controls
 * the MAIN-world caller (content/cookie-noise-mainworld.js, Chrome MV3
 * only) via a nonce-gated CustomEvent handshake on a channel SEPARATE
 * from `muga:history-gate` — this feature's pref (`cookieConsentMode`,
 * default "reject-only" for new installs) is independent from
 * `activeDefenseEnabled` (default ON); sharing a gate would conflate two
 * independent opt-ins.
 *
 * On Firefox MV2 (no `world: "MAIN"` support) this script ALSO performs
 * the reject call directly, reaching the page's real OneTrust object via
 * `window.wrappedJSObject` — no cross-world event bridge is needed there
 * because gatekeeper and caller share the same world. Dormant on Chrome.
 *
 * The detection + confidence-gate logic below is a hand-maintained COPY
 * of the block in src/lib/cmp-adapters.js between the `@sync` markers
 * (content scripts cannot use ES module imports — see AGENTS.md). Kept in
 * sync by tests/unit/cookie-noise-sync.test.mjs. Same ethical-spine rule
 * as that file applies here: this source, including every comment,
 * intentionally avoids the word for "granting broad consent" — do not
 * introduce it. See src/lib/cmp-adapters.js's docblock for the full
 * rationale and the structural guard that enforces it.
 *
 * Runs in the isolated world (Chrome + Firefox). In the TOP frame, listed
 * after content/cleaner-bundle.js in the manifest so `window.__mugaCleaner`
 * is already attached when the gate first opens (needed for the
 * `isSiteFullyExempt` per-site exemption check). `window.__mugaCleaner` is
 * NOT attached in child frames (cleaner-bundle.js stays top-frame-only) —
 * computeGate() below resolves the TOP frame's real hostname instead (see
 * the `@sync:frame-host` block) and checks the exemption with a
 * per-frame-safe, prefs-only copy of the real predicate (see the
 * `@sync:site-exempt` block), so a user's per-site pause is still honored
 * inside a cross-origin consent-or-pay dialog iframe
 * (cookie-consent-all-frames FIX A). Fail-closed: an undeterminable
 * top-frame hostname is treated as exempt rather than risk opening the
 * gate against the user's pause.
 *
 * Cross-origin-iframe scope (deliberate, scoped change): this script is
 * registered `all_frames: true` in the manifest, IN ITS OWN dedicated
 * content_scripts entry — every other content script stays top-frame-only.
 * A real-site frame-location probe found that consent-or-pay wall dialogs
 * (Sourcepoint's `sp_message_container` message iframe, hosted on a
 * dedicated cross-origin subdomain) render in a CROSS-ORIGIN CHILD FRAME,
 * not the top frame — so a top-frame-only script can never reach the
 * dialog's own buttons. The previous same-frame-only guard below (an early
 * return keyed on frame identity) was REMOVED for this reason. `all_frames`
 * is not a new permission — MUGA already holds `<all_urls>` host
 * permission, which already covers every frame; no new user-facing
 * permission prompt results from this change. The module now runs once
 * per frame (ads, embeds, same-origin iframes, cross-origin consent
 * iframes) — see the bounded give-up window
 * below and the defensive try/catch wrapper immediately below, both of
 * which keep this cheap and safe when a frame has no matching CMP.
 */

(function () {
  "use strict";

  try {
  if (window.__mugaCookieNoiseGate) return;
  window.__mugaCookieNoiseGate = true;

  // @sync:cmp-adapters:start
  const CONFIDENCE_THRESHOLD = 1;

  function detectOneTrust(signals) {
    if (!signals || signals.hasOneTrustGlobal !== true || signals.hasRejectAllFn !== true) {
      return 0;
    }
    const secondary =
      (signals.hasBannerDom === true ? 1 : 0) +
      (signals.hasActiveGroupsGlobal === true ? 1 : 0) +
      (signals.hasRejectHandlerDom === true ? 1 : 0);
    return secondary >= 1 ? 1 : 0.4;
  }

  function canRejectOneTrust(signals) {
    return detectOneTrust(signals) >= CONFIDENCE_THRESHOLD;
  }

  function detectCookiebot(signals) {
    if (!signals || signals.hasCookiebotGlobal !== true || signals.hasSubmitCustomConsentFn !== true) {
      return 0;
    }
    const secondary =
      (signals.hasCybotDialogDom === true ? 1 : 0) +
      (signals.hasConsentObjectGlobal === true ? 1 : 0) +
      (signals.hasResponseBooleanGlobal === true ? 1 : 0);
    return secondary >= 1 ? 1 : 0.4;
  }

  function canRejectCookiebot(signals) {
    return detectCookiebot(signals) >= CONFIDENCE_THRESHOLD;
  }

  function detectDidomi(signals) {
    if (!signals || signals.hasDidomiGlobal !== true || signals.hasSetUserDisagreeToAllFn !== true) {
      return 0;
    }
    const secondary =
      (signals.hasDidomiHostDom === true ? 1 : 0) +
      (signals.hasGetCurrentUserStatusFn === true ? 1 : 0);
    return secondary >= 1 ? 1 : 0.4;
  }

  function canRejectDidomi(signals) {
    return detectDidomi(signals) >= CONFIDENCE_THRESHOLD;
  }

  function detectCookieYes(signals) {
    if (
      !signals ||
      signals.hasGetCkyConsentFn !== true ||
      signals.hasPerformBannerActionFn !== true
    ) {
      return 0;
    }
    const secondary =
      (signals.hasCkyConsentContainerDom === true ? 1 : 0) +
      (signals.hasCkyOverlayDom === true ? 1 : 0) +
      (signals.hasCkyConsentBarDom === true ? 1 : 0);
    return secondary >= 1 ? 1 : 0.4;
  }

  function canRejectCookieYes(signals) {
    return detectCookieYes(signals) >= CONFIDENCE_THRESHOLD;
  }

  // Sourcepoint (#1123): __tcfapi is generic to ALL TCF-compliant CMPs
  // (including Didomi above), so it can never be the sole mandatory anchor.
  // Both hasTcfApiFn AND the Sourcepoint-specific DOM signal
  // (div[id^="sp_message_container"]) are mandatory together — see the
  // TCF-generic-signal discrimination rationale above detectCookieYes.
  function detectSourcepoint(signals) {
    if (!signals || signals.hasTcfApiFn !== true || signals.hasSpMessageContainerDom !== true) {
      return 0;
    }
    const secondary =
      (signals.hasSpPrivacyMgmtIframeDom === true ? 1 : 0) +
      (signals.hasSpProdIframeDom === true ? 1 : 0) +
      (signals.hasSpProdScriptDom === true ? 1 : 0);
    return secondary >= 1 ? 1 : 0.4;
  }

  function canRejectSourcepoint(signals) {
    return detectSourcepoint(signals) >= CONFIDENCE_THRESHOLD;
  }

  // Usercentrics (#1121): window.UC_UI is a vendor-namespaced global (like
  // Didomi's window.Didomi), NOT a shared/generic surface like __tcfapi and
  // NOT a bare global like CookieYes's — so this mirrors detectDidomi's
  // shape (mandatory global + mandatory reject-fn signal, plus >=1
  // corroborating secondary signal).
  function detectUsercentrics(signals) {
    if (!signals || signals.hasUcUiGlobal !== true || signals.hasDenyAllConsentsFn !== true) {
      return 0;
    }
    const secondary =
      (signals.hasUsercentricsRootDom === true ? 1 : 0) +
      (signals.hasIsInitializedFn === true ? 1 : 0);
    return secondary >= 1 ? 1 : 0.4;
  }

  function canRejectUsercentrics(signals) {
    return detectUsercentrics(signals) >= CONFIDENCE_THRESHOLD;
  }

  // Cookie Information: window.CookieInformation is a vendor-namespaced
  // global (like OneTrust/Didomi/UC_UI), so this mirrors detectDidomi's shape
  // (mandatory global + mandatory reject-fn signal, plus >=1 corroborating
  // secondary signal). Do NOT key off __tcfapi — see the discrimination
  // rationale above detectCookieInformation in the docblock preceding this
  // sync block.
  function detectCookieInformation(signals) {
    if (
      !signals ||
      signals.hasCookieInformationGlobal !== true ||
      signals.hasDeclineAllCategoriesFn !== true
    ) {
      return 0;
    }
    const secondary =
      (signals.hasCoiOverlayDom === true ? 1 : 0) +
      (signals.hasCoiConsentBannerDom === true ? 1 : 0) +
      (signals.hasCoiSummeryDom === true ? 1 : 0) +
      (signals.hasCoiBannerWrapperDom === true ? 1 : 0) +
      (signals.hasCoiConsentSummaryDom === true ? 1 : 0);
    return secondary >= 1 ? 1 : 0.4;
  }

  function canRejectCookieInformation(signals) {
    return detectCookieInformation(signals) >= CONFIDENCE_THRESHOLD;
  }

  // CookieScript: the reject call lives on window.CookieScript.instance, not
  // directly on the vendor global — see the TRIPLE-mandatory-gate rationale
  // above detectCookieScript in the docblock preceding this sync block.
  function detectCookieScript(signals) {
    if (
      !signals ||
      signals.hasCookieScriptGlobal !== true ||
      signals.hasCookieScriptInstance !== true ||
      signals.hasRejectAllActionFn !== true
    ) {
      return 0;
    }
    const secondary =
      (signals.hasCookiescriptInjectedDom === true ? 1 : 0) +
      (signals.hasCookiescriptDescriptionDom === true ? 1 : 0);
    return secondary >= 1 ? 1 : 0.4;
  }

  function canRejectCookieScript(signals) {
    return detectCookieScript(signals) >= CONFIDENCE_THRESHOLD;
  }

  // tarteaucitron: the reject call lives on window.tarteaucitron.userInterface,
  // not directly on the vendor global — see the TRIPLE-mandatory-gate
  // rationale above detectTarteaucitron in the docblock preceding this sync
  // block.
  function detectTarteaucitron(signals) {
    if (
      !signals ||
      signals.hasTarteaucitronGlobal !== true ||
      signals.hasTarteaucitronUserInterface !== true ||
      signals.hasRespondAllFn !== true
    ) {
      return 0;
    }
    const secondary =
      (signals.hasTarteaucitronRootDom === true ? 1 : 0) +
      (signals.hasTarteaucitronAlertBigDom === true ? 1 : 0) +
      (signals.hasTarteaucitronBackDom === true ? 1 : 0) +
      (signals.hasTarteaucitronModalOpenDom === true ? 1 : 0);
    return secondary >= 1 ? 1 : 0.4;
  }

  function canRejectTarteaucitron(signals) {
    return detectTarteaucitron(signals) >= CONFIDENCE_THRESHOLD;
  }

  // consentmanager.net: __cmp is the legacy IAB TCF v1.1 generic surface
  // every v1.1-era CMP can expose, so it can never be the sole mandatory
  // anchor — see the dual-anchor discrimination rationale above
  // detectSourcepoint. hasCmpMngrGlobal AND hasCmpFn AND hasCmpBoxDom are all
  // mandatory together (see the TRIPLE-mandatory rationale in the docblock
  // preceding this sync block).
  function detectConsentmanager(signals) {
    if (
      !signals ||
      signals.hasCmpMngrGlobal !== true ||
      signals.hasCmpFn !== true ||
      signals.hasCmpBoxDom !== true
    ) {
      return 0;
    }
    const secondary =
      (signals.hasCmpWelcomeBtnYesDom === true ? 1 : 0) +
      (signals.hasCmpWelcomeBtnNoDom === true ? 1 : 0) +
      (signals.hasCmpBoxBtnDom === true ? 1 : 0);
    return secondary >= 1 ? 1 : 0.4;
  }

  function canRejectConsentmanager(signals) {
    return detectConsentmanager(signals) >= CONFIDENCE_THRESHOLD;
  }
  // @sync:cmp-adapters:end

  // Cookie Consent Minimizer — consent-or-pay-wall accept-click
  // (cookie-consent-paywall-accept). ALL accept logic lives in the pure
  // sibling lib module (src/lib/cmp-accept-adapters.js); the fenced block
  // directly below is a hand-maintained COPY of its button-discrimination
  // primitives (content scripts cannot use ES module imports — AGENTS.md).
  // Kept in sync by tests/unit/cookie-noise-sync.test.mjs. World-agnostic
  // and pure — never touches `window`/`document` itself; the dispatch
  // region further below supplies the real DOM reads and the click.
  //
  // This is the ONE and ONLY place this mechanism runs (isolated world,
  // both Chrome and Firefox — all_frames:true already covers both via this
  // file). A DOM `element.click()` needs neither a page-authored global nor
  // the MAIN world, unlike the retired Didomi JS-API accept path, so there
  // is no cross-world fork here at all.
  //
  // HONEST NOTE: the word-list DATA below now also covers FR/ES/IT tokens
  // (locale widening), NOT yet real-site-verified — see the "Slice scope" /
  // "HONEST NOTE" paragraphs in src/lib/cmp-accept-adapters.js's own
  // docblock for the full statement; only DE has passed a real-EU headed
  // smoke test so far.
  // @sync:cmp-accept-veto:start
  const ACCEPT_TOKENS = Object.freeze([
    "accept",
    "agree",
    "consent",
    "continue",
    "zustimmen",
    "einwilligen",
    "einverstanden",
    "akzeptieren",
    "und weiter",
    "annehmen",
    // FR/ES/IT locale widening (NOT yet real-site-verified — see file docblock).
    "accepter",
    "tout accepter",
    "j'accepte",
    "continuer",
    "consentir", // shared FR/ES spelling
    "aceptar",
    "aceptar todo",
    "acepto",
    "continuar",
    "estoy de acuerdo",
    "accetta",
    "accetta tutto",
    "acconsento",
    "continua",
  ]);

  const PAY_DENY_TOKENS = Object.freeze([
    "abo",
    "abonnieren",
    "abonnement",
    "pur",
    "werbefrei",
    "subscribe",
    "subscription",
    "pay",
    "bezahlen",
    "kaufen",
    "zahlungspflichtig",
    // FR/ES/IT locale widening (NOT yet real-site-verified — see file docblock).
    "s'abonner",
    "payer",
    "sans publicité",
    "suscribir",
    "suscripción",
    "pagar",
    "sin publicidad",
    "abbonamento",
    "abbonati",
    "paga",
    "senza pubblicità",
  ]);

  const CURRENCY_TOKENS = Object.freeze(["€", "$", "£"]);

  // ISO currency codes matched WORD-BOUNDARY-SAFE (not bare substring): a plain
  // `.includes("eur")` would false-positive "europe"/"neural", so these count
  // only when flanked by non-alphanumeric boundaries (see
  // containsWordBoundaryToken). Lowercase — text is normalized before matching.
  const CURRENCY_CODE_TOKENS = Object.freeze(["eur", "usd", "gbp", "chf"]);

  const PERIOD_TOKENS = Object.freeze([
    "/monat",
    "/month",
    "/mo",
    "/jahr",
    "pro monat",
    "im monat",
    "monatlich",
    "pro jahr",
    "jährlich",
    "per month",
    "a month",
    "per year",
    "a year",
    // FR/ES/IT locale widening (NOT yet real-site-verified — see file docblock).
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
  ]);

  const SETTINGS_TOKENS = Object.freeze([
    "einstellungen",
    "settings",
    "manage",
    "options",
    "preferences",
    "customize",
    // FR/ES/IT locale widening (NOT yet real-site-verified — see file docblock).
    "paramétrer",
    "gérer",
    "personnaliser",
    "configurar",
    "gestionar",
    "preferencias",
    "ajustes",
    "personalizar",
    "impostazioni",
    "gestisci",
    "personalizza",
  ]);

  const REJECT_TOKENS = Object.freeze([
    "ablehnen",
    "nur notwendige",
    "nur erforderliche",
    "nur essenzielle",
    "nur essentielle",
    "ohne einwilligung fortfahren",
    "weiterlesen ohne zustimmung",
    "reject",
    "decline",
    "refuse",
    "disagree",
    "do not consent",
    "continue without agreeing",
    "continue without accepting",
    "necessary only",
    "only necessary",
    "essential only",
    // FR/ES/IT locale widening (NOT yet real-site-verified — see file docblock).
    // NOTE: "continuer sans accepter" / "continuar sin aceptar" / "continua
    // senza accettare" deliberately embed an ACCEPT_TOKENS substring
    // ("continuer"/"continuar"/"continua", plus "accepter"/"aceptar" in the FR/
    // ES phrasing) — REJECT_TOKENS is checked BEFORE ACCEPT_TOKENS in
    // classifyConsentButton, so the literal reject phrase always wins
    // (deny-wins precedence). See tests/unit/cmp-accept-adapters.test.mjs's
    // "ADVERSARIAL collision negatives" group for the explicit proof.
    "refuser",
    "tout refuser",
    "continuer sans accepter",
    "poursuivre sans accepter",
    "rechazar",
    "rechazar todo",
    "solo necesarias",
    "solo esenciales",
    "continuar sin aceptar",
    "rifiuta",
    "rifiuta tutto",
    "solo necessari",
    "continua senza accettare",
  ]);

  function normalizeButtonText(rawText) {
    return typeof rawText === "string" ? rawText.trim().toLowerCase() : "";
  }

  function containsAnyToken(text, tokens) {
    for (const token of tokens) {
      if (text.includes(token)) return true;
    }
    return false;
  }

  // Word-boundary token match: a token counts only when it is NOT embedded in a
  // larger word run. "Word" chars are Unicode LETTERS (incl. umlauts/accents such
  // as ä/ö/ü/ß) and digits — an ASCII-only [a-z0-9] boundary wrongly treated an
  // umlaut as a boundary, so "consent" false-matched inside "consentüberprüfung"
  // (F4). So "eur" matches "9,99 eur" but never "europe", and "consent" never
  // matches inside "consentüberprüfung".
  function containsWordBoundaryToken(text, tokens) {
    for (const token of tokens) {
      let from = 0;
      let idx = text.indexOf(token, from);
      while (idx !== -1) {
        const before = idx === 0 ? "" : text.charAt(idx - 1);
        const after = text.charAt(idx + token.length);
        const boundedBefore = before === "" || !/[\p{L}\p{N}]/u.test(before);
        const boundedAfter = after === "" || !/[\p{L}\p{N}]/u.test(after);
        if (boundedBefore && boundedAfter) return true;
        from = idx + 1;
        idx = text.indexOf(token, from);
      }
    }
    return false;
  }

  function hasPriceIndicator(text) {
    return (
      containsAnyToken(text, CURRENCY_TOKENS) ||
      containsAnyToken(text, PERIOD_TOKENS) ||
      containsWordBoundaryToken(text, CURRENCY_CODE_TOKENS)
    );
  }

  // classifyConsentButton takes BOTH the control's accessible name (rawText —
  // what identifies accept/reject/settings intent) AND its full text (rawFull —
  // accessible name + visible textContent + value). The PAY/price/deny scan runs
  // over the FULL text so an aria-label that omits the price cannot hide a paid
  // tier (M1); the accept/reject/settings intent still keys off the accessible
  // name. rawFull defaults to rawText when omitted (plain-data callers/tests).
  function classifyConsentButton(rawText, rawFull) {
    const text = normalizeButtonText(rawText);
    const full = normalizeButtonText(rawFull === undefined || rawFull === null ? rawText : rawFull);
    const payScan = full.length > 0 ? full : text;
    if (containsAnyToken(payScan, PAY_DENY_TOKENS) || hasPriceIndicator(payScan)) return "pay";
    if (!text) return "unknown";
    if (containsAnyToken(text, SETTINGS_TOKENS)) return "settings";
    if (containsAnyToken(text, REJECT_TOKENS)) return "reject";
    // ACCEPT is matched WORD-BOUNDARY-SAFE (not bare substring): a bare
    // `.includes("und weiter")` false-matches inside "Verwendung und Weitergabe"
    // and `.includes("consent")` inside "Consenthub" (both observed on real SP
    // walls — engram id 1339/1341). Boundaries keep "und weiter" from matching
    // "…und Weitergabe" and "consent" from "Consenthub", while still matching a
    // real free-accept label. PAY/SETTINGS/REJECT stay bare substring on purpose:
    // over-matching those only ever produces MORE vetoes (the safe direction).
    if (containsWordBoundaryToken(text, ACCEPT_TOKENS)) return "accept";
    return "unknown";
  }

  // findFreeAcceptTarget clicks a button ONLY when EXACTLY ONE actionable
  // candidate classifies as a free-accept control AND every other actionable
  // candidate is classifiable. FAIL-CLOSED: an actionable control we cannot
  // classify (icon-only, empty text, unrecognized locale) might itself be a free
  // reject/settings path we simply failed to read — its mere presence VETOES the
  // whole accept (returns ambiguous), never a guess. Zero or more than one
  // surviving accept candidate also vetoes.
  function findFreeAcceptTarget(candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    const survivors = [];
    for (const candidate of list) {
      if (!candidate || typeof candidate !== "object") continue;
      if (candidate.actionable !== true) continue;
      const kind = classifyConsentButton(candidate.text, candidate.fullText);
      if (kind === "unknown") return { status: "ambiguous", target: null };
      if (kind !== "accept") continue;
      survivors.push(candidate);
    }
    if (survivors.length === 0) return { status: "noop", target: null };
    if (survivors.length > 1) return { status: "ambiguous", target: null };
    return { status: "single", target: survivors[0] };
  }

  // hasFreeRejectControl — L3 last-resort gate. Returns true when the wall
  // offers ANY free path that is not accept-all: a reject/necessary-only control
  // OR a settings/manage control (SETTINGS-IMPLIES-REACHABLE-REJECT — a free
  // reject is always one layer deeper behind a settings pane, so a
  // [Accept all][Settings] banner must never be accepted at layer 1). The caller
  // also collects <a> links as candidates, so an anchor-based reject blocks too.
  function hasFreeRejectControl(candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    for (const candidate of list) {
      if (!candidate || typeof candidate !== "object") continue;
      if (candidate.actionable !== true) continue;
      const kind = classifyConsentButton(candidate.text, candidate.fullText);
      if (kind === "reject" || kind === "settings") return true;
    }
    return false;
  }

  // hasPayOption — the required POSITIVE consent-or-pay signal (C1/F1). A genuine
  // consent-or-pay wall presents a PAY/SUBSCRIBE path; a generic cross-origin
  // iframe with a lone "Continue"/"Accept" does NOT. If no candidate classifies
  // as pay (a pay/subscribe token or a price/period indicator anywhere in its
  // full text), this is NOT a consent-or-pay wall and the accept-click must NOOP.
  function hasPayOption(candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    for (const candidate of list) {
      if (!candidate || typeof candidate !== "object") continue;
      if (classifyConsentButton(candidate.text, candidate.fullText) === "pay") return true;
    }
    return false;
  }

  // ── SP-STRUCTURAL decision-button targeting (PART A, real-wall recalibration) ─
  //
  // Sourcepoint renders its consent-or-pay message with a STABLE structure:
  // every DECISION control carries a `sp_choice_type_<N>` class (surfaced on each
  // candidate as `spChoice`, the "<N>" suffix), while incidental links
  // (Datenschutz / Impressum / FAQ / Privacy Center / login) are plain
  // `text-link` anchors with NO such class (engram id 1339/1341 real-EU capture:
  // zeit / spiegel / faz / welt / sueddeutsche). Canonical choice types:
  //   11 = "Accept all / consent" — the FREE-accept button, the ONLY click target
  //   12 = "Show options / manage / settings"  → a free reject is reachable
  //   13 = "Reject all"                          → a free reject is present
  //   9 / link / 5 / … = the pay / subscribe / login alternative
  // Scoping the decision to ONLY the `sp_choice_type_*` set removes the
  // incidental-link false-veto (id 1339: every real wall carries privacy links
  // that classify "unknown" → the generic ambiguity veto killed every firing)
  // WITHOUT weakening reject detection: a real free reject on an SP wall is ALWAYS
  // an sp_choice button (12/13), never an incidental link.
  //
  // Fail-closed inside the decision set (each condition alone VETOES → ambiguous):
  //   - any settings/reject choice type (12/13) present   → reject reachable
  //   - any control classifying reject/settings by token  → reject reachable
  //   - the accept-all (type 11) button classifying PAY   → deny-precedence
  //   - not EXACTLY ONE actionable free-accept (type 11)   → ambiguity / none
  //   - no non-accept alternative decision button present  → not a consent-or-pay
  // Only the type-11 button is ever the click target; the pay/login/link choices
  // are never clicked, so an unreadable ("unknown") NON-accept SP choice does NOT
  // veto — its choice type already proves it is not the accept button. That
  // structural fact is what lets a genuine hard wall fire while zeit/spiegel/welt
  // (which additionally expose a Settings choice) correctly stay vetoed.
  const SP_ACCEPT_ALL_CHOICE = "11";
  const SP_REJECT_REACHABLE_CHOICES = Object.freeze(["12", "13"]);

  function findSpFreeAcceptTarget(candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    const decisions = [];
    for (const candidate of list) {
      if (!candidate || typeof candidate !== "object") continue;
      if (typeof candidate.spChoice !== "string" || candidate.spChoice.length === 0) continue;
      decisions.push(candidate);
    }
    if (decisions.length === 0) return { status: "noop", target: null };
    const accepts = [];
    let hasAlternative = false;
    for (const candidate of decisions) {
      if (SP_REJECT_REACHABLE_CHOICES.includes(candidate.spChoice)) return { status: "ambiguous", target: null };
      const kind = classifyConsentButton(candidate.text, candidate.fullText);
      if (kind === "reject" || kind === "settings") return { status: "ambiguous", target: null };
      if (candidate.spChoice === SP_ACCEPT_ALL_CHOICE) {
        if (kind === "pay") return { status: "ambiguous", target: null };
        if (kind === "accept" && candidate.actionable === true) accepts.push(candidate);
      } else if (candidate.actionable === true) {
        hasAlternative = true;
      }
    }
    if (accepts.length === 0) return { status: "noop", target: null };
    if (accepts.length > 1) return { status: "ambiguous", target: null };
    if (!hasAlternative) return { status: "noop", target: null };
    return { status: "single", target: accepts[0] };
  }

  // isPaywallFrame (PART B of the design): a POSITIVE, CONJUNCTIVE pre-filter.
  // True ONLY when the frame is a SUBFRAME (never the top frame — a consent-or-
  // pay dialog always renders in a child iframe per the real-site probe, engram
  // id 1333/1335) AND the frame's own URL matches the Sourcepoint message-iframe
  // shape (hasCsp=true AND consent/tcfv2 present, case-insensitively — query/path
  // markers, not host-based, so they still match first-party CMP subdomains like
  // sp-spiegel-de.spiegel.de or consent-cdn.zeit.de; do NOT filter on
  // sp-prod.net/sourcepoint.com, that misses real deployments, engram id 1335's
  // gotcha). A bare cross-origin host mismatch is NO LONGER sufficient (C1/F1):
  // EVERY ad/embed/social/checkout iframe is cross-origin, so requiring only
  // that over-fired far beyond real consent-or-pay walls. The SP URL shape is now
  // MANDATORY. env.isTopFrame must be exactly false — an undeterminable frame
  // identity fails closed to false (never scanned). Pure; never throws. The
  // caller pairs this with hasFreeRejectControl over ALL collected candidates —
  // including <a href> anchors, so a free reject rendered as a plain link still
  // vetoes (F1) — and findSpFreeAcceptTarget's exactly-one requirement (a single
  // sp_choice_type_11 accept plus a non-accept alternative decision button)
  // before ever clicking.
  function isPaywallFrame(env) {
    const e = env && typeof env === "object" ? env : {};
    if (e.isTopFrame !== false) return false; // never the top frame; fail-closed on unknown identity
    const urlLower = typeof e.frameUrl === "string" ? e.frameUrl.toLowerCase() : "";
    // FIX 1 (engram id 1339/1341): on real deployments the `consent/tcfv2` marker
    // appears ONLY PERCENT-ENCODED (`consent%2Ftcfv2`) nested inside the
    // `consent_origin=` query param — the literal slash never survives in
    // location.href (e.g. zeit: consent_origin=https%3A%2F%2Fconsent-cdn.zeit.de
    // %2Fconsent%2Ftcfv2). The original literal-only match therefore never fired
    // on any real wall. Decode %2F back to `/` before matching so BOTH the real
    // encoded form and a literal path satisfy the gate.
    const decoded = urlLower.replace(/%2f/g, "/");
    return decoded.includes("hascsp=true") && decoded.includes("consent/tcfv2");
  }
  // @sync:cmp-accept-veto:end

  // Retained-API reference (isolated-world only): findFreeAcceptTarget and
  // hasPayOption are part of the pure discrimination API mirrored byte-for-byte
  // from src/lib/cmp-accept-adapters.js (where they are exported and unit-tested).
  // The dispatcher below now targets via findSpFreeAcceptTarget (SP-structural),
  // so these two are not called here — this `void` keeps them referenced so the
  // hand-copied @sync block stays byte-identical to the lib without tripping
  // no-unused-vars. Behaviourally inert.
  void findFreeAcceptTarget;
  void hasPayOption;

  // Pure double-gate for the accept-click path (mirrors computeCookieGate's
  // @sync:cookie-gate shape). Hand-maintained COPY of the sibling lib
  // module's own same-named block. Kept in sync by
  // tests/unit/cookie-noise-sync.test.mjs. The main-world caller does NOT
  // carry this block — it never reads prefs, and the accept-click mechanism
  // does not run there at all.
  // @sync:cmp-accept-gate:start
  function computeAcceptGate(prefs, deps) {
    if (!prefs) return false;
    if (prefs.enabled === false) return false;
    if (prefs.onboardingDone !== true) return false;
    if (prefs.cookieConsentMode !== "accept-when-necessary") return false;
    if (prefs.cookieConsentAcceptConsented !== true) return false;
    const isSiteFullyExempt = deps && deps.isSiteFullyExempt;
    if (typeof isSiteFullyExempt === "function") {
      try {
        if (isSiteFullyExempt(deps.hostname, prefs)) return false;
      } catch {
        // FAIL-CLOSED: an exemption predicate that throws leaves the site's
        // exempt/not-exempt status UNRESOLVED. A consent-GRANTING gate must
        // never open on an unresolved signal, so an unexpected throw keeps the
        // gate shut (returns false) — the safe direction for the highest-stakes
        // action in the project.
        return false;
      }
    }
    return true;
  }
  // @sync:cmp-accept-gate:end

  // ── Nonce handshake (separate channel: muga:cookie-gate) ────────────────
  // Mirrors the #811 pattern from history-defuser.js on its own channel.
  // The nonce lives only in this closure — no global property stores it.
  const _nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(_nonceBytes);
  const _nonce = Array.from(_nonceBytes, (b) => b.toString(16).padStart(2, "0")).join("");

  function dispatchNonceOnce() {
    try {
      document.dispatchEvent(new CustomEvent("muga:cookie-gate:nonce", {
        detail: { nonce: _nonce },
      }));
    } catch {
      // document detached — silent
    }
  }
  dispatchNonceOnce();

  function dispatchGate(enabled) {
    try {
      document.dispatchEvent(new CustomEvent("muga:cookie-gate", {
        detail: { enabled: !!enabled, nonce: _nonce },
      }));
    } catch {
      // document detached or CustomEvent unavailable — silent. Harmless
      // no-op on Firefox too, where no MAIN-world listener exists at all.
    }
  }

  // ── Firefox MV2 direct reject path (no world:"MAIN" available) ──────────
  //
  // Firefox content scripts can reach the page's real objects via
  // `window.wrappedJSObject` (the CSP-immune pattern already proven by
  // history-defuser.js's page-world history wrap). No `exportFunction` is
  // needed here — we only READ `wrappedJSObject.OneTrust` and CALL its
  // `RejectAll` method, we don't install anything onto the page.
  let _fxGateOpen = false;
  let _fxActed = false;
  let _fxObserver = null;

  function fxCollectSignals() {
    let hasOneTrustGlobal = false;
    let hasRejectAllFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const ot = wrapped && wrapped.OneTrust;
      hasOneTrustGlobal = typeof ot === "object" && ot !== null;
      hasRejectAllFn = hasOneTrustGlobal && typeof ot.RejectAll === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasBannerDom = false;
    let hasRejectHandlerDom = false;
    try {
      hasBannerDom = !!(
        document.getElementById("onetrust-banner-sdk") ||
        document.getElementById("onetrust-consent-sdk")
      );
      hasRejectHandlerDom = !!document.getElementById("onetrust-reject-all-handler");
    } catch {
      // ignore
    }
    let hasActiveGroupsGlobal = false;
    try {
      hasActiveGroupsGlobal = typeof window.wrappedJSObject.OnetrustActiveGroups === "string";
    } catch {
      // ignore
    }
    let hasCookiebotGlobal = false;
    let hasSubmitCustomConsentFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const cb = wrapped && wrapped.Cookiebot;
      hasCookiebotGlobal = typeof cb === "object" && cb !== null;
      hasSubmitCustomConsentFn = hasCookiebotGlobal && typeof cb.submitCustomConsent === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasCybotDialogDom = false;
    try {
      hasCybotDialogDom = !!document.getElementById("CybotCookiebotDialog");
    } catch {
      // ignore
    }
    let hasConsentObjectGlobal = false;
    let hasResponseBooleanGlobal = false;
    try {
      const wrapped = window.wrappedJSObject;
      const cb = wrapped && wrapped.Cookiebot;
      hasConsentObjectGlobal = hasCookiebotGlobal && typeof cb.consent === "object";
      hasResponseBooleanGlobal = hasCookiebotGlobal && typeof cb.hasResponse === "boolean";
    } catch {
      // ignore
    }
    let hasDidomiGlobal = false;
    let hasSetUserDisagreeToAllFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const di = wrapped && wrapped.Didomi;
      hasDidomiGlobal = typeof di === "object" && di !== null;
      hasSetUserDisagreeToAllFn = hasDidomiGlobal && typeof di.setUserDisagreeToAll === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasDidomiHostDom = false;
    try {
      hasDidomiHostDom = !!document.getElementById("didomi-host");
    } catch {
      // ignore
    }
    let hasGetCurrentUserStatusFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const di = wrapped && wrapped.Didomi;
      hasGetCurrentUserStatusFn = hasDidomiGlobal && typeof di.getCurrentUserStatus === "function";
    } catch {
      // ignore
    }
    // CookieYes (#1120): unlike the three adapters above, the reject call
    // is a BARE global (`wrappedJSObject.performBannerAction`), not a
    // method on a vendor-namespaced object. Both bare globals are checked
    // directly — see the dual-mandatory-signal rationale on
    // detectCookieYes in cookie-noise-mainworld.js / cmp-adapters.js.
    let hasGetCkyConsentFn = false;
    let hasPerformBannerActionFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      hasGetCkyConsentFn = wrapped && typeof wrapped.getCkyConsent === "function";
      hasPerformBannerActionFn = wrapped && typeof wrapped.performBannerAction === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasCkyConsentContainerDom = false;
    let hasCkyOverlayDom = false;
    let hasCkyConsentBarDom = false;
    try {
      hasCkyConsentContainerDom = !!document.querySelector(".cky-consent-container");
      hasCkyOverlayDom = !!document.querySelector(".cky-overlay");
      hasCkyConsentBarDom = !!document.querySelector(".cky-consent-bar");
    } catch {
      // ignore
    }
    // Sourcepoint (#1123): __tcfapi is the generic IAB TCF surface every
    // TCF-compliant CMP exposes (including Didomi above), so it can never
    // be the sole mandatory anchor on its own — see the dual-mandatory
    // rationale on detectSourcepoint above. Reached via wrappedJSObject,
    // same Xray-safety pattern as the other Firefox signal reads above.
    let hasTcfApiFn = false;
    try {
      hasTcfApiFn = typeof window.wrappedJSObject.__tcfapi === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasSpMessageContainerDom = false;
    let hasSpPrivacyMgmtIframeDom = false;
    let hasSpProdIframeDom = false;
    let hasSpProdScriptDom = false;
    try {
      hasSpMessageContainerDom = !!document.querySelector('div[id^="sp_message_container"]');
      hasSpPrivacyMgmtIframeDom = !!document.querySelector('iframe[src*="privacy-mgmt.com"]');
      hasSpProdIframeDom = !!document.querySelector('iframe[src*="sp-prod.net"]');
      hasSpProdScriptDom = !!document.querySelector('script[src*="sp-prod.net"]');
    } catch {
      // ignore
    }
    // Usercentrics (#1121): window.UC_UI is the drop-in banner's
    // vendor-namespaced global, reached via wrappedJSObject — same
    // Xray-safety pattern as the other Firefox signal reads above. Do NOT
    // key off __tcfapi or an __ucCmp global — those are the generic-TCF /
    // headless-SDK surfaces, not this signal.
    let hasUcUiGlobal = false;
    let hasDenyAllConsentsFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const uc = wrapped && wrapped.UC_UI;
      hasUcUiGlobal = typeof uc === "object" && uc !== null;
      hasDenyAllConsentsFn = hasUcUiGlobal && typeof uc.denyAllConsents === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasUsercentricsRootDom = false;
    try {
      hasUsercentricsRootDom = !!document.getElementById("usercentrics-root");
    } catch {
      // ignore
    }
    let hasIsInitializedFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const uc = wrapped && wrapped.UC_UI;
      hasIsInitializedFn = hasUcUiGlobal && typeof uc.isInitialized === "function";
    } catch {
      // ignore
    }
    // Cookie Information: window.CookieInformation is a vendor-namespaced
    // global, reached via wrappedJSObject — same Xray-safety pattern as the
    // other Firefox signal reads above. Do NOT key off the generic __tcfapi
    // surface (hasTcfApiFn, already collected above) — this vendor's TCF
    // surface is opt-in per site and is Sourcepoint's dual-mandatory
    // anchor, not this adapter's.
    let hasCookieInformationGlobal = false;
    let hasDeclineAllCategoriesFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const ci = wrapped && wrapped.CookieInformation;
      hasCookieInformationGlobal = typeof ci === "object" && ci !== null;
      hasDeclineAllCategoriesFn = hasCookieInformationGlobal && typeof ci.declineAllCategories === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasCoiOverlayDom = false;
    let hasCoiConsentBannerDom = false;
    let hasCoiSummeryDom = false;
    let hasCoiBannerWrapperDom = false;
    let hasCoiConsentSummaryDom = false;
    try {
      hasCoiOverlayDom = !!document.getElementById("coiOverlay");
      hasCoiConsentBannerDom = !!document.getElementById("coiConsentBanner");
      hasCoiSummeryDom = !!document.getElementById("coiSummery");
      hasCoiBannerWrapperDom = !!document.getElementById("coi-banner-wrapper");
      hasCoiConsentSummaryDom = !!document.querySelector(".coi-consent-summary");
    } catch {
      // ignore
    }
    // CookieScript: the reject call lives on window.CookieScript.instance,
    // not directly on the vendor global, reached via wrappedJSObject — same
    // Xray-safety pattern as the other Firefox signal reads above. The
    // vendor global itself can be EITHER an object OR a callable function
    // with `.instance` hung off it (real-site verification found
    // cookie-script.com ships the function-shaped variant) — allow both
    // shapes for the global itself; `.instance` and `.rejectAllAction`
    // remain the real, strictly object/function-typed discriminators, so
    // this does not loosen detection against any other CMP.
    let hasCookieScriptGlobal = false;
    let hasCookieScriptInstance = false;
    let hasRejectAllActionFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const cs = wrapped && wrapped.CookieScript;
      hasCookieScriptGlobal = (typeof cs === "object" || typeof cs === "function") && cs !== null;
      const instance = hasCookieScriptGlobal && cs.instance;
      hasCookieScriptInstance = typeof instance === "object" && instance !== null;
      hasRejectAllActionFn = hasCookieScriptInstance && typeof instance.rejectAllAction === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasCookiescriptInjectedDom = false;
    let hasCookiescriptDescriptionDom = false;
    try {
      hasCookiescriptInjectedDom = !!document.getElementById("cookiescript_injected");
      hasCookiescriptDescriptionDom = !!document.getElementById("cookiescript_description");
    } catch {
      // ignore
    }
    // tarteaucitron: the reject call lives on window.tarteaucitron.userInterface,
    // not directly on the vendor global, reached via wrappedJSObject — same
    // Xray-safety pattern as the other Firefox signal reads above. Null-safe
    // staged checks, not a naive chained typeof — hasTarteaucitronUserInterface
    // must be confirmed an object BEFORE probing .respondAll.
    let hasTarteaucitronGlobal = false;
    let hasTarteaucitronUserInterface = false;
    let hasRespondAllFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const tac = wrapped && wrapped.tarteaucitron;
      hasTarteaucitronGlobal = typeof tac === "object" && tac !== null;
      const ui = hasTarteaucitronGlobal && tac.userInterface;
      hasTarteaucitronUserInterface = typeof ui === "object" && ui !== null;
      hasRespondAllFn = hasTarteaucitronUserInterface && typeof ui.respondAll === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasTarteaucitronRootDom = false;
    let hasTarteaucitronAlertBigDom = false;
    let hasTarteaucitronBackDom = false;
    let hasTarteaucitronModalOpenDom = false;
    try {
      hasTarteaucitronRootDom = !!document.getElementById("tarteaucitronRoot");
      hasTarteaucitronAlertBigDom = !!document.getElementById("tarteaucitronAlertBig");
      hasTarteaucitronBackDom = !!document.getElementById("tarteaucitronBack");
      hasTarteaucitronModalOpenDom = !!(document.body && document.body.classList.contains("tarteaucitron-modal-open"));
    } catch {
      // ignore
    }
    // consentmanager.net: window.cmpmngr is the vendor-specific global,
    // window.__cmp is the legacy IAB TCF v1.1 generic reject surface,
    // reached via wrappedJSObject — same Xray-safety pattern as the other
    // Firefox signal reads above. Do NOT key detection off __cmp alone —
    // see the dual-anchor discrimination rationale above detectConsentmanager.
    let hasCmpMngrGlobal = false;
    let hasCmpFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const cm = wrapped && wrapped.cmpmngr;
      hasCmpMngrGlobal = typeof cm === "object" && cm !== null;
      hasCmpFn = wrapped && typeof wrapped.__cmp === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasCmpBoxDom = false;
    let hasCmpWelcomeBtnYesDom = false;
    let hasCmpWelcomeBtnNoDom = false;
    let hasCmpBoxBtnDom = false;
    try {
      hasCmpBoxDom = !!document.getElementById("cmpbox");
      hasCmpWelcomeBtnYesDom = !!document.getElementById("cmpwelcomebtnyes");
      hasCmpWelcomeBtnNoDom = !!document.getElementById("cmpwelcomebtnno");
      hasCmpBoxBtnDom = !!document.querySelector("#cmpbox .cmpboxbtn");
    } catch {
      // ignore
    }
    return {
      hasOneTrustGlobal,
      hasRejectAllFn,
      hasBannerDom,
      hasActiveGroupsGlobal,
      hasRejectHandlerDom,
      hasCookiebotGlobal,
      hasSubmitCustomConsentFn,
      hasCybotDialogDom,
      hasConsentObjectGlobal,
      hasResponseBooleanGlobal,
      hasDidomiGlobal,
      hasSetUserDisagreeToAllFn,
      hasDidomiHostDom,
      hasGetCurrentUserStatusFn,
      hasGetCkyConsentFn,
      hasPerformBannerActionFn,
      hasCkyConsentContainerDom,
      hasCkyOverlayDom,
      hasCkyConsentBarDom,
      hasTcfApiFn,
      hasSpMessageContainerDom,
      hasSpPrivacyMgmtIframeDom,
      hasSpProdIframeDom,
      hasSpProdScriptDom,
      hasUcUiGlobal,
      hasDenyAllConsentsFn,
      hasUsercentricsRootDom,
      hasIsInitializedFn,
      hasCookieInformationGlobal,
      hasDeclineAllCategoriesFn,
      hasCoiOverlayDom,
      hasCoiConsentBannerDom,
      hasCoiSummeryDom,
      hasCoiBannerWrapperDom,
      hasCoiConsentSummaryDom,
      hasCookieScriptGlobal,
      hasCookieScriptInstance,
      hasRejectAllActionFn,
      hasCookiescriptInjectedDom,
      hasCookiescriptDescriptionDom,
      hasTarteaucitronGlobal,
      hasTarteaucitronUserInterface,
      hasRespondAllFn,
      hasTarteaucitronRootDom,
      hasTarteaucitronAlertBigDom,
      hasTarteaucitronBackDom,
      hasTarteaucitronModalOpenDom,
      hasCmpMngrGlobal,
      hasCmpFn,
      hasCmpBoxDom,
      hasCmpWelcomeBtnYesDom,
      hasCmpWelcomeBtnNoDom,
      hasCmpBoxBtnDom,
    };
  }

  function fxRunDispatcher() {
    if (_fxActed || !_fxGateOpen) return;
    const signals = fxCollectSignals();
    if (canRejectOneTrust(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.OneTrust.RejectAll();
      } catch {
        // A throwing page global must never break the page.
      }
      fxStopObserver();
      return;
    }
    // Tier 1: Cookiebot API adapter (#1118). Same literal-false-only reject
    // call as the Chrome MAIN-world caller — see cookie-noise-mainworld.js.
    if (canRejectCookiebot(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.Cookiebot.submitCustomConsent(false, false, false);
      } catch {
        // A throwing page global must never break the page.
      }
      fxStopObserver();
      return;
    }
    // Tier 1: Didomi API adapter (#1119). Same zero-argument, synchronous
    // reject-call shape as OneTrust.RejectAll() — see cookie-noise-mainworld.js.
    if (canRejectDidomi(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.Didomi.setUserDisagreeToAll();
      } catch {
        // A throwing page global must never break the page.
      }
      fxStopObserver();
      return;
    }
    // Tier 1: CookieYes API adapter (#1120). Same dual-mandatory-signal
    // detection and literal "reject"-only argument as the Chrome
    // MAIN-world caller — see cookie-noise-mainworld.js.
    if (canRejectCookieYes(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.performBannerAction("reject");
      } catch {
        // A throwing page global must never break the page.
      }
      fxStopObserver();
      return;
    }
    // Tier 1: Sourcepoint API adapter (#1123). Same fire-and-forget,
    // synchronous _fxActed + fxStopObserver() shape as the Chrome
    // MAIN-world caller — see cookie-noise-mainworld.js. postRejectAll's
    // async callback is optional-log-only and never gates control flow.
    if (canRejectSourcepoint(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.__tcfapi("postRejectAll", 2, (success) => {
          void success; // fire-and-forget — log only, never gates control flow
        });
      } catch {
        // A throwing page global must never break the page.
      }
      fxStopObserver();
      return;
    }
    // Tier 1: Usercentrics API adapter (#1121). Same fire-and-forget,
    // synchronous _fxActed + fxStopObserver() shape as the Chrome
    // MAIN-world caller — see cookie-noise-mainworld.js. denyAllConsents()
    // returns a Promise; .catch(() => {}) swallows any floating rejection
    // and the promise is never awaited.
    if (canRejectUsercentrics(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.UC_UI.denyAllConsents().catch(() => {});
      } catch {
        // A throwing page global must never break the page.
      }
      fxStopObserver();
      return;
    }
    // Tier 1: Cookie Information API adapter. Same zero-argument,
    // synchronous reject-call shape as OneTrust.RejectAll() /
    // Didomi.setUserDisagreeToAll() — see cookie-noise-mainworld.js.
    if (canRejectCookieInformation(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.CookieInformation.declineAllCategories();
      } catch {
        // A throwing page global must never break the page.
      }
      fxStopObserver();
      return;
    }
    // Tier 1: CookieScript API adapter. Same zero-argument, synchronous
    // reject-call shape as the adapters above — see cookie-noise-mainworld.js.
    if (canRejectCookieScript(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.CookieScript.instance.rejectAllAction();
      } catch {
        // A throwing page global must never break the page.
      }
      fxStopObserver();
      return;
    }
    // Tier 1: tarteaucitron API adapter. Same zero-argument-shape family as
    // the adapters above, except respondAll takes one literal argument:
    // `false` denies every registered service — see
    // cookie-noise-mainworld.js for the full rationale.
    if (canRejectTarteaucitron(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.tarteaucitron.userInterface.respondAll(false);
      } catch {
        // A throwing page global must never break the page.
      }
      fxStopObserver();
      return;
    }
    // Tier 1: consentmanager.net API adapter. Same literal-`0`,
    // fire-and-forget shape as the Chrome MAIN-world caller — see
    // cookie-noise-mainworld.js. setConsent's callback is optional-log-only
    // and never gates control flow.
    if (canRejectConsentmanager(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.__cmp("setConsent", 0, () => {}, true);
      } catch {
        // A throwing page global must never break the page.
      }
      fxStopObserver();
      return;
    }
    // The consent-or-pay-wall accept-click (cookie-consent-paywall-accept)
    // deliberately does NOT live in this Tier-1 vendor-API dispatcher — it
    // is a generic DOM-button click, independent of any vendor adapter. See
    // runAcceptClickDispatcher() further below, which runs for BOTH
    // browsers (Chrome and Firefox alike) since this whole file is the
    // isolated world already.
  }

  // Bounded give-up window (#1027) — Firefox mirror of the MAIN-world
  // caller's give-up (see content/cookie-noise-mainworld.js for the full
  // rationale). Most pages never show a OneTrust banner; without a give-up
  // the observer + dispatcher would run per-mutation for the whole page
  // lifetime. Fail-closed: giving up just disconnects, never acts.
  const FX_GIVE_UP_AFTER_DOM_READY_MS = 10000;
  let _fxGiveUpArmed = false;
  let _fxGiveUpTimer = null;
  // Unconditional fallback timer (FIX C) — see fxArmGiveUp() below.
  let _fxGiveUpFallbackTimer = null;

  function fxArmGiveUp() {
    if (_fxGiveUpArmed) return;
    _fxGiveUpArmed = true;
    const schedule = () => {
      _fxGiveUpTimer = setTimeout(() => {
        _fxGiveUpTimer = null;
        if (!_fxActed) fxStopObserver();
      }, FX_GIVE_UP_AFTER_DOM_READY_MS);
    };
    if (document.readyState === "loading") {
      // Bounded fallback (FIX C, all_frames:true): a frame that never
      // reaches DOMContentLoaded at all (e.g. a pending subresource that
      // never settles in a sandboxed child frame) would otherwise never
      // arm `schedule` above, leaving the observer running for the whole
      // page lifetime. This fallback fires unconditionally on the SAME
      // give-up window, independent of `schedule`'s own timer — both just
      // call the idempotent fxStopObserver(), so no harm if
      // DOMContentLoaded eventually does fire and both timers end up
      // disconnecting.
      _fxGiveUpFallbackTimer = setTimeout(() => {
        _fxGiveUpFallbackTimer = null;
        if (!_fxActed) fxStopObserver();
      }, FX_GIVE_UP_AFTER_DOM_READY_MS);
      document.addEventListener("DOMContentLoaded", schedule, { once: true });
    } else {
      schedule();
    }
  }

  function fxStartObserver() {
    if (_fxObserver || _fxActed) return;
    if (!document || !document.documentElement) return;
    try {
      _fxObserver = new MutationObserver(() => fxRunDispatcher());
      _fxObserver.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      _fxObserver = null;
    }
    fxArmGiveUp();
  }

  function fxStopObserver() {
    if (_fxGiveUpTimer !== null) {
      clearTimeout(_fxGiveUpTimer);
      _fxGiveUpTimer = null;
    }
    if (_fxGiveUpFallbackTimer !== null) {
      clearTimeout(_fxGiveUpFallbackTimer);
      _fxGiveUpFallbackTimer = null;
    }
    // Reset so a later gate reopen (Settings toggle) arms a fresh window.
    _fxGiveUpArmed = false;
    if (!_fxObserver) return;
    try {
      _fxObserver.disconnect();
    } catch {
      // already disconnected
    }
    _fxObserver = null;
  }

  let _isFirefox = false;
  try {
    const mv = chrome.runtime.getManifest && chrome.runtime.getManifest().manifest_version;
    _isFirefox = mv === 2;
  } catch {
    // leave false — the Chrome MAIN-world path stays the default assumption.
  }

  // ── Disabled-state gate (prefs) ──────────────────────────────────────────
  // Inline copy of computeCookieGate from src/lib/cmp-adapters.js — content
  // scripts cannot use ES module imports (AGENTS.md). Kept byte-identical
  // (modulo indentation) to the library copy by
  // tests/unit/cookie-noise-sync.test.mjs. The pure helper takes injected
  // deps so it stays unit-testable in src/lib/; the thin call site below
  // supplies this world's real location + cleaner exemption predicate. The
  // `modeActive` deps field is a boolean already pre-validated upstream
  // (background/service-worker.js, via settings-schema.js's closed-enum
  // check) — this gate never reads or compares the raw mode string itself.
  // @sync:cookie-gate:start
  function computeCookieGate(prefs, deps) {
    if (!prefs) return false;
    if (prefs.enabled === false) return false;
    if (prefs.onboardingDone !== true) return false;
    if (!deps || deps.modeActive !== true) return false;
    const isSiteFullyExempt = deps && deps.isSiteFullyExempt;
    if (typeof isSiteFullyExempt === "function") {
      try {
        if (isSiteFullyExempt(deps.hostname, prefs)) return false;
      } catch {
        // Fail-safe: treat as not exempt on any unexpected throw.
      }
    }
    return true;
  }
  // @sync:cookie-gate:end

  // Content scripts cannot import ES modules (AGENTS.md), so this pure
  // helper is hand-copied, byte-identical (modulo indentation), from
  // src/lib/frame-host.js. Kept in sync by
  // tests/unit/cookie-noise-sync.test.mjs. Resolves the TOP frame's real
  // hostname (cookie-consent-all-frames FIX A) — needed because
  // `location.hostname` inside a cross-origin consent-or-pay dialog iframe
  // is the CMP vendor's OWN host, not the paused site's.
  // @sync:frame-host:start
  function resolveTopFrameHostname(env) {
    const e = env && typeof env === "object" ? env : {};

    if (e.isTopFrame === true) {
      return typeof e.hostname === "string" && e.hostname.length > 0 ? e.hostname : null;
    }

    // Child frame: only Chrome/Edge expose `location.ancestorOrigins` (a
    // DOMStringList of ancestor frame origins, outermost-last — the LAST
    // entry is always the top frame's origin, regardless of nesting depth).
    // Firefox has no equivalent API — an absent or empty list is
    // UNDETERMINABLE, not "no ancestors", and must fail closed to `null`.
    const ancestorOrigins = e.ancestorOrigins;
    const length =
      ancestorOrigins && typeof ancestorOrigins.length === "number" ? ancestorOrigins.length : 0;
    if (length === 0) return null;

    const topOrigin = ancestorOrigins[length - 1];
    if (typeof topOrigin !== "string" || topOrigin.length === 0) return null;

    try {
      const hostname = new URL(topOrigin).hostname;
      return hostname.length > 0 ? hostname : null;
    } catch {
      // Malformed origin string — never throw, fail closed instead.
      return null;
    }
  }
  // @sync:frame-host:end

  // Content scripts cannot import ES modules (AGENTS.md), so these four
  // functions are hand-copied, byte-identical (modulo indentation and the
  // `export` keyword, which content scripts cannot use), from
  // src/lib/cleaner.js. Kept in sync by tests/unit/cookie-noise-sync.test.mjs.
  // Deliberately PREFS-ONLY (no `window`/`document` access) so this copy is
  // safe to run in a child frame, unlike `window.__mugaCleaner.isSiteFullyExempt`
  // (never attached outside the top frame — see computeGate() below).
  // @sync:site-exempt:start
  /**
   * Parses a blacklist/whitelist entry string into a structured object.
   * Supported formats:
   *   "amazon.es"                      → { domain: "amazon.es", param: null, value: null }
   *   "amazon.es::tag::youtuber-21"    → { domain: "amazon.es", param: "tag", value: "youtuber-21" }
   *
   * @param {string} entry
   * @returns {{ domain: string, param: string|null, value: string|null }}
   */
  function parseListEntry(entry) {
    const parts = entry.split("::");
    return {
      domain: parts[0]?.trim().replace(/^www\./, "").toLowerCase() || "",
      // Lowercase the param KEY: tracker param names are lowercase in practice and
      // the match sites compare it directly, so a mixed-case entry (e.g. "Tag")
      // otherwise silently never matched a real "tag" query param (audit #1048).
      // The VALUE stays case-sensitive (affiliate tag values are matched verbatim).
      param:  parts[1]?.trim().toLowerCase() || null,
      value:  parts[2]?.trim() || null,
    };
  }

  /**
   * Strips a single trailing dot from a hostname (#1095).
   *
   * `amazon.com.` is a valid FQDN — the trailing dot denotes the DNS root —
   * and browsers/resolvers treat it as IDENTICAL to `amazon.com`. Every
   * host-matching helper in this module already strips a leading `www.`
   * before comparing; without the same treatment for a trailing dot, a page
   * on `www.amazon.com.` bypassed affiliate-pattern lookup entirely
   * (`getPatternsForHost` found zero patterns, so stripAllAffiliates left a
   * foreign tag completely untouched) and slipped past domain-only
   * whitelist/blacklist/pause-by-site entries for `amazon.com`.
   *
   * @param {string} hostname
   * @returns {string}
   */
  function stripTrailingDot(hostname) {
    return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  }

  /**
   * Returns true if a host matches a parsed list entry's domain.
   */
  function domainMatches(hostname, entryDomain) {
    const host = stripTrailingDot(hostname).replace(/^www\./, "");
    return host === entryDomain || host.endsWith("." + entryDomain);
  }

  /**
   * Returns true if a hostname is FULLY EXEMPT from MUGA - the single
   * choke-point predicate that governs every cleaning mechanism, present and
   * future (#allowlist-full-inert). Originally added as
   * isSiteExemptFromActiveDefense (#1006) to cover only the four active-defense
   * content scripts (window.name defuser, history defuser, DOM link rewriter,
   * click rewriter), all of which gate on a single muga:history-gate event.
   * Renamed and promoted to the general-purpose exemption check consulted by
   * processUrl (JS cleaning, #allowlist-full-inert) and by the service worker's
   * DNR allow-rule sync (network-layer cleaning) - so "domain is allowlisted"
   * now means MUGA has literally no effect on that domain through ANY path,
   * not a per-mechanism opt-out that has to be re-added every time a new
   * mechanism ships.
   *
   * A site counts as exempt when a DOMAIN-ONLY whitelist entry matches the
   * host (bare "example.com"). A param-scoped entry ("example.com::tag::x")
   * does NOT count - that only protects one affiliate value, it is not a
   * "leave this site alone" signal. (The legacy `example.com::disabled`
   * per-site-pause blacklist syntax was removed entirely - a domain is
   * exempted ONLY via a domain-only whitelist entry now.)
   *
   * Reuses parseListEntry/domainMatches rather than reimplementing domain
   * matching (a separate cleanup is tracked in #1005).
   *
   * Defensive: returns false for any falsy or malformed input so a missing or
   * corrupt prefs object never accidentally grants an exemption. Fail-safe
   * direction matters here: MUGA must stay ACTIVE unless we are sure the user
   * opted the site out - a bug in this predicate must never globally disable
   * cleaning.
   *
   * @param {string} hostname - the current page's hostname.
   * @param {{ whitelist?: string[], blacklist?: string[] }} prefs
   * @returns {boolean}
   */
  function isSiteFullyExempt(hostname, prefs) {
    if (!hostname || typeof hostname !== "string" || !prefs || typeof prefs !== "object") return false;

    const whitelist = Array.isArray(prefs.whitelist) ? prefs.whitelist : [];
    for (const raw of whitelist) {
      let entry;
      try {
        entry = parseListEntry(raw);
      } catch {
        continue;
      }
      if (!entry.domain || entry.param) continue;
      if (domainMatches(hostname, entry.domain)) return true;
    }

    return false;
  }
  // @sync:site-exempt:end

  function computeGate(prefs) {
    // isSiteFullyExempt is a standalone function on __mugaCleaner (no `this`
    // dependency — see src/lib/cleaner.js), so passing the reference detached
    // is safe. modeActive is precomputed by the service worker's getPrefs
    // response (see the @sync:cookie-gate comment above) — read verbatim,
    // never recomputed here.
    let isTopFrame = true;
    try {
      isTopFrame = window.top === window.self;
    } catch {
      // An unexpected/sandboxed frame shape that cannot even report its own
      // top-frame identity — treat as a child frame so the fail-closed path
      // below runs instead of trusting this frame's own (possibly
      // CMP-vendor) hostname.
      isTopFrame = false;
    }

    if (isTopFrame) {
      const cleaner = window.__mugaCleaner;
      return computeCookieGate(prefs, {
        modeActive: !!(prefs && prefs.modeActive === true),
        hostname: location.hostname,
        isSiteFullyExempt:
          cleaner && typeof cleaner.isSiteFullyExempt === "function" ? cleaner.isSiteFullyExempt : null,
      });
    }

    // Child frame (e.g. a cross-origin consent-or-pay dialog iframe):
    // `window.__mugaCleaner` is never attached here (cleaner-bundle.js
    // stays top-frame-only) and `location.hostname` is the CMP vendor's OWN
    // host, not the paused site's — so the top-frame branch above cannot be
    // reused as-is. Resolve the REAL top-frame hostname instead (see the
    // @sync:frame-host block above) and check the per-site exemption with a
    // per-frame-safe, prefs-only copy of the real predicate (see the
    // @sync:site-exempt block above) instead of window.__mugaCleaner.
    let ancestorOrigins = null;
    try {
      ancestorOrigins = location.ancestorOrigins;
    } catch {
      ancestorOrigins = null;
    }
    const topHostname = resolveTopFrameHostname({ isTopFrame: false, ancestorOrigins });
    return computeCookieGate(prefs, {
      modeActive: !!(prefs && prefs.modeActive === true),
      hostname: topHostname,
      // FAIL-CLOSED: an undeterminable top host (topHostname === null — no
      // location.ancestorOrigins support, e.g. Firefox, or an empty list)
      // is treated as EXEMPT — the gate stays shut rather than risk opening
      // it against the user's own per-site pause.
      isSiteFullyExempt: (hostname, prefsArg) =>
        hostname === null ? true : isSiteFullyExempt(hostname, prefsArg),
    });
  }

  // Resolves this frame's own identity + the relayed TOP frame's hostname,
  // exactly the same ancestorOrigins-based mechanism computeGate() uses for
  // the reject gate's per-site exemption (cookie-consent-all-frames FIX A) —
  // reused here so the accept-click's own exemption check (below) honors a
  // per-site pause even from inside a cross-origin consent iframe.
  function resolveFrameIdentity() {
    let isTopFrame = true;
    try {
      isTopFrame = window.top === window.self;
    } catch {
      isTopFrame = false;
    }
    if (isTopFrame) {
      return { isTopFrame: true, topHostname: location.hostname };
    }
    let ancestorOrigins = null;
    try {
      ancestorOrigins = location.ancestorOrigins;
    } catch {
      ancestorOrigins = null;
    }
    return { isTopFrame: false, topHostname: resolveTopFrameHostname({ isTopFrame: false, ancestorOrigins }) };
  }

  // Computes the accept-click double-gate from the real prefs in this
  // world — this world is the only one with prefs access. Unlike the
  // reject gate (relayed to MAIN world via dispatchGate), the accept-click
  // mechanism never runs outside this world at all, so nothing is relayed
  // here — this result is consumed directly, below. This thin wrapper is
  // itself fenced (this file's structural guard forbids spelling the
  // wrapped function's name outside a fenced region).
  // @sync:cmp-accept-gate-call:start
  function computeAcceptGateForFrame(prefs) {
    const { isTopFrame, topHostname } = resolveFrameIdentity();
    if (isTopFrame) {
      const cleaner = window.__mugaCleaner;
      return computeAcceptGate(prefs, {
        hostname: topHostname,
        isSiteFullyExempt:
          cleaner && typeof cleaner.isSiteFullyExempt === "function" ? cleaner.isSiteFullyExempt : null,
      });
    }
    return computeAcceptGate(prefs, {
      hostname: topHostname,
      // FAIL-CLOSED: an undeterminable top host is treated as EXEMPT — see
      // computeGate()'s child-frame branch for the identical rationale.
      isSiteFullyExempt: (hostname, prefsArg) =>
        hostname === null ? true : isSiteFullyExempt(hostname, prefsArg),
    });
  }
  // @sync:cmp-accept-gate-call:end

  // ── Consent-or-pay-wall accept-click dispatch ────────────────────────────
  //
  // Runs for BOTH browsers (this whole file is the isolated world already;
  // all_frames:true covers every frame on both). Independent of the Tier-1
  // reject dispatchers above — a DOM `element.click()` needs no vendor API,
  // no page-authored global, and no MAIN world, so there is no per-browser
  // fork here at all, unlike the retired Didomi JS-API accept path.
  let _acceptActed = false;
  let _acceptGateOpen = false;
  let _acceptObserver = null;
  const ACCEPT_GIVE_UP_AFTER_DOM_READY_MS = 10000;
  let _acceptGiveUpArmed = false;
  let _acceptGiveUpTimer = null;
  let _acceptGiveUpFallbackTimer = null;
  // Bounded re-sweep: a Sourcepoint consent-or-pay wall animates its buttons in
  // via CSS (opacity/transform) and flips them from non-actionable to actionable
  // through pure LAYOUT, with no accompanying DOM mutation — so the childList/
  // subtree MutationObserver alone can miss the moment the free-accept button
  // becomes clickable (observed on faz.net: fired on one load, missed on the
  // next). A low-frequency re-sweep re-runs the SAME fully-gated dispatcher until
  // it acts or the give-up window closes. This changes RELIABILITY only — every
  // sweep applies the identical isPaywallFrame + reject/settings veto + exactly-
  // one-accept checks, so it can never make the decision less safe.
  const ACCEPT_RESWEEP_INTERVAL_MS = 1000;
  let _acceptResweepTimer = null;

  // `a[href]` is included so a FREE-reject rendered as a plain anchor (not a
  // <button> or role=button) is still collected and can block the accept-click
  // via hasFreeRejectControl, which runs over ALL collected candidates (F1). An
  // anchor only vetoes when it carries a REJECT/SETTINGS token; a privacy/
  // imprint/FAQ link classifies "unknown" and never false-vetoes. The accept
  // TARGET stays SP-scoped (findSpFreeAcceptTarget only considers sp_choice
  // decision buttons), so widening the pool cannot bias the target resolver.
  // NOTE: this scan sees only this document's OWN (light-DOM) nodes;
  // controls inside a closed shadow root are NOT reachable from a content
  // script and are therefore invisible to this collector — a documented limit,
  // acceptable because an unreadable/ambiguous wall fails closed (no click).
  const ACCEPT_CANDIDATE_SELECTOR =
    'button, a[href], a[role="button"], [role="button"], input[type="button"], input[type="submit"]';

  function acceptAccessibleName(el) {
    try {
      const aria = typeof el.getAttribute === "function" ? el.getAttribute("aria-label") : null;
      if (typeof aria === "string" && aria.trim().length > 0) return aria;
      if (typeof el.value === "string" && el.value.trim().length > 0) return el.value;
      return typeof el.textContent === "string" ? el.textContent : "";
    } catch {
      return "";
    }
  }

  // The control's FULL text: accessible name + value + visible textContent,
  // concatenated. The PAY/price/deny scan runs over THIS (see
  // classifyConsentButton) so an aria-label that omits the price cannot hide a
  // paid tier behind a benign-looking accessible name (M1). Never throws.
  function acceptFullText(el) {
    try {
      const parts = [];
      const aria = typeof el.getAttribute === "function" ? el.getAttribute("aria-label") : null;
      if (typeof aria === "string") parts.push(aria);
      if (typeof el.value === "string") parts.push(el.value);
      if (typeof el.textContent === "string") parts.push(el.textContent);
      return parts.join(" ");
    } catch {
      return "";
    }
  }

  // Actionability = connected to the layout (getClientRects non-empty —
  // false for display:none/detached) and not disabled. A CSS-hidden decoy
  // (visibility:hidden or opacity:0 with layout box) can still have
  // non-empty client rects; getClientRects().length===0 catches the common
  // display:none / detached-node case, which is the shape a hostile page
  // would use to hide a decoy button from view without removing it. This
  // mirrors the same conservative bar every other DOM-driven signal in this
  // file uses — never throws.
  function isAcceptCandidateActionable(el) {
    try {
      if (el.disabled === true) return false;
      if (typeof el.getClientRects === "function" && el.getClientRects().length === 0) return false;
      return true;
    } catch {
      return false;
    }
  }

  // The Sourcepoint decision-button marker: the "<N>" suffix of the element's
  // `sp_choice_type_<N>` class ("11"/"12"/"13"/"9"/"link"/…), or "" when the
  // element carries no such class (an incidental link, NOT a decision control).
  // findSpFreeAcceptTarget scopes the whole decision to elements where this is
  // non-empty, so incidental privacy/imprint/FAQ/login links never enter the
  // veto. Never throws.
  function acceptSpChoice(el) {
    try {
      const cls = typeof el.getAttribute === "function" ? el.getAttribute("class") : null;
      if (typeof cls !== "string" || cls.length === 0) return "";
      for (const token of cls.split(/\s+/)) {
        if (token.indexOf("sp_choice_type_") === 0) return token.slice("sp_choice_type_".length);
      }
      return "";
    } catch {
      return "";
    }
  }

  function collectAcceptCandidates() {
    const candidates = [];
    try {
      const nodes = document.querySelectorAll(ACCEPT_CANDIDATE_SELECTOR);
      for (const el of nodes) {
        candidates.push({
          text: acceptAccessibleName(el),
          fullText: acceptFullText(el),
          spChoice: acceptSpChoice(el),
          actionable: isAcceptCandidateActionable(el),
          ref: el,
        });
      }
    } catch {
      // document not ready / detached — leave candidates empty (NOOP).
    }
    return candidates;
  }

  // The dispatch itself. Fires ONLY when every one of these holds, checked
  // in this exact order: the accept-click double-gate is open (mode+gesture
  // +enabled+onboarded+not-exempt, computed above); this is NOT the top
  // frame (a consent-or-pay dialog never renders there); the frame's own
  // shape matches the Sourcepoint consent-or-pay message-iframe URL shape
  // (isPaywallFrame — MANDATORY, a bare cross-origin iframe is not enough,
  // C1/F1; FIX 1 now matches the real percent-encoded consent_origin marker);
  // NO free reject/settings control exists ANYWHERE on the wall
  // (hasFreeRejectControl over ALL collected candidates — including <a href>
  // anchors, so a free reject rendered as a plain link still blocks the click,
  // F1 — a free reject always wins, this NEVER double-guesses against the reject
  // engine); and the SP-STRUCTURAL resolver returns EXACTLY ONE free-accept (the
  // sp_choice_type_11 button) with a non-accept alternative decision button
  // present and no settings/reject choice anywhere in the decision set
  // (findSpFreeAcceptTarget). Incidental privacy/imprint/FAQ links carry no
  // sp_choice class and no reject token, so they never trigger a veto (the
  // recalibration that lets a real hard wall fire). Any ambiguity, any
  // pay-classified type-11, any reachable free reject, or any missing signal
  // resolves to a NOOP — this function never guesses.
  function runAcceptClickDispatcher() {
    if (_acceptActed || !_acceptGateOpen) return;
    const { isTopFrame, topHostname } = resolveFrameIdentity();
    if (isTopFrame) return;
    const env = {
      isTopFrame: false,
      frameUrl: location.href,
      frameHost: location.hostname,
      topHost: topHostname,
    };
    if (!isPaywallFrame(env)) return;
    const candidates = collectAcceptCandidates();
    // FIX F1: run the reject/settings safety net over ALL collected candidates
    // (including <a href> anchors). A free reject rendered as a plain link (e.g.
    // "Weiterlesen ohne Zustimmung") must block the accept-click. An anchor only
    // vetoes when it carries a REJECT/SETTINGS token — an incidental privacy/
    // imprint/FAQ link classifies "unknown" and never false-vetoes here. The
    // accept TARGET stays SP-scoped (findSpFreeAcceptTarget below).
    if (hasFreeRejectControl(candidates)) return;
    const result = findSpFreeAcceptTarget(candidates);
    if (result.status !== "single") return;
    _acceptActed = true;
    try {
      result.target.ref.click();
    } catch {
      // A throwing/hostile page element must never break the page.
    }
    acceptStopObserver();
  }

  // Bounded give-up window — same rationale and shape as the reject
  // dispatchers' own give-up windows above (a consent-or-pay wall that is
  // going to appear does so within a few seconds of a settled DOM).
  // Fail-closed: giving up just disconnects the observer, never clicks.
  function acceptArmGiveUp() {
    if (_acceptGiveUpArmed) return;
    _acceptGiveUpArmed = true;
    const schedule = () => {
      _acceptGiveUpTimer = setTimeout(() => {
        _acceptGiveUpTimer = null;
        if (!_acceptActed) acceptStopObserver();
      }, ACCEPT_GIVE_UP_AFTER_DOM_READY_MS);
    };
    if (document.readyState === "loading") {
      _acceptGiveUpFallbackTimer = setTimeout(() => {
        _acceptGiveUpFallbackTimer = null;
        if (!_acceptActed) acceptStopObserver();
      }, ACCEPT_GIVE_UP_AFTER_DOM_READY_MS);
      document.addEventListener("DOMContentLoaded", schedule, { once: true });
    } else {
      schedule();
    }
  }

  function acceptStartObserver() {
    if (_acceptObserver || _acceptActed) return;
    if (!document || !document.documentElement) return;
    try {
      _acceptObserver = new MutationObserver(() => runAcceptClickDispatcher());
      _acceptObserver.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      _acceptObserver = null;
    }
    // Layout-driven actionability re-sweep (see ACCEPT_RESWEEP_INTERVAL_MS). The
    // give-up window (acceptStopObserver) clears this too, so it is bounded.
    if (_acceptResweepTimer === null) {
      try {
        _acceptResweepTimer = setInterval(() => {
          if (_acceptActed) return;
          runAcceptClickDispatcher();
        }, ACCEPT_RESWEEP_INTERVAL_MS);
      } catch {
        _acceptResweepTimer = null;
      }
    }
    acceptArmGiveUp();
  }

  function acceptStopObserver() {
    if (_acceptGiveUpTimer !== null) {
      clearTimeout(_acceptGiveUpTimer);
      _acceptGiveUpTimer = null;
    }
    if (_acceptGiveUpFallbackTimer !== null) {
      clearTimeout(_acceptGiveUpFallbackTimer);
      _acceptGiveUpFallbackTimer = null;
    }
    if (_acceptResweepTimer !== null) {
      clearInterval(_acceptResweepTimer);
      _acceptResweepTimer = null;
    }
    _acceptGiveUpArmed = false;
    if (!_acceptObserver) return;
    try {
      _acceptObserver.disconnect();
    } catch {
      // already disconnected
    }
    _acceptObserver = null;
  }

  // ── Sourcepoint reject-click dispatch (DOM fallback for postRejectAll) ────
  //
  // Real-site verification found the __tcfapi postRejectAll call above does
  // not dismiss Sourcepoint's own UI on real deployments even when the call
  // fires without throwing — a gap the Tier-1 API adapter's confidence gate
  // alone cannot close (see findSpRejectTarget's rationale, hand-copied from
  // src/lib/cmp-adapters.js below). This is a SEPARATE, additive action: a
  // DOM `element.click()` on the wall's own "Reject all" control, reusing
  // the SAME neutral DOM candidate scanner the consent-or-pay accept-click
  // feature already collects (collectAcceptCandidates — it only enumerates
  // buttons/links and their sp_choice_type_<N> class; it does not decide
  // what to click, findSpRejectTarget does, and that resolver only ever
  // recognizes "13"). Runs for BOTH browsers, in every frame
  // (all_frames:true already covers this file) — a DOM click needs neither
  // a page-authored global nor the MAIN world. Gated by the SAME reject
  // master gate (computeGate) as the Tier-1 API ladder above, so it never
  // runs outside the reject-only feature's own enabled/onboarded/not-exempt
  // gate. Marks itself acted ONLY after a real click on a confirmed single
  // target — never on mere detection, so a no-op is never reported as a
  // success.

  // @sync:cmp-sp-reject-click:start
  const SP_REJECT_ALL_CHOICE = "13";

  function findSpRejectTarget(candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    const matches = [];
    for (const candidate of list) {
      if (!candidate || typeof candidate !== "object") continue;
      if (candidate.spChoice !== SP_REJECT_ALL_CHOICE) continue;
      if (candidate.actionable !== true) continue;
      matches.push(candidate);
    }
    if (matches.length === 0) return { status: "noop", target: null };
    if (matches.length > 1) return { status: "ambiguous", target: null };
    return { status: "single", target: matches[0] };
  }

  // SP multi-layer: some walls expose ONLY a "12" ("Options"/"Manage") control,
  // with the real "Reject all" one layer deeper inside the panel it opens.
  // Resolves the SINGLE actionable "12" to click, but ONLY on an options-ONLY
  // wall — i.e. when NO other actionable decision control (a broad-consent "11",
  // a pay "9", a direct reject "13", or any other sp_choice button) is present. A
  // wall that also shows broad-consent/pay/reject is a consent-or-pay wall, not
  // the options-only shape this deep-reject traversal targets, so it is left
  // alone (the reject engine's direct "13" path and the separate consent-or-pay
  // feature own those). Opening a settings panel never grants consent
  // (monotone-safe); the deeper "13" is clicked by findSpRejectTarget on the next
  // observer pass. Incidental non-decision candidates (no sp_choice class, e.g.
  // privacy/imprint links) are ignored. Any ambiguity (zero, or more than one
  // actionable "12") is a NOOP. Pure; never throws.
  const SP_OPEN_SETTINGS_CHOICE = "12";

  function findSpOpenSettingsTarget(candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    const options = [];
    let otherActionableDecision = false;
    for (const candidate of list) {
      if (!candidate || typeof candidate !== "object") continue;
      if (candidate.actionable !== true) continue;
      if (typeof candidate.spChoice !== "string" || candidate.spChoice.length === 0) continue;
      if (candidate.spChoice === SP_OPEN_SETTINGS_CHOICE) {
        options.push(candidate);
      } else {
        // Any OTHER actionable sp_choice decision control (broad-consent "11",
        // pay "9", direct reject "13", …) means this is NOT an options-only wall.
        otherActionableDecision = true;
      }
    }
    if (otherActionableDecision) return { status: "noop", target: null };
    if (options.length === 0) return { status: "noop", target: null };
    if (options.length > 1) return { status: "ambiguous", target: null };
    return { status: "single", target: options[0] };
  }
  // @sync:cmp-sp-reject-click:end

  let _spRejectActed = false;
  let _spPmOpened = false;
  let _spRejectGateOpen = false;
  let _spRejectObserver = null;
  const SP_REJECT_GIVE_UP_AFTER_DOM_READY_MS = 10000;
  let _spRejectGiveUpArmed = false;
  let _spRejectGiveUpTimer = null;
  let _spRejectGiveUpFallbackTimer = null;

  // NOTE (real-site probe finding): the `sp_message_container` DOM anchor
  // (the pure detectSourcepoint signal's DOM anchor above) and the actual
  // `sp_choice_type_*` decision buttons do NOT necessarily share a frame —
  // on real deployments (e.g. pinknews.co.uk) the container div renders in
  // the TOP frame while the buttons render inside a separate cross-origin
  // `cdn.privacy-mgmt.com` iframe. A same-frame container pre-check would
  // silently block the dispatcher in the exact frame where the buttons
  // live. This dispatcher therefore does NOT gate on that DOM anchor at
  // all — it relies entirely on findSpRejectTarget's own specificity
  // (exactly one actionable "13" candidate) as the safety/precision
  // filter, mirroring how the consent-or-pay accept-click dispatcher above
  // has no DOM pre-check of its own either (all_frames:true already means
  // every frame pays this same, cheap, per-frame query cost).
  //
  // MULTI-LAYER (#1123 follow-up): a wall exposing ONLY choice type "12"
  // ("Options"/"Manage"/settings) — where the real reject control sits one
  // layer deeper, behind that secondary panel — is handled below via
  // findSpOpenSettingsTarget: the dispatcher clicks the single actionable "12"
  // ONCE (guarded by _spPmOpened) to reveal the deeper panel, then the observer
  // re-enters and clicks the revealed single "13" through findSpRejectTarget.
  // Opening the panel is monotone-safe (never grants consent) and success is
  // still only marked after a real "13" click, so a panel that never surfaces
  // a reachable "13" stays a fail-closed NOOP.
  function runSpRejectClickDispatcher() {
    if (_spRejectActed || !_spRejectGateOpen) return;
    const candidates = collectAcceptCandidates();
    const result = findSpRejectTarget(candidates);
    if (result.status === "single") {
      _spRejectActed = true;
      try {
        result.target.ref.click();
      } catch {
        // A throwing/hostile page element must never break the page.
      }
      spRejectStopObserver();
      return;
    }
    // Multi-layer (#1123 follow-up): no directly-reachable "13". If the wall
    // exposes exactly one actionable "12" ("Options"/"Manage") and we have not
    // opened the privacy-manager panel yet, click it ONCE to reveal the deeper
    // "Reject all". Opening a settings panel never grants consent
    // (monotone-safe), so this is NOT marked as success and the observer stays
    // live: the panel's render re-enters this dispatcher, which then clicks the
    // revealed single "13" via the branch above. A panel that never surfaces a
    // "13" resolves to a fail-closed NOOP when the bounded give-up window tears
    // the observer down.
    if (_spPmOpened) return;
    const settings = findSpOpenSettingsTarget(candidates);
    if (settings.status !== "single") return;
    _spPmOpened = true;
    try {
      settings.target.ref.click();
    } catch {
      // A throwing/hostile page element must never break the page.
    }
  }

  // Bounded give-up window — same rationale and shape as the reject/accept
  // dispatchers' own give-up windows above.
  function spRejectArmGiveUp() {
    if (_spRejectGiveUpArmed) return;
    _spRejectGiveUpArmed = true;
    const schedule = () => {
      _spRejectGiveUpTimer = setTimeout(() => {
        _spRejectGiveUpTimer = null;
        if (!_spRejectActed) spRejectStopObserver();
      }, SP_REJECT_GIVE_UP_AFTER_DOM_READY_MS);
    };
    if (document.readyState === "loading") {
      _spRejectGiveUpFallbackTimer = setTimeout(() => {
        _spRejectGiveUpFallbackTimer = null;
        if (!_spRejectActed) spRejectStopObserver();
      }, SP_REJECT_GIVE_UP_AFTER_DOM_READY_MS);
      document.addEventListener("DOMContentLoaded", schedule, { once: true });
    } else {
      schedule();
    }
  }

  function spRejectStartObserver() {
    if (_spRejectObserver || _spRejectActed) return;
    if (!document || !document.documentElement) return;
    try {
      _spRejectObserver = new MutationObserver(() => runSpRejectClickDispatcher());
      _spRejectObserver.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      _spRejectObserver = null;
    }
    spRejectArmGiveUp();
  }

  function spRejectStopObserver() {
    if (_spRejectGiveUpTimer !== null) {
      clearTimeout(_spRejectGiveUpTimer);
      _spRejectGiveUpTimer = null;
    }
    if (_spRejectGiveUpFallbackTimer !== null) {
      clearTimeout(_spRejectGiveUpFallbackTimer);
      _spRejectGiveUpFallbackTimer = null;
    }
    _spRejectGiveUpArmed = false;
    if (!_spRejectObserver) return;
    try {
      _spRejectObserver.disconnect();
    } catch {
      // already disconnected
    }
    _spRejectObserver = null;
  }

  function readPrefsAndGate() {
    try {
      chrome.runtime.sendMessage({ type: "getPrefs" }, (prefs) => {
        void chrome.runtime.lastError;
        const open = computeGate(prefs);
        // Always dispatch — harmless no-op on Firefox, where no MAIN-world
        // listener is ever loaded (no world:"MAIN" content script there).
        dispatchGate(open);
        if (_isFirefox) {
          _fxGateOpen = open;
          if (open) {
            fxRunDispatcher(); // initial sweep — the banner may already exist
            fxStartObserver();
          } else {
            fxStopObserver();
          }
        }
        // Accept-click gate + dispatch — runs directly in THIS world for
        // both browsers, independent of the reject gate/dispatch above.
        _acceptGateOpen = computeAcceptGateForFrame(prefs);
        if (_acceptGateOpen) {
          runAcceptClickDispatcher(); // initial sweep — the wall may already exist
          acceptStartObserver();
        } else {
          acceptStopObserver();
        }
        // Sourcepoint reject-click DOM fallback — runs directly in THIS
        // world for BOTH browsers, gated by the SAME reject master gate
        // (`open`) as the Tier-1 API ladder above, independent of `_isFirefox`.
        _spRejectGateOpen = open;
        if (_spRejectGateOpen) {
          runSpRejectClickDispatcher(); // initial sweep — the wall may already exist
          spRejectStartObserver();
        } else {
          spRejectStopObserver();
        }
      });
    } catch {
      // Extension context invalidated. Leave the gate closed.
    }
  }

  readPrefsAndGate();

  // Re-read on storage changes so toggling the feature in Settings closes
  // (or opens) the gate without a page reload.
  let _storageListenerInstalled = false;
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    if (!_storageListenerInstalled) {
      _storageListenerInstalled = true;
      chrome.storage.onChanged.addListener((_changes, area) => {
        if (area === "sync") readPrefsAndGate();
      });
    }
  }
  } catch {
    // Frame-safety (all_frames:true): this guards only the SYNCHRONOUS
    // setup above — dispatchNonceOnce()'s call, readPrefsAndGate()'s
    // initial call, and the storage.onChanged listener REGISTRATION — in
    // ANY frame (top, same-origin iframe, cross-origin consent iframe,
    // ad/embed iframe, restricted/opaque frame), e.g. `document`/`chrome.*`
    // being unavailable in a sandboxed frame. It does NOT reach code that
    // runs from a LATER event-loop turn: the getPrefs sendMessage
    // callback, the MutationObserver callback, the give-up setTimeout
    // callback, and the storage.onChanged callback itself all fire after
    // this try block's dynamic extent has already ended — each of those is
    // individually wrapped fail-closed where it is defined above.
  }
})();
