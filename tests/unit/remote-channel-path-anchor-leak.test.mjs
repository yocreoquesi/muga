/**
 * MUGA — #1326 channel path-anchor leak: 31 params removed from the REMOTE
 * channel's global list.
 *
 * Context: #1322/#1323/#1324/#1341 removed 41 params from the BUNDLED global
 * strip list (`src/lib/affiliates.js` TRACKING_PARAMS) because their only
 * upstream evidence anchors them to a host or a path, never the whole web.
 * The REMOTE channel (`tools/rules-source/params.json`, signed into
 * `docs/rules/v1/params.json`) is a SEPARATE global list that pipeline never
 * touched, so any installed build that had already fetched the signed
 * payload kept stripping those names on every site regardless of what the
 * bundled artifact said.
 *
 * This measurement widened the same class: of the payload's 189 global
 * params, 31 have upstream evidence that is ONLY a path anchor (e.g. a
 * removeparam rule anchored to google's search path for `ved`) — never a
 * whole host. Per
 * docs/adr/0010-path-scoped-param-rules.md decision 5, a path predicate has
 * NO smaller landing spot in this channel than global: `scoped[]` can only
 * name whole hosts, and path predicates are deliberately a BUNDLED-only
 * mechanism. So publishing one of these 31 globally is not a fallback, it
 * is an over-claim with no smaller option — the #1212/#1217 failure class,
 * live in the signed payload.
 *
 * Pins two things:
 *   (1) none of the 31 are in tools/rules-source/params.json's global list —
 *       so a future hand-edit or promote run that reintroduces one is
 *       caught immediately, with the reason spelled out.
 *   (2) tools/import-upstream.mjs's parseRemoveparamRules — the parser that
 *       feeds the automated ingestion pipeline — no longer lets a
 *       path-anchored line for any of these 31 names reach the global
 *       candidate pool, so a future scheduled ingest run cannot quietly
 *       re-admit one through the exact pipeline that created this leak.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseRemoveparamRules } from "../../tools/import-upstream.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const PARAMS_SOURCE_PATH = join(ROOT, "tools", "rules-source", "params.json");

/**
 * The 31 params #1326's channel-leak measurement found published in the
 * remote channel's global list whose ONLY upstream evidence is a path
 * anchor. Each entry names why it left: either the specific path anchor
 * measured, or (for the shorter, more collision-prone names) the collision
 * risk of stripping that name on every site on the strength of one path.
 */
const PATH_ANCHOR_ONLY_PARAMS = {
  __tn__: "path/query-anchored upstream only (facebook.com); no whole-host evidence",
  _trkparms: "path/query-anchored upstream only (ebay.*); no whole-host evidence",
  _trksid: "path/query-anchored upstream only (ebay.*); no whole-host evidence",
  aqs: "path-anchored upstream only (google.*/search, google.*/webhp); no whole-host evidence",
  camp: "path-anchored upstream only; collision-prone short name (#1212/#1217 class)",
  clickorigin: "path-anchored upstream only; no whole-host evidence",
  cmp: "path-anchored upstream only (indeed.com); collision-prone short name",
  dchild: "path-anchored upstream only (amazon.*); already host-anchored on amazon.* in the bundled ruleset",
  dib: "path-anchored upstream only (amazon.*); already host-anchored on amazon.* in the bundled ruleset",
  dib_tag: "path-anchored upstream only (amazon.*); already host-anchored on amazon.* in the bundled ruleset",
  fbs: "path-anchored upstream only (google.*/search, google.*/webhp); no whole-host evidence",
  "field-lbr_brands_browse-bin": "path-anchored upstream only (amazon.*); no whole-host evidence",
  ga_account: "path-anchored upstream only; no whole-host evidence",
  gemius_identifier: "path-anchored upstream only; no whole-host evidence",
  gs_l: "path-anchored upstream only (google.*/search); no whole-host evidence",
  iflsig: "path-anchored upstream only (google.*/search, google.*/webhp); no whole-host evidence",
  mclid: "path-anchored upstream only; no whole-host evidence",
  offerlistid: "path-anchored upstream only; no whole-host evidence",
  position: "path-anchored upstream only; collision-prone short name (#1212/#1217 class)",
  qid: "path-anchored upstream only (amazon.*); already host-anchored on amazon.* in the bundled ruleset",
  rdc: "path-anchored upstream only (facebook.com); no whole-host evidence",
  refrid: "path-anchored upstream only (amazon.*); no whole-host evidence",
  "scm-url": "path-anchored upstream only; no whole-host evidence",
  sourcetype: "path-anchored upstream only (coupang.com); no whole-host evidence",
  sprefix: "path-anchored upstream only; already host-anchored on amazon.* (and others) in the bundled ruleset",
  terminal_id: "path-anchored upstream only (aliexpress.com); no whole-host evidence",
  tracking: "path-anchored upstream only (facebook.com); collision-prone short name",
  uniqueid: "path-anchored upstream only; collision-prone name",
  ved: "path-anchored upstream only (google.*/search, google.*/webhp); already path-scoped to google.com/search+webhp in the bundled ruleset (#1326 slices 1+2)",
  visit_id: "path-anchored upstream only (bilibili.com); collision-prone name",
  wt_cd: "path-anchored upstream only; no whole-host evidence",
};

