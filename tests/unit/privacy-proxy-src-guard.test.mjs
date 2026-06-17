/**
 * MUGA — ADR-0004 phase 5: PrivacyProxy decommission guard (#701 item 9)
 *
 * The Privacy Proxy ("PrivacyProxy", CamelCase) was fully decommissioned in
 * ADR-0004 phase 5. This test asserts that the identifier "PrivacyProxy"
 * (exact CamelCase) never reappears in src/ .js files.
 *
 * EXEMPTION: the storage migration legitimately references the OLD storage key
 * `privacyProxyEnabled` (lowercase-p camelCase) in src/lib/storage-migrations.js,
 * src/lib/prefs.js, and src/background/service-worker.js comments. That string
 * is NOT "PrivacyProxy" (different casing), so a plain substring check on
 * "PrivacyProxy" does NOT match it — no special exclusion logic is needed.
 * Do NOT ban `privacyProxyEnabled`; it must remain until the migration is retired.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

/**
 * Recursively collect all .js files under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function collectJsFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsFiles(full));
    } else if (entry.name.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

const srcDir = join(root, "src");
const jsFiles = collectJsFiles(srcDir);

describe("ADR-0004 phase 5: PrivacyProxy decommission guard (#701 item 9)", () => {
  test("no .js file under src/ contains the literal identifier 'PrivacyProxy'", () => {
    const offenders = [];
    for (const filePath of jsFiles) {
      const fileText = readFileSync(filePath, "utf8");
      if (fileText.includes("PrivacyProxy")) {
        offenders.push(filePath.replace(root + "\\", "").replace(root + "/", ""));
      }
    }
    assert.deepStrictEqual(
      offenders,
      [],
      `The following file(s) contain the banned identifier 'PrivacyProxy'.\n` +
        `ADR-0004 phase 5 fully decommissioned the Privacy Proxy — this identifier must not reappear.\n` +
        `See docs/adr/0004-*.md for rationale.\n` +
        `NOTE: 'privacyProxyEnabled' (lowercase-p) is exempt — it is the legacy storage migration key.\n` +
        `Offending files:\n  ${offenders.join("\n  ")}`,
    );
  });
});
