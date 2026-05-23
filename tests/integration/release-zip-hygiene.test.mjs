/**
 * MUGA — release zip hygiene
 *
 * Guards against shipping per-install or source-only artefacts to the
 * extension stores. Two regressions this covers:
 *
 * 1. `_metadata/generated_indexed_rulesets/_ruleset*` — Chrome generates
 *    these on every load of the MV3 declarative_net_request rules. They
 *    are per-installation cache, not portable, and were leaking into the
 *    shipped zip (v1.16.0 and earlier).
 *
 * 2. `content/cleaner-bundle-src.mjs` — the ESM source for the content
 *    bundle. Only the bundled output (`cleaner-bundle.js`) should ship;
 *    the source uses imports MV3 content scripts can't load.
 *
 * Root cause: web-ext's CLI `--ignore-files` REPLACES the config file's
 * `ignoreFiles` array — it doesn't merge. The build scripts in
 * package.json are the source of truth.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, "..", "..");

const FORBIDDEN_PATTERNS = [
  { regex: /^_metadata\//,            label: "Chrome-generated DNR ruleset cache (_metadata/)" },
  { regex: /-src\.mjs$/,              label: "ESM bundle source (-src.mjs)" },
];

function listZipEntries(zipPath) {
  const out = execSync(`unzip -Z1 "${zipPath}"`, { encoding: "utf8" });
  return out.split("\n").map(l => l.trim()).filter(Boolean);
}

function latestZip(targetDir) {
  if (!existsSync(targetDir)) return null;
  const zips = readdirSync(targetDir)
    .filter(f => f.endsWith(".zip"))
    .sort();
  return zips.length ? join(targetDir, zips[zips.length - 1]) : null;
}

for (const target of ["chrome", "firefox"]) {
  test(`release zip (${target}) contains no forbidden paths`, () => {
    const zip = latestZip(join(ROOT, "dist", target));
    if (!zip) {
      // No build artefact yet — nothing to validate. CI builds before tests.
      return;
    }
    const entries = listZipEntries(zip);
    const offending = [];
    for (const { regex, label } of FORBIDDEN_PATTERNS) {
      const hits = entries.filter(e => regex.test(e));
      if (hits.length) offending.push(`${label}:\n  - ${hits.join("\n  - ")}`);
    }
    assert.equal(
      offending.length,
      0,
      `${zip} contains forbidden paths:\n\n${offending.join("\n\n")}\n\n` +
      `Fix: add the matching pattern to --ignore-files in the build:* ` +
      `script in package.json (web-ext-config.mjs is shadowed by the CLI).`
    );
  });
}
