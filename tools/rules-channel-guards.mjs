#!/usr/bin/env node
/**
 * MUGA — producer-side guards for the signed remote-rules channel.
 *
 * Two failure modes that publish green and are only visible to users:
 *
 *   --max-age <params.json>  (#1416)
 *     Installed builds reject a payload whose `published` is older than
 *     STALE_DAYS (180, src/lib/remote-rules.js). Quiet weeks deliberately
 *     publish nothing (the #1344 churn guard), so the live date simply ages
 *     and, after 180 days, every fresh install, re-enable and offline user
 *     gets no remote rules. This fails at DEFAULT_MAX_AGE_DAYS instead, which
 *     leaves several weekly runs to publish a bumped version.
 *
 *   --bump <source params.json> <published params.json>  (#1421)
 *     A change to the signed content at an unchanged `version` is never
 *     delivered to a build that already holds that version. The old guard
 *     compared `params[]` only; the `scoped[]` section, now most of the
 *     payload, could change (or a wrong fact be withdrawn) without a bump.
 *
 * Exit codes: 0 ok, 1 guard failed, 2 usage or unreadable input.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { STALE_DAYS, CLOCK_SKEW_TOLERANCE_MS } from "../src/lib/remote-rules.js";

/** Fail this many days after `published`, 30 days before the runtime does. */
export const DEFAULT_MAX_AGE_DAYS = 150;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{published?: string}} payload
 * @param {number} nowMs
 * @param {number} [maxAgeDays]
 * @returns {string[]} problems, empty when the payload is fresh enough
 */
export function publishedAgeProblems(payload, nowMs, maxAgeDays = DEFAULT_MAX_AGE_DAYS) {
  const published = payload?.published;
  const publishedMs = typeof published === "string" ? Date.parse(published) : NaN;
  if (Number.isNaN(publishedMs)) {
    return [`published is missing or not a date: ${JSON.stringify(published)}`];
  }
  if (publishedMs - nowMs > CLOCK_SKEW_TOLERANCE_MS) {
    return [`published ${published} is in the future; the runtime rejects it as STALE_PAYLOAD`];
  }
  const ageDays = Math.floor((nowMs - publishedMs) / DAY_MS);
  if (ageDays > maxAgeDays) {
    return [
      `published ${published} is ${ageDays} days old (guard: ${maxAgeDays}, installed builds ` +
        `reject after ${STALE_DAYS}). Bump "version" and refresh "published" in ` +
        "tools/rules-source/params.json so the channel is re-signed before it expires.",
    ];
  }
  return [];
}

/**
 * Fields of the signed content that differ while `version` did not move.
 * `scoped` absent and `scoped: []` are the same content (I1's
 * absent-when-empty convention).
 *
 * @param {{version: number, published: string, params: string[], scoped?: unknown[]}} source
 * @param {{version: number, published: string, params: string[], scoped?: unknown[]}} live the signed artifact currently published
 * @returns {string[]} names of the changed fields; ["version"] when the source goes backwards; empty when bumped or unchanged
 */
export function unbumpedContentChanges(source, live) {
  // A LOWER source version would publish a payload every installed build
  // rejects as VERSION_REGRESSION, silently keeping the old rules.
  if (source.version < live.version) return ["version"];
  if (source.version !== live.version) return [];
  const changed = [];
  if (JSON.stringify(source.params) !== JSON.stringify(live.params)) changed.push("params");
  if (JSON.stringify(source.scoped ?? []) !== JSON.stringify(live.scoped ?? [])) {
    changed.push("scoped");
  }
  if (source.published !== live.published) changed.push("published");
  return changed;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`[rules-channel-guards] cannot read ${path}: ${err.message}`);
    process.exit(2);
  }
}

function main(argv) {
  const [mode, a, b] = argv;
  if (mode === "--max-age" && a) {
    const problems = publishedAgeProblems(readJson(a), Date.now());
    if (problems.length > 0) {
      console.error(`[rules-channel-guards] ${a}: ${problems.join("; ")}`);
      process.exit(1);
    }
    console.log(`[rules-channel-guards] ${a}: published date is inside the ${DEFAULT_MAX_AGE_DAYS}-day guard`);
    return;
  }
  if (mode === "--bump" && a && b) {
    const source = readJson(a);
    const live = readJson(b);
    const changed = unbumpedContentChanges(source, live);
    if (changed.includes("version")) {
      console.error(
        `[rules-channel-guards] ${a} has version ${source.version}, below the published ${live.version}. ` +
          "Installed builds reject a lower version as VERSION_REGRESSION: raise it above the published one."
      );
      process.exit(1);
    }
    if (changed.length > 0) {
      console.error(
        `[rules-channel-guards] ${a} changes ${changed.join(", ")} at the published version ` +
          `${source.version}. Builds that already hold that version never receive it: bump "version".`
      );
      process.exit(1);
    }
    console.log(`[rules-channel-guards] ${a}: no unbumped content change against ${b}`);
    return;
  }
  console.error(
    "usage: rules-channel-guards.mjs --max-age <params.json>\n" +
      "       rules-channel-guards.mjs --bump <source params.json> <published params.json>"
  );
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
