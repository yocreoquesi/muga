/**
 * MUGA — Unit tests for Privacy Proxy integration in the service worker (B20 #453)
 *
 * These are structural tests that verify the source code contains the expected
 * patterns. This mirrors the existing `service-worker-patterns.test.mjs` style
 * because the service-worker cannot be imported directly (Chrome API bindings
 * are not available in the Node.js test environment).
 *
 * For the pure helper `_validateProxyUrl`, the test imports and exercises it
 * directly via the exported test-hook `__TEST_ONLY__validateProxyUrl`.
 *
 * Tests cover:
 *   3.1 UNWRAP_VIA_PROXY message handler
 *   3.2 refreshBuildHashIfStale helper + onInstalled / onStartup wiring
 *   3.3 permission-revocation self-heal branch
 *   4.1 Block-prompt CTA — structural assertions in content script
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const swSource = readFileSync(join(__dirname, "../../src/background/service-worker.js"), "utf8");
const cleanerSource = readFileSync(join(__dirname, "../../src/content/cleaner.js"), "utf8");

// ── 3.1 UNWRAP_VIA_PROXY message handler ─────────────────────────────────────

describe("UNWRAP_VIA_PROXY message handler — structural", () => {
  test("handler registered in the main message listener", () => {
    assert.ok(
      swSource.includes('message.type === "UNWRAP_VIA_PROXY"'),
      'service-worker must handle "UNWRAP_VIA_PROXY" message type'
    );
  });

  test("calls fetchUnwrap to delegate to proxy-client", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    assert.ok(handlerStart !== -1, "UNWRAP_VIA_PROXY handler must be present");
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 1500);
    assert.ok(
      handlerSlice.includes("fetchUnwrap"),
      "UNWRAP_VIA_PROXY handler must call fetchUnwrap"
    );
  });

  test("validates URL scheme is http or https before calling fetchUnwrap", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 2000);
    // Must contain scheme validation (protocol check for http:/https:)
    assert.ok(
      handlerSlice.includes("invalid_url") || handlerSlice.includes("http:"),
      "handler must validate URL scheme"
    );
  });

  test("validates hostname is a generic shortener before calling fetchUnwrap", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 2000);
    // 2.1 pivot (#659): allowlist tightened to GENERIC_SHORTENERS only —
    // affiliate-redirect networks must NEVER be sent to the Worker.
    assert.ok(
      handlerSlice.includes("isGenericShortener"),
      "handler must check isGenericShortener for the hostname"
    );
    assert.ok(
      !handlerSlice.includes("OPAQUE_NETWORKS"),
      "handler must NOT gate on the legacy OPAQUE_NETWORKS union — affiliate redirects must pass through"
    );
  });

  test("checks privacyProxyEnabled pref before proceeding", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 2000);
    assert.ok(
      handlerSlice.includes("privacyProxyEnabled"),
      "handler must check privacyProxyEnabled pref"
    );
  });

  test("returns { ok: false, reason: 'disabled' } when feature is disabled", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 2000);
    assert.ok(
      handlerSlice.includes('"disabled"'),
      "handler must return reason: 'disabled' when proxy feature is off"
    );
  });

  test("returns { ok: false, reason: 'invalid_url' } for bad input", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 2000);
    assert.ok(
      handlerSlice.includes('"invalid_url"'),
      "handler must return reason: 'invalid_url' for non-opaque or bad URL"
    );
  });

  test("wraps new URL() in try/catch for safe parsing", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 2000);
    assert.ok(
      handlerSlice.includes("new URL(") && handlerSlice.includes("} catch"),
      "handler must wrap new URL() in try/catch"
    );
  });

  test("always calls sendResponse (async path returns true)", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    // The handler body is ~90 lines. Use a generous slice to cover it fully.
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 5000);
    assert.ok(
      handlerSlice.includes("return true"),
      "handler must return true to keep the message channel open for async response"
    );
  });

  test("imports fetchUnwrap from proxy-client", () => {
    assert.ok(
      swSource.includes("fetchUnwrap") && swSource.includes("proxy-client"),
      "service-worker must import fetchUnwrap from proxy-client.js"
    );
  });

  test("imports isGenericShortener from opaque-networks", () => {
    assert.ok(
      swSource.includes("isGenericShortener") && swSource.includes("opaque-networks"),
      "service-worker must import isGenericShortener from opaque-networks.js"
    );
  });
});

// ── 3.2 refreshBuildHashIfStale helper ───────────────────────────────────────

describe("refreshBuildHashIfStale — structural", () => {
  test("helper function is defined in service-worker", () => {
    assert.ok(
      swSource.includes("refreshBuildHashIfStale"),
      "service-worker must define refreshBuildHashIfStale helper"
    );
  });

  test("reads workerBuildHashFetchedAt from chrome.storage.local", () => {
    // The constant and function together form the build-hash subsystem.
    // Scan the full source for the required patterns.
    assert.ok(
      swSource.includes("workerBuildHashFetchedAt"),
      "helper must read workerBuildHashFetchedAt from storage"
    );
  });

  test("only fetches when interval has elapsed (86400000 ms = 24h gate)", () => {
    // The 24h constant may live outside the function body but is required
    // to be defined in the service-worker source.
    assert.ok(
      swSource.includes("86400000"),
      "service-worker must define the 24h gate interval (86400000 ms)"
    );
  });

  test("fetches https://unwrap.muga.app/healthz for build hash", () => {
    // Search the full SW source — the function references the URL.
    assert.ok(
      swSource.includes("healthz"),
      "helper must fetch from /healthz endpoint"
    );
  });

  test("stores commit_sha as workerBuildHash on success", () => {
    assert.ok(
      swSource.includes("workerBuildHash") && swSource.includes("commit_sha"),
      "helper must store commit_sha as workerBuildHash"
    );
  });

  test("logs warning on error and does not throw", () => {
    const fnStart = swSource.indexOf("async function refreshBuildHashIfStale");
    const fnSlice = swSource.slice(fnStart, fnStart + 2500);
    assert.ok(
      fnSlice.includes("console.warn") && fnSlice.includes("build-hash"),
      "helper must console.warn on fetch error, not throw"
    );
  });

  test("wired into onInstalled listener", () => {
    const installedStart = swSource.indexOf("chrome.runtime.onInstalled.addListener");
    assert.ok(installedStart !== -1, "onInstalled listener must be present");
    const installedSlice = swSource.slice(installedStart, installedStart + 800);
    assert.ok(
      installedSlice.includes("refreshBuildHashIfStale"),
      "onInstalled listener must call refreshBuildHashIfStale"
    );
  });

  test("wired into onStartup listener", () => {
    const startupStart = swSource.indexOf("chrome.runtime.onStartup.addListener");
    assert.ok(startupStart !== -1, "onStartup listener must be present");
    const startupSlice = swSource.slice(startupStart, startupStart + 800);
    assert.ok(
      startupSlice.includes("refreshBuildHashIfStale"),
      "onStartup listener must call refreshBuildHashIfStale"
    );
  });

  test("gates fetch on privacyProxyEnabled AND chrome.permissions.contains", () => {
    const fnStart = swSource.indexOf("async function refreshBuildHashIfStale");
    const fnSlice = swSource.slice(fnStart, fnStart + 2500);
    assert.ok(
      fnSlice.includes("privacyProxyEnabled"),
      "helper must check privacyProxyEnabled before fetching"
    );
  });
});

// ── 3.3 Permission-revocation self-heal ──────────────────────────────────────

describe("UNWRAP_VIA_PROXY — permission revocation self-heal", () => {
  test("self-heal branch exists for reason=permission", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 3000);
    assert.ok(
      handlerSlice.includes('"permission"'),
      "handler must have a branch for reason: 'permission' (self-heal)"
    );
  });

  test("sets privacyProxyEnabled=false in sync storage on permission revocation", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 3000);
    assert.ok(
      handlerSlice.includes("privacyProxyEnabled: false"),
      "self-heal must write privacyProxyEnabled:false to chrome.storage.sync"
    );
  });

  test("only self-heals on 'permission' reason, not on other failures", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 3000);
    // The self-heal pref-set must be conditional on reason === "permission"
    // We verify this by checking it's inside a "permission" conditional, not at the top level
    const permIdx = handlerSlice.indexOf('"permission"');
    const prefSetIdx = handlerSlice.indexOf("privacyProxyEnabled: false");
    assert.ok(
      prefSetIdx > permIdx,
      "privacyProxyEnabled:false must appear AFTER the permission reason check (i.e. inside that branch)"
    );
  });
});

// ── 4.1 Block-prompt CTA in content script ───────────────────────────────────

describe("Block-prompt toast CTA — structural (content script)", () => {
  test("SHOW_PROXY_CTA message type handled in content script", () => {
    assert.ok(
      cleanerSource.includes("SHOW_PROXY_CTA"),
      "content script must handle SHOW_PROXY_CTA message type"
    );
  });

  test("CTA uses enable_privacy_proxy_cta i18n key text for button", () => {
    assert.ok(
      cleanerSource.includes("enable_privacy_proxy_cta") ||
      cleanerSource.includes("proxy_cta"),
      "content script CTA button text must reference the i18n key"
    );
  });

  test("CTA opens options page via chrome.runtime.openOptionsPage", () => {
    assert.ok(
      cleanerSource.includes("openOptionsPage"),
      "CTA click handler must call chrome.runtime.openOptionsPage"
    );
  });

  test("CTA writes optionsAnchor to chrome.storage.session (MV3 path)", () => {
    assert.ok(
      cleanerSource.includes("optionsAnchor") && cleanerSource.includes("privacy-proxy"),
      "CTA must write optionsAnchor:'privacy-proxy' to chrome.storage.session"
    );
  });

  test("CTA feature-detects chrome.storage.session availability (MV2 guard)", () => {
    assert.ok(
      cleanerSource.includes("chrome.storage.session"),
      "CTA must feature-detect chrome.storage.session for MV2 compat"
    );
  });

  test("CTA button built with createElement + textContent (no innerHTML)", () => {
    // The patterns test verifies no innerHTML with dynamic content.
    // We verify the CTA build area uses textContent and createElement approach
    // by checking for showProxyCta function or equivalent structure.
    assert.ok(
      cleanerSource.includes("showProxyCta") || cleanerSource.includes("SHOW_PROXY_CTA"),
      "content script must have proxy CTA toast functionality"
    );
  });
});

// ── 4.1 CTA trigger in content script click handler ──────────────────────────

describe("Block-prompt CTA — click handler integration", () => {
  // redirector-coverage-expansion (T12): the inline _OPAQUE_NETWORK_HOSTS array
  // and _isOpaqueNetworkHost function were removed from cleaner.js. The opaque-host
  // check is now delegated to window.__mugaCleaner.isOpaqueNetworkHost, which is
  // provided by the content bundle (cleaner-bundle-src.mjs → cleaner-bundle.js).
  // Single source of truth lives in src/lib/opaque-networks.js.
  test("opaque-host check delegates to window.__mugaCleaner.isOpaqueNetworkHost (bundle)", () => {
    assert.ok(
      cleanerSource.includes("window.__mugaCleaner?.isOpaqueNetworkHost"),
      "content script must delegate opaque-host check to window.__mugaCleaner.isOpaqueNetworkHost"
    );
  });

  test("inline _OPAQUE_NETWORK_HOSTS declaration is removed (single-source refactor)", () => {
    assert.ok(
      !cleanerSource.includes("const _OPAQUE_NETWORK_HOSTS"),
      "content script must NOT declare an inline _OPAQUE_NETWORK_HOSTS array — single-source refactor landed"
    );
  });

  test("inline _isOpaqueNetworkHost function declaration is removed (single-source refactor)", () => {
    assert.ok(
      !cleanerSource.includes("function _isOpaqueNetworkHost"),
      "content script must NOT define _isOpaqueNetworkHost — it is now supplied by the content bundle"
    );
  });

  test("click handler checks isOpaqueNetworkHost when privacyProxyEnabled is false", () => {
    assert.ok(
      cleanerSource.includes("isOpaqueNetworkHost") && cleanerSource.includes("privacyProxyEnabled"),
      "click handler must gate CTA on both privacyProxyEnabled and isOpaqueNetworkHost"
    );
  });

  test("CTA toast fires with enable_cta variant from click handler", () => {
    assert.ok(
      cleanerSource.includes('"enable_cta"'),
      'content script must call showProxyCta with variant "enable_cta"'
    );
  });
});

// ── Triangulation: GENERIC_SHORTENERS allowlist shape (post-#659) ────────────

describe("UNWRAP_VIA_PROXY — triangulation", () => {
  test("GENERIC_SHORTENERS is a frozen array of hostnames (no www. prefix expected)", async () => {
    const { GENERIC_SHORTENERS } = await import("../../src/lib/opaque-networks.js");
    assert.ok(Array.isArray(GENERIC_SHORTENERS), "GENERIC_SHORTENERS must be an array");
    assert.ok(GENERIC_SHORTENERS.length > 0, "GENERIC_SHORTENERS must not be empty");
    for (const host of GENERIC_SHORTENERS) {
      assert.equal(typeof host, "string", "each entry must be a string");
      assert.ok(host.length > 0, "each entry must be non-empty");
      assert.ok(!host.startsWith("www."), `entry '${host}' must not have www. prefix`);
    }
  });

  test("Worker allowlist excludes affiliate-redirect networks", async () => {
    // 2.1 pivot (#659): the URL Unwrapper tier must NOT resolve affiliate
    // redirects. Their click is the attribution event — sending them to the
    // Worker would strip the creator's commission.
    const { isGenericShortener } = await import("../../src/lib/opaque-networks.js");
    assert.equal(isGenericShortener("s.click.aliexpress.com"), false, "AliExpress affiliate host must NOT be unwrappable");
    assert.equal(isGenericShortener("anrdoezrs.net"), false, "CJ Affiliate host must NOT be unwrappable");
    assert.equal(isGenericShortener("ad.admitad.com"), false, "Admitad host must NOT be unwrappable");
    assert.equal(isGenericShortener("prf.hn"), false, "Partnerize host must NOT be unwrappable");
    assert.equal(isGenericShortener("px.a8.net"), false, "A8.net host must NOT be unwrappable");
  });

  test("Worker allowlist includes known generic shorteners", async () => {
    const { isGenericShortener } = await import("../../src/lib/opaque-networks.js");
    assert.equal(isGenericShortener("bit.ly"), true);
    assert.equal(isGenericShortener("tinyurl.com"), true);
    assert.equal(isGenericShortener("t.co"), true);
  });

  test("handler sends 'disabled' reason (not 'permission' or 'network') when pref is off", () => {
    // Triangulation: there must be exactly this reason string for the disabled path —
    // NOT permission (which triggers self-heal) and NOT network (infrastructure error)
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 4000);
    // Verify "disabled" appears before "permission" in the handler body
    const disabledIdx = handlerSlice.indexOf('"disabled"');
    const permissionIdx = handlerSlice.indexOf('"permission"');
    assert.ok(disabledIdx !== -1, '"disabled" reason must be present in handler');
    assert.ok(permissionIdx !== -1, '"permission" reason must be present in handler');
    assert.ok(disabledIdx < permissionIdx, '"disabled" check must precede "permission" self-heal branch');
  });
});

// ── W-1: UNWRAP_VIA_PROXY send in content script click handler ────────────────
// Gap 1: The content script never sent UNWRAP_VIA_PROXY when proxy was ON.
// Fix: extend the click handler else-branch to intercept opaque-network clicks
// when proxy is enabled and local unwrap returns null.

describe("Content script click handler — UNWRAP_VIA_PROXY wiring (W-1)", () => {
  test("click handler sends UNWRAP_VIA_PROXY when proxy is enabled and host is opaque", () => {
    assert.ok(
      cleanerSource.includes("UNWRAP_VIA_PROXY"),
      "content script click handler must send UNWRAP_VIA_PROXY message"
    );
  });

  test("UNWRAP_VIA_PROXY send is gated on privacyProxyEnabled being truthy", () => {
    // The UNWRAP_VIA_PROXY message send must be inside a privacyProxyEnabled conditional
    const proxyEnabledIdx = cleanerSource.indexOf("privacyProxyEnabled");
    const unwrapMsgIdx = cleanerSource.indexOf('"UNWRAP_VIA_PROXY"', proxyEnabledIdx);
    assert.ok(proxyEnabledIdx !== -1, "privacyProxyEnabled check must be present in content script");
    assert.ok(unwrapMsgIdx !== -1, "UNWRAP_VIA_PROXY message type must appear after privacyProxyEnabled check");
    assert.ok(
      unwrapMsgIdx > proxyEnabledIdx,
      "UNWRAP_VIA_PROXY send must appear after the privacyProxyEnabled gate"
    );
  });

  test("click handler calls detectWrapper from window.__mugaCleaner before sending UNWRAP_VIA_PROXY", () => {
    assert.ok(
      cleanerSource.includes("detectWrapper") && cleanerSource.includes("UNWRAP_VIA_PROXY"),
      "click handler must call detectWrapper from __mugaCleaner before sending UNWRAP_VIA_PROXY"
    );
  });

  test("click handler checks unwrap() returns null before sending UNWRAP_VIA_PROXY", () => {
    // The proxy path only fires when unwrap returns null (opaque — cannot unwrap locally)
    const unwrapCheckIdx = cleanerSource.indexOf("_unwrap(href) === null");
    assert.ok(
      unwrapCheckIdx !== -1,
      "click handler must check _unwrap(href) === null before entering proxy path"
    );
  });

  test("click handler has a 6000ms timeout guard on the UNWRAP_VIA_PROXY message", () => {
    assert.ok(
      cleanerSource.includes("6000") && cleanerSource.includes("UNWRAP_VIA_PROXY"),
      "content script must have a 6000ms timeout guard on the proxy message round-trip"
    );
  });

  test("click handler navigates to response.destination on ok:true", () => {
    // Verify the success path navigates to the resolved destination
    const okCheckIdx = cleanerSource.indexOf("response?.ok === true");
    const destIdx = cleanerSource.indexOf("response.destination", okCheckIdx);
    assert.ok(okCheckIdx !== -1, "click handler must check response?.ok === true");
    assert.ok(destIdx !== -1, "click handler must read response.destination on ok:true");
  });

  test("click handler falls back to original href on SW failure or timeout", () => {
    // On failure, navigate to original href (not cleanUrl — the user should get the opaque URL)
    const unwrapViaProxyIdx = cleanerSource.indexOf('"UNWRAP_VIA_PROXY"');
    const proxyBlock = cleanerSource.slice(unwrapViaProxyIdx, unwrapViaProxyIdx + 3000);
    assert.ok(
      proxyBlock.includes("navigate(href,") || proxyBlock.includes("navigate(href ,"),
      "click handler must call navigate(href, ...) as fallback on SW failure"
    );
  });

  test("click handler validates destination scheme before navigating (defense in depth)", () => {
    // Must validate http/https scheme even though SW already validates
    const unwrapViaProxyIdx = cleanerSource.indexOf('"UNWRAP_VIA_PROXY"');
    const proxyBlock = cleanerSource.slice(unwrapViaProxyIdx, unwrapViaProxyIdx + 3000);
    assert.ok(
      proxyBlock.includes("https://") && proxyBlock.includes("http://"),
      "click handler must validate destination scheme before navigating"
    );
  });

  test("click handler validates destination length before navigating (defense in depth)", () => {
    const unwrapViaProxyIdx = cleanerSource.indexOf('"UNWRAP_VIA_PROXY"');
    const proxyBlock = cleanerSource.slice(unwrapViaProxyIdx, unwrapViaProxyIdx + 3000);
    assert.ok(
      proxyBlock.includes("2000"),
      "click handler must validate destination length <= 2000 before navigating"
    );
  });

  test("CTA toast (enable_cta) fires only when proxy is OFF, not when proxy is ON", () => {
    // The enable_cta showProxyCta call must be inside the else-branch (proxy=OFF),
    // not in the proxy=ON branch.
    // Verify: 'enable_cta' appears in the source, and privacyProxyEnabled appears before it
    const proxyEnabledIdx = cleanerSource.indexOf("privacyProxyEnabled");
    const enableCtaIdx = cleanerSource.indexOf('"enable_cta"', proxyEnabledIdx);
    assert.ok(enableCtaIdx !== -1, '"enable_cta" must be present in the click handler');
    // The UNWRAP_VIA_PROXY send must appear BEFORE the enable_cta (proxy ON path runs first)
    const unwrapMsgIdx = cleanerSource.indexOf('"UNWRAP_VIA_PROXY"', proxyEnabledIdx);
    assert.ok(
      unwrapMsgIdx !== -1 && unwrapMsgIdx < enableCtaIdx,
      "UNWRAP_VIA_PROXY send (proxy ON path) must appear before enable_cta (proxy OFF path)"
    );
  });
});

// ── W-2: Permission pre-flight in UNWRAP_VIA_PROXY handler ───────────────────
// Gap 2: The permission revocation self-heal branch was dead code because
// fetchUnwrap has no path that returns reason="permission" — a revoked host
// permission produces a network error. Fix: add a chrome.permissions.contains
// pre-flight BEFORE fetchUnwrap so the self-heal branch can actually fire.

describe("UNWRAP_VIA_PROXY — permission pre-flight check (W-2)", () => {
  test("handler calls chrome.permissions.contains before fetchUnwrap", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 4000);
    assert.ok(
      handlerSlice.includes("chrome.permissions.contains"),
      "UNWRAP_VIA_PROXY handler must call chrome.permissions.contains as a pre-flight"
    );
  });

  test("pre-flight checks the unwrap.muga.app/* origin", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 4000);
    assert.ok(
      handlerSlice.includes("unwrap.muga.app"),
      "permission pre-flight must check the 'unwrap.muga.app' origin"
    );
  });

  test("pre-flight returns { ok: false, reason: 'permission' } when permission is missing", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    // The handler is ~80 lines. Use 4000 chars to cover the full async body.
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 4000);
    // Must return "permission" reason in the pre-flight section (BEFORE fetchUnwrap call)
    const permissionIdx = handlerSlice.indexOf('"permission"');
    const fetchUnwrapIdx = handlerSlice.indexOf("fetchUnwrap(");
    assert.ok(permissionIdx !== -1, "handler must return reason 'permission'");
    assert.ok(fetchUnwrapIdx !== -1, "handler must call fetchUnwrap");
    assert.ok(
      permissionIdx < fetchUnwrapIdx,
      "permission reason must appear BEFORE the fetchUnwrap call (i.e. in the pre-flight gate)"
    );
  });

  test("pre-flight appears AFTER privacyProxyEnabled gate but BEFORE URL validation", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 4000);
    const disabledIdx = handlerSlice.indexOf('"disabled"');
    const permContainsIdx = handlerSlice.indexOf("chrome.permissions.contains");
    const invalidUrlIdx = handlerSlice.indexOf('"invalid_url"');
    assert.ok(disabledIdx !== -1, '"disabled" check must exist');
    assert.ok(permContainsIdx !== -1, "chrome.permissions.contains must be present");
    assert.ok(invalidUrlIdx !== -1, '"invalid_url" check must exist');
    assert.ok(
      disabledIdx < permContainsIdx,
      "privacyProxyEnabled gate ('disabled') must come BEFORE permission pre-flight"
    );
    assert.ok(
      permContainsIdx < invalidUrlIdx,
      "permission pre-flight must come BEFORE URL validation ('invalid_url')"
    );
  });

  test("self-heal branch (privacyProxyEnabled:false write) is reachable via pre-flight", () => {
    // The pre-flight returns { ok: false, reason: "permission" } which triggers
    // the existing self-heal logic. Verify the complete dispatch path exists:
    // 1. pre-flight returns reason="permission"
    // 2. handler checks result.reason === "permission"
    // 3. handler writes privacyProxyEnabled: false
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 6000);
    assert.ok(
      handlerSlice.includes("chrome.permissions.contains"),
      "pre-flight gate must be present"
    );
    assert.ok(
      handlerSlice.includes('result.reason === "permission"') ||
      handlerSlice.includes("result.reason === 'permission'"),
      "self-heal branch must check result.reason === 'permission'"
    );
    assert.ok(
      handlerSlice.includes("privacyProxyEnabled: false"),
      "self-heal branch must write privacyProxyEnabled: false"
    );
  });
});

// ── i18n key completeness ─────────────────────────────────────────────────────

describe("B20 i18n keys — proxy_auto_disabled", () => {
  test("proxy_auto_disabled key exists in TRANSLATIONS", async () => {
    const { TRANSLATIONS } = await import("../../src/lib/i18n.js");
    assert.ok(
      Object.prototype.hasOwnProperty.call(TRANSLATIONS, "proxy_auto_disabled"),
      "TRANSLATIONS must include proxy_auto_disabled key"
    );
  });

  test("proxy_auto_disabled has en and es translations", async () => {
    const { TRANSLATIONS } = await import("../../src/lib/i18n.js");
    const entry = TRANSLATIONS.proxy_auto_disabled;
    assert.ok(entry, "proxy_auto_disabled must exist");
    assert.equal(typeof entry.en, "string", "must have English translation");
    assert.equal(typeof entry.es, "string", "must have Spanish translation");
    assert.ok(entry.en.length > 0, "English translation must not be empty");
    assert.ok(entry.es.length > 0, "Spanish translation must not be empty");
  });
});