describe("#1326 — path-anchor-only params removed from the remote channel's global list", () => {
  test("the fixture itself names exactly 31 params", () => {
    assert.equal(Object.keys(PATH_ANCHOR_ONLY_PARAMS).length, 31);
  });

  const source = JSON.parse(readFileSync(PARAMS_SOURCE_PATH, "utf8"));
  const sourceParams = new Set(source.params.map((p) => p.toLowerCase()));

  for (const [param, reason] of Object.entries(PATH_ANCHOR_ONLY_PARAMS)) {
    test(`"${param}" is absent from tools/rules-source/params.json's global list`, () => {
      assert.ok(
        !sourceParams.has(param.toLowerCase()),
        `"${param}" is back in the remote channel's global params. It was removed because: ` +
          `${reason}. A path anchor cannot land at a scope smaller than global in this channel ` +
          "(ADR-0010 decision 5 keeps path predicates bundled-only), so re-adding it here is an " +
          "over-claim, not a fallback — either the upstream evidence changed (revert this pin " +
          "with a fresh measurement) or it must come back out. #1326.",
      );
    });
  }
});

describe("#1326 — a future ingest re-adding one of the 31 fails loudly (parser-side)", () => {
  // One synthetic ||host/path-anchored line per param, so a regression that
  // quietly re-merges the path-anchor case into "global" (undoing the
  // tools/import-upstream.mjs fix) breaks every assertion here at once,
  // naming exactly which params leaked back in and why they must not.
  const fixtureText = Object.keys(PATH_ANCHOR_ONLY_PARAMS)
    .map((param) => `||example.com/anchor$removeparam=${param}`)
    .join("\n");

  const { params, scoped, pathAnchorSkipped } = parseRemoveparamRules(fixtureText);

  test("none of the 31 reach the global candidate pool from a realistic path-anchored line", () => {
    const leaked = Object.keys(PATH_ANCHOR_ONLY_PARAMS).filter((p) => params.has(p));
    assert.deepEqual(
      leaked,
      [],
      `these path-anchor-only params reached parseRemoveparamRules' global \`params\` set: ` +
        `${leaked.join(", ")}. Each was removed from the remote channel by #1326 precisely ` +
        "because a path anchor has no smaller landing spot than global here — if the parser " +
        "lets them back into the candidate pool, the next scheduled ingest run republishes them.",
    );
  });

  test("none of the 31 reach `scoped[]` either — a path anchor has nowhere smaller to land", () => {
    assert.deepEqual(
      scoped,
      [],
      "a path-anchored line must not produce a scoped (param, host) fact — that would over-claim " +
        "a whole host on evidence that only supports one path (ADR-0010 decision 5).",
    );
  });

  test("every one of the 31 synthetic lines is counted in pathAnchorSkipped", () => {
    assert.equal(pathAnchorSkipped, Object.keys(PATH_ANCHOR_ONLY_PARAMS).length);
  });
});
