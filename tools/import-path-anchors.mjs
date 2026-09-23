#!/usr/bin/env node
/**
 * MUGA: import-path-anchors — reviewable ingestion of path-anchored upstream
 * facts into `domain-rules.json`'s `pathStrips` (#1326 slice 3, ADR-0010).
 *
 * ── Why this is NOT wired into the weekly automated pipeline ─────────────
 * `tools/rule-ingestion/` (adapters → gates → orchestrate → land-scoped →
 * promote → sign) exists to produce the SIGNED weekly remote payload
 * (`tools/rules-source/params.json`'s `scoped[]`). ADR-0010 decision 5 keeps
 * path predicates OUT of that channel — "a BUNDLED-only mechanism ... they
 * change on a release cadence, not a weekly fetch." Wiring this into that
 * cron would make the BUNDLED `domain-rules.json` mutate weekly outside
 * release review, the opposite of decision 5's intent. So this is a
 * manually-run CLI: it reports by default, and only WRITES with `--apply`,
 * for a human to review the diff and commit it as an ordinary PR.
 *
 * ── What it reuses, and why ────────────────────────────────────────────
 * `parseRemoveparamRules` (tools/import-upstream.mjs) already parses AdGuard
 * Filter 17 and now (#1326 slice 3) additionally yields the literal
 * `(param, host, pathPrefix)` facts a `||host/path...` line expresses — this
 * module does no regex parsing of its own. Every guard `land-scoped.mjs`
 * applies to a host-scoped fact applies identically here, imported from the
 * same source (`src/lib/remote-rules.js`), because a path-scoped claim is
 * NARROWER than a host-scoped one and must never be treated as SAFER.
 *
 * Corroboration: AdGuard Filter 17 is the only adapter this ingestion has
 * (see `tools/rule-ingestion/README.md`), so a path-anchored candidate always
 * carries exactly one signal — the same reality `SCOPED_MIN_SIGNALS = 1`
 * (tools/rule-ingestion/gates/corroboration-gate.mjs) already encodes for
 * host-scoped facts. There is nothing for a corroboration gate to relax here
 * beyond what is already true: one source, one signal, threshold one.
 *
 * ── Capacity ───────────────────────────────────────────────────────────
 * `generate-rules.mjs` throws if the total number of (domain, prefix) DNR
 * rules exceeds `DNR_PATH_SCOPED_MAX_RULES` (100). `selectNewGroups` counts
 * the EXISTING total first and only admits new groups up to that budget,
 * deterministically (candidates are already sorted by domain then prefix),
 * dropping any overflow into a reported list rather than raising the cap —
 * raising a deliberately-sized safety constant is a separate decision this
 * slice does not make.
 *
 * Usage:
 *   node tools/import-path-anchors.mjs           # dry run, report only
 *   node tools/import-path-anchors.mjs --apply    # write + regenerate
 */

import { fetchAdGuardFilter17, parseRemoveparamRules } from "./import-upstream.mjs";
import { emitDomainRules, withDomainRules } from "./rules-store.mjs";
import { loadStore, writeAll } from "./build-rules-store.mjs";
import { AFFILIATE_PARAM_GUARD, REMOTE_PARAM_DENYLIST, hostPreservesParam } from "../src/lib/remote-rules.js";
import { TRACKING_PARAMS } from "../src/lib/affiliates-data.js";
import { DNR_PATH_SCOPED_MAX_RULES } from "../src/lib/dnr-ids.js";

export const DEFAULT_NOTE =
  "Path-scoped param strip, ingested from AdGuard Filter 17 (#1326 slice 3).";

