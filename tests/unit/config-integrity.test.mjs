/**
 * MUGA — Config Integrity Tests
 *
 * Structural invariants for domain-rules.json and the MV2/MV3 manifests.
 * Catches mismatched versions, non-standard keys, missing permissions,
 * and accidentally-stripped affiliate params before store submission.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const domainRules = require("../../src/rules/domain-rules.json");

// ---------------------------------------------------------------------------
// Domain rules JSON integrity
// ---------------------------------------------------------------------------
describe("domain-rules.json integrity", () => {
  test("all 167 entries have domain, preserveParams (non-empty array), and note", () => {
    assert.equal(domainRules.length, 167, `Expected 167 entries, got ${domainRules.length}`);
    for (const rule of domainRules) {
      assert.equal(typeof rule.domain, "string", `domain must be string: ${JSON.stringify(rule)}`);
      assert.ok(Array.isArray(rule.preserveParams), `preserveParams must be array: ${rule.domain}`);
      assert.ok(rule.preserveParams.length > 0, `preserveParams must not be empty: ${rule.domain}`);
      assert.equal(typeof rule.note, "string", `note must be string: ${rule.domain}`);
      assert.ok(rule.note.length > 0, `note must not be empty: ${rule.domain}`);
    }
  });

  test("no duplicate domain entries", () => {
    const domains = domainRules.map(r => r.domain);
    const unique = new Set(domains);
    assert.equal(unique.size, domains.length, "Duplicate domain entries found");
  });

  test("all domains are valid lowercase strings", () => {
    for (const rule of domainRules) {
      assert.equal(rule.domain, rule.domain.toLowerCase(), `domain must be lowercase: ${rule.domain}`);
      assert.match(rule.domain, /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/, `invalid domain format: ${rule.domain}`);
    }
  });

  test("key domains present: google.com, youtube.com, amazon.com, github.com, wikipedia.org, booking.com, reddit.com", () => {
    const domains = new Set(domainRules.map(r => r.domain));
    const required = ["google.com", "youtube.com", "amazon.com", "github.com", "wikipedia.org", "booking.com", "reddit.com"];
    for (const d of required) {
      assert.ok(domains.has(d), `Missing domain rule for: ${d}`);
    }
  });

  test("no known affiliate param appears in any domain's stripParams (except documented overrides)", () => {
    // Affiliate params that must NEVER be stripped -- they belong to creators/partners
    // on stores where MUGA supports affiliate injection (privacy-compatible model).
    // Params from redirect-based networks (Awin, Admitad, etc.) are intentionally
    // excluded: MUGA strips them as policy because these networks force users through
    // external tracking servers. See privacy policy "Stores removed for privacy reasons".
    const knownAffiliateParams = new Set([
      "tag",           // Amazon Associates
      "aid",           // Booking.com
      "campid",        // eBay Partner Network
      "subid",         // Coupang Partners
      "hmkeyword",     // Coupang Partners
    ]);
    // Documented exceptions for "ref": tracking noise on Amazon (ref=cm_sw_r_*),
    // and intentionally stripped on incompatible stores (redirect-based affiliate policy).
    const allowedOverrides = {
      "ref": ["amazon.com", "amazon.es", "amazon.de", "amazon.fr", "amazon.co.uk", "amazon.it",
              "amazon.co.jp", "amazon.com.br", "amazon.in", "amazon.com.au", "amazon.ca",
              "amazon.com.mx", "amazon.nl", "amazon.pl", "amazon.se", "amazon.sg",
              "pccomponentes.com", "mediamarkt.es", "mediamarkt.de",
              "fnac.com", "fnac.es", "elcorteingles.es", "shein.com"],
    };
    for (const rule of domainRules) {
      for (const param of (rule.stripParams || [])) {
        const lower = param.toLowerCase();
        const overrideDomains = allowedOverrides[lower] || [];
        if (overrideDomains.includes(rule.domain)) continue;
        assert.ok(
          !knownAffiliateParams.has(lower),
          `Domain ${rule.domain} has affiliate param "${param}" in stripParams — this would strip someone's affiliate tag`
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Manifest integrity — prevent AMO/CWS submission failures
// ---------------------------------------------------------------------------
describe("manifest.json integrity", () => {
  const require = createRequire(import.meta.url);
  const mv3 = require("../../src/manifest.json");
  const mv2 = require("../../src/manifest.v2.json");

  test("MV3 and MV2 have matching version", () => {
    assert.equal(mv3.version, mv2.version, `MV3 version ${mv3.version} !== MV2 version ${mv2.version}`);
  });

  test("MV3 and MV2 have matching name", () => {
    assert.equal(mv3.name, mv2.name, "Extension name must match across manifests");
  });

  test("MV2 has gecko ID", () => {
    const geckoId = mv2.browser_specific_settings?.gecko?.id;
    assert.ok(geckoId, "manifest.v2.json must have browser_specific_settings.gecko.id");
  });

  test("MV2 has data_collection_permissions with required array", () => {
    const dcp = mv2.browser_specific_settings?.gecko?.data_collection_permissions;
    assert.ok(dcp, "manifest.v2.json must have data_collection_permissions");
    assert.ok(Array.isArray(dcp.required), "data_collection_permissions.required must be an array");
    assert.ok(dcp.required.length > 0, "data_collection_permissions.required must not be empty");
  });

  test("MV2 has gecko_android settings", () => {
    const android = mv2.browser_specific_settings?.gecko_android;
    assert.ok(android, "manifest.v2.json must have gecko_android for Firefox Android support");
    assert.ok(android.strict_min_version, "gecko_android must have strict_min_version");
  });

  test("version in package.json matches manifests", () => {
    const pkg = require("../../package.json");
    assert.equal(pkg.version, mv3.version, `package.json ${pkg.version} !== manifest.json ${mv3.version}`);
  });

  // Prevent issue #272: custom keys cause Firefox warnings
  test("MV2 has no custom/non-standard keys at root level", () => {
    const standardMV2Keys = new Set([
      "manifest_version", "name", "short_name", "version", "description",
      "permissions", "optional_permissions", "background", "content_scripts",
      "commands", "browser_action", "page_action", "options_ui",
      "web_accessible_resources", "declarative_net_request", "icons",
      "content_security_policy", "browser_specific_settings",
      "default_locale", "homepage_url", "author", "developer",
      "incognito", "minimum_chrome_version", "offline_enabled",
      "omnibox", "options_page", "sidebar_action", "theme",
      "chrome_url_overrides", "chrome_settings_overrides",
      "devtools_page", "externally_connectable", "storage",
    ]);
    for (const key of Object.keys(mv2)) {
      assert.ok(
        standardMV2Keys.has(key),
        `MV2 manifest has non-standard key "${key}" which will cause Firefox warnings`
      );
    }
  });

  test("MV3 has no custom/non-standard keys at root level", () => {
    const standardMV3Keys = new Set([
      "manifest_version", "name", "short_name", "version", "description",
      "permissions", "optional_permissions", "optional_host_permissions", "host_permissions",
      "background", "content_scripts", "commands", "action",
      "options_ui", "options_page", "web_accessible_resources",
      "declarative_net_request", "icons", "content_security_policy",
      "default_locale", "homepage_url", "author", "developer",
      "incognito", "minimum_chrome_version", "offline_enabled",
      "omnibox", "side_panel", "devtools_page",
      "externally_connectable", "storage", "key",
      "chrome_url_overrides", "chrome_settings_overrides",
    ]);
    for (const key of Object.keys(mv3)) {
      assert.ok(
        standardMV3Keys.has(key),
        `MV3 manifest has non-standard key "${key}" which may cause store rejection`
      );
    }
  });

  test("MV3 uses declarativeNetRequestWithHostAccess (not declarativeNetRequest) for redirect rules", () => {
    assert.ok(
      mv3.permissions.includes("declarativeNetRequestWithHostAccess"),
      "MV3 must use declarativeNetRequestWithHostAccess for redirect-type DNR rules"
    );
    assert.ok(
      !mv3.permissions.includes("declarativeNetRequest"),
      "MV3 must NOT use plain declarativeNetRequest (insufficient for redirect rules)"
    );
  });

  test("neither manifest requests the tabs permission (use activeTab instead)", () => {
    assert.ok(!mv3.permissions.includes("tabs"), "MV3 must not request tabs permission");
    assert.ok(!mv2.permissions.includes("tabs"), "MV2 must not request tabs permission");
    assert.ok(mv3.permissions.includes("activeTab"), "MV3 must use activeTab");
    assert.ok(mv2.permissions.includes("activeTab"), "MV2 must use activeTab");
  });

  // Prevent em dashes sneaking back into user-visible manifest fields
  test("no em dashes in manifest name or description fields", () => {
    const fields = [mv3.name, mv3.description, mv2.name, mv2.description];
    for (const field of fields) {
      assert.ok(
        !field.includes("\u2014"),
        `Em dash found in manifest field: "${field}"`
      );
    }
  });

  // MV3 must declare web_accessible_resources for pages opened by the extension
  test("MV3 has web_accessible_resources", () => {
    assert.ok(
      mv3.web_accessible_resources,
      "MV3 manifest must declare web_accessible_resources for onboarding/privacy pages"
    );
    const allResources = mv3.web_accessible_resources.flatMap(r => r.resources || []);
    assert.ok(
      allResources.includes("onboarding/onboarding.html"),
      "onboarding/onboarding.html must be in web_accessible_resources"
    );
  });

  test("MV3 and MV2 declare the same permissions (excluding host_permissions and MV-specific equivalents)", () => {
    // MV3 uses declarativeNetRequestWithHostAccess (required for redirect rules in MV3)
    // MV2 uses declarativeNetRequest (Firefox MV2 doesn't support the WithHostAccess variant)
    const MV_EQUIVALENTS = new Map([
      ["declarativeNetRequestWithHostAccess", "declarativeNetRequest"],
    ]);
    const normalize = (p) => MV_EQUIVALENTS.get(p) ?? p;
    const mv3Perms = new Set(mv3.permissions.map(normalize));
    const mv2Perms = new Set(mv2.permissions.filter(p => p !== "<all_urls>").map(normalize));
    for (const p of mv3Perms) {
      assert.ok(mv2Perms.has(p), `Permission "${p}" in MV3 but missing from MV2`);
    }
    for (const p of mv2Perms) {
      assert.ok(mv3Perms.has(p), `Permission "${p}" in MV2 but missing from MV3`);
    }
  });

  // Remote rules update (T1.1) — REQ-MANIFEST-1, REQ-MANIFEST-2
  test("MV3 permissions include alarms (required for weekly remote-rules fetch)", () => {
    assert.ok(
      mv3.permissions.includes("alarms"),
      'manifest.json must include "alarms" in permissions for chrome.alarms API'
    );
  });

  test("MV2 permissions include alarms (required for weekly remote-rules fetch)", () => {
    assert.ok(
      mv2.permissions.includes("alarms"),
      'manifest.v2.json must include "alarms" in permissions for browser.alarms API'
    );
  });

  test("MV3 optional_host_permissions includes yocreoquesi.github.io (remote rules endpoint)", () => {
    assert.ok(
      Array.isArray(mv3.optional_host_permissions),
      "manifest.json must have optional_host_permissions array"
    );
    assert.ok(
      mv3.optional_host_permissions.includes("https://yocreoquesi.github.io/*"),
      'manifest.json optional_host_permissions must include "https://yocreoquesi.github.io/*"'
    );
  });

  test("MV2 optional_permissions includes yocreoquesi.github.io (remote rules endpoint)", () => {
    assert.ok(
      Array.isArray(mv2.optional_permissions),
      "manifest.v2.json must have optional_permissions array"
    );
    assert.ok(
      mv2.optional_permissions.includes("https://yocreoquesi.github.io/*"),
      'manifest.v2.json optional_permissions must include "https://yocreoquesi.github.io/*"'
    );
  });
});
