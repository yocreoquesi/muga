/**
 * MUGA: Ops-docs sync test (#414)
 *
 * Mechanical drift checks for the runbooks under docs/ops/. Catches
 * the obvious sync failures without trying to evaluate substance.
 *
 * Substance review (does the runbook describe the current process)
 * stays a human task. This file enforces:
 *
 *   1. Every doc in docs/ops/ is referenced from docs/ops/README.md
 *      so the index does not silently drift out of sync with the
 *      sibling files.
 *
 *   2. The rollback playbook references at least one CHANGELOG entry
 *      version (e.g. "v1.12.0"), keeping the playbook's example
 *      version connected to the actual codebase. If a future release
 *      cycle bumps the major version and the playbook stays on the
 *      old example, this catches it.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const opsDir = join(root, "docs/ops");

function read(relPath) {
  return readFileSync(join(root, relPath), "utf8");
}

// ---------------------------------------------------------------------------
// 1. Every doc in docs/ops/ must be referenced from docs/ops/README.md
// ---------------------------------------------------------------------------
describe("Ops-docs sync — every doc is indexed", () => {
  test("docs/ops/README.md references every sibling .md file", () => {
    const readme = read("docs/ops/README.md");
    const siblings = readdirSync(opsDir).filter(
      (f) => f.endsWith(".md") && f !== "README.md"
    );

    assert.ok(siblings.length > 0, "docs/ops/ has no runbooks (expected at least one)");

    for (const sibling of siblings) {
      const isReferenced =
        readme.includes(`(${sibling})`) ||
        readme.includes(`(./${sibling})`) ||
        readme.includes(`/${sibling}`);
      assert.ok(
        isReferenced,
        [
          `docs/ops/README.md does not reference ${sibling}.`,
          "Either link the doc from the index or remove it from docs/ops/.",
        ].join(" ")
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Rollback playbook references a CHANGELOG version
// ---------------------------------------------------------------------------
describe("Ops-docs sync — rollback playbook references CHANGELOG versions", () => {
  test("docs/ops/rollback-playbook.md cites at least one v1.X.Y version", () => {
    const playbook = read("docs/ops/rollback-playbook.md");
    const changelog = read("CHANGELOG.md");

    // Pull every version stamp from the CHANGELOG.
    const changelogVersions = new Set(
      [...changelog.matchAll(/v?(\d+\.\d+\.\d+)/g)].map((m) => m[1])
    );
    assert.ok(
      changelogVersions.size > 0,
      "CHANGELOG.md has no v X.Y.Z entries (expected at least one)"
    );

    // The playbook should reference at least ONE version that also
    // appears in the CHANGELOG. This keeps the example stay connected
    // to the actual release line.
    const playbookVersions = [...playbook.matchAll(/v?(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    const intersection = playbookVersions.filter((v) => changelogVersions.has(v));

    assert.ok(
      intersection.length > 0,
      [
        "docs/ops/rollback-playbook.md does not cite any version that appears",
        "in CHANGELOG.md. The playbook example versions should be drawn from",
        "the actual release line, not invented numbers.",
        `Playbook versions: ${playbookVersions.join(", ") || "(none)"}`,
        `CHANGELOG versions: ${[...changelogVersions].slice(0, 5).join(", ")}…`,
      ].join("\n  ")
    );
  });
});
