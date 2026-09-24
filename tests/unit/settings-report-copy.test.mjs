/**
 * MUGA — Settings > Report a problem speaks to users, not QA (#1411).
 *
 * The section (#1353) reused the Developer tools URL tester strings, so the
 * only report path every user can reach opened with a "Test" button, a
 * field named "URL to test" and a "Result" heading. It now has its own
 * copy; the dev_url_* keys stay with the Developer tools tester.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { TRANSLATIONS, SUPPORTED_LANGS } from "../../src/lib/i18n.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, "../../src/options/options.html"), "utf8");
const sectionOf = (openTag) => {
  const open = html.indexOf(openTag);
  assert.ok(open !== -1, openTag);
  return html.slice(open, html.indexOf("</section>", open));
};
const report = sectionOf('<section id="section-report"');
const devTools = sectionOf('<section id="section-dev-tools"');

const OWN_KEYS = {
  report_url_check_btn: 'data-i18n="report_url_check_btn"',
  aria_report_url_input: 'data-i18n-aria-label="aria_report_url_input"',
  report_url_result_label: 'data-i18n="report_url_result_label"',
};

describe("#1411: the report section has its own copy", () => {
  test("it no longer borrows the QA tester's button, field name or result heading", () => {
    for (const key of ["dev_url_test_btn", "aria_dev_url_input", "dev_url_result_label"]) {
      assert.ok(!report.includes(`"${key}"`), `section-report still uses ${key}`);
    }
  });

  test("it uses its own three keys", () => {
    for (const attr of Object.values(OWN_KEYS)) assert.ok(report.includes(attr), attr);
  });

  test("the Developer tools tester keeps its QA wording", () => {
    for (const key of ["dev_url_test_btn", "aria_dev_url_input", "dev_url_result_label"]) {
      assert.ok(devTools.includes(`"${key}"`), `section-dev-tools lost ${key}`);
    }
  });

  for (const key of Object.keys(OWN_KEYS)) {
    test(`${key} is translated in all 7 locales and differs from the tester copy`, () => {
      for (const { code } of SUPPORTED_LANGS) {
        const value = TRANSLATIONS[key]?.[code];
        assert.ok(typeof value === "string" && value.trim(), `${key}.${code}`);
        assert.ok(!value.includes("—"), `${key}.${code} has an em-dash`);
      }
    });
  }
});
