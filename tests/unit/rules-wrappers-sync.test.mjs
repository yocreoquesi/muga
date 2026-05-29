/**
 * MUGA: rule artifact integrity invariants for src/rules/wrappers.json (issue #538, #715).
 *
 * These tests pin four invariants over muga's internal rule artifacts
 * under src/rules/:
 *
 *   1. wrappers.json signature is valid Ed25519 against the pinned
 *      worker-pubkey.txt — proves the artifact is authentic.
 *   2. wrappers.data.js (ESM-friendly module) matches wrappers.json
 *      verbatim — proves no drift between the auditable source-of-truth and
 *      the module wrapper-engine.js actually imports.
 *   3. The engine's WRAPPERS table covers every spec entry id (modulo the
 *      documented skimlinks consolidation) and the spec→engine mapping is
 *      complete — catches any future spec entry that adds a new extractor
 *      kind not yet wired in the mapper.
 *   4. Every extractor kind in the rule set is recognized by the mapper.
 *
 * If any of these fail, regenerate via the rules pipeline.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { webcrypto as crypto } from "node:crypto";

import { WRAPPERS } from "../../src/lib/wrapper-engine.js";
import { WRAPPERS_RAW } from "../../src/rules/wrappers.data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES = join(__dirname, "..", "..", "src", "rules");

test("wrappers.json Ed25519 signature verifies against pinned worker-pubkey", async () => {
  const body = readFileSync(join(RULES, "wrappers.json"));
  const sigB64 = readFileSync(join(RULES, "wrappers.json.sig"), "utf8").trim();
  const pubkeyB64 = readFileSync(join(RULES, "worker-pubkey.txt"), "utf8").trim();

  const pubkey = await crypto.subtle.importKey(
    "raw",
    Buffer.from(pubkeyB64, "base64"),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "Ed25519",
    pubkey,
    Buffer.from(sigB64, "base64"),
    body,
  );
  assert.equal(
    ok,
    true,
    "src/rules/wrappers.json signature does not match worker-pubkey.txt — regenerate via the rules pipeline",
  );
});

test("wrappers.data.js mirrors wrappers.json verbatim", () => {
  const json = JSON.parse(
    readFileSync(join(RULES, "wrappers.json"), "utf8"),
  );
  assert.deepEqual(
    WRAPPERS_RAW,
    json,
    "src/rules/wrappers.data.js drifted from wrappers.json — regenerate via the rules pipeline",
  );
});

test("engine WRAPPERS covers every spec id (skimlinks consolidated; MUGA-excluded ids skipped)", () => {
  const engineIds = new Set(WRAPPERS.map((w) => w.id));
  const SKIMLINKS_SPEC_IDS = new Set([
    "skimlinks-redirectingat",
    "skimlinks-skimresources",
  ]);
  // MUGA-policy exclusions kept in sync with MUGA_EXCLUDED_IDS in wrapper-engine.js.
  // See docs/adr/0003-awin-redirect-model-resolution.md (#684 for awin; #692 for the rest).
  const MUGA_EXCLUDED_IDS = new Set(["awin", "impact", "rakuten", "tradetracker"]);
  for (const entry of WRAPPERS_RAW) {
    if (MUGA_EXCLUDED_IDS.has(entry.id)) {
      assert.equal(
        engineIds.has(entry.id),
        false,
        `engine WRAPPERS unexpectedly includes excluded id "${entry.id}" — MUGA_EXCLUDED_IDS filter is bypassed`,
      );
      continue;
    }
    if (SKIMLINKS_SPEC_IDS.has(entry.id)) {
      assert.ok(
        engineIds.has("skimlinks"),
        "skimlinks consolidation: engine must expose `skimlinks` when spec ships skimlinks-redirectingat / skimlinks-skimresources",
      );
      continue;
    }
    assert.ok(
      engineIds.has(entry.id),
      `engine WRAPPERS missing id "${entry.id}" — mapper or vendor sync is stale`,
    );
  }
});

test("every spec extractor kind is recognized by the mapper (no silent skips)", () => {
  const KNOWN = new Set(["fromParam", "fromAnyParam", "fromUrlAfterQuery"]);
  for (const entry of WRAPPERS_RAW) {
    assert.ok(
      KNOWN.has(entry.extractor.kind),
      `unknown extractor kind "${entry.extractor.kind}" for id "${entry.id}" — mapper must be extended in src/lib/wrapper-engine.js`,
    );
  }
});
