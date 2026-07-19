/**
 * MUGA — Cookie Consent Minimizer: cmp-adapters.js (#1027)
 *
 * Pure-logic tests for the OneTrust Tier 1 adapter and the two-tier
 * decision function. No DOM, no chrome.*, no globals — signals are
 * injected as plain objects, matching the pure-module contract described
 * in src/lib/cmp-adapters.js.
 *
 * Three groups:
 *   1. decideAction truth table — reject / hard-wall-noop / uncertain-noop.
 *   2. Multi-signal detect() confidence gate — mandatory + corroboration.
 *   3. STRUCTURAL never-auto-reject-the-other-way guard (own section,
 *      load-bearing — do NOT fold into the groups above). Statically
 *      scans the source for any trace of a consent-granting action.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  ACTIONS,
  TIER1,
  TIER2,
  oneTrustAdapter,
  cookiebotAdapter,
  didomiAdapter,
  cookieYesAdapter,
  sourcepointAdapter,
  usercentricsAdapter,
  cookieInformationAdapter,
  cookieScriptAdapter,
  tarteaucitronAdapter,
  consentmanagerAdapter,
  decideAction,
  computeCookieGate,
  findSpRejectTarget,
  findSpOpenSettingsTarget,
} from "../../src/lib/cmp-adapters.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Registry shape ──────────────────────────────────────────────────────────

describe("cmp-adapters — registry shape", () => {
  test("TIER1 contains exactly the OneTrust, Cookiebot, Didomi, CookieYes, Sourcepoint, Usercentrics, Cookie Information, CookieScript, tarteaucitron and consentmanager.net adapters, in order", () => {
    assert.equal(TIER1.length, 10);
    assert.strictEqual(TIER1[0], oneTrustAdapter);
    assert.strictEqual(TIER1[1], cookiebotAdapter);
    assert.strictEqual(TIER1[2], didomiAdapter);
    assert.strictEqual(TIER1[3], cookieYesAdapter);
    assert.strictEqual(TIER1[4], sourcepointAdapter);
    assert.strictEqual(TIER1[5], usercentricsAdapter);
    assert.strictEqual(TIER1[6], cookieInformationAdapter);
    assert.strictEqual(TIER1[7], cookieScriptAdapter);
    assert.strictEqual(TIER1[8], tarteaucitronAdapter);
    assert.strictEqual(TIER1[9], consentmanagerAdapter);
  });

  test("TIER2 ships empty in this slice", () => {
    assert.ok(Array.isArray(TIER2));
    assert.equal(TIER2.length, 0);
  });

  test("TIER1 and TIER2 are frozen", () => {
    assert.ok(Object.isFrozen(TIER1));
    assert.ok(Object.isFrozen(TIER2));
  });

  test("oneTrustAdapter exposes id, tier, detect, canReject, reject", () => {
    assert.equal(oneTrustAdapter.id, "onetrust");
    assert.equal(oneTrustAdapter.tier, 1);
    assert.equal(typeof oneTrustAdapter.detect, "function");
    assert.equal(typeof oneTrustAdapter.canReject, "function");
    assert.equal(typeof oneTrustAdapter.reject, "function");
  });

  test("cookiebotAdapter exposes id, tier, detect, canReject, reject", () => {
    assert.equal(cookiebotAdapter.id, "cookiebot");
    assert.equal(cookiebotAdapter.tier, 1);
    assert.equal(typeof cookiebotAdapter.detect, "function");
    assert.equal(typeof cookiebotAdapter.canReject, "function");
    assert.equal(typeof cookiebotAdapter.reject, "function");
  });

  test("didomiAdapter exposes id, tier, detect, canReject, reject", () => {
    assert.equal(didomiAdapter.id, "didomi");
    assert.equal(didomiAdapter.tier, 1);
    assert.equal(typeof didomiAdapter.detect, "function");
    assert.equal(typeof didomiAdapter.canReject, "function");
    assert.equal(typeof didomiAdapter.reject, "function");
  });

  test("cookieYesAdapter exposes id, tier, detect, canReject, reject", () => {
    assert.equal(cookieYesAdapter.id, "cookieyes");
    assert.equal(cookieYesAdapter.tier, 1);
    assert.equal(typeof cookieYesAdapter.detect, "function");
    assert.equal(typeof cookieYesAdapter.canReject, "function");
    assert.equal(typeof cookieYesAdapter.reject, "function");
  });

  test("sourcepointAdapter exposes id, tier, detect, canReject, reject", () => {
    assert.equal(sourcepointAdapter.id, "sourcepoint");
    assert.equal(sourcepointAdapter.tier, 1);
    assert.equal(typeof sourcepointAdapter.detect, "function");
    assert.equal(typeof sourcepointAdapter.canReject, "function");
    assert.equal(typeof sourcepointAdapter.reject, "function");
  });

  test("usercentricsAdapter exposes id, tier, detect, canReject, reject", () => {
    assert.equal(usercentricsAdapter.id, "usercentrics");
    assert.equal(usercentricsAdapter.tier, 1);
    assert.equal(typeof usercentricsAdapter.detect, "function");
    assert.equal(typeof usercentricsAdapter.canReject, "function");
    assert.equal(typeof usercentricsAdapter.reject, "function");
  });

  test("cookieInformationAdapter exposes id, tier, detect, canReject, reject", () => {
    assert.equal(cookieInformationAdapter.id, "cookieinformation");
    assert.equal(cookieInformationAdapter.tier, 1);
    assert.equal(typeof cookieInformationAdapter.detect, "function");
    assert.equal(typeof cookieInformationAdapter.canReject, "function");
    assert.equal(typeof cookieInformationAdapter.reject, "function");
  });

  test("cookieScriptAdapter exposes id, tier, detect, canReject, reject", () => {
    assert.equal(cookieScriptAdapter.id, "cookiescript");
    assert.equal(cookieScriptAdapter.tier, 1);
    assert.equal(typeof cookieScriptAdapter.detect, "function");
    assert.equal(typeof cookieScriptAdapter.canReject, "function");
    assert.equal(typeof cookieScriptAdapter.reject, "function");
  });

  test("tarteaucitronAdapter exposes id, tier, detect, canReject, reject", () => {
    assert.equal(tarteaucitronAdapter.id, "tarteaucitron");
    assert.equal(tarteaucitronAdapter.tier, 1);
    assert.equal(typeof tarteaucitronAdapter.detect, "function");
    assert.equal(typeof tarteaucitronAdapter.canReject, "function");
    assert.equal(typeof tarteaucitronAdapter.reject, "function");
  });

  test("consentmanagerAdapter exposes id, tier, detect, canReject, reject", () => {
    assert.equal(consentmanagerAdapter.id, "consentmanager");
    assert.equal(consentmanagerAdapter.tier, 1);
    assert.equal(typeof consentmanagerAdapter.detect, "function");
    assert.equal(typeof consentmanagerAdapter.canReject, "function");
    assert.equal(typeof consentmanagerAdapter.reject, "function");
  });

  test("ACTIONS is a closed set containing only the reject-family action", () => {
    assert.deepEqual(Object.keys(ACTIONS), ["REJECT_ALL"]);
    assert.equal(ACTIONS.REJECT_ALL, "reject-all");
  });
});

// ── decideAction — exhaustive truth table ───────────────────────────────────

const FULL_SIGNALS = Object.freeze({
  hasOneTrustGlobal: true,
  hasRejectAllFn: true,
  hasBannerDom: true,
  hasActiveGroupsGlobal: true,
  hasRejectHandlerDom: true,
});

describe("decideAction — truth table", () => {
  test("RejectAll present + corroborated -> reject", () => {
    const r = decideAction(FULL_SIGNALS);
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "onetrust");
  });

  test("OneTrust global present but RejectAll absent (hard wall) -> NOOP, adapterId threaded", () => {
    const r = decideAction({
      hasOneTrustGlobal: true,
      hasRejectAllFn: false,
      hasBannerDom: true,
      hasActiveGroupsGlobal: true,
      hasRejectHandlerDom: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
    assert.equal(r.adapterId, "onetrust");
  });

  test("no signals at all (non-OneTrust page) -> NOOP, uncertain", () => {
    const r = decideAction({});
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("null/undefined signals -> NOOP, uncertain, never throws", () => {
    assert.doesNotThrow(() => decideAction(null));
    assert.doesNotThrow(() => decideAction(undefined));
    assert.equal(decideAction(null).action, null);
    assert.equal(decideAction(undefined).reason, "uncertain");
  });

  test("mandatory signal present but zero corroboration -> NOOP, uncertain (fail-closed)", () => {
    const r = decideAction({
      hasOneTrustGlobal: true,
      hasRejectAllFn: true,
      hasBannerDom: false,
      hasActiveGroupsGlobal: false,
      hasRejectHandlerDom: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("Cookiebot submitCustomConsent present + corroborated -> reject", () => {
    const r = decideAction({
      hasCookiebotGlobal: true,
      hasSubmitCustomConsentFn: true,
      hasCybotDialogDom: true,
      hasConsentObjectGlobal: true,
      hasResponseBooleanGlobal: true,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "cookiebot");
  });

  test("Cookiebot global present but submitCustomConsent absent (hard wall) -> NOOP, adapterId threaded", () => {
    const r = decideAction({
      hasCookiebotGlobal: true,
      hasSubmitCustomConsentFn: false,
      hasCybotDialogDom: true,
      hasConsentObjectGlobal: true,
      hasResponseBooleanGlobal: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
    assert.equal(r.adapterId, "cookiebot");
  });

  test("Cookiebot mandatory signal present but zero corroboration -> NOOP, uncertain (fail-closed)", () => {
    const r = decideAction({
      hasCookiebotGlobal: true,
      hasSubmitCustomConsentFn: true,
      hasCybotDialogDom: false,
      hasConsentObjectGlobal: false,
      hasResponseBooleanGlobal: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("Didomi setUserDisagreeToAll present + corroborated -> reject", () => {
    const r = decideAction({
      hasDidomiGlobal: true,
      hasSetUserDisagreeToAllFn: true,
      hasDidomiHostDom: true,
      hasGetCurrentUserStatusFn: true,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "didomi");
  });

  test("Didomi global present but setUserDisagreeToAll absent (hard wall) -> NOOP, adapterId threaded", () => {
    const r = decideAction({
      hasDidomiGlobal: true,
      hasSetUserDisagreeToAllFn: false,
      hasDidomiHostDom: true,
      hasGetCurrentUserStatusFn: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
    assert.equal(r.adapterId, "didomi");
  });

  test("Didomi mandatory signal present but zero corroboration -> NOOP, uncertain (fail-closed)", () => {
    const r = decideAction({
      hasDidomiGlobal: true,
      hasSetUserDisagreeToAllFn: true,
      hasDidomiHostDom: false,
      hasGetCurrentUserStatusFn: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("CookieYes: both bare globals + corroborating DOM -> reject", () => {
    const r = decideAction({
      hasGetCkyConsentFn: true,
      hasPerformBannerActionFn: true,
      hasCkyConsentContainerDom: true,
      hasCkyOverlayDom: true,
      hasCkyConsentBarDom: false,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "cookieyes");
  });

  test("CookieYes: performBannerAction present but getCkyConsent missing (only one global) -> NOOP, uncertain", () => {
    const r = decideAction({
      hasGetCkyConsentFn: false,
      hasPerformBannerActionFn: true,
      hasCkyConsentContainerDom: true,
      hasCkyOverlayDom: true,
      hasCkyConsentBarDom: true,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("CookieYes: getCkyConsent present but performBannerAction missing (hard wall) -> NOOP, no-reject-path, adapterId threaded", () => {
    const r = decideAction({
      hasGetCkyConsentFn: true,
      hasPerformBannerActionFn: false,
      hasCkyConsentContainerDom: true,
      hasCkyOverlayDom: true,
      hasCkyConsentBarDom: true,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
    assert.equal(r.adapterId, "cookieyes");
  });

  test("CookieYes: both globals present but zero DOM corroboration -> NOOP, uncertain (fail-closed)", () => {
    const r = decideAction({
      hasGetCkyConsentFn: true,
      hasPerformBannerActionFn: true,
      hasCkyConsentContainerDom: false,
      hasCkyOverlayDom: false,
      hasCkyConsentBarDom: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("Sourcepoint: __tcfapi fn + sp_message_container DOM + corroboration -> reject", () => {
    const r = decideAction({
      hasTcfApiFn: true,
      hasSpMessageContainerDom: true,
      hasSpPrivacyMgmtIframeDom: true,
      hasSpProdIframeDom: false,
      hasSpProdScriptDom: false,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "sourcepoint");
  });

  test("Sourcepoint: sp_message_container DOM present but __tcfapi missing (hard wall) -> NOOP, no-reject-path, adapterId threaded", () => {
    const r = decideAction({
      hasTcfApiFn: false,
      hasSpMessageContainerDom: true,
      hasSpPrivacyMgmtIframeDom: true,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
    assert.equal(r.adapterId, "sourcepoint");
  });

  test("Sourcepoint: __tcfapi present but sp_message_container DOM missing -> NOOP, uncertain (generic TCF CMP, not Sourcepoint)", () => {
    const r = decideAction({
      hasTcfApiFn: true,
      hasSpMessageContainerDom: false,
      hasSpPrivacyMgmtIframeDom: true,
      hasSpProdIframeDom: true,
      hasSpProdScriptDom: true,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("Sourcepoint: both mandatory signals present but zero corroboration -> NOOP, uncertain (fail-closed)", () => {
    const r = decideAction({
      hasTcfApiFn: true,
      hasSpMessageContainerDom: true,
      hasSpPrivacyMgmtIframeDom: false,
      hasSpProdIframeDom: false,
      hasSpProdScriptDom: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("Didomi-shaped signals (window.Didomi + __tcfapi, NO sp_message_container) resolve to Didomi, never misfire as Sourcepoint", () => {
    const r = decideAction({
      hasDidomiGlobal: true,
      hasSetUserDisagreeToAllFn: true,
      hasDidomiHostDom: true,
      hasGetCurrentUserStatusFn: true,
      hasTcfApiFn: true,
      hasSpMessageContainerDom: false,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "didomi");
  });

  test("Usercentrics: UC_UI global + denyAllConsents fn + corroborating DOM host -> reject", () => {
    const r = decideAction({
      hasUcUiGlobal: true,
      hasDenyAllConsentsFn: true,
      hasUsercentricsRootDom: true,
      hasIsInitializedFn: true,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "usercentrics");
  });

  test("Usercentrics: UC_UI global present but denyAllConsents absent (hard wall) -> NOOP, adapterId threaded", () => {
    const r = decideAction({
      hasUcUiGlobal: true,
      hasDenyAllConsentsFn: false,
      hasUsercentricsRootDom: true,
      hasIsInitializedFn: true,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
    assert.equal(r.adapterId, "usercentrics");
  });

  test("Usercentrics mandatory signals present but zero corroboration -> NOOP, uncertain (fail-closed)", () => {
    const r = decideAction({
      hasUcUiGlobal: true,
      hasDenyAllConsentsFn: true,
      hasUsercentricsRootDom: false,
      hasIsInitializedFn: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("Didomi-shaped signals (window.Didomi, NO UC_UI) resolve to Didomi, never misfire as Usercentrics", () => {
    const r = decideAction({
      hasDidomiGlobal: true,
      hasSetUserDisagreeToAllFn: true,
      hasDidomiHostDom: true,
      hasGetCurrentUserStatusFn: true,
      hasUcUiGlobal: false,
      hasDenyAllConsentsFn: false,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "didomi");
  });

  test("TCF-shaped signals (__tcfapi + sp_message_container, NO UC_UI) resolve to Sourcepoint, never misfire as Usercentrics", () => {
    const r = decideAction({
      hasTcfApiFn: true,
      hasSpMessageContainerDom: true,
      hasSpPrivacyMgmtIframeDom: true,
      hasUcUiGlobal: false,
      hasDenyAllConsentsFn: false,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "sourcepoint");
  });

  test("Cookie Information: CookieInformation global + declineAllCategories fn + corroborating DOM -> reject", () => {
    const r = decideAction({
      hasCookieInformationGlobal: true,
      hasDeclineAllCategoriesFn: true,
      hasCoiOverlayDom: true,
      hasCoiConsentBannerDom: false,
      hasCoiSummeryDom: false,
      hasCoiBannerWrapperDom: false,
      hasCoiConsentSummaryDom: false,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "cookieinformation");
  });

  test("Cookie Information: global present but declineAllCategories absent (hard wall) -> NOOP, no-reject-path, adapterId threaded", () => {
    const r = decideAction({
      hasCookieInformationGlobal: true,
      hasDeclineAllCategoriesFn: false,
      hasCoiOverlayDom: true,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
    assert.equal(r.adapterId, "cookieinformation");
  });

  test("Cookie Information: mandatory signals present but zero DOM corroboration -> NOOP, uncertain (fail-closed)", () => {
    const r = decideAction({
      hasCookieInformationGlobal: true,
      hasDeclineAllCategoriesFn: true,
      hasCoiOverlayDom: false,
      hasCoiConsentBannerDom: false,
      hasCoiSummeryDom: false,
      hasCoiBannerWrapperDom: false,
      hasCoiConsentSummaryDom: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("Cookie Information: __tcfapi ALSO present (opt-in TCF mode) still resolves to cookieinformation, never misfires as Sourcepoint/uncertain", () => {
    const r = decideAction({
      hasCookieInformationGlobal: true,
      hasDeclineAllCategoriesFn: true,
      hasCoiOverlayDom: true,
      hasTcfApiFn: true,
      hasSpMessageContainerDom: false,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "cookieinformation");
  });

  test("CookieScript: global + instance + rejectAllAction fn + corroborating DOM -> reject", () => {
    const r = decideAction({
      hasCookieScriptGlobal: true,
      hasCookieScriptInstance: true,
      hasRejectAllActionFn: true,
      hasCookiescriptInjectedDom: true,
      hasCookiescriptDescriptionDom: false,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "cookiescript");
  });

  test("CookieScript: global present but instance/rejectAllAction absent (hard wall) -> NOOP, no-reject-path, adapterId threaded", () => {
    const r = decideAction({
      hasCookieScriptGlobal: true,
      hasCookieScriptInstance: false,
      hasRejectAllActionFn: false,
      hasCookiescriptInjectedDom: true,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
    assert.equal(r.adapterId, "cookiescript");
  });

  test("CookieScript: global + instance present but rejectAllAction fn absent (hard wall) -> NOOP, no-reject-path, adapterId threaded", () => {
    const r = decideAction({
      hasCookieScriptGlobal: true,
      hasCookieScriptInstance: true,
      hasRejectAllActionFn: false,
      hasCookiescriptInjectedDom: true,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
    assert.equal(r.adapterId, "cookiescript");
  });

  test("CookieScript: mandatory signals present but zero DOM corroboration -> NOOP, uncertain (fail-closed)", () => {
    const r = decideAction({
      hasCookieScriptGlobal: true,
      hasCookieScriptInstance: true,
      hasRejectAllActionFn: true,
      hasCookiescriptInjectedDom: false,
      hasCookiescriptDescriptionDom: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("tarteaucitron: global + userInterface + respondAll fn + corroborating DOM -> reject", () => {
    const r = decideAction({
      hasTarteaucitronGlobal: true,
      hasTarteaucitronUserInterface: true,
      hasRespondAllFn: true,
      hasTarteaucitronRootDom: true,
      hasTarteaucitronAlertBigDom: false,
      hasTarteaucitronBackDom: false,
      hasTarteaucitronModalOpenDom: false,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "tarteaucitron");
  });

  test("tarteaucitron: global present but userInterface/respondAll absent (hard wall) -> NOOP, no-reject-path, adapterId threaded", () => {
    const r = decideAction({
      hasTarteaucitronGlobal: true,
      hasTarteaucitronUserInterface: false,
      hasRespondAllFn: false,
      hasTarteaucitronRootDom: true,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
    assert.equal(r.adapterId, "tarteaucitron");
  });

  test("tarteaucitron: global + userInterface present but respondAll fn absent (hard wall) -> NOOP, no-reject-path, adapterId threaded", () => {
    const r = decideAction({
      hasTarteaucitronGlobal: true,
      hasTarteaucitronUserInterface: true,
      hasRespondAllFn: false,
      hasTarteaucitronRootDom: true,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
    assert.equal(r.adapterId, "tarteaucitron");
  });

  test("tarteaucitron: mandatory signals present but zero DOM corroboration -> NOOP, uncertain (fail-closed)", () => {
    const r = decideAction({
      hasTarteaucitronGlobal: true,
      hasTarteaucitronUserInterface: true,
      hasRespondAllFn: true,
      hasTarteaucitronRootDom: false,
      hasTarteaucitronAlertBigDom: false,
      hasTarteaucitronBackDom: false,
      hasTarteaucitronModalOpenDom: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("consentmanager.net: cmpmngr global + __cmp fn + #cmpbox DOM + corroborating DOM -> reject", () => {
    const r = decideAction({
      hasCmpMngrGlobal: true,
      hasCmpFn: true,
      hasCmpBoxDom: true,
      hasCmpWelcomeBtnYesDom: true,
      hasCmpWelcomeBtnNoDom: false,
      hasCmpBoxBtnDom: false,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "consentmanager");
  });

  test("consentmanager.net: #cmpbox DOM present but cmpmngr global missing (hard wall) -> NOOP, no-reject-path, adapterId threaded", () => {
    const r = decideAction({
      hasCmpMngrGlobal: false,
      hasCmpFn: true,
      hasCmpBoxDom: true,
      hasCmpWelcomeBtnYesDom: true,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
    assert.equal(r.adapterId, "consentmanager");
  });

  test("consentmanager.net: #cmpbox DOM present but __cmp fn missing (hard wall) -> NOOP, no-reject-path, adapterId threaded", () => {
    const r = decideAction({
      hasCmpMngrGlobal: true,
      hasCmpFn: false,
      hasCmpBoxDom: true,
      hasCmpWelcomeBtnYesDom: true,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
    assert.equal(r.adapterId, "consentmanager");
  });

  test("consentmanager.net: cmpmngr + __cmp present but #cmpbox DOM missing -> NOOP, uncertain (generic TCF v1.1 CMP, not consentmanager.net)", () => {
    const r = decideAction({
      hasCmpMngrGlobal: true,
      hasCmpFn: true,
      hasCmpBoxDom: false,
      hasCmpWelcomeBtnYesDom: true,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("consentmanager.net: all three mandatory signals present but zero DOM corroboration -> NOOP, uncertain (fail-closed)", () => {
    const r = decideAction({
      hasCmpMngrGlobal: true,
      hasCmpFn: true,
      hasCmpBoxDom: true,
      hasCmpWelcomeBtnYesDom: false,
      hasCmpWelcomeBtnNoDom: false,
      hasCmpBoxBtnDom: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("bare __cmp function present alone (no cmpmngr, no #cmpbox) -> NOOP, uncertain — never misfires as consentmanager.net", () => {
    const r = decideAction({
      hasCmpFn: true,
      hasCmpMngrGlobal: false,
      hasCmpBoxDom: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("Sourcepoint-shaped signals (__tcfapi + sp_message_container, NO cmpmngr/#cmpbox) resolve to Sourcepoint, never misfire as consentmanager.net", () => {
    const r = decideAction({
      hasTcfApiFn: true,
      hasSpMessageContainerDom: true,
      hasSpPrivacyMgmtIframeDom: true,
      hasCmpMngrGlobal: false,
      hasCmpFn: false,
      hasCmpBoxDom: false,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "sourcepoint");
  });
});

// ── detect() / canReject() — multi-signal confidence gate ──────────────────

describe("oneTrustAdapter.detect — confidence gate", () => {
  test("mandatory + >=1 secondary -> confidence at ceiling, canReject true", () => {
    const c = oneTrustAdapter.detect(FULL_SIGNALS);
    assert.ok(c >= 1);
    assert.equal(oneTrustAdapter.canReject(FULL_SIGNALS), true);
  });

  test("mandatory + exactly one secondary (DOM banner only) -> canReject true", () => {
    const s = {
      hasOneTrustGlobal: true,
      hasRejectAllFn: true,
      hasBannerDom: true,
      hasActiveGroupsGlobal: false,
      hasRejectHandlerDom: false,
    };
    assert.equal(oneTrustAdapter.canReject(s), true);
  });

  test("global-only (mandatory present, zero secondary signals) -> uncertain, canReject false", () => {
    const s = {
      hasOneTrustGlobal: true,
      hasRejectAllFn: true,
      hasBannerDom: false,
      hasActiveGroupsGlobal: false,
      hasRejectHandlerDom: false,
    };
    assert.equal(oneTrustAdapter.canReject(s), false);
    assert.ok(oneTrustAdapter.detect(s) < 1);
  });

  test("DOM-only (mandatory RejectAll fn missing) -> confidence 0, canReject false", () => {
    const s = {
      hasOneTrustGlobal: false,
      hasRejectAllFn: false,
      hasBannerDom: true,
      hasActiveGroupsGlobal: true,
      hasRejectHandlerDom: true,
    };
    assert.equal(oneTrustAdapter.detect(s), 0);
    assert.equal(oneTrustAdapter.canReject(s), false);
  });

  test("malformed/missing signals object never throws", () => {
    assert.doesNotThrow(() => oneTrustAdapter.detect(null));
    assert.doesNotThrow(() => oneTrustAdapter.detect(undefined));
    assert.equal(oneTrustAdapter.detect(null), 0);
  });
});

describe("cookiebotAdapter.detect — confidence gate", () => {
  const FULL_COOKIEBOT_SIGNALS = Object.freeze({
    hasCookiebotGlobal: true,
    hasSubmitCustomConsentFn: true,
    hasCybotDialogDom: true,
    hasConsentObjectGlobal: true,
    hasResponseBooleanGlobal: true,
  });

  test("mandatory + >=1 secondary -> confidence at ceiling, canReject true", () => {
    const c = cookiebotAdapter.detect(FULL_COOKIEBOT_SIGNALS);
    assert.ok(c >= 1);
    assert.equal(cookiebotAdapter.canReject(FULL_COOKIEBOT_SIGNALS), true);
  });

  test("mandatory + exactly one secondary (Cybot dialog DOM only) -> canReject true", () => {
    const s = {
      hasCookiebotGlobal: true,
      hasSubmitCustomConsentFn: true,
      hasCybotDialogDom: true,
      hasConsentObjectGlobal: false,
      hasResponseBooleanGlobal: false,
    };
    assert.equal(cookiebotAdapter.canReject(s), true);
  });

  test("global-only (mandatory present, zero secondary signals) -> uncertain, canReject false", () => {
    const s = {
      hasCookiebotGlobal: true,
      hasSubmitCustomConsentFn: true,
      hasCybotDialogDom: false,
      hasConsentObjectGlobal: false,
      hasResponseBooleanGlobal: false,
    };
    assert.equal(cookiebotAdapter.canReject(s), false);
    assert.ok(cookiebotAdapter.detect(s) < 1);
  });

  test("DOM-only (mandatory submitCustomConsent fn missing) -> confidence 0, canReject false", () => {
    const s = {
      hasCookiebotGlobal: false,
      hasSubmitCustomConsentFn: false,
      hasCybotDialogDom: true,
      hasConsentObjectGlobal: true,
      hasResponseBooleanGlobal: true,
    };
    assert.equal(cookiebotAdapter.detect(s), 0);
    assert.equal(cookiebotAdapter.canReject(s), false);
  });

  test("malformed/missing signals object never throws", () => {
    assert.doesNotThrow(() => cookiebotAdapter.detect(null));
    assert.doesNotThrow(() => cookiebotAdapter.detect(undefined));
    assert.equal(cookiebotAdapter.detect(null), 0);
  });
});

describe("didomiAdapter.detect — confidence gate", () => {
  const FULL_DIDOMI_SIGNALS = Object.freeze({
    hasDidomiGlobal: true,
    hasSetUserDisagreeToAllFn: true,
    hasDidomiHostDom: true,
    hasGetCurrentUserStatusFn: true,
  });

  test("mandatory + >=1 secondary -> confidence at ceiling, canReject true", () => {
    const c = didomiAdapter.detect(FULL_DIDOMI_SIGNALS);
    assert.ok(c >= 1);
    assert.equal(didomiAdapter.canReject(FULL_DIDOMI_SIGNALS), true);
  });

  test("mandatory + exactly one secondary (#didomi-host DOM only) -> canReject true", () => {
    const s = {
      hasDidomiGlobal: true,
      hasSetUserDisagreeToAllFn: true,
      hasDidomiHostDom: true,
      hasGetCurrentUserStatusFn: false,
    };
    assert.equal(didomiAdapter.canReject(s), true);
  });

  test("global-only (mandatory present, zero secondary signals) -> uncertain, canReject false", () => {
    const s = {
      hasDidomiGlobal: true,
      hasSetUserDisagreeToAllFn: true,
      hasDidomiHostDom: false,
      hasGetCurrentUserStatusFn: false,
    };
    assert.equal(didomiAdapter.canReject(s), false);
    assert.ok(didomiAdapter.detect(s) < 1);
  });

  test("DOM-only (mandatory setUserDisagreeToAll fn missing) -> confidence 0, canReject false", () => {
    const s = {
      hasDidomiGlobal: false,
      hasSetUserDisagreeToAllFn: false,
      hasDidomiHostDom: true,
      hasGetCurrentUserStatusFn: true,
    };
    assert.equal(didomiAdapter.detect(s), 0);
    assert.equal(didomiAdapter.canReject(s), false);
  });

  test("malformed/missing signals object never throws", () => {
    assert.doesNotThrow(() => didomiAdapter.detect(null));
    assert.doesNotThrow(() => didomiAdapter.detect(undefined));
    assert.equal(didomiAdapter.detect(null), 0);
  });
});

describe("cookieYesAdapter.detect — dual-mandatory confidence gate", () => {
  const FULL_COOKIEYES_SIGNALS = Object.freeze({
    hasGetCkyConsentFn: true,
    hasPerformBannerActionFn: true,
    hasCkyConsentContainerDom: true,
    hasCkyOverlayDom: true,
    hasCkyConsentBarDom: true,
  });

  test("both mandatory globals + >=1 secondary -> confidence at ceiling, canReject true", () => {
    const c = cookieYesAdapter.detect(FULL_COOKIEYES_SIGNALS);
    assert.ok(c >= 1);
    assert.equal(cookieYesAdapter.canReject(FULL_COOKIEYES_SIGNALS), true);
  });

  test("both mandatory globals + exactly one secondary (.cky-consent-container only) -> canReject true", () => {
    const s = {
      hasGetCkyConsentFn: true,
      hasPerformBannerActionFn: true,
      hasCkyConsentContainerDom: true,
      hasCkyOverlayDom: false,
      hasCkyConsentBarDom: false,
    };
    assert.equal(cookieYesAdapter.canReject(s), true);
  });

  test("both mandatory globals present, zero DOM corroboration -> uncertain, canReject false", () => {
    const s = {
      hasGetCkyConsentFn: true,
      hasPerformBannerActionFn: true,
      hasCkyConsentContainerDom: false,
      hasCkyOverlayDom: false,
      hasCkyConsentBarDom: false,
    };
    assert.equal(cookieYesAdapter.canReject(s), false);
    assert.ok(cookieYesAdapter.detect(s) < 1);
  });

  test("only getCkyConsent present (performBannerAction missing) -> confidence 0, canReject false", () => {
    const s = {
      hasGetCkyConsentFn: true,
      hasPerformBannerActionFn: false,
      hasCkyConsentContainerDom: true,
      hasCkyOverlayDom: true,
      hasCkyConsentBarDom: true,
    };
    assert.equal(cookieYesAdapter.detect(s), 0);
    assert.equal(cookieYesAdapter.canReject(s), false);
  });

  test("only performBannerAction present (getCkyConsent missing) -> confidence 0, canReject false", () => {
    const s = {
      hasGetCkyConsentFn: false,
      hasPerformBannerActionFn: true,
      hasCkyConsentContainerDom: true,
      hasCkyOverlayDom: true,
      hasCkyConsentBarDom: true,
    };
    assert.equal(cookieYesAdapter.detect(s), 0);
    assert.equal(cookieYesAdapter.canReject(s), false);
  });

  test("DOM-only (both mandatory globals missing) -> confidence 0, canReject false", () => {
    const s = {
      hasGetCkyConsentFn: false,
      hasPerformBannerActionFn: false,
      hasCkyConsentContainerDom: true,
      hasCkyOverlayDom: true,
      hasCkyConsentBarDom: true,
    };
    assert.equal(cookieYesAdapter.detect(s), 0);
    assert.equal(cookieYesAdapter.canReject(s), false);
  });

  test("malformed/missing signals object never throws", () => {
    assert.doesNotThrow(() => cookieYesAdapter.detect(null));
    assert.doesNotThrow(() => cookieYesAdapter.detect(undefined));
    assert.equal(cookieYesAdapter.detect(null), 0);
  });
});

describe("sourcepointAdapter.detect — dual-mandatory TCF-generic-signal discrimination", () => {
  const FULL_SP_SIGNALS = Object.freeze({
    hasTcfApiFn: true,
    hasSpMessageContainerDom: true,
    hasSpPrivacyMgmtIframeDom: true,
    hasSpProdIframeDom: true,
    hasSpProdScriptDom: true,
  });

  test("both mandatory signals + >=1 secondary -> confidence at ceiling, canReject true", () => {
    const c = sourcepointAdapter.detect(FULL_SP_SIGNALS);
    assert.ok(c >= 1);
    assert.equal(sourcepointAdapter.canReject(FULL_SP_SIGNALS), true);
  });

  test("both mandatory signals + exactly one secondary (privacy-mgmt.com iframe only) -> canReject true", () => {
    const s = {
      hasTcfApiFn: true,
      hasSpMessageContainerDom: true,
      hasSpPrivacyMgmtIframeDom: true,
      hasSpProdIframeDom: false,
      hasSpProdScriptDom: false,
    };
    assert.equal(sourcepointAdapter.canReject(s), true);
  });

  test("both mandatory signals present, zero DOM corroboration -> uncertain, canReject false (fail-closed)", () => {
    const s = {
      hasTcfApiFn: true,
      hasSpMessageContainerDom: true,
      hasSpPrivacyMgmtIframeDom: false,
      hasSpProdIframeDom: false,
      hasSpProdScriptDom: false,
    };
    assert.equal(sourcepointAdapter.canReject(s), false);
    assert.ok(sourcepointAdapter.detect(s) < 1);
  });

  test("__tcfapi present but sp_message_container DOM missing -> confidence 0 (generic TCF CMP, e.g. Didomi)", () => {
    const s = {
      hasTcfApiFn: true,
      hasSpMessageContainerDom: false,
      hasSpPrivacyMgmtIframeDom: true,
      hasSpProdIframeDom: true,
      hasSpProdScriptDom: true,
    };
    assert.equal(sourcepointAdapter.detect(s), 0);
    assert.equal(sourcepointAdapter.canReject(s), false);
  });

  test("sp_message_container DOM present but __tcfapi missing -> confidence 0, canReject false", () => {
    const s = {
      hasTcfApiFn: false,
      hasSpMessageContainerDom: true,
      hasSpPrivacyMgmtIframeDom: true,
      hasSpProdIframeDom: true,
      hasSpProdScriptDom: true,
    };
    assert.equal(sourcepointAdapter.detect(s), 0);
    assert.equal(sourcepointAdapter.canReject(s), false);
  });

  test("Didomi-shaped signal set (window.Didomi + __tcfapi, NO sp_message_container) yields NOOP (confidence 0) for the Sourcepoint adapter", () => {
    const s = {
      hasDidomiGlobal: true,
      hasSetUserDisagreeToAllFn: true,
      hasDidomiHostDom: true,
      hasGetCurrentUserStatusFn: true,
      hasTcfApiFn: true,
      hasSpMessageContainerDom: false,
    };
    assert.equal(sourcepointAdapter.detect(s), 0);
    assert.equal(sourcepointAdapter.canReject(s), false);
  });

  test("malformed/missing signals object never throws", () => {
    assert.doesNotThrow(() => sourcepointAdapter.detect(null));
    assert.doesNotThrow(() => sourcepointAdapter.detect(undefined));
    assert.equal(sourcepointAdapter.detect(null), 0);
  });
});

// ── findSpRejectTarget — SP-structural DOM reject-click target resolution ──
//
// Sourcepoint's postRejectAll __tcfapi call does not dismiss the vendor's own
// UI on real deployments even when it fires without throwing (round-2 EU
// verification). findSpRejectTarget resolves the wall's own "Reject all"
// decision control (the "13" sp_choice_type_<N> class) as a DOM click
// fallback. Only a SINGLE actionable "13" candidate is ever a target — any
// ambiguity (zero, or more than one) is a NOOP. A wall exposing only a "12"
// ("Show options") choice with no "13" present NOOPs too (deferred
// second-layer flow, not this slice's scope).
describe("findSpRejectTarget — SP-structural reject-click target resolution", () => {
  test("exactly one actionable '13' candidate -> single, that candidate is the target", () => {
    const candidates = [
      { text: "Reject all", spChoice: "13", actionable: true, ref: "reject-ref" },
      { text: "Accept all", spChoice: "11", actionable: true, ref: "accept-ref" },
    ];
    const result = findSpRejectTarget(candidates);
    assert.equal(result.status, "single");
    assert.equal(result.target.ref, "reject-ref");
  });

  test("no '13' candidate at all -> noop", () => {
    const candidates = [{ text: "Accept all", spChoice: "11", actionable: true, ref: "accept-ref" }];
    assert.equal(findSpRejectTarget(candidates).status, "noop");
    assert.equal(findSpRejectTarget(candidates).target, null);
  });

  test("only a '12' (Show options) choice present, no '13' -> noop (second-layer flow deferred, not this slice)", () => {
    const candidates = [{ text: "Options", spChoice: "12", actionable: true, ref: "options-ref" }];
    assert.equal(findSpRejectTarget(candidates).status, "noop");
  });

  test("a '13' candidate present but NOT actionable (hidden/disabled) -> noop", () => {
    const candidates = [{ text: "Reject all", spChoice: "13", actionable: false, ref: "reject-ref" }];
    assert.equal(findSpRejectTarget(candidates).status, "noop");
  });

  test("more than one actionable '13' candidate -> ambiguous, never guesses", () => {
    const candidates = [
      { text: "Reject all", spChoice: "13", actionable: true, ref: "reject-ref-1" },
      { text: "Reject all", spChoice: "13", actionable: true, ref: "reject-ref-2" },
    ];
    const result = findSpRejectTarget(candidates);
    assert.equal(result.status, "ambiguous");
    assert.equal(result.target, null);
  });

  test("a '13' candidate co-existing with a '12' choice still resolves to single (13 wins directly, no veto from 12's presence)", () => {
    const candidates = [
      { text: "Options", spChoice: "12", actionable: true, ref: "options-ref" },
      { text: "Reject all", spChoice: "13", actionable: true, ref: "reject-ref" },
    ];
    const result = findSpRejectTarget(candidates);
    assert.equal(result.status, "single");
    assert.equal(result.target.ref, "reject-ref");
  });

  test("incidental non-decision candidates (no spChoice, e.g. privacy/imprint links) never veto or interfere", () => {
    const candidates = [
      { text: "Privacy Policy", spChoice: "", actionable: true, ref: "privacy-ref" },
      { text: "Reject all", spChoice: "13", actionable: true, ref: "reject-ref" },
    ];
    const result = findSpRejectTarget(candidates);
    assert.equal(result.status, "single");
    assert.equal(result.target.ref, "reject-ref");
  });

  test("never clicks type-11 (accept) or type-9/link (pay/subscribe) even if present alongside an ambiguous set", () => {
    const candidates = [
      { text: "Accept all", spChoice: "11", actionable: true, ref: "accept-ref" },
      { text: "Subscribe", spChoice: "9", actionable: true, ref: "pay-ref" },
    ];
    const result = findSpRejectTarget(candidates);
    assert.notEqual(result.status, "single");
    assert.equal(result.target, null);
  });

  test("malformed/missing input never throws and always fails closed to noop", () => {
    assert.doesNotThrow(() => findSpRejectTarget(null));
    assert.doesNotThrow(() => findSpRejectTarget(undefined));
    assert.equal(findSpRejectTarget(null).status, "noop");
    assert.equal(findSpRejectTarget(undefined).status, "noop");
    assert.equal(findSpRejectTarget([null, 42, "x", { spChoice: "13" }]).status, "noop");
  });
});

// ── findSpOpenSettingsTarget — SP multi-layer "open the panel" resolution ──
//
// Some Sourcepoint walls expose ONLY a "12" ("Options"/"Manage") control, with
// the real "Reject all" one layer deeper behind the privacy-manager panel that
// "12" opens. findSpOpenSettingsTarget resolves the SINGLE actionable "12" to
// click when — and ONLY when — no directly actionable "13" is present (a
// one-click reject always wins). Opening a settings panel never grants consent
// (monotone-safe); the deeper "13" is handled by findSpRejectTarget on the next
// observer pass. Any ambiguity (zero, or more than one "12") is a NOOP.
describe("findSpOpenSettingsTarget — SP multi-layer open-settings target resolution", () => {
  test("exactly one actionable '12', no '13' -> single, that candidate is the target", () => {
    const candidates = [{ text: "Options", spChoice: "12", actionable: true, ref: "options-ref" }];
    const result = findSpOpenSettingsTarget(candidates);
    assert.equal(result.status, "single");
    assert.equal(result.target.ref, "options-ref");
  });

  test("a directly actionable '13' present -> noop (the one-click reject wins, never take the panel detour)", () => {
    const candidates = [
      { text: "Options", spChoice: "12", actionable: true, ref: "options-ref" },
      { text: "Reject all", spChoice: "13", actionable: true, ref: "reject-ref" },
    ];
    assert.equal(findSpOpenSettingsTarget(candidates).status, "noop");
    assert.equal(findSpOpenSettingsTarget(candidates).target, null);
  });

  test("no '12' candidate at all -> noop", () => {
    const candidates = [{ text: "Accept all", spChoice: "11", actionable: true, ref: "accept-ref" }];
    assert.equal(findSpOpenSettingsTarget(candidates).status, "noop");
  });

  test("a '12' candidate present but NOT actionable (hidden/disabled) -> noop", () => {
    const candidates = [{ text: "Options", spChoice: "12", actionable: false, ref: "options-ref" }];
    assert.equal(findSpOpenSettingsTarget(candidates).status, "noop");
  });

  test("more than one actionable '12' candidate -> ambiguous, never guesses which panel to open", () => {
    const candidates = [
      { text: "Options", spChoice: "12", actionable: true, ref: "options-ref-1" },
      { text: "Manage", spChoice: "12", actionable: true, ref: "options-ref-2" },
    ];
    const result = findSpOpenSettingsTarget(candidates);
    assert.equal(result.status, "ambiguous");
    assert.equal(result.target, null);
  });

  test("a non-actionable '13' does NOT block opening a single actionable '12' (only a *reachable* one-click reject wins)", () => {
    const candidates = [
      { text: "Reject all", spChoice: "13", actionable: false, ref: "reject-ref" },
      { text: "Options", spChoice: "12", actionable: true, ref: "options-ref" },
    ];
    const result = findSpOpenSettingsTarget(candidates);
    assert.equal(result.status, "single");
    assert.equal(result.target.ref, "options-ref");
  });

  test("never targets type-11 (accept) or type-9/link (pay/subscribe)", () => {
    const candidates = [
      { text: "Accept all", spChoice: "11", actionable: true, ref: "accept-ref" },
      { text: "Subscribe", spChoice: "9", actionable: true, ref: "pay-ref" },
    ];
    const result = findSpOpenSettingsTarget(candidates);
    assert.equal(result.status, "noop");
    assert.equal(result.target, null);
  });

  test("options-ONLY scope: a '12' alongside an actionable accept '11' (a consent-or-pay wall shape) -> noop, never opens the panel", () => {
    const candidates = [
      { text: "Accept all", spChoice: "11", actionable: true, ref: "accept-ref" },
      { text: "Settings", spChoice: "12", actionable: true, ref: "settings-ref" },
      { text: "Subscribe", spChoice: "9", actionable: true, ref: "pay-ref" },
    ];
    assert.equal(findSpOpenSettingsTarget(candidates).status, "noop");
    assert.equal(findSpOpenSettingsTarget(candidates).target, null);
  });

  test("options-ONLY scope: a non-actionable accept '11' does NOT disqualify a single actionable '12' (only ACTIONABLE decisions count)", () => {
    const candidates = [
      { text: "Accept all", spChoice: "11", actionable: false, ref: "accept-ref" },
      { text: "Options", spChoice: "12", actionable: true, ref: "settings-ref" },
    ];
    const result = findSpOpenSettingsTarget(candidates);
    assert.equal(result.status, "single");
    assert.equal(result.target.ref, "settings-ref");
  });

  test("incidental non-decision candidates (no spChoice) never interfere with a single '12' target", () => {
    const candidates = [
      { text: "Privacy Policy", spChoice: "", actionable: true, ref: "privacy-ref" },
      { text: "Options", spChoice: "12", actionable: true, ref: "options-ref" },
    ];
    const result = findSpOpenSettingsTarget(candidates);
    assert.equal(result.status, "single");
    assert.equal(result.target.ref, "options-ref");
  });

  test("malformed/missing input never throws and always fails closed to noop", () => {
    assert.doesNotThrow(() => findSpOpenSettingsTarget(null));
    assert.doesNotThrow(() => findSpOpenSettingsTarget(undefined));
    assert.equal(findSpOpenSettingsTarget(null).status, "noop");
    assert.equal(findSpOpenSettingsTarget(undefined).status, "noop");
    assert.equal(findSpOpenSettingsTarget([null, 42, "x", { spChoice: "12" }]).status, "noop");
  });
});

describe("usercentricsAdapter.detect — dual-mandatory confidence gate", () => {
  const FULL_UC_SIGNALS = Object.freeze({
    hasUcUiGlobal: true,
    hasDenyAllConsentsFn: true,
    hasUsercentricsRootDom: true,
    hasIsInitializedFn: true,
  });

  test("both mandatory signals + >=1 secondary -> confidence at ceiling, canReject true", () => {
    const c = usercentricsAdapter.detect(FULL_UC_SIGNALS);
    assert.ok(c >= 1);
    assert.equal(usercentricsAdapter.canReject(FULL_UC_SIGNALS), true);
  });

  test("both mandatory signals + exactly one secondary (#usercentrics-root DOM only) -> canReject true", () => {
    const s = {
      hasUcUiGlobal: true,
      hasDenyAllConsentsFn: true,
      hasUsercentricsRootDom: true,
      hasIsInitializedFn: false,
    };
    assert.equal(usercentricsAdapter.canReject(s), true);
  });

  test("both mandatory signals + exactly one secondary (isInitialized fn only) -> canReject true", () => {
    const s = {
      hasUcUiGlobal: true,
      hasDenyAllConsentsFn: true,
      hasUsercentricsRootDom: false,
      hasIsInitializedFn: true,
    };
    assert.equal(usercentricsAdapter.canReject(s), true);
  });

  test("global-only (mandatory present, zero secondary signals) -> uncertain, canReject false", () => {
    const s = {
      hasUcUiGlobal: true,
      hasDenyAllConsentsFn: true,
      hasUsercentricsRootDom: false,
      hasIsInitializedFn: false,
    };
    assert.equal(usercentricsAdapter.canReject(s), false);
    assert.ok(usercentricsAdapter.detect(s) < 1);
  });

  test("DOM-only (mandatory denyAllConsents fn missing) -> confidence 0, canReject false", () => {
    const s = {
      hasUcUiGlobal: false,
      hasDenyAllConsentsFn: false,
      hasUsercentricsRootDom: true,
      hasIsInitializedFn: true,
    };
    assert.equal(usercentricsAdapter.detect(s), 0);
    assert.equal(usercentricsAdapter.canReject(s), false);
  });

  test("malformed/missing signals object never throws", () => {
    assert.doesNotThrow(() => usercentricsAdapter.detect(null));
    assert.doesNotThrow(() => usercentricsAdapter.detect(undefined));
    assert.equal(usercentricsAdapter.detect(null), 0);
  });
});

describe("cookieInformationAdapter.detect — confidence gate", () => {
  const FULL_COI_SIGNALS = Object.freeze({
    hasCookieInformationGlobal: true,
    hasDeclineAllCategoriesFn: true,
    hasCoiOverlayDom: true,
    hasCoiConsentBannerDom: true,
    hasCoiSummeryDom: true,
    hasCoiBannerWrapperDom: true,
    hasCoiConsentSummaryDom: true,
  });

  test("mandatory + >=1 secondary -> confidence at ceiling, canReject true", () => {
    const c = cookieInformationAdapter.detect(FULL_COI_SIGNALS);
    assert.ok(c >= 1);
    assert.equal(cookieInformationAdapter.canReject(FULL_COI_SIGNALS), true);
  });

  test("mandatory + exactly one secondary (#coiOverlay only) -> canReject true", () => {
    const s = {
      hasCookieInformationGlobal: true,
      hasDeclineAllCategoriesFn: true,
      hasCoiOverlayDom: true,
      hasCoiConsentBannerDom: false,
      hasCoiSummeryDom: false,
      hasCoiBannerWrapperDom: false,
      hasCoiConsentSummaryDom: false,
    };
    assert.equal(cookieInformationAdapter.canReject(s), true);
  });

  test("mandatory + exactly one secondary (.coi-consent-summary only) -> canReject true", () => {
    const s = {
      hasCookieInformationGlobal: true,
      hasDeclineAllCategoriesFn: true,
      hasCoiOverlayDom: false,
      hasCoiConsentBannerDom: false,
      hasCoiSummeryDom: false,
      hasCoiBannerWrapperDom: false,
      hasCoiConsentSummaryDom: true,
    };
    assert.equal(cookieInformationAdapter.canReject(s), true);
  });

  test("global-only (mandatory present, zero secondary signals) -> uncertain, canReject false", () => {
    const s = {
      hasCookieInformationGlobal: true,
      hasDeclineAllCategoriesFn: true,
      hasCoiOverlayDom: false,
      hasCoiConsentBannerDom: false,
      hasCoiSummeryDom: false,
      hasCoiBannerWrapperDom: false,
      hasCoiConsentSummaryDom: false,
    };
    assert.equal(cookieInformationAdapter.canReject(s), false);
    assert.ok(cookieInformationAdapter.detect(s) < 1);
  });

  test("DOM-only (mandatory declineAllCategories fn missing) -> confidence 0, canReject false", () => {
    const s = {
      hasCookieInformationGlobal: false,
      hasDeclineAllCategoriesFn: false,
      hasCoiOverlayDom: true,
      hasCoiConsentBannerDom: true,
      hasCoiSummeryDom: true,
    };
    assert.equal(cookieInformationAdapter.detect(s), 0);
    assert.equal(cookieInformationAdapter.canReject(s), false);
  });

  test("malformed/missing signals object never throws", () => {
    assert.doesNotThrow(() => cookieInformationAdapter.detect(null));
    assert.doesNotThrow(() => cookieInformationAdapter.detect(undefined));
    assert.equal(cookieInformationAdapter.detect(null), 0);
  });
});

describe("cookieScriptAdapter.detect — dual-mandatory-plus-instance confidence gate", () => {
  const FULL_CS_SIGNALS = Object.freeze({
    hasCookieScriptGlobal: true,
    hasCookieScriptInstance: true,
    hasRejectAllActionFn: true,
    hasCookiescriptInjectedDom: true,
    hasCookiescriptDescriptionDom: true,
  });

  test("mandatory + >=1 secondary -> confidence at ceiling, canReject true", () => {
    const c = cookieScriptAdapter.detect(FULL_CS_SIGNALS);
    assert.ok(c >= 1);
    assert.equal(cookieScriptAdapter.canReject(FULL_CS_SIGNALS), true);
  });

  test("mandatory + exactly one secondary (#cookiescript_injected only) -> canReject true", () => {
    const s = {
      hasCookieScriptGlobal: true,
      hasCookieScriptInstance: true,
      hasRejectAllActionFn: true,
      hasCookiescriptInjectedDom: true,
      hasCookiescriptDescriptionDom: false,
    };
    assert.equal(cookieScriptAdapter.canReject(s), true);
  });

  test("global-only (mandatory present, zero secondary signals) -> uncertain, canReject false", () => {
    const s = {
      hasCookieScriptGlobal: true,
      hasCookieScriptInstance: true,
      hasRejectAllActionFn: true,
      hasCookiescriptInjectedDom: false,
      hasCookiescriptDescriptionDom: false,
    };
    assert.equal(cookieScriptAdapter.canReject(s), false);
    assert.ok(cookieScriptAdapter.detect(s) < 1);
  });

  test("DOM-only (mandatory instance/rejectAllAction missing) -> confidence 0, canReject false", () => {
    const s = {
      hasCookieScriptGlobal: false,
      hasCookieScriptInstance: false,
      hasRejectAllActionFn: false,
      hasCookiescriptInjectedDom: true,
      hasCookiescriptDescriptionDom: true,
    };
    assert.equal(cookieScriptAdapter.detect(s), 0);
    assert.equal(cookieScriptAdapter.canReject(s), false);
  });

  test("global present but instance absent (rejectAllAction unreachable) -> confidence 0, canReject false", () => {
    const s = {
      hasCookieScriptGlobal: true,
      hasCookieScriptInstance: false,
      hasRejectAllActionFn: false,
      hasCookiescriptInjectedDom: true,
      hasCookiescriptDescriptionDom: true,
    };
    assert.equal(cookieScriptAdapter.detect(s), 0);
    assert.equal(cookieScriptAdapter.canReject(s), false);
  });

  test("malformed/missing signals object never throws", () => {
    assert.doesNotThrow(() => cookieScriptAdapter.detect(null));
    assert.doesNotThrow(() => cookieScriptAdapter.detect(undefined));
    assert.equal(cookieScriptAdapter.detect(null), 0);
  });
});

describe("tarteaucitronAdapter.detect — triple-mandatory confidence gate", () => {
  const FULL_TAC_SIGNALS = Object.freeze({
    hasTarteaucitronGlobal: true,
    hasTarteaucitronUserInterface: true,
    hasRespondAllFn: true,
    hasTarteaucitronRootDom: true,
    hasTarteaucitronAlertBigDom: true,
    hasTarteaucitronBackDom: true,
    hasTarteaucitronModalOpenDom: true,
  });

  test("mandatory triple + >=1 secondary -> confidence at ceiling, canReject true", () => {
    const c = tarteaucitronAdapter.detect(FULL_TAC_SIGNALS);
    assert.ok(c >= 1);
    assert.equal(tarteaucitronAdapter.canReject(FULL_TAC_SIGNALS), true);
  });

  test("mandatory triple + exactly one secondary (#tarteaucitronRoot only) -> canReject true", () => {
    const s = {
      hasTarteaucitronGlobal: true,
      hasTarteaucitronUserInterface: true,
      hasRespondAllFn: true,
      hasTarteaucitronRootDom: true,
      hasTarteaucitronAlertBigDom: false,
      hasTarteaucitronBackDom: false,
      hasTarteaucitronModalOpenDom: false,
    };
    assert.equal(tarteaucitronAdapter.canReject(s), true);
  });

  test("global-only (mandatory triple present, zero secondary signals) -> uncertain, canReject false", () => {
    const s = {
      hasTarteaucitronGlobal: true,
      hasTarteaucitronUserInterface: true,
      hasRespondAllFn: true,
      hasTarteaucitronRootDom: false,
      hasTarteaucitronAlertBigDom: false,
      hasTarteaucitronBackDom: false,
      hasTarteaucitronModalOpenDom: false,
    };
    assert.equal(tarteaucitronAdapter.canReject(s), false);
    assert.ok(tarteaucitronAdapter.detect(s) < 1);
  });

  test("DOM-only (mandatory respondAll fn missing) -> confidence 0, canReject false", () => {
    const s = {
      hasTarteaucitronGlobal: false,
      hasTarteaucitronUserInterface: false,
      hasRespondAllFn: false,
      hasTarteaucitronRootDom: true,
      hasTarteaucitronAlertBigDom: true,
      hasTarteaucitronBackDom: true,
      hasTarteaucitronModalOpenDom: true,
    };
    assert.equal(tarteaucitronAdapter.detect(s), 0);
    assert.equal(tarteaucitronAdapter.canReject(s), false);
  });

  test("global present but userInterface absent (respondAll unreachable) -> confidence 0, canReject false", () => {
    const s = {
      hasTarteaucitronGlobal: true,
      hasTarteaucitronUserInterface: false,
      hasRespondAllFn: false,
      hasTarteaucitronRootDom: true,
    };
    assert.equal(tarteaucitronAdapter.detect(s), 0);
    assert.equal(tarteaucitronAdapter.canReject(s), false);
  });

  test("malformed/missing signals object never throws", () => {
    assert.doesNotThrow(() => tarteaucitronAdapter.detect(null));
    assert.doesNotThrow(() => tarteaucitronAdapter.detect(undefined));
    assert.equal(tarteaucitronAdapter.detect(null), 0);
  });
});

describe("consentmanagerAdapter.detect — triple-mandatory confidence gate", () => {
  const FULL_CMP_SIGNALS = Object.freeze({
    hasCmpMngrGlobal: true,
    hasCmpFn: true,
    hasCmpBoxDom: true,
    hasCmpWelcomeBtnYesDom: true,
    hasCmpWelcomeBtnNoDom: true,
    hasCmpBoxBtnDom: true,
  });

  test("mandatory triple + >=1 secondary -> confidence at ceiling, canReject true", () => {
    const c = consentmanagerAdapter.detect(FULL_CMP_SIGNALS);
    assert.ok(c >= 1);
    assert.equal(consentmanagerAdapter.canReject(FULL_CMP_SIGNALS), true);
  });

  test("mandatory triple + exactly one secondary (#cmpwelcomebtnyes only) -> canReject true", () => {
    const s = {
      hasCmpMngrGlobal: true,
      hasCmpFn: true,
      hasCmpBoxDom: true,
      hasCmpWelcomeBtnYesDom: true,
      hasCmpWelcomeBtnNoDom: false,
      hasCmpBoxBtnDom: false,
    };
    assert.equal(consentmanagerAdapter.canReject(s), true);
  });

  test("mandatory triple present, zero secondary signals -> uncertain, canReject false", () => {
    const s = {
      hasCmpMngrGlobal: true,
      hasCmpFn: true,
      hasCmpBoxDom: true,
      hasCmpWelcomeBtnYesDom: false,
      hasCmpWelcomeBtnNoDom: false,
      hasCmpBoxBtnDom: false,
    };
    assert.equal(consentmanagerAdapter.canReject(s), false);
    assert.ok(consentmanagerAdapter.detect(s) < 1);
  });

  test("DOM-only (mandatory global/fn missing) -> confidence 0, canReject false", () => {
    const s = {
      hasCmpMngrGlobal: false,
      hasCmpFn: false,
      hasCmpBoxDom: true,
      hasCmpWelcomeBtnYesDom: true,
      hasCmpWelcomeBtnNoDom: true,
      hasCmpBoxBtnDom: true,
    };
    assert.equal(consentmanagerAdapter.detect(s), 0);
    assert.equal(consentmanagerAdapter.canReject(s), false);
  });

  test("cmpmngr global + __cmp fn present but #cmpbox DOM absent -> confidence 0, canReject false", () => {
    const s = {
      hasCmpMngrGlobal: true,
      hasCmpFn: true,
      hasCmpBoxDom: false,
      hasCmpWelcomeBtnYesDom: true,
    };
    assert.equal(consentmanagerAdapter.detect(s), 0);
    assert.equal(consentmanagerAdapter.canReject(s), false);
  });

  test("malformed/missing signals object never throws", () => {
    assert.doesNotThrow(() => consentmanagerAdapter.detect(null));
    assert.doesNotThrow(() => consentmanagerAdapter.detect(undefined));
    assert.equal(consentmanagerAdapter.detect(null), 0);
  });
});

// ── reject() — pure, callback-injected global call ──────────────────────────

describe("oneTrustAdapter.reject — pure callback invocation", () => {
  test("calls the injected function and reports rejected", () => {
    let called = false;
    const r = oneTrustAdapter.reject(() => { called = true; });
    assert.equal(called, true);
    assert.equal(r.status, "rejected");
  });

  test("a throwing callback is swallowed -> status noop, never throws", () => {
    const r = oneTrustAdapter.reject(() => { throw new Error("boom"); });
    assert.equal(r.status, "noop");
  });

  test("non-function argument -> status noop, no call", () => {
    const r = oneTrustAdapter.reject(undefined);
    assert.equal(r.status, "noop");
  });
});

describe("cookiebotAdapter.reject — pure callback invocation", () => {
  test("calls the injected function and reports rejected", () => {
    let called = false;
    const r = cookiebotAdapter.reject(() => { called = true; });
    assert.equal(called, true);
    assert.equal(r.status, "rejected");
  });

  test("a throwing callback is swallowed -> status noop, never throws", () => {
    const r = cookiebotAdapter.reject(() => { throw new Error("boom"); });
    assert.equal(r.status, "noop");
  });

  test("non-function argument -> status noop, no call", () => {
    const r = cookiebotAdapter.reject(undefined);
    assert.equal(r.status, "noop");
  });
});

describe("didomiAdapter.reject — pure callback invocation", () => {
  test("calls the injected function and reports rejected", () => {
    let called = false;
    const r = didomiAdapter.reject(() => { called = true; });
    assert.equal(called, true);
    assert.equal(r.status, "rejected");
  });

  test("a throwing callback is swallowed -> status noop, never throws", () => {
    const r = didomiAdapter.reject(() => { throw new Error("boom"); });
    assert.equal(r.status, "noop");
  });

  test("non-function argument -> status noop, no call", () => {
    const r = didomiAdapter.reject(undefined);
    assert.equal(r.status, "noop");
  });
});

describe("cookieYesAdapter.reject — pure callback invocation", () => {
  test("calls the injected function and reports rejected", () => {
    let called = false;
    const r = cookieYesAdapter.reject(() => { called = true; });
    assert.equal(called, true);
    assert.equal(r.status, "rejected");
  });

  test("a throwing callback is swallowed -> status noop, never throws", () => {
    const r = cookieYesAdapter.reject(() => { throw new Error("boom"); });
    assert.equal(r.status, "noop");
  });

  test("non-function argument -> status noop, no call", () => {
    const r = cookieYesAdapter.reject(undefined);
    assert.equal(r.status, "noop");
  });
});

describe("sourcepointAdapter.reject — pure callback invocation", () => {
  test("calls the injected function and reports rejected", () => {
    let called = false;
    const r = sourcepointAdapter.reject(() => { called = true; });
    assert.equal(called, true);
    assert.equal(r.status, "rejected");
  });

  test("a throwing callback is swallowed -> status noop, never throws", () => {
    const r = sourcepointAdapter.reject(() => { throw new Error("boom"); });
    assert.equal(r.status, "noop");
  });

  test("non-function argument -> status noop, no call", () => {
    const r = sourcepointAdapter.reject(undefined);
    assert.equal(r.status, "noop");
  });
});

describe("usercentricsAdapter.reject — pure callback invocation", () => {
  test("calls the injected function and reports rejected", () => {
    let called = false;
    const r = usercentricsAdapter.reject(() => { called = true; });
    assert.equal(called, true);
    assert.equal(r.status, "rejected");
  });

  test("a throwing callback is swallowed -> status noop, never throws", () => {
    const r = usercentricsAdapter.reject(() => { throw new Error("boom"); });
    assert.equal(r.status, "noop");
  });

  test("non-function argument -> status noop, no call", () => {
    const r = usercentricsAdapter.reject(undefined);
    assert.equal(r.status, "noop");
  });

  test("a callback that returns a Promise is handled fire-and-forget: reject() reports rejected synchronously without awaiting, and a later rejection on that promise never surfaces as an unhandled rejection or a thrown error here", async () => {
    let settleReject;
    let called = false;
    const promise = new Promise((_resolve, rej) => {
      settleReject = rej;
    });
    const r = usercentricsAdapter.reject(() => {
      called = true;
      return promise.catch(() => {});
    });
    // Synchronous contract: reject() must report "rejected" immediately,
    // without waiting for the returned promise to settle.
    assert.equal(called, true);
    assert.equal(r.status, "rejected");
    // Now settle the floating promise with a rejection — this must never
    // produce an unhandled-rejection warning (the .catch(() => {}) above,
    // mirroring the real denyAllConsents().catch(() => {}) call-site shape,
    // already swallowed it) and must not throw here.
    settleReject(new Error("denyAllConsents rejected"));
    await promise.catch(() => {});
  });
});

describe("cookieInformationAdapter.reject — pure callback invocation", () => {
  test("calls the injected function and reports rejected", () => {
    let called = false;
    const r = cookieInformationAdapter.reject(() => { called = true; });
    assert.equal(called, true);
    assert.equal(r.status, "rejected");
  });

  test("a throwing callback is swallowed -> status noop, never throws", () => {
    const r = cookieInformationAdapter.reject(() => { throw new Error("boom"); });
    assert.equal(r.status, "noop");
  });

  test("non-function argument -> status noop, no call", () => {
    const r = cookieInformationAdapter.reject(undefined);
    assert.equal(r.status, "noop");
  });
});

describe("cookieScriptAdapter.reject — pure callback invocation", () => {
  test("calls the injected function and reports rejected", () => {
    let called = false;
    const r = cookieScriptAdapter.reject(() => { called = true; });
    assert.equal(called, true);
    assert.equal(r.status, "rejected");
  });

  test("a throwing callback is swallowed -> status noop, never throws", () => {
    const r = cookieScriptAdapter.reject(() => { throw new Error("boom"); });
    assert.equal(r.status, "noop");
  });

  test("non-function argument -> status noop, no call", () => {
    const r = cookieScriptAdapter.reject(undefined);
    assert.equal(r.status, "noop");
  });
});

describe("tarteaucitronAdapter.reject — pure callback invocation", () => {
  test("calls the injected function and reports rejected", () => {
    let called = false;
    const r = tarteaucitronAdapter.reject(() => { called = true; });
    assert.equal(called, true);
    assert.equal(r.status, "rejected");
  });

  test("a throwing callback is swallowed -> status noop, never throws", () => {
    const r = tarteaucitronAdapter.reject(() => { throw new Error("boom"); });
    assert.equal(r.status, "noop");
  });

  test("non-function argument -> status noop, no call", () => {
    const r = tarteaucitronAdapter.reject(undefined);
    assert.equal(r.status, "noop");
  });
});

describe("consentmanagerAdapter.reject — pure callback invocation", () => {
  test("calls the injected function and reports rejected", () => {
    let called = false;
    const r = consentmanagerAdapter.reject(() => { called = true; });
    assert.equal(called, true);
    assert.equal(r.status, "rejected");
  });

  test("a throwing callback is swallowed -> status noop, never throws", () => {
    const r = consentmanagerAdapter.reject(() => { throw new Error("boom"); });
    assert.equal(r.status, "noop");
  });

  test("non-function argument -> status noop, no call", () => {
    const r = consentmanagerAdapter.reject(undefined);
    assert.equal(r.status, "noop");
  });
});

// ── computeCookieGate — disabled-state gate truth table ────────────────────
//
// W2/S2 (#1027): the gate decision used to live in a non-exported IIFE
// closure in content/cookie-noise.js, so these branches had no executed
// coverage (only a structural regex). Extracting it as a pure helper lets
// every branch run here.
//
// cookie-consent-accept Slice 2a: this gate no longer compares
// `prefs.cookieConsentMode` against a literal mode string itself — that
// string comparison (which would need to name every active enum member,
// including the newer one this file must never spell — see the STRUCTURAL
// guard below) moved to the settings-schema.js boundary
// (isCookieConsentModeActive), which is lexically unrestricted. The caller
// resolves the raw pref there and hands this gate a pre-validated boolean
// via `deps.modeActive`. This lets the reject ladder run first in every
// active mode (design's L3) without this file ever knowing a second mode
// exists.

const GATE_ON_PREFS = Object.freeze({
  enabled: true,
  onboardingDone: true,
});

const GATE_ON_DEPS = Object.freeze({ modeActive: true });

describe("computeCookieGate — disabled-state gate", () => {
  test("all gate conditions pass (modeActive true) -> gate opens (true)", () => {
    assert.equal(computeCookieGate(GATE_ON_PREFS, GATE_ON_DEPS), true);
  });

  // modeActive is computed upstream (settings-schema.js's
  // isCookieConsentModeActive) for BOTH "reject-only" and
  // "accept-when-necessary" — this gate treats them identically: it only
  // ever sees the pre-validated boolean, never the mode string.
  test("modeActive true opens the gate the same way regardless of which active mode produced it", () => {
    assert.equal(computeCookieGate(GATE_ON_PREFS, { modeActive: true }), true);
  });

  test("modeActive false -> gate stays closed (e.g. mode is off)", () => {
    assert.equal(computeCookieGate(GATE_ON_PREFS, { modeActive: false }), false);
  });

  test("modeActive missing/undefined -> gate stays closed (fail-closed)", () => {
    assert.equal(computeCookieGate(GATE_ON_PREFS, {}), false);
    assert.equal(computeCookieGate(GATE_ON_PREFS, { modeActive: undefined }), false);
  });

  test("deps entirely missing -> gate stays closed (fail-closed)", () => {
    assert.equal(computeCookieGate(GATE_ON_PREFS), false);
    assert.equal(computeCookieGate(GATE_ON_PREFS, null), false);
  });

  test("modeActive as a truthy non-boolean (e.g. the string 'true') does NOT open the gate — must be exactly true", () => {
    assert.equal(computeCookieGate(GATE_ON_PREFS, { modeActive: "true" }), false);
    assert.equal(computeCookieGate(GATE_ON_PREFS, { modeActive: 1 }), false);
  });

  test("onboardingDone false -> gate stays closed", () => {
    assert.equal(computeCookieGate({ ...GATE_ON_PREFS, onboardingDone: false }, GATE_ON_DEPS), false);
  });

  test("master enabled false -> gate stays closed", () => {
    assert.equal(computeCookieGate({ ...GATE_ON_PREFS, enabled: false }, GATE_ON_DEPS), false);
  });

  test("null / undefined prefs -> gate stays closed, never throws", () => {
    assert.doesNotThrow(() => computeCookieGate(null, GATE_ON_DEPS));
    assert.equal(computeCookieGate(null, GATE_ON_DEPS), false);
    assert.equal(computeCookieGate(undefined, GATE_ON_DEPS), false);
  });

  test("isSiteFullyExempt true -> gate stays closed even when every pref passes", () => {
    const deps = { modeActive: true, hostname: "example.com", isSiteFullyExempt: () => true };
    assert.equal(computeCookieGate(GATE_ON_PREFS, deps), false);
  });

  test("isSiteFullyExempt false -> gate opens (site not exempt)", () => {
    const deps = { modeActive: true, hostname: "example.com", isSiteFullyExempt: () => false };
    assert.equal(computeCookieGate(GATE_ON_PREFS, deps), true);
  });

  test("isSiteFullyExempt receives the injected hostname and prefs", () => {
    let seen = null;
    const deps = {
      modeActive: true,
      hostname: "shop.example.com",
      isSiteFullyExempt: (hostname, prefs) => { seen = { hostname, prefs }; return false; },
    };
    computeCookieGate(GATE_ON_PREFS, deps);
    assert.equal(seen.hostname, "shop.example.com");
    assert.strictEqual(seen.prefs, GATE_ON_PREFS);
  });

  test("a throwing isSiteFullyExempt is swallowed and treated as not exempt (fail-safe -> open)", () => {
    const deps = { modeActive: true, hostname: "example.com", isSiteFullyExempt: () => { throw new Error("boom"); } };
    assert.doesNotThrow(() => computeCookieGate(GATE_ON_PREFS, deps));
    assert.equal(computeCookieGate(GATE_ON_PREFS, deps), true);
  });
});

// ── STRUCTURAL guard — no consent-granting action path can exist ───────────
//
// LOAD-BEARING. This is the ethical spine of the feature (#1027): MUGA must
// never programmatically grant broad tracking consent on the user's behalf.
// The guard is a static source scan, deliberately kept in its own describe
// block so a future PR that reintroduces a consent-granting action fails
// here first, independent of any behavioral test above.
//
// cmp-adapters.js's own source (including every comment) is written WITHOUT
// the word this guard forbids, so a plain case-insensitive scan is safe —
// see the file's docblock for the naming convention this enables.

describe("cmp-adapters — STRUCTURAL guard: closed reject-only action set", () => {
  const source = readFileSync(join(__dirname, "../../src/lib/cmp-adapters.js"), "utf8");
  const FORBIDDEN = /allowall|accept/i;

  test("cmp-adapters.js source contains no AllowAll / accept-family identifier", () => {
    assert.doesNotMatch(
      source,
      FORBIDDEN,
      "cmp-adapters.js must never reference AllowAll/accept — the action registry is reject-only",
    );
  });

  test("ACTIONS enum has exactly one member and it is REJECT_ALL", () => {
    assert.equal(Object.keys(ACTIONS).length, 1);
    assert.ok("REJECT_ALL" in ACTIONS);
  });

  test("no TIER1 or TIER2 adapter exposes any method whose name suggests a grant/allow action", () => {
    for (const adapter of [...TIER1, ...TIER2]) {
      for (const key of Object.keys(adapter)) {
        assert.doesNotMatch(key, FORBIDDEN, `adapter "${adapter.id}" exposes a forbidden method: ${key}`);
      }
    }
  });

  test("cookiebotAdapter is registered in TIER1 alongside oneTrustAdapter (#1118)", () => {
    assert.ok(TIER1.includes(cookiebotAdapter), "TIER1 must include cookiebotAdapter");
    assert.ok(TIER1.includes(oneTrustAdapter), "TIER1 must still include oneTrustAdapter");
  });

  test("didomiAdapter is registered in TIER1 alongside oneTrustAdapter and cookiebotAdapter (#1119)", () => {
    assert.ok(TIER1.includes(didomiAdapter), "TIER1 must include didomiAdapter");
    assert.ok(TIER1.includes(oneTrustAdapter), "TIER1 must still include oneTrustAdapter");
    assert.ok(TIER1.includes(cookiebotAdapter), "TIER1 must still include cookiebotAdapter");
  });

  test("cookieYesAdapter is registered in TIER1 alongside the other three adapters (#1120)", () => {
    assert.ok(TIER1.includes(cookieYesAdapter), "TIER1 must include cookieYesAdapter");
    assert.ok(TIER1.includes(oneTrustAdapter), "TIER1 must still include oneTrustAdapter");
    assert.ok(TIER1.includes(cookiebotAdapter), "TIER1 must still include cookiebotAdapter");
    assert.ok(TIER1.includes(didomiAdapter), "TIER1 must still include didomiAdapter");
  });

  test("sourcepointAdapter is registered in TIER1 alongside the other four adapters (#1123)", () => {
    assert.ok(TIER1.includes(sourcepointAdapter), "TIER1 must include sourcepointAdapter");
    assert.ok(TIER1.includes(oneTrustAdapter), "TIER1 must still include oneTrustAdapter");
    assert.ok(TIER1.includes(cookiebotAdapter), "TIER1 must still include cookiebotAdapter");
    assert.ok(TIER1.includes(didomiAdapter), "TIER1 must still include didomiAdapter");
    assert.ok(TIER1.includes(cookieYesAdapter), "TIER1 must still include cookieYesAdapter");
  });

  test("usercentricsAdapter is registered in TIER1 alongside the other five adapters (#1121)", () => {
    assert.ok(TIER1.includes(usercentricsAdapter), "TIER1 must include usercentricsAdapter");
    assert.ok(TIER1.includes(oneTrustAdapter), "TIER1 must still include oneTrustAdapter");
    assert.ok(TIER1.includes(cookiebotAdapter), "TIER1 must still include cookiebotAdapter");
    assert.ok(TIER1.includes(didomiAdapter), "TIER1 must still include didomiAdapter");
    assert.ok(TIER1.includes(cookieYesAdapter), "TIER1 must still include cookieYesAdapter");
    assert.ok(TIER1.includes(sourcepointAdapter), "TIER1 must still include sourcepointAdapter");
  });

  test("cookieInformationAdapter is registered in TIER1 alongside the other six adapters", () => {
    assert.ok(TIER1.includes(cookieInformationAdapter), "TIER1 must include cookieInformationAdapter");
    assert.ok(TIER1.includes(oneTrustAdapter), "TIER1 must still include oneTrustAdapter");
    assert.ok(TIER1.includes(cookiebotAdapter), "TIER1 must still include cookiebotAdapter");
    assert.ok(TIER1.includes(didomiAdapter), "TIER1 must still include didomiAdapter");
    assert.ok(TIER1.includes(cookieYesAdapter), "TIER1 must still include cookieYesAdapter");
    assert.ok(TIER1.includes(sourcepointAdapter), "TIER1 must still include sourcepointAdapter");
    assert.ok(TIER1.includes(usercentricsAdapter), "TIER1 must still include usercentricsAdapter");
  });

  test("cookieScriptAdapter is registered in TIER1 alongside the other seven adapters", () => {
    assert.ok(TIER1.includes(cookieScriptAdapter), "TIER1 must include cookieScriptAdapter");
    assert.ok(TIER1.includes(oneTrustAdapter), "TIER1 must still include oneTrustAdapter");
    assert.ok(TIER1.includes(cookiebotAdapter), "TIER1 must still include cookiebotAdapter");
    assert.ok(TIER1.includes(didomiAdapter), "TIER1 must still include didomiAdapter");
    assert.ok(TIER1.includes(cookieYesAdapter), "TIER1 must still include cookieYesAdapter");
    assert.ok(TIER1.includes(sourcepointAdapter), "TIER1 must still include sourcepointAdapter");
    assert.ok(TIER1.includes(usercentricsAdapter), "TIER1 must still include usercentricsAdapter");
    assert.ok(TIER1.includes(cookieInformationAdapter), "TIER1 must still include cookieInformationAdapter");
  });

  test("tarteaucitronAdapter is registered in TIER1 alongside the other eight adapters", () => {
    assert.ok(TIER1.includes(tarteaucitronAdapter), "TIER1 must include tarteaucitronAdapter");
    assert.ok(TIER1.includes(oneTrustAdapter), "TIER1 must still include oneTrustAdapter");
    assert.ok(TIER1.includes(cookiebotAdapter), "TIER1 must still include cookiebotAdapter");
    assert.ok(TIER1.includes(didomiAdapter), "TIER1 must still include didomiAdapter");
    assert.ok(TIER1.includes(cookieYesAdapter), "TIER1 must still include cookieYesAdapter");
    assert.ok(TIER1.includes(sourcepointAdapter), "TIER1 must still include sourcepointAdapter");
    assert.ok(TIER1.includes(usercentricsAdapter), "TIER1 must still include usercentricsAdapter");
    assert.ok(TIER1.includes(cookieInformationAdapter), "TIER1 must still include cookieInformationAdapter");
    assert.ok(TIER1.includes(cookieScriptAdapter), "TIER1 must still include cookieScriptAdapter");
  });

  test("consentmanagerAdapter is registered in TIER1 alongside the other nine adapters", () => {
    assert.ok(TIER1.includes(consentmanagerAdapter), "TIER1 must include consentmanagerAdapter");
    assert.ok(TIER1.includes(oneTrustAdapter), "TIER1 must still include oneTrustAdapter");
    assert.ok(TIER1.includes(cookiebotAdapter), "TIER1 must still include cookiebotAdapter");
    assert.ok(TIER1.includes(didomiAdapter), "TIER1 must still include didomiAdapter");
    assert.ok(TIER1.includes(cookieYesAdapter), "TIER1 must still include cookieYesAdapter");
    assert.ok(TIER1.includes(sourcepointAdapter), "TIER1 must still include sourcepointAdapter");
    assert.ok(TIER1.includes(usercentricsAdapter), "TIER1 must still include usercentricsAdapter");
    assert.ok(TIER1.includes(cookieInformationAdapter), "TIER1 must still include cookieInformationAdapter");
    assert.ok(TIER1.includes(cookieScriptAdapter), "TIER1 must still include cookieScriptAdapter");
    assert.ok(TIER1.includes(tarteaucitronAdapter), "TIER1 must still include tarteaucitronAdapter");
  });
});
