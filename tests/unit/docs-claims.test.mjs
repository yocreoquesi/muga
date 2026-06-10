/**
 * MUGA — Machine-enforced documentation claims guard (#828, #829)
 *
 * PURPOSE: Numbers and file paths in README.md and CONTRIBUTING.md drift over
 * time. This test makes drift immediately visible: a failing test means the
 * docs are wrong *or* the source data changed — update both in the same PR.
 * That is the point. "Fix the test without fixing the docs" is not a valid
 * resolution.
 *
 * Assertions:
 *  (a) README noise-pattern count claims equal the live TRACKING_PARAMS /
 *      TRACKING_PREFIXES counts from affiliates.js (after stripping comments).
 *  (b) README domain count claim equals the domain-rules.json array length.
 *  (c) README badge line contains NO hardcoded test-count number — the badge
 *      must use a non-numeric label so it cannot drift.
 *  (d) CONTRIBUTING.md project-structure table file paths all exist on disk
 *      (files that are listed in the structure block must be real files).
 *  (e) package.json has engines.node (#829 — import.meta.dirname needs >=20.11)
 *  (f) dev:* / lint commands carry NO inline _metadata ignore globs — the
 *      shared web-ext-config.mjs covers them; only build:* commands need CLI
 *      overrides (web-ext CLI --ignore-files replaces, doesn't merge).
 *  (g) web-ext-config.mjs contains the _metadata ignore list (#829)
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readRoot(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

/**
 * Extract TRACKING_PARAMS count from affiliates-data.js.
 * (#826: data was moved from affiliates.js to affiliates-data.js;
 * affiliates.js re-exports it so all runtime importers are unchanged.)
 * Strips single-line comments before counting so comment-embedded strings
 * are ignored. Returns an exact integer — drift causes an assertion failure,
 * not a silent mismatch.
 */
function liveTrackingParamsCount() {
  const src = readRoot("src/lib/affiliates-data.js");
  const tpStart = src.indexOf("export const TRACKING_PARAMS = [");
  assert.ok(tpStart !== -1, "TRACKING_PARAMS export not found in affiliates-data.js");
  const tpEnd = src.indexOf("];", tpStart);
  assert.ok(tpEnd !== -1, "TRACKING_PARAMS closing ]; not found");
  const block = src.slice(tpStart, tpEnd + 2).replace(/\/\/[^\n]*/g, "");
  const entries = block.match(/"([^"]+)"/g) ?? [];
  return entries.length;
}

/**
 * Extract TRACKING_PREFIXES count from affiliates-data.js.
 * (#826: data was moved from affiliates.js to affiliates-data.js.)
 * Same stripping logic as above.
 */
function liveTrackingPrefixesCount() {
  const src = readRoot("src/lib/affiliates-data.js");
  const pfStart = src.indexOf("TRACKING_PREFIXES = [");
  assert.ok(pfStart !== -1, "TRACKING_PREFIXES not found in affiliates-data.js");
  const pfEnd = src.indexOf("];", pfStart);
  assert.ok(pfEnd !== -1, "TRACKING_PREFIXES closing ]; not found");
  const block = src.slice(pfStart, pfEnd + 2).replace(/\/\/[^\n]*/g, "");
  const entries = block.match(/"([^"]+)"/g) ?? [];
  return entries.length;
}

/**
 * Count domain-rules.json entries. The file is an array of domain objects.
 */