/**
 * Filters `parseRemoveparamRules`'s `pathAnchored[]` down to facts this
 * pipeline may actually land, applying the SAME absolute guards
 * `land-scoped.mjs` applies to host-scoped facts (never weaker for a
 * narrower, path-scoped claim), plus one path-specific check: a param
 * already in the global `TRACKING_PARAMS` list needs no path scope — the
 * global rule already strips it everywhere, on this host included.
 *
 * Deduplicates identical `(host, pathPrefix, param)` triples (upstream can
 * repeat one across several filter lines).
 *
 * @param {Array<{param: string, host: string, pathPrefix: string}>} pathAnchored
 * @param {object} [opts]
 * @param {string[]} [opts.trackingParams]
 * @param {Set<string>|string[]} [opts.affiliateGuard]
 * @param {Set<string>|string[]} [opts.denylist]
 * @param {function(string, string): boolean} [opts.hostPreservesParamFn]
 * @returns {{
 *   landable: Array<{param: string, host: string, pathPrefix: string}>,
 *   excluded: {
 *     alreadyGlobal: Array, guard: Array, denylist: Array, hostPreserve: Array,
 *   },
 * }}
 */
export function filterLandablePathAnchors(pathAnchored, opts = {}) {
  const {
    trackingParams = TRACKING_PARAMS,
    affiliateGuard = AFFILIATE_PARAM_GUARD,
    denylist = REMOTE_PARAM_DENYLIST,
    hostPreservesParamFn = hostPreservesParam,
  } = opts;

  const globalSet = new Set([...trackingParams].map((p) => p.toLowerCase()));
  const guardSet = new Set([...affiliateGuard].map((p) => p.toLowerCase()));
  const denySet = new Set([...denylist].map((p) => p.toLowerCase()));

  const landable = [];
  const excluded = { alreadyGlobal: [], guard: [], denylist: [], hostPreserve: [] };
  const seen = new Set();

  for (const fact of pathAnchored) {
    const key = `${fact.host}\0${fact.pathPrefix}\0${fact.param}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const lower = fact.param.toLowerCase();
    if (globalSet.has(lower)) { excluded.alreadyGlobal.push(fact); continue; }
    if (guardSet.has(lower)) { excluded.guard.push(fact); continue; }
    if (denySet.has(lower)) { excluded.denylist.push(fact); continue; }
    if (hostPreservesParamFn(fact.host, lower)) { excluded.hostPreserve.push(fact); continue; }
    landable.push(fact);
  }

  return { landable, excluded };
}

/**
 * Groups landable facts into one candidate `pathStrips` group per
 * `(host, pathPrefix)`, each carrying exactly one prefix — the store's own
 * `emitDomainRules` already consolidates entries that share an IDENTICAL
 * `pathPrefixes` array (see `tools/rules-store.mjs`'s `groupByScope`), so no
 * separate multi-prefix consolidation is needed here.
 *
 * Sorted deterministically by domain then prefix, and each group's params
 * sorted, so re-running against unchanged input reproduces byte-identical
 * output.
 *
 * @param {Array<{param: string, host: string, pathPrefix: string}>} landable
 * @returns {Array<{domain: string, pathPrefixes: string[], params: string[]}>}
 */
export function groupPathAnchors(landable) {
  const groups = new Map();
  for (const fact of landable) {
    const key = `${fact.host}\0${fact.pathPrefix}`;
    if (!groups.has(key)) {
      groups.set(key, { domain: fact.host, pathPrefixes: [fact.pathPrefix], params: new Set() });
    }
    groups.get(key).params.add(fact.param.toLowerCase());
  }

  const result = [...groups.values()].map((g) => ({
    domain: g.domain,
    pathPrefixes: g.pathPrefixes,
    params: [...g.params].sort(),
  }));

  result.sort(
    (a, b) => a.domain.localeCompare(b.domain) || a.pathPrefixes[0].localeCompare(b.pathPrefixes[0])
  );
  return result;
}

/**
 * Splits candidate groups into what is genuinely new, what the store already
 * carries (idempotent re-run — a no-op), and what the DNR rule cap forces to
 * defer.
 *
 * A candidate whose `(domain, prefix)` already exists merges only its NEW
 * params into that existing group — this costs no additional DNR rule, since
 * it is the same `(domain, prefix)` rule carrying a larger `removeParams`
 * set, so it is never subject to the cap.
 *
 * @param {Array<{domain: string, pathPrefixes: string[], params: string[]}>} candidateGroups
 * @param {Array<{domain: string, pathStrips?: Array<{pathPrefixes: string[], params: string[]}>}>} existingDomainRules
 * @param {object} [opts]
 * @param {number} [opts.maxTotalRules]
 * @returns {{
 *   toAdd: Array<{domain: string, pathPrefixes: string[], params: string[], mergeIntoExisting?: boolean}>,
 *   alreadyLanded: Array,
 *   overflow: Array,
 *   existingRuleCount: number,
 * }}
 */
export function selectNewGroups(candidateGroups, existingDomainRules, opts = {}) {
  const { maxTotalRules = DNR_PATH_SCOPED_MAX_RULES } = opts;

  const existingByKey = new Map();
  let existingRuleCount = 0;
  for (const rule of existingDomainRules) {
    for (const group of rule.pathStrips ?? []) {
      for (const prefix of group.pathPrefixes) {
        existingRuleCount++;
        // One (domain, prefix) may legitimately appear only once per group in
        // a well-formed store; last-write-wins here is a defensive fallback,
        // not a real ambiguity source.
        existingByKey.set(
          `${rule.domain}\0${prefix}`,
          new Set((group.params ?? []).map((p) => p.toLowerCase()))
        );
      }
    }
  }

  const toAdd = [];
  const alreadyLanded = [];
  const overflow = [];
  let budget = maxTotalRules - existingRuleCount;

  for (const group of candidateGroups) {
    const key = `${group.domain}\0${group.pathPrefixes[0]}`;
    const existingParams = existingByKey.get(key);

    if (existingParams) {
      const newParams = group.params.filter((p) => !existingParams.has(p));
      if (newParams.length === 0) {
        alreadyLanded.push(group);
      } else {
        toAdd.push({ ...group, params: newParams, mergeIntoExisting: true });
      }
      continue;
    }

    if (budget <= 0) {
      overflow.push(group);
      continue;
    }
    toAdd.push(group);
    budget--;
  }

  return { toAdd, alreadyLanded, overflow, existingRuleCount };
}

/**
 * Returns a NEW `domain-rules.json`-shaped array with every group in `toAdd`
 * merged in: a brand new domain gets a fresh entry (`preserveParams: []`, a
 * `note`, no `stripParams` key — matching how a path-only host has nothing
 * else to strip or preserve); an existing domain gets its `pathStrips`
 * extended or one of its existing groups' `params` extended.
 *
 * `existingDomainRules` is never mutated — every touched object is copied
 * first, matching `withDomainRules`'s own "pass the COMPLETE set" contract.
 *
 * @param {Array<object>} existingDomainRules
 * @param {Array<{domain: string, pathPrefixes: string[], params: string[], mergeIntoExisting?: boolean}>} toAdd
 * @param {object} [opts]
 * @param {string} [opts.note]
 * @returns {Array<object>}
 */
export function applyPathAnchorGroups(existingDomainRules, toAdd, opts = {}) {
  const { note = DEFAULT_NOTE } = opts;

  const result = existingDomainRules.map((rule) => ({
    ...rule,
    pathStrips: rule.pathStrips ? rule.pathStrips.map((g) => ({ ...g, params: [...g.params] })) : rule.pathStrips,
  }));
  const byDomain = new Map(result.map((rule) => [rule.domain, rule]));

  for (const group of toAdd) {
    let rule = byDomain.get(group.domain);
    if (!rule) {
      rule = { domain: group.domain, preserveParams: [], pathStrips: [], note };
      result.push(rule);
      byDomain.set(group.domain, rule);
    }
    if (!rule.pathStrips) rule.pathStrips = [];

    if (group.mergeIntoExisting) {
      const target = rule.pathStrips.find(
        (g) => JSON.stringify(g.pathPrefixes) === JSON.stringify(group.pathPrefixes)
      );
      target.params = [...new Set([...target.params, ...group.params])].sort();
    } else {
      rule.pathStrips.push({ pathPrefixes: group.pathPrefixes, params: group.params });
    }
  }

  return result;
}

/**
 * The pure end-to-end core: raw `pathAnchored[]` + the current
 * `domain-rules.json`-shaped array in → a full report + the next
 * domain-rules array out. No I/O — the CLI below is the only place that
 * touches the network, the store, or the filesystem.
 *
 * @param {Array<{param: string, host: string, pathPrefix: string}>} pathAnchored
 * @param {Array<object>} existingDomainRules
 * @param {object} [opts] Forwarded to `filterLandablePathAnchors`,
 *   `selectNewGroups`, and `applyPathAnchorGroups`.
 * @returns {{
 *   excluded: object,
 *   candidateGroups: Array,
 *   toAdd: Array,
 *   alreadyLanded: Array,
 *   overflow: Array,
 *   existingRuleCount: number,
 *   nextDomainRules: Array<object>,
 * }}
 */
export function computeLanding(pathAnchored, existingDomainRules, opts = {}) {
  const { landable, excluded } = filterLandablePathAnchors(pathAnchored, opts);
  const candidateGroups = groupPathAnchors(landable);
  const { toAdd, alreadyLanded, overflow, existingRuleCount } = selectNewGroups(
    candidateGroups,
    existingDomainRules,
    opts
  );
  const nextDomainRules = applyPathAnchorGroups(existingDomainRules, toAdd, opts);

  return { excluded, candidateGroups, toAdd, alreadyLanded, overflow, existingRuleCount, nextDomainRules };
}

// ── CLI ──────────────────────────────────────────────────────────────

async function main() {
  const apply = process.argv.includes("--apply");

  const text = await fetchAdGuardFilter17();
  const { pathAnchored } = parseRemoveparamRules(text);

  const store = loadStore();
  const existingDomainRules = JSON.parse(emitDomainRules(store));

  const result = computeLanding(pathAnchored, existingDomainRules);

  console.log(`[import-path-anchors] ${pathAnchored.length} raw path-anchored fact(s) parsed`);
  console.log(
    `[import-path-anchors] excluded — alreadyGlobal: ${result.excluded.alreadyGlobal.length}, ` +
      `AFFILIATE_PARAM_GUARD: ${result.excluded.guard.length}, ` +
      `REMOTE_PARAM_DENYLIST: ${result.excluded.denylist.length}, ` +
      `host preserves it: ${result.excluded.hostPreserve.length}`
  );
  console.log(`[import-path-anchors] ${result.candidateGroups.length} candidate (host, pathPrefix) group(s)`);
  console.log(`[import-path-anchors] ${result.alreadyLanded.length} already landed (no-op)`);
  console.log(
    `[import-path-anchors] ${result.toAdd.length} new group(s) to land ` +
      `(existing DNR path-scoped rule count: ${result.existingRuleCount}/${DNR_PATH_SCOPED_MAX_RULES})`
  );
  if (result.overflow.length > 0) {
    console.log(
      `[import-path-anchors] ${result.overflow.length} group(s) DROPPED — ` +
        `DNR_PATH_SCOPED_MAX_RULES (${DNR_PATH_SCOPED_MAX_RULES}) reached: ` +
        result.overflow.map((g) => `${g.domain}${g.pathPrefixes[0]}`).join(", ")
    );
  }

  if (!apply) {
    console.log("[import-path-anchors] dry run — pass --apply to write. Nothing written.");
    return;
  }

  if (result.toAdd.length === 0) {
    console.log("[import-path-anchors] nothing new to land — store unchanged.");
    return;
  }

  const nextStore = withDomainRules(store, result.nextDomainRules);
  writeAll(nextStore);
  console.log(`[import-path-anchors] landed ${result.toAdd.length} new group(s).`);
}

if (process.argv[1]?.endsWith("import-path-anchors.mjs")) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
