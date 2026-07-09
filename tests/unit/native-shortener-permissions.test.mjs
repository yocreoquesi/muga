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

// audit #1035: an explicit, restrictive `connect-src` blocks fetch to any host
// it does not list — independent of host_permissions. The native shortener
// resolver (service-worker.js -> resolveShortener) fetch()es each allowlisted
// shortener host, so every shortener origin MUST also appear in connect-src or
// the whole ADR-0004 native-resolution path fails closed on both browsers.
// Derived from GENERIC_SHORTENERS (single source of truth) so the manifest CSP
// fails this test closed the moment it drifts from the resolver allowlist.
function connectSrcSources(policyString) {
  const directive = policyString
    .split(";")
    .map((s) => s.trim())
    .find((d) => d === "connect-src" || d.startsWith("connect-src "));
  return directive ? directive.split(/\s+/).slice(1) : [];
}

describe("audit #1035: connect-src covers every shortener the resolver fetches", () => {
  // The resolver's gate (isGenericShortener -> matches() in opaque-networks.js)
  // strips a leading `www.` before comparing, so `www.bit.ly` is ALSO treated as
  // an allowlisted shortener and fetched. A CSP host-source matches the exact
  // host only (no implicit www), so connect-src must carry BOTH the apex and the
  // www. variant for each shortener or www-prefixed links fail closed.
  const expectedConnect = GENERIC_SHORTENERS.flatMap((host) => [
    `https://${host}`,
    `https://www.${host}`,
  ]);

  test("MV3 extension_pages connect-src includes every shortener origin", () => {
    const sources = connectSrcSources(mv3.content_security_policy.extension_pages);
    for (const origin of expectedConnect) {
      assert.ok(
        sources.includes(origin),
        `MV3 connect-src is missing ${origin} — resolveShortener fetch to it would be CSP-blocked`,
      );
    }
  });

  test("MV2 connect-src includes every shortener origin", () => {
    const sources = connectSrcSources(mv2.content_security_policy);
    for (const origin of expectedConnect) {
      assert.ok(
        sources.includes(origin),
        `MV2 connect-src is missing ${origin} — resolveShortener fetch to it would be CSP-blocked`,
      );
    }
  });
});
