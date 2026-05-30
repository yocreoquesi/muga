import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GENERIC_SHORTENERS } from "../../src/lib/native-shortener-resolver.js";

// ADR-0004 phase 2 (#699): the eight shortener host permissions in both
// manifests must stay in lockstep with the resolver's GENERIC_SHORTENERS
// allowlist. Deriving the expected origins from that single source of truth
// makes this test fail closed if the manifest and the allowlist ever drift.

const ROOT = new URL("../../", import.meta.url);
const mv3 = JSON.parse(readFileSync(new URL("src/manifest.json", ROOT), "utf8"));
const mv2 = JSON.parse(readFileSync(new URL("src/manifest.v2.json", ROOT), "utf8"));

const expectedOrigins = GENERIC_SHORTENERS.map((host) => `https://${host}/*`);

describe("ADR-0004 phase 2: shortener optional permissions", () => {
  test("MV3 optional_host_permissions includes all shortener origins", () => {
    for (const origin of expectedOrigins) {
      assert.ok(
        mv3.optional_host_permissions.includes(origin),
        `MV3 manifest is missing optional host permission ${origin}`,
      );
    }
  });

  test("MV2 optional_permissions includes all shortener origins", () => {
    for (const origin of expectedOrigins) {
      assert.ok(
        mv2.optional_permissions.includes(origin),
        `MV2 manifest is missing optional permission ${origin}`,
      );
    }
  });
});
