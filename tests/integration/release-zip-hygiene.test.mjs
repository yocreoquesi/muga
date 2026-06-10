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
 *
 * 3. Test/production boundary (#827) — `lib/test-fixtures.js` in the
 *    store artifact must be the inert stub produced by strip-test-seams.mjs,
 *    NOT the dev source that reads `chrome.storage.local["__muga_test_*"]`.
 *    `background/service-worker.js` must not contain the runtime
 *    `Array.isArray(globalThis.__MUGA_TRUSTED_KEYS__)` conditional.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { inflateRawSync } from "node:zlib";

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

// ── Pure-Node ZIP entry reader (no external tools required) ──────────────────
//
// Reads the ZIP central directory and decompresses individual entries.
// Supports stored (method 0) and deflated (method 8) entries, which covers
// all entries produced by web-ext build.

/**
 * Parses a ZIP file and returns an array of { name, getData() } objects.
 * getData() decompresses and returns the entry content as a Buffer.
 *
 * @param {string} zipPath - Absolute path to the zip file.
 * @returns {Array<{name: string, getData: () => Buffer}>}
 */
function readZipEntries(zipPath) {
  const buf = readFileSync(zipPath);
  const entries = [];

  // Find End of Central Directory record (signature 0x06054b50).
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Invalid ZIP: EOCD not found");

  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdCount  = buf.readUInt16LE(eocdOffset + 10);

  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break; // Central directory signature
    const method       = buf.readUInt16LE(pos + 10);
    const compSize     = buf.readUInt32LE(pos + 20);
    const nameLen      = buf.readUInt16LE(pos + 28);
    const extraLen     = buf.readUInt16LE(pos + 30);
    const commentLen   = buf.readUInt16LE(pos + 32);
    const localOffset  = buf.readUInt32LE(pos + 42);
    const name         = buf.toString("utf8", pos + 46, pos + 46 + nameLen);

    // Capture for closure — const binds the value at this iteration.
    const capturedOffset = localOffset;
    const capturedMethod = method;
    const capturedComp   = compSize;

    entries.push({
      name,
      getData() {
        // Local file header: signature (4) + fixed fields (26) + name + extra
        const lhNameLen  = buf.readUInt16LE(capturedOffset + 26);
        const lhExtraLen = buf.readUInt16LE(capturedOffset + 28);
        const dataStart  = capturedOffset + 30 + lhNameLen + lhExtraLen;
        const compressed = buf.slice(dataStart, dataStart + capturedComp);
        if (capturedMethod === 0) return compressed;           // stored
        if (capturedMethod === 8) return inflateRawSync(compressed); // deflated
        throw new Error(`Unsupported compression method ${capturedMethod} for ${name}`);
      },
    });

    pos += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

// ── Existing hygiene tests (entry-name patterns) ──────────────────────────────

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

// ── Test/production boundary tests (#827) ─────────────────────────────────────
//
// Asserts that store artifacts ship the inert stub for test-fixtures.js
// and have no runtime __MUGA_TRUSTED_KEYS__ conditional in service-worker.js.

for (const target of ["chrome", "firefox"]) {
  test(`release zip (${target}) — lib/test-fixtures.js is the inert stub (#827)`, () => {
    const zip = latestZip(join(ROOT, "dist", target));
    if (!zip) return; // No build artefact — CI builds before running.

    const entries = readZipEntries(zip);
    const fixturesEntry = entries.find(e => e.name === "lib/test-fixtures.js");

    assert.ok(
      fixturesEntry,
      `${zip} does not contain lib/test-fixtures.js — the file must be present (as the inert stub)`
    );

    const content = fixturesEntry.getData().toString("utf8");

    assert.ok(
      !content.includes("__muga_test_mode"),
      `${zip}: lib/test-fixtures.js contains "__muga_test_mode" — the stub was not applied.\n` +
      `Run npm run build:chrome (or build:firefox) to regenerate the artifact.`
    );

    assert.ok(
      !content.includes("__muga_test_fixtures"),
      `${zip}: lib/test-fixtures.js contains "__muga_test_fixtures" — the stub was not applied.`
    );

    assert.ok(
      !content.includes("chrome.storage"),
      `${zip}: lib/test-fixtures.js contains "chrome.storage" — the stub was not applied.`
    );

    assert.ok(
      content.includes("export async function getTestFixtures"),
      `${zip}: lib/test-fixtures.js stub must export getTestFixtures`
    );
  });

  test(`release zip (${target}) — service-worker.js has no __MUGA_TRUSTED_KEYS__ runtime seam (#827)`, () => {
    const zip = latestZip(join(ROOT, "dist", target));
    if (!zip) return; // No build artefact — CI builds before running.

    const entries = readZipEntries(zip);
    const swEntry = entries.find(e => e.name === "background/service-worker.js");

    assert.ok(
      swEntry,
      `${zip} does not contain background/service-worker.js`
    );

    const content = swEntry.getData().toString("utf8");

    assert.ok(
      !content.includes("Array.isArray(globalThis.__MUGA_TRUSTED_KEYS__)"),
      `${zip}: background/service-worker.js contains the Array.isArray(globalThis.__MUGA_TRUSTED_KEYS__) ` +
      `runtime seam — strip-test-seams.mjs did not neutralise it.\n` +
      `Run npm run build:chrome (or build:firefox) to regenerate the artifact.`
    );
  });
}
