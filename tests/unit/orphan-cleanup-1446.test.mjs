/**
 * MUGA — regression guard for #1446 (reduced scope).
 *
 * src/lib/csft-upstream.js had no importer after the Report upstream button
 * moved to Settings (#1351). Its header promised a report that carries
 * "NEVER the domain list", while the shipped button goes through
 * tracker-flag-deeplink.js and prefills up to 50 domains by design. A
 * privacy statement about code that does not run is worse than none, so the
 * module is gone and nothing may point readers at it.
 *
 * The same moves left comments describing popup controls that now live in
 * Settings > Activity; those are pinned here too. Two exports with no caller
 * anywhere (tests included) ride along.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import * as remoteRules from "../../src/lib/remote-rules.js";
import * as pathRules from "../../src/lib/path-rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("#1446 csft-upstream.js is gone and nobody cites it", () => {
  test("the module does not exist", () => {
    assert.equal(existsSync(join(ROOT, "src/lib/csft-upstream.js")), false);
  });
  for (const file of [
    "src/lib/broken-site-report.js",
    ".github/ISSUE_TEMPLATE/tracker-flag.yml",
    "tests/unit/options-report-upstream-button.test.mjs",
  ]) {
    test(`${file} does not cite it`, () => {
      assert.ok(!read(file).includes("csft-upstream"), `${file} still names csft-upstream`);
    });
  }
  test("the shipped deep-link builder states its own privacy contract", () => {
    const src = read("src/lib/tracker-flag-deeplink.js");
    assert.match(src, /Privacy contract/);
    assert.match(src, /capped at 50/);
  });
});

describe("#1446 exports with no caller are removed", () => {
  test("createRemoteRulesOrchestrator", () => {
    assert.equal("createRemoteRulesOrchestrator" in remoteRules, false);
  });
  test("loadPathStripRules / loadPathAffiliateRules", () => {
    assert.equal("loadPathStripRules" in pathRules, false);
    assert.equal("loadPathAffiliateRules" in pathRules, false);
  });
});

describe("#1446 comments name Settings, not retired popup controls", () => {
  test("prefs.js", () => {
    const src = read("src/lib/prefs.js");
    assert.ok(!/identifiers in the popup/.test(src));
    assert.ok(!/popup's\s*\/\/\s*"Strip locally"|popup's "Strip locally"/.test(src));
  });
  test("user-custom-rules.js", () => {
    assert.ok(!/Strip locally/.test(read("src/lib/user-custom-rules.js")));
  });
  test("param-breakdown-view.js names all its consumers", () => {
    assert.match(read("src/lib/param-breakdown-view.js"), /Settings/);
  });
  test("test-fixtures.js documents only fixtures something reads", () => {
    const src = read("src/lib/test-fixtures.js");
    for (const key of ["consentManifest", "requiredConsentVersion", "consentClausesByVersion"]) {
      assert.ok(!src.includes(key), `test-fixtures.js still documents ${key}`);
    }
  });
});
