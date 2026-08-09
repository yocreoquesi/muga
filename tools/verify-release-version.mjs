#!/usr/bin/env node
/**
 * Release pre-flight: does the tag actually describe what is about to ship?
 *
 * The stores validate the MANIFEST version, not the git tag. Nothing in the
 * release pipeline compared the two, so tagging `v3.0.1` with manifests still
 * at 3.0.0 would publish 3.0.0 under a tag that says otherwise — and the
 * failure is not loud. The store accepts it, the GitHub Release is named after
 * the tag, and the mismatch only surfaces later when the next release cannot
 * reuse a version number that was silently already burned. MUGA has been here
 * before (the 2.6.0 version-drift incident).
 *
 * Three things are checked, all of them silent failures otherwise:
 *
 *   1. The tag matches package.json and BOTH manifests.
 *   2. manifest.json's `version_name` matches too, since that is the string
 *      users actually see in chrome://extensions.
 *   3. CHANGELOG.md has a section for this version. scripts/prepare-amo-
 *      metadata.sh greps for `## [x.y.z]` and falls back to generic
 *      "Bug fixes and improvements" notes with only a warning if it is
 *      missing, so a forgotten changelog entry ships as real release notes.
 *
 * Usage: node tools/verify-release-version.mjs v3.0.1
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/**
 * Strips a single leading "v" from a git tag. Tags are `vX.Y.Z`; every
 * version field in the repo is bare `X.Y.Z`.
 *
 * @param {string} tag
 * @returns {string}
 */
export function versionFromTag(tag) {
  if (typeof tag !== "string" || tag.trim() === "") {
    throw new Error("A tag is required, e.g. v3.0.1");
  }
  return tag.trim().replace(/^v/, "");
}

/**
 * Collects every mismatch rather than throwing on the first one: a release
 * engineer fixing one field at a time, re-tagging, and failing again on the
 * next is a worse loop than seeing all of them at once.
 *
 * @param {string} tag - the git tag being released, e.g. "v3.0.1"
 * @param {{ pkg?: object, mv3?: object, mv2?: object, changelog?: string }} [sources]
 * @returns {string[]} human-readable problems; empty means the release is coherent
 */
export function findReleaseVersionProblems(tag, sources = {}) {
  const version = versionFromTag(tag);
  const problems = [];

  const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  const pkg = sources.pkg ?? read("package.json");
  const mv3 = sources.mv3 ?? read("src/manifest.json");
  const mv2 = sources.mv2 ?? read("src/manifest.v2.json");
  const changelog =
    sources.changelog ?? fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");

  if (pkg.version !== version) {
    problems.push(`package.json is ${pkg.version}, tag says ${version}`);
  }
  if (mv3.version !== version) {
    problems.push(`src/manifest.json is ${mv3.version}, tag says ${version}`);
  }
  if (mv2.version !== version) {
    problems.push(`src/manifest.v2.json is ${mv2.version}, tag says ${version}`);
  }
  // version_name is what chrome://extensions displays. It is allowed to be
  // absent, but if present it must not contradict the shipped version.
  if (mv3.version_name !== undefined && mv3.version_name !== version) {
    problems.push(`src/manifest.json version_name is ${mv3.version_name}, tag says ${version}`);
  }

  // Anchored to line start so a link reference like "[3.0.0]: https://..."
  // at the bottom of the file cannot satisfy the check.
  const heading = new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\]`, "m");
  if (!heading.test(changelog)) {
    problems.push(
      `CHANGELOG.md has no "## [${version}]" section — ` +
      "AMO would receive generic placeholder release notes"
    );
  }

  return problems;
}

function isMain() {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return entry === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const tag = process.argv[2];
  let problems;
  try {
    problems = findReleaseVersionProblems(tag);
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(1);
  }

  if (problems.length > 0) {
    console.error(`FATAL: tag ${tag} does not match what would be published:\n`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      "\nThe stores validate the manifest version, not the tag name. Publishing " +
      "now would burn a version number under a tag that describes a different one."
    );
    process.exit(1);
  }

  console.log(`Release pre-flight OK: ${tag} matches both manifests, package.json and CHANGELOG.md`);
}
