/**
 * MUGA — no two npm scripts run the same command (#1267)
 *
 * `test:integration` and `test:integration:stub` were byte-identical. The pair
 * came from #825, which split the integration gate: the `:stub` variant ran on
 * PRs while the live `unwrap.muga.app` Worker contract ran on main pushes.
 * ADR-0004 decommissioned that Worker and the live test went with it, leaving
 * two names for one command and nothing referencing the second.
 *
 * The cost is not the duplicated line. It is that #1267 read the pair as
 * evidence that a release still depends on a live third-party service, and
 * filed it as such -- the leftover name outlived the thing it named and went
 * on describing a system that no longer existed. That is the same failure the
 * #1254 docs sweep was about, in package.json.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/**
 * Deliberate aliases, if any are ever wanted: a short name for a long command
 * that is genuinely meant to be two names for one thing.
 *
 * EMPTY, and the empty state is the point. An alias is cheap to add and
 * impossible to distinguish later from a leftover, so each one has to be
 * argued for here rather than merged for free.
 *
 * @type {Set<string>}
 */
const INTENTIONAL_ALIASES = new Set();

describe("package.json scripts", () => {
  test("no two scripts share a command", () => {
    const byCommand = new Map();
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      if (INTENTIONAL_ALIASES.has(name)) continue;
      const normalised = command.trim().replace(/\s+/g, " ");
      if (!byCommand.has(normalised)) byCommand.set(normalised, []);
      byCommand.get(normalised).push(name);
    }

    const duplicates = [...byCommand.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([command, names]) => `${names.join(" == ")}  ->  ${command}`);

    assert.deepStrictEqual(
      duplicates,
      [],
      `Two npm scripts run the same command:\n  ${duplicates.join("\n  ")}\n` +
        "One of them is almost certainly a leftover whose second half was deleted, and a name " +
        "that outlives what it named goes on describing a system that no longer exists. " +
        "Delete the stale name, or add it to INTENTIONAL_ALIASES with a reason."
    );
  });

  test("every script the CI workflows invoke exists", () => {
    // The other direction of the same rot: a workflow calling a script that was
    // renamed fails at the point of running, which is the most expensive place
    // to find out.
    const workflows = ["ci.yml", "release.yml", "auto-ingest-rules.yml", "publish-rules.yml"];
    const invoked = new Set();
    for (const file of workflows) {
      let src;
      try {
        src = readFileSync(join(ROOT, ".github/workflows", file), "utf8");
      } catch {
        continue; // a workflow that no longer exists is not this test's business
      }
      for (const m of src.matchAll(/npm run ([a-z0-9:_-]+)/g)) invoked.add(m[1]);
    }

    assert.ok(invoked.size > 0, "the sweep must find some npm run invocations, or it proves nothing");

    const missing = [...invoked].filter((name) => !(name in (pkg.scripts ?? {})));
    assert.deepStrictEqual(
      missing,
      [],
      `A CI workflow invokes an npm script that does not exist:\n  ${missing.join("\n  ")}`
    );
  });
});
