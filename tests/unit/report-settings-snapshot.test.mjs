/**
 * MUGA: Unit tests for the report settings snapshot (#1507)
 *
 * The snapshot rides in the broken-site issue form so a maintainer can
 * reproduce a report. It must describe the user's configuration without
 * describing their browsing:
 *   - scalar prefs: only the keys that differ from PREF_DEFAULTS, derived from
 *     SETTINGS_FIELDS, plus disabledCategories (always);
 *   - lists: entry counts, plus only the entries that match the reported page;
 *   - remote rules: on/off and the payload version in use.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildSettingsSnapshot } from "../../src/lib/broken-site-report.js";
import { PREF_DEFAULTS } from "../../src/lib/prefs.js";

const URL_UNDER_REPORT = "https://shop.example.com/item?ref_code=abc&utm_source=x";

function snapshot(prefOverrides = {}, extra = {}) {
  return buildSettingsSnapshot({
    prefs: { ...PREF_DEFAULTS, ...prefOverrides },
    url: URL_UNDER_REPORT,
    remoteRulesVersion: 16,
    ...extra,
  });
}

describe("#1507 buildSettingsSnapshot: scalar prefs", () => {
  test("all-default prefs report no changed keys", () => {
    assert.match(snapshot(), /^Changed from defaults: none$/m);
  });

  test("lists exactly the keys that differ from PREF_DEFAULTS, with their values", () => {
    const out = snapshot({ blockBeacons: true, toastDuration: 30, ampRedirect: false });
    const line = out.split("\n").find((l) => l.startsWith("Changed from defaults:"));
    assert.equal(line, "Changed from defaults: ampRedirect=false, blockBeacons=true, toastDuration=30");
  });

  test("ignores prefs that are not user settings (consent state, internal flags)", () => {
    const out = snapshot({ onboardingDone: true, consentVersion: "3", dnrEnabled: false });
    assert.match(out, /^Changed from defaults: none$/m);
  });

  test("always carries disabledCategories, empty or not", () => {
    assert.match(snapshot(), /^disabledCategories: none$/m);
    assert.match(snapshot({ disabledCategories: ["social", "ads"] }), /^disabledCategories: social, ads$/m);
  });
});

describe("#1507 buildSettingsSnapshot: lists are counts plus page-matching entries only", () => {
  test("a list with no matching entry is a bare count, never its contents", () => {
    const out = snapshot({ whitelist: ["other.org", "news.site::tag::x-21"] });
    assert.match(out, /^whitelist: 2 entries$/m);
    assert.ok(!out.includes("other.org"));
    assert.ok(!out.includes("news.site"));
  });

  test("host lists include only the entries whose domain matches the reported host", () => {
    const out = snapshot({
      whitelist: ["example.com::tag::me-21", "other.org"],
      blacklist: ["shop.example.com", "unrelated.net", "notexample.com"],
    });
    assert.match(out, /^whitelist: 2 entries; matching this page: example\.com::tag::me-21$/m);
    assert.match(out, /^blacklist: 3 entries; matching this page: shop\.example\.com$/m);
    assert.ok(!out.includes("other.org"));
    assert.ok(!out.includes("unrelated.net"));
    assert.ok(!out.includes("notexample.com"));
  });

  test("param lists include only the entries present as params in the reported URL", () => {
    const out = snapshot({ customParams: ["ref_code", "secret_param"], userCustomRules: ["UTM_SOURCE", "zz"] });
    assert.match(out, /^customParams: 2 entries; matching this page: ref_code$/m);
    assert.match(out, /^userCustomRules: 2 entries; matching this page: UTM_SOURCE$/m);
    assert.ok(!out.includes("secret_param"));
    assert.ok(!/\bzz\b/.test(out));
  });

  test("creatorAllowlist matches on the entry's domain part", () => {
    const out = snapshot({ creatorAllowlist: ["example.com/@someone", "youtube.com/@other"] });
    assert.match(out, /^creatorAllowlist: 2 entries; matching this page: example\.com\/@someone$/m);
    assert.ok(!out.includes("youtube.com"));
  });

  test("singular count reads naturally and empty lists read 0 entries", () => {
    assert.match(snapshot({ blacklist: ["x.org"] }), /^blacklist: 1 entry$/m);
    assert.match(snapshot(), /^customParams: 0 entries$/m);
  });
});

describe("#1507 buildSettingsSnapshot: remote rules", () => {
  test("reports on/off and the payload version in use", () => {
    assert.match(snapshot(), /^Remote rules: on, payload version 16$/m);
    assert.match(snapshot({ remoteRulesEnabled: false }), /^Remote rules: off, payload version 16$/m);
  });

  test("version 0 or missing reads as no payload", () => {
    assert.match(snapshot({}, { remoteRulesVersion: 0 }), /^Remote rules: on, no payload yet$/m);
    assert.match(snapshot({}, { remoteRulesVersion: undefined }), /^Remote rules: on, no payload yet$/m);
  });
});

describe("#1507 buildSettingsSnapshot: defensive", () => {
  test("never throws on garbage and still returns a string", () => {
    for (const bad of [undefined, null, {}, { prefs: null }, { prefs: { whitelist: "nope" }, url: 42 }]) {
      assert.doesNotThrow(() => buildSettingsSnapshot(bad));
      assert.equal(typeof buildSettingsSnapshot(bad), "string");
    }
  });

  test("an unparseable URL matches no list entry", () => {
    const out = buildSettingsSnapshot({
      prefs: { ...PREF_DEFAULTS, whitelist: ["example.com"] },
      url: "not a url",
    });
    assert.match(out, /^whitelist: 1 entry$/m);
  });
});
