/**
 * MUGA — release version pre-flight
 *
 * The stores validate the manifest version, not the git tag. Until now
 * nothing compared them, so a mistyped tag would publish a different version
 * than the tag claims — quietly, since the store accepts it and the GitHub
 * Release is named after the tag. The damage shows up later, when the next
 * release cannot reuse a number that was already burned.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import {
  versionFromTag,
  findReleaseVersionProblems,
} from "../../tools/verify-release-version.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** A coherent set of sources, so each test can break exactly one thing. */
function sources(overrides = {}) {
  return {
    pkg: { version: "3.0.1" },
    mv3: { version: "3.0.1", version_name: "3.0.1" },
    mv2: { version: "3.0.1" },
    changelog: "# Changelog\n\n## [3.0.1] - 2026-08-10\n\n- something\n",
    ...overrides,
  };
}

describe("versionFromTag", () => {
  it("strips the leading v", () => {
    assert.equal(versionFromTag("v3.0.1"), "3.0.1");
  });

  it("accepts a bare version", () => {
    assert.equal(versionFromTag("3.0.1"), "3.0.1");
  });

  it("strips only ONE leading v, so a typo cannot be normalised away", () => {
    assert.equal(versionFromTag("vv3.0.1"), "v3.0.1");
  });

  it("rejects an empty or non-string tag rather than comparing against nothing", () => {
    for (const bad of ["", "   ", null, undefined, 3]) {
      assert.throws(() => versionFromTag(/** @type {any} */ (bad)), /tag is required/);
    }
  });
});

describe("findReleaseVersionProblems — the coherent case", () => {
  it("reports nothing when every source agrees", () => {
    assert.deepEqual(findReleaseVersionProblems("v3.0.1", sources()), []);
  });

  it("accepts a manifest with no version_name at all", () => {
    const s = sources({ mv3: { version: "3.0.1" } });
    assert.deepEqual(findReleaseVersionProblems("v3.0.1", s), []);
  });
});

describe("findReleaseVersionProblems — each drift is caught", () => {
  it("catches a stale package.json", () => {
    const problems = findReleaseVersionProblems("v3.0.1", sources({ pkg: { version: "3.0.0" } }));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /package\.json is 3\.0\.0/);
  });

  it("catches a stale MV3 manifest — the one Chrome validates", () => {
    const s = sources({ mv3: { version: "3.0.0", version_name: "3.0.0" } });
    const problems = findReleaseVersionProblems("v3.0.1", s);
    assert.ok(problems.some((p) => /src\/manifest\.json is 3\.0\.0/.test(p)));
  });

  it("catches a stale MV2 manifest — the one AMO validates", () => {
    const problems = findReleaseVersionProblems("v3.0.1", sources({ mv2: { version: "3.0.0" } }));
    assert.ok(problems.some((p) => /manifest\.v2\.json is 3\.0\.0/.test(p)));
  });

  it("catches a version_name that contradicts the version users are shipped", () => {
    const s = sources({ mv3: { version: "3.0.1", version_name: "3.0.0" } });
    const problems = findReleaseVersionProblems("v3.0.1", s);
    assert.ok(problems.some((p) => /version_name is 3\.0\.0/.test(p)));
  });

  it("catches a missing CHANGELOG section, which would ship placeholder notes", () => {
    const s = sources({ changelog: "# Changelog\n\n## [3.0.0] - 2026-08-08\n\n- older\n" });
    const problems = findReleaseVersionProblems("v3.0.1", s);
    assert.ok(problems.some((p) => /no "## \[3\.0\.1\]" section/.test(p)));
  });

  it("does not accept a link reference at the bottom as a CHANGELOG section", () => {
    // "[3.0.1]: https://..." is a link definition, not a release entry.
    const s = sources({ changelog: "# Changelog\n\n[3.0.1]: https://example.com/compare\n" });
    const problems = findReleaseVersionProblems("v3.0.1", s);
    assert.ok(problems.some((p) => /no "## \[3\.0\.1\]" section/.test(p)));
  });

  it("reports EVERY problem at once instead of stopping at the first", () => {
    const s = sources({
      pkg: { version: "3.0.0" },
      mv3: { version: "3.0.0", version_name: "3.0.0" },
      mv2: { version: "3.0.0" },
      changelog: "# Changelog\n",
    });
    // package + mv3 + mv2 + version_name + changelog
    assert.equal(findReleaseVersionProblems("v3.0.1", s).length, 5);
  });

  it("treats a version that is a prefix of another as a mismatch", () => {
    // "3.0.1" must not be satisfied by "3.0.10".
    const s = sources({ pkg: { version: "3.0.10" } });
    assert.ok(findReleaseVersionProblems("v3.0.1", s).some((p) => /package\.json is 3\.0\.10/.test(p)));
  });
});

describe("findReleaseVersionProblems — against the real repository", () => {
  it("the current tree is coherent with its own package.json version", () => {
    // Guards the guard: if this fails, the repo itself is mid-drift and the
    // next release would have shipped it.
    assert.deepEqual(findReleaseVersionProblems(`v${PKG.version}`), []);
  });
});