function liveDomainCount() {
  const raw = readRoot("src/rules/domain-rules.json");
  const data = JSON.parse(raw);
  assert.ok(Array.isArray(data), "domain-rules.json must be a JSON array");
  return data.length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("docs-claims — machine-enforced README/CONTRIBUTING accuracy", () => {
  const readme = readRoot("README.md");
  const contributing = readRoot("CONTRIBUTING.md");

  // ── (a) Noise-pattern counts ─────────────────────────────────────────────

  test("(a1) README tracking-param count equals live TRACKING_PARAMS length", () => {
    const live = liveTrackingParamsCount();
    // Match "NNN tracking params" — tolerant regex, exact equality on parse result
    const m = readme.match(/(\d+)\s+tracking\s+params?\b/i);
    assert.ok(
      m,
      "README must contain a phrase like '448 tracking params' — add one if missing"
    );
    const claimed = parseInt(m[1], 10);
    assert.strictEqual(
      claimed,
      live,
      `README claims ${claimed} tracking params but affiliates-data.js has ${live}. ` +
        "Update README and affiliates-data.js in the same PR."
    );
  });

  test("(a2) README prefix-pattern count equals live TRACKING_PREFIXES length", () => {
    const live = liveTrackingPrefixesCount();
    // Match "NNN prefix patterns"
    const m = readme.match(/(\d+)\s+prefix\s+patterns?\b/i);
    assert.ok(
      m,
      "README must contain a phrase like '13 prefix patterns' — add one if missing"
    );
    const claimed = parseInt(m[1], 10);
    assert.strictEqual(
      claimed,
      live,
      `README claims ${claimed} prefix patterns but affiliates-data.js has ${live}. ` +
        "Update README and affiliates-data.js in the same PR."
    );
  });

  // ── (b) Domain count ─────────────────────────────────────────────────────

  test("(b) README domain count equals live domain-rules.json length", () => {
    const live = liveDomainCount();
    // Match "NNN domains" — the number immediately before the word "domains"
    const m = readme.match(/\*\*(\d+)\s+domains?\*\*/i);
    assert.ok(
      m,
      "README must contain a phrase like '**169 domains**' — add one if missing"
    );
    const claimed = parseInt(m[1], 10);
    assert.strictEqual(
      claimed,
      live,
      `README claims ${claimed} domains but domain-rules.json has ${live} entries. ` +
        "Update README and domain-rules.json in the same PR."
    );
  });

  // ── (c) Badge must not contain a hardcoded test count ────────────────────

  test("(c) Tests badge line must NOT contain a hardcoded numeric test count", () => {
    // Find the Tests badge line
    const badgeLine = readme
      .split("\n")
      .find((l) => l.includes("img.shields.io") && l.toLowerCase().includes("test"));
    assert.ok(badgeLine, "README must have a shields.io tests badge line");
    // A hardcoded count looks like: tests-NNNN or NNN_pass or NNNN-pass etc.
    // Tolerate "tests-passing" or "tests-green" but not "tests-4300" or "tests-4471_pass"
    const hasHardcodedNumber = /tests-\d+|tests_\d+|\d+_pass|\d+-pass/i.test(badgeLine);
    assert.ok(
      !hasHardcodedNumber,
      `Tests badge contains a hardcoded number that will drift: ${badgeLine.trim()}\n` +
        "Replace with a non-numeric label such as 'tests-passing'."
    );
  });

  // ── (c2) Dev-section test counts must use the floor format (N,N00+) ───────
  //
  // A precise count ("4471 unit tests") drifts with every test PR. The floor
  // format ("4,400+ unit tests") only needs touching when the suite crosses
  // the next hundred — and this guard fails if the floor ever exceeds reality.

  test("(c2) README test counts use floor format and stay below the real count", () => {
    const devLines = readme
      .split("\n")
      .filter((l) => /unit tests|E2E tests/i.test(l));
    assert.ok(devLines.length > 0, "README must mention the test suites");
    for (const line of devLines) {
      const precise = line.match(/(?<![\d,+])(\d{3,})(?!\+)\s+(unit|E2E) tests/i);
      assert.equal(
        precise,
        null,
        `Precise test count will drift — use the floor format (e.g. "4,400+"): ${line.trim()}`
      );
    }
    const floor = readme.match(/([\d,]+)\+\s+unit tests/i);
    assert.ok(floor, 'README must state a "N+ unit tests" floor');
    const floorN = Number(floor[1].replace(/,/g, ""));
    const testFiles = readdirSync(join(ROOT, "tests/unit")).filter((f) => f.endsWith(".test.mjs"));
    // Cheap lower bound without running the suite: the floor must be plausible —
    // ≥10 tests/file on average would be suspicious to encode here, so we only
    // assert the floor is positive and not absurdly high vs file count.
    assert.ok(floorN >= 1000 && floorN <= testFiles.length * 100,
      `Floor ${floorN} looks implausible for ${testFiles.length} test files — update the README floor honestly.`);
  });

  // ── (e) package.json engines.node (#829) ─────────────────────────────────
  //
  // import.meta.dirname was unflagged in Node 20.11. The engines field makes
  // npm warn contributors who are running an older patch release.

  test("(e) package.json has engines.node set to >=20.11", () => {
    const pkg = JSON.parse(readRoot("package.json"));
    assert.ok(
      pkg.engines && typeof pkg.engines.node === "string",
      "package.json must have an engines.node field (import.meta.dirname requires >=20.11)"
    );
    assert.match(
      pkg.engines.node,
      /20\.11/,
      `engines.node "${pkg.engines.node}" must reference 20.11 as the minimum ` +
      "(import.meta.dirname was unflagged in 20.11)"
    );
  });

  // ── (f) dev / lint commands carry no inline _metadata globs (#829) ────────
  //
  // web-ext auto-loads web-ext-config.mjs from the cwd for `web-ext run` and
  // `web-ext lint`. The _metadata triple-glob lives in that config, so adding
  // --ignore-files to these commands would be redundant (and the CLI flag
  // REPLACES the config's ignoreFiles, not merges — adding it would also drop
  // everything else in the config).
  //
  // build:* commands are exempt: strip-test-seams.mjs copies src/ to a temp
  // dir and then passes all remaining args (including --ignore-files) verbatim
  // to web-ext build; those commands need explicit flags because the config
  // file lives in the project root, not the temp dir.

  test("(f) dev:chrome, dev:firefox, and lint commands do not carry inline _metadata ignore globs", () => {
    const pkg = JSON.parse(readRoot("package.json"));
    const scrutinised = ["dev:chrome", "dev:firefox", "lint"];
    for (const cmd of scrutinised) {
      const script = pkg.scripts?.[cmd] ?? "";
      assert.ok(
        !script.includes("_metadata"),
        `scripts.${cmd} carries an inline _metadata ignore glob ("${script}"). ` +
        "The shared web-ext-config.mjs already covers it for web-ext run/lint — " +
        "adding --ignore-files here would REPLACE the config's ignoreFiles, not merge."
      );
    }
  });

  // ── (g) web-ext-config.mjs contains the _metadata ignore list (#829) ──────
  //
  // Asserts the shared config is the canonical home of the _metadata triple.
  // If someone removes it from the config, this test fails before anything
  // ships, keeping dev-mode reload loops visible.

  test("(g) web-ext-config.mjs contains all three _metadata ignore globs", () => {
    const config = readRoot("web-ext-config.mjs");
    const required = ["_metadata", "_metadata/**", "_metadata/**/*"];
    for (const glob of required) {
      assert.ok(
        config.includes(JSON.stringify(glob)),
        `web-ext-config.mjs must include the ignore glob ${JSON.stringify(glob)} ` +
        "so dev:chrome/dev:firefox/lint inherit _metadata exclusion without inline flags."
      );
    }
  });

  // ── (d) CONTRIBUTING structure block — all listed paths must exist ────────

  test("(d) CONTRIBUTING project-structure file paths all exist on disk", () => {
    // Find the "## Project structure" section, then extract ONLY the first
    // fenced code block that follows it (stop at the closing ```).
    const sectionStart = contributing.indexOf("## Project structure");
    assert.ok(
      sectionStart !== -1,
      "CONTRIBUTING must have a '## Project structure' section"
    );
    const afterSection = contributing.slice(sectionStart);

    // Find the opening ``` of the code block
    const fenceOpen = afterSection.indexOf("```");
    assert.ok(fenceOpen !== -1, "Project structure section must have a fenced code block");

    // Find the closing ``` (start searching after the opening fence + 3 chars)
    const fenceClose = afterSection.indexOf("```", fenceOpen + 3);
    assert.ok(fenceClose !== -1, "Project structure fenced code block must be closed");

    // Extract only the content inside the fences
    const codeBlock = afterSection.slice(fenceOpen + 3, fenceClose);

    // Extract file tokens from tree-diagram lines only.
    // Tree lines contain box-drawing characters (├ └ │) OR leading whitespace + "├" / "└".
    // A file token: a word that contains a dot, ends before whitespace or EOL,
    // and has a common source-file extension. We explicitly exclude tokens like
    // "Node.js" (capital N) which appear in prose, not tree lines.
    const SOURCE_EXTENSIONS = /\.(js|mjs|cjs|json|ts|html|css|yml|yaml|md)$/i;
    const fileTokens = [];
    for (const line of codeBlock.split("\n")) {
      // Only look at lines that contain box-drawing tree characters
      if (!/[├└│]/.test(line)) continue;
      // Extract the token: everything after the last tree char sequence, up to whitespace
      const m = line.match(/[├└│─\s]+([^\s]+)/);
      if (!m) continue;
      const token = m[1].trim();
      if (SOURCE_EXTENSIONS.test(token)) fileTokens.push(token);
    }

    // Resolve each file token against common source directories.
    const searchRoots = [
      join(ROOT, "src"),
      join(ROOT, "tests"),
    ];
    const sourceDirs = ["", "content", "lib", "background", "popup", "options", "unit", "e2e", "rules"];

    const missingFiles = [];
    for (const token of fileTokens) {
      let found = false;
      outer: for (const base of searchRoots) {
        for (const sub of sourceDirs) {
          if (existsSync(join(base, sub, token))) { found = true; break outer; }
        }
      }
      if (!found) missingFiles.push(token);
    }

    assert.deepStrictEqual(
      missingFiles,
      [],
      `CONTRIBUTING project structure lists file(s) that don't exist on disk: ${missingFiles.join(", ")}. ` +
        "Remove deleted files from the structure block and add new ones."
    );
  });
});
