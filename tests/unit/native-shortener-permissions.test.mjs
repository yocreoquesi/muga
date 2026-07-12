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

// audit #1035 (updated): an explicit `connect-src` blocks fetch to any host it
// does not list — independent of host_permissions. The native shortener resolver
// (service-worker.js -> resolveShortener) now uses redirect:"follow" and reads
// response.url, so the browser follows the chain to an ARBITRARY destination host
// (wherever the short link points). Those destinations cannot be enumerated, so
// connect-src must permit them via a broad scheme-source (`https:` / `http:`),
// which also covers every shortener origin. This asserts the broad sources stay
// present so the whole resolution path (shortener + destination) is not CSP-blocked.
function connectSrcSources(policyString) {
  const directive = policyString
    .split(";")
    .map((s) => s.trim())
    .find((d) => d === "connect-src" || d.startsWith("connect-src "));
  return directive ? directive.split(/\s+/).slice(1) : [];
}

describe("audit #1035: connect-src permits shortener hosts AND their arbitrary destinations", () => {
  for (const [label, policy] of [
    ["MV3", () => mv3.content_security_policy.extension_pages],
    ["MV2", () => mv2.content_security_policy],
  ]) {
    test(`${label} connect-src allows any https/http host (covers shorteners + follow-redirect destinations)`, () => {
      const sources = connectSrcSources(policy());
      assert.ok(sources.includes("https:"), `${label} connect-src must include the https: scheme-source`);
      assert.ok(sources.includes("http:"), `${label} connect-src must include the http: scheme-source (redirect chains may pass through http)`);
      // Sanity: a representative shortener origin is therefore permitted.
      assert.ok(
        GENERIC_SHORTENERS.length === 0 || sources.includes("https:"),
        "every https shortener origin is covered by the https: scheme-source",
      );
    });
  }
});
