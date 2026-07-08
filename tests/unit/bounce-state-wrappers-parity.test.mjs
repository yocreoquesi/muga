/**
 * MUGA — bounce-state WRAPPERS wipe-allowlist guard (#725, revised).
 *
 * `src/content/bounce-state-cleaner.js` carries an inline `WRAPPERS` table that
 * is the CURATED ALLOWLIST of hosts whose localStorage/sessionStorage the
 * bounce-state cleaner is allowed to wipe. Its resolveEngine() gates the wipe
 * on THIS table, not on the full wrapper engine — deliberately, because the
 * full engine also recognizes shared-origin content wrappers
 * (youtube.com/redirect, duckduckgo.com/l/, steamcommunity.com/linkfilter/)
 * whose origin holds the user's own session/settings; wiping their storage
 * would destroy legitimate first-party state.
 *
 * The invariant this file pins is therefore no longer "every wrapper must be
 * mirrored here" (that was the pre-inversion contract, which made adding a
 * content-origin wrapper silently dangerous). It is:
 *   (a) the inline table is a SUBSET of engine wrappers — no orphan wipe host;
 *   (b) shared-origin content wrappers are NEVER in the table (the C1 guard);
 *   (c) no affiliate pass-through host is in the table (also #703).
 * A pure redirector missing from the table just misses cleanup (fail-safe).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { WRAPPERS } from "../../src/lib/wrapper-engine.js";
import { isAffiliateRedirectNetwork } from "../../src/lib/opaque-networks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOUNCE_SRC = readFileSync(
  join(__dirname, "../../src/content/bounce-state-cleaner.js"),
  "utf8",
);

// Isolate the inline `const WRAPPERS = [ ... ];` block so host-literal matches
// don't pick up the unrelated INLINE_AFFILIATE_REDIRECT_NETWORKS list.
const wStart = BOUNCE_SRC.indexOf("const WRAPPERS = [");
const wEnd = BOUNCE_SRC.indexOf("];", wStart);
const INLINE_WRAPPERS_SRC = BOUNCE_SRC.slice(wStart, wEnd);

test("inline WRAPPERS block is found in bounce-state-cleaner.js", () => {
  assert.ok(wStart !== -1 && wEnd > wStart, "could not locate the inline const WRAPPERS = [ ... ] table");
});

// ── New contract (the bounce-wipe allowlist inversion) ─────────────────────
// The bounce-state storage wipe is gated on the CURATED inline WRAPPERS table,
// NOT on the full wrapper engine (see resolveEngine() in
// src/content/bounce-state-cleaner.js). So the invariant is no longer "every
// wrapper must be in the inline table"; it is:
//   (a) the inline table is a SUBSET of engine wrappers — no orphan/typo host
//       in the wipe allowlist, and
//   (b) SHARED-ORIGIN content wrappers are ABSENT from the inline table, so
//       their first-party Web Storage is never wiped (the C1 guard).

/**
 * Pull the literal host strings out of the isolated inline WRAPPERS block.
 * @returns {string[]}
 */
function inlineHostLiterals() {
  const hosts = [];
  const re = /"([a-z0-9.*-]+)"/gi;
  let m;
  while ((m = re.exec(INLINE_WRAPPERS_SRC)) !== null) hosts.push(m[1].toLowerCase());
  return hosts;
}

// Shared-origin content wrappers: unwrapped by the engine, but their origin
// holds the user's own session/settings, so they MUST NOT be storage-wiped.
const CONTENT_ORIGIN_HOSTS = [
  "youtube.com", "www.youtube.com",
  "duckduckgo.com", "www.duckduckgo.com",
  "steamcommunity.com", "www.steamcommunity.com",
  "curseforge.com", "www.curseforge.com",
];

test("inline WRAPPERS is a subset of engine wrappers — no orphan wipe host (#725)", () => {
  const engineHosts = new Set();
  for (const wrapper of WRAPPERS) {
    for (const pattern of wrapper.hostPatterns) {
      if (typeof pattern === "string") engineHosts.add(pattern.toLowerCase());
    }
  }
  const orphans = inlineHostLiterals().filter((h) => !engineHosts.has(h));
  assert.deepEqual(
    orphans,
    [],
    "bounce-state-cleaner.js inline WRAPPERS contains host(s) that are not " +
      "wrapper-engine.js wrappers — the wipe allowlist has drifted:\n  " +
      orphans.join("\n  "),
  );
});

test("shared-origin content wrappers are NEVER in the inline wipe table (C1 guard)", () => {
  const inline = inlineHostLiterals();
  const leaked = CONTENT_ORIGIN_HOSTS.filter((h) => inline.includes(h));
  assert.deepEqual(
    leaked,
    [],
    "a shared-origin content host is in the bounce-state wipe allowlist — " +
      "landing on its redirect interstitial would wipe the user's first-party " +
      "storage (logout / lost settings):\n  " + leaked.join("\n  "),
  );
  // And they must genuinely be wrappers (so the guard is meaningful, not
  // guarding against hosts the engine never unwraps in the first place).
  const engineHosts = new Set(
    WRAPPERS.flatMap((w) => w.hostPatterns.filter((p) => typeof p === "string").map((p) => p.toLowerCase())),
  );
  for (const h of CONTENT_ORIGIN_HOSTS) {
    assert.ok(engineHosts.has(h), `expected ${h} to be an engine wrapper (unwrapped but not wiped)`);
  }
});

test("no affiliate-redirect host leaked into the inline wipe table", () => {
  const leaked = inlineHostLiterals().filter((h) => isAffiliateRedirectNetwork(h));
  assert.deepEqual(leaked, [], "affiliate pass-through host in wipe allowlist:\n  " + leaked.join("\n  "));
});

test("resolveEngine gates the wipe on the inline table, NOT the bundled engine (C1 inversion)", () => {
  // The whole C1 fix rests on the wipe decision using the curated inline
  // table. If resolveEngine ever prefers window.__mugaCleaner (the full
  // engine) again, content-origin wrappers would be wiped once more.
  const match = BOUNCE_SRC.match(/function resolveEngine\(\)\s*\{([\s\S]*?)\n {2}\}/);
  assert.ok(match, "resolveEngine() not found");
  const body = match[1];
  assert.match(body, /detectWrapper:\s*inlineDetectWrapper/, "wipe gate must use inlineDetectWrapper");
  assert.ok(
    !/__mugaCleaner/.test(body),
    "resolveEngine must NOT consult the bundled engine (__mugaCleaner) for the wipe decision",
  );
});
