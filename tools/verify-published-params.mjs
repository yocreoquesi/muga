#!/usr/bin/env node
/**
 * MUGA — does rules.muga.app serve the payload this repository published? (#1267)
 *
 * `publish-rules.yml`'s smoke check used to be `curl --head`. That asks whether
 * the URL answers, and nothing else: a publish that landed a broken or stale
 * payload passed its own smoke check by construction, because a 200 on the
 * wrong bytes looks exactly like a 200 on the right ones.
 *
 * The workflow's targeting was never the problem, contrary to how #1267 first
 * read it. A run that publishes opens a PR and cannot verify an endpoint that
 * `--auto` will update minutes later; that PR's merge re-enters the workflow,
 * finds nothing to publish, and THAT pass is the one that checks the live URL.
 * The comment in the workflow has said so all along. What was missing is depth,
 * not aim.
 *
 * This is also the check that should have caught #1251, where the workflow had
 * been failing to publish for months while reporting green.
 *
 * Exit codes: 0 verified, 1 mismatch, 2 usage/parse error.
 */

import { readFileSync } from "node:fs";

/**
 * Compares a live payload against the committed one.
 *
 * `sig` is the strongest single field: it is the Ed25519 signature over the
 * payload, so an equal sig means the endpoint is serving the exact bytes this
 * repository signed. Comparing `version` as well costs nothing and is the
 * field a human reads first during an incident.
 *
 * The non-empty `params` check is not redundant with the signature. A payload
 * can be correctly signed and still be useless, and "the endpoint serves a
 * valid empty list" is precisely the shape a broken generator produces.
 *
 * @param {object} live payload fetched from the endpoint
 * @param {object} committed payload from docs/rules/v1/params.json
 * @returns {string[]} problems, empty when the live payload is the committed one
 */
export function comparePayloads(live, committed) {
  const problems = [];

  if (!live || typeof live !== "object") return ["live payload is not an object"];
  if (!committed || typeof committed !== "object") {
    return ["committed payload is not an object"];
  }

  if (live.version !== committed.version) {
    problems.push(
      `version: live is ${JSON.stringify(live.version)}, committed is ${JSON.stringify(committed.version)}`
    );
  }
  if (live.sig !== committed.sig) {
    problems.push(
      "sig: the live payload is not the bytes this repository signed"
    );
  }
  if (!Array.isArray(live.params) || live.params.length === 0) {
    problems.push("params: the live payload carries no parameters");
  }

  return problems;
}

/**
 * Reads and parses a JSON file, exiting 2 on failure.
 *
 * Exit 2 rather than 1 so an unreadable file is distinguishable from a real
 * mismatch: one is a broken check, the other is a broken publish, and an
 * on-call reader should not have to guess which.
 *
 * @param {string} path
 * @param {string} label
 * @returns {object}
 */
function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`[verify-published-params] cannot read the ${label} payload at ${path}: ${err.message}`);
    process.exit(2);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === "--live") args.live = argv[i + 1];
    else if (argv[i] === "--committed") args.committed = argv[i + 1];
  }
  return args;
}

function main() {
  const { live, committed } = parseArgs(process.argv.slice(2));
  if (!live || !committed) {
    console.error("usage: verify-published-params.mjs --live <path> --committed <path>");
    process.exit(2);
  }

  const liveJson = readJson(live, "live");
  const committedJson = readJson(committed, "committed");
  const problems = comparePayloads(liveJson, committedJson);

  if (problems.length > 0) {
    console.error(
      "rules.muga.app is not serving the committed payload:\n  " + problems.join("\n  ")
    );
    process.exit(1);
  }

  console.log(
    `rules.muga.app serves version ${liveJson.version} with ${liveJson.params.length} params; ` +
      "the signature matches the committed artifact."
  );
}

// Only run when invoked directly, so the comparison can be unit-tested.
if (process.argv[1] && process.argv[1].endsWith("verify-published-params.mjs")) {
  main();
}
