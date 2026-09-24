/**
 * MUGA — rules-channel-guards.mjs tests (#1416, #1421)
 *
 * Two cheap producer-side guards for the signed remote-rules channel:
 *
 *   - publishedAgeProblems (#1416): installed builds reject a payload whose
 *     `published` is older than STALE_DAYS (180). Nothing refreshed that date
 *     on quiet weeks, so the channel could expire silently. The guard fails
 *     well before the runtime limit.
 *   - unbumpedContentChanges (#1421): at an unchanged `version`, any change
 *     to the signed content (params, scoped, published) is never delivered to
 *     a build that already holds that version.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  publishedAgeProblems,
  unbumpedContentChanges,
  DEFAULT_MAX_AGE_DAYS,
} from "../../tools/rules-channel-guards.mjs";
import { STALE_DAYS } from "../../src/lib/remote-rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "..", "tools", "rules-channel-guards.mjs");
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-24T12:00:00.000Z");

describe("publishedAgeProblems (#1416)", () => {
  test("the guard margin sits well inside the runtime's STALE_DAYS", () => {
    assert.ok(DEFAULT_MAX_AGE_DAYS < STALE_DAYS);
    assert.ok(STALE_DAYS - DEFAULT_MAX_AGE_DAYS >= 21, "at least three weekly runs of warning");
  });

  test("a fresh payload passes", () => {
    const published = new Date(NOW - 10 * DAY).toISOString();
    assert.deepEqual(publishedAgeProblems({ published }, NOW), []);
  });

  test("a payload older than the margin fails, before the runtime would reject it", () => {
    const published = new Date(NOW - (DEFAULT_MAX_AGE_DAYS + 1) * DAY).toISOString();
    const problems = publishedAgeProblems({ published }, NOW);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /days old/);
  });

  test("a missing or unparseable published fails", () => {
    assert.equal(publishedAgeProblems({}, NOW).length, 1);
    assert.equal(publishedAgeProblems({ published: "not a date" }, NOW).length, 1);
  });

  test("a published date in the future fails (it would read as fresh forever)", () => {
    const published = new Date(NOW + 2 * DAY).toISOString();
    assert.equal(publishedAgeProblems({ published }, NOW).length, 1);
  });
});

describe("unbumpedContentChanges (#1421)", () => {
  const base = {
    version: 16,
    published: "2026-09-23T00:00:00.000Z",
    params: ["a", "b"],
    scoped: [{ param: "x", hosts: ["a.com"] }],
  };

  test("identical content at the same version is fine", () => {
    assert.deepEqual(unbumpedContentChanges({ ...base }, { ...base, sig: "s", scopedSig: "t" }), []);
  });

  test("a source version LOWER than the published one is caught (#1421 native review)", () => {
    assert.deepEqual(unbumpedContentChanges({ ...base, version: 15 }, base), ["version"]);
  });

  test("a SCOPED-only change at an unchanged version is caught", () => {
    const source = { ...base, scoped: [{ param: "y", hosts: ["b.com"] }] };
    assert.deepEqual(unbumpedContentChanges(source, base), ["scoped"]);
  });

  test("a withdrawn scoped fact at an unchanged version is caught", () => {
    const source = { ...base, scoped: [] };
    assert.deepEqual(unbumpedContentChanges(source, base), ["scoped"]);
  });

  test("an absent scoped section equals an empty one", () => {
    const { scoped: _drop, ...noScoped } = base;
    assert.deepEqual(unbumpedContentChanges(noScoped, { ...base, scoped: [] }), []);
  });

  test("params and published are compared too", () => {
    assert.deepEqual(unbumpedContentChanges({ ...base, params: ["a"] }, base), ["params"]);
    assert.deepEqual(
      unbumpedContentChanges({ ...base, published: "2026-09-24T00:00:00.000Z" }, base),
      ["published"]
    );
  });

  test("a bumped version may change anything", () => {
    const source = { ...base, version: 17, params: ["c"], scoped: [] };
    assert.deepEqual(unbumpedContentChanges(source, base), []);
  });
});

describe("the guards are wired into the channel's workflows", () => {
  const wf = (name) =>
    readFileSync(join(__dirname, "..", "..", ".github", "workflows", name), "utf8");

  test("the weekly auto-ingest run checks the age of what the channel will serve (#1416)", () => {
    const text = wf("auto-ingest-rules.yml");
    const guard = text.indexOf("node tools/rules-channel-guards.mjs --max-age tools/rules-source/params.json");
    const reconcile = text.indexOf("node tools/rule-ingestion/reconcile-net-change.mjs");
    assert.ok(guard > -1, "auto-ingest-rules.yml must run the --max-age guard");
    assert.ok(guard > reconcile, "after reconcile, which is what refreshes published on a net change");
  });

  test("publish-rules refuses an unbumped content change before signing (#1421)", () => {
    const text = wf("publish-rules.yml");
    const guard = text.indexOf(
      "node tools/rules-channel-guards.mjs --bump tools/rules-source/params.json docs/rules/v1/params.json"
    );
    const sign = text.indexOf("run: node tools/sign-rules.mjs");
    const key = text.indexOf('> "$RUNNER_TEMP/key.pem"');
    assert.ok(guard > -1, "publish-rules.yml must run the --bump guard");
    assert.ok(guard < sign && guard < key, "before the key is written and before signing");
  });
});

describe("CLI", () => {
  function tmpJson(obj) {
    const dir = mkdtempSync(join(tmpdir(), "rules-channel-guards-"));
    const path = join(dir, "p.json");
    writeFileSync(path, JSON.stringify(obj), "utf8");
    return path;
  }

  test("--max-age: exits 1 on an old published date and names the fix", () => {
    const path = tmpJson({ version: 1, published: "2020-01-01T00:00:00.000Z", params: ["a"] });
    const r = spawnSync(process.execPath, [CLI, "--max-age", path], { encoding: "utf8" });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /version/);
  });

  test("--max-age: exits 0 on a fresh date", () => {
    const path = tmpJson({ version: 1, published: new Date().toISOString(), params: ["a"] });
    const r = spawnSync(process.execPath, [CLI, "--max-age", path], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  });

  test("--bump: exits 1 when the source changed scoped facts without a version bump", () => {
    const published = { version: 4, published: "2026-09-01T00:00:00.000Z", params: ["a"], scoped: [] };
    const source = { ...published, scoped: [{ param: "x", hosts: ["a.com"] }] };
    const r = spawnSync(process.execPath, [CLI, "--bump", tmpJson(source), tmpJson(published)], {
      encoding: "utf8",
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /scoped/);
  });

  test("--bump: exits 0 on the committed source vs the committed published artifact", () => {
    const root = join(__dirname, "..", "..");
    const r = spawnSync(
      process.execPath,
      [
        CLI,
        "--bump",
        join(root, "tools", "rules-source", "params.json"),
        join(root, "docs", "rules", "v1", "params.json"),
      ],
      { encoding: "utf8" }
    );
    assert.equal(r.status, 0, r.stderr);
  });

  test("no mode: usage error, exit 2", () => {
    const r = spawnSync(process.execPath, [CLI], { encoding: "utf8" });
    assert.equal(r.status, 2);
  });
});
