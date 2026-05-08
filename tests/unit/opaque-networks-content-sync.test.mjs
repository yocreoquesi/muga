/**
 * MUGA: Opaque-networks ↔ content-script sync invariant (#453, B20 Group B)
 *
 * Why this file exists:
 *   src/content/cleaner.js is an IIFE (content script) that cannot import ES
 *   modules, so it carries an inline copy of the OPAQUE_NETWORKS array from
 *   src/lib/opaque-networks.js under the name _OPAQUE_NETWORK_HOSTS. Any drift
 *   between the two would silently break the Privacy Proxy CTA trigger for
 *   newly-added networks. This test asserts the two arrays are identical.
 *
 * Pattern mirrors cleaner-bundle-sync.test.mjs and url-regex-sync.test.mjs.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { OPAQUE_NETWORKS } from "../../src/lib/opaque-networks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLEANER_PATH = join(__dirname, "..", "..", "src", "content", "cleaner.js");
const CLEANER_SOURCE = readFileSync(CLEANER_PATH, "utf8");

/**
 * Extracts the _OPAQUE_NETWORK_HOSTS array literal from cleaner.js.
 *
 * The declaration looks like:
 *   const _OPAQUE_NETWORK_HOSTS = Object.freeze([
 *     "host.one",
 *     "host.two",
 *   ]);
 *
 * We capture everything between the first "[" after the declaration and the
 * matching "])" that closes Object.freeze, then parse each quoted string.
 *
 * @returns {string[]}
 */
function extractOpaqueNetworkHosts(source) {
  const declarationMatch = source.match(
    /const\s+_OPAQUE_NETWORK_HOSTS\s*=\s*Object\.freeze\(\s*\[([^\]]*)\]/s
  );
  if (!declarationMatch) {
    throw new Error(
      "Could not locate _OPAQUE_NETWORK_HOSTS = Object.freeze([...]) in src/content/cleaner.js"
    );
  }
  const arrayBody = declarationMatch[1];
  // Extract every double-quoted string inside the array body.
  const entries = [];
  const entryRe = /"([^"]+)"/g;
  let m;
  while ((m = entryRe.exec(arrayBody)) !== null) {
    entries.push(m[1]);
  }
  return entries;
}

describe("Opaque-networks sync — opaque-networks.js vs content/cleaner.js", () => {
  test("_OPAQUE_NETWORK_HOSTS is defined in cleaner.js", () => {
    assert.ok(
      CLEANER_SOURCE.includes("_OPAQUE_NETWORK_HOSTS"),
      "cleaner.js must define _OPAQUE_NETWORK_HOSTS"
    );
  });

  test("_OPAQUE_NETWORK_HOSTS array is parseable", () => {
    const hosts = extractOpaqueNetworkHosts(CLEANER_SOURCE);
    assert.ok(
      hosts.length > 0,
      "_OPAQUE_NETWORK_HOSTS must contain at least one entry"
    );
  });

  test("_OPAQUE_NETWORK_HOSTS matches OPAQUE_NETWORKS — same length", () => {
    const hosts = extractOpaqueNetworkHosts(CLEANER_SOURCE);
    assert.strictEqual(
      hosts.length,
      OPAQUE_NETWORKS.length,
      `Drift detected: src/content/cleaner.js _OPAQUE_NETWORK_HOSTS has ${hosts.length} entries, ` +
      `but src/lib/opaque-networks.js OPAQUE_NETWORKS has ${OPAQUE_NETWORKS.length}. ` +
      "Update the cleaner.js replica to match."
    );
  });

  test("_OPAQUE_NETWORK_HOSTS matches OPAQUE_NETWORKS — same elements, same order", () => {
    const hosts = extractOpaqueNetworkHosts(CLEANER_SOURCE);
    for (let i = 0; i < OPAQUE_NETWORKS.length; i++) {
      assert.strictEqual(
        hosts[i],
        OPAQUE_NETWORKS[i],
        `Drift detected: src/content/cleaner.js _OPAQUE_NETWORK_HOSTS does not match ` +
        `src/lib/opaque-networks.js OPAQUE_NETWORKS. ` +
        `Index ${i}: cleaner.js has "${hosts[i]}", opaque-networks.js has "${OPAQUE_NETWORKS[i]}". ` +
        "Update the cleaner.js replica to match."
      );
    }
  });
});
