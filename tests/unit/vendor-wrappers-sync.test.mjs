/**
 * MUGA: src/vendor/caps-spec/wrappers.json sync invariants (issue #538).
 *
 * The wrapper recipe table is sourced from the caps-spec normative artifact,
 * vendored under src/vendor/caps-spec/. These tests pin three invariants:
 *
 *   1. The vendored wrappers.json signature is valid Ed25519 against the
 *      pinned worker-pubkey.txt — proves the snapshot is authentic.
 *   2. wrappers.data.js (auto-generated, ESM-friendly) matches wrappers.json
 *      verbatim — proves no drift between the auditable source-of-truth and
 *      the module wrapper-engine.js actually imports.
 *   3. The engine's WRAPPERS table covers every spec entry id (modulo the
 *      documented skimlinks consolidation) and the spec→engine mapping is
 *      complete — catches any future spec entry that adds a new extractor
 *      kind not yet wired in the mapper.
 *
 * If any of these fail, the typical fix is:
 *
 *     npm run sync:wrappers
 *     git add src/vendor/caps-spec/
 *     npm run build:content
 *     git add src/content/cleaner-bundle.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { webcrypto as crypto } from "node:crypto";

import { WRAPPERS } from "../../src/lib/wrapper-engine.js";
import { WRAPPERS_RAW } from "../../src/vendor/caps-spec/wrappers.data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDOR = join(__dirname, "..", "..", "src", "vendor", "caps-spec");

test("vendored wrappers.json Ed25519 signature verifies against pinned worker-pubkey", async () => {
  const body = readFileSync(join(VENDOR, "wrappers.json"));
  const sigB64 = readFileSync(join(VENDOR, "wrappers.json.sig"), "utf8").trim();
  const pubkeyB64 = readFileSync(join(VENDOR, "worker-pubkey.txt"), "utf8").trim();

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
    "src/vendor/caps-spec/wrappers.json signature does not match worker-pubkey.txt — run `npm run sync:wrappers`",
  );
});

test("wrappers.data.js mirrors wrappers.json verbatim", () => {
  const json = JSON.parse(
    readFileSync(join(VENDOR, "wrappers.json"), "utf8"),
  );
  assert.deepEqual(
    WRAPPERS_RAW,
    json,
    "src/vendor/caps-spec/wrappers.data.js drifted from wrappers.json — run `npm run sync:wrappers`",
  );
});

test("engine WRAPPERS covers every spec id (skimlinks split consolidated)", () => {
  const engineIds = new Set(WRAPPERS.map((w) => w.id));
  const SKIMLINKS_SPEC_IDS = new Set([
    "skimlinks-redirectingat",
    "skimlinks-skimresources",
  ]);
  for (const entry of WRAPPERS_RAW) {
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
