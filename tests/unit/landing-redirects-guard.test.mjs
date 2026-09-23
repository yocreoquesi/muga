/**
 * MUGA: muga.app redirect guard (#1356).
 *
 * `/clean` was retired as a public destination: the landing already hosts
 * the same tool inline at `#demo-tool`, driven by the real controller
 * (landing/clean/ui.js). Cloudflare Pages (the platform that serves
 * muga.app, build output directory `landing/`, see docs/ops/landing-
 * deploy.md) reads redirect rules from `landing/_redirects`, the same way
 * it reads response headers from `landing/_headers`
 * (tests/unit/landing-headers-guard.test.mjs).
 *
 * Two things must survive the redirect or it is worse than a 404:
 *   - `?url=` (#1333's share link) must reach the landing, not get dropped.
 *   - The redirect must not loop (source and destination must differ, and
 *     the destination must not itself start with `/clean`).
 *
 * Cloudflare's own `_redirects` docs do not explicitly state that a bare
 * destination (no query string of its own) forwards the original request's
 * query string automatically. This mirrors Netlify's documented behaviour
 * (Pages' `_redirects` format follows Netlify's), but is not confirmed for
 * Cloudflare Pages specifically anywhere reachable from this repo — flagged
 * in odd/tasks/retire-clean-page.md as unverifiable locally; verify against
 * production the same way docs/ops/landing-deploy.md already does for
 * headers.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const REDIRECTS_FILE = "landing/_redirects";
const REDIRECTS = readFileSync(join(ROOT, REDIRECTS_FILE), "utf8");

/** Non-comment, non-blank lines, CRLF-safe (see landing-headers-guard.test.mjs
 * for why: `.` excludes line terminators, so a stray "\r" silently breaks
 * matching on a Windows checkout while passing on Linux CI). */
function rules() {
  return REDIRECTS.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

/** Parses a `_redirects` line into { source, destination, code }. */
function parseRule(line) {
  const parts = line.split(/\s+/);
  return { source: parts[0], destination: parts[1], code: parts[2] ? Number(parts[2]) : 302 };
}

describe("muga.app /clean retirement redirects (#1356)", () => {
  const rules_ = rules();

  test("_redirects declares a rule for /clean", () => {
    const rule = rules_.map(parseRule).find((r) => r.source === "/clean");
    assert.ok(rule, `${REDIRECTS_FILE} must redirect the bare /clean path`);
  });

  test("_redirects declares a rule for /clean/ (trailing slash)", () => {
    const rule = rules_.map(parseRule).find((r) => r.source === "/clean/");
    assert.ok(rule, `${REDIRECTS_FILE} must redirect /clean/ as well as /clean`);
  });

  for (const source of ["/clean", "/clean/"]) {
    test(`${source} redirects to the landing's tool anchor, not a 404 and not a bare /`, () => {
      const rule = rules_.map(parseRule).find((r) => r.source === source);
      assert.ok(rule, `no rule for ${source}`);
      assert.equal(
        rule.destination,
        "/#demo-tool",
        `${source} must redirect straight at the landing's tool anchor (#demo-tool), the way #1356 names it`,
      );
    });

    test(`${source} does not redirect back into /clean (no loop)`, () => {
      const rule = rules_.map(parseRule).find((r) => r.source === source);
      assert.ok(rule, `no rule for ${source}`);
      assert.ok(
        !rule.destination.startsWith("/clean"),
        `${source} -> ${rule.destination} would loop back into the retired page`,
      );
    });

    test(`${source} uses a permanent redirect (301), since the retirement is not temporary`, () => {
      const rule = rules_.map(parseRule).find((r) => r.source === source);
      assert.ok(rule, `no rule for ${source}`);
      assert.equal(rule.code, 301);
    });
  }

  test("no rule redirects the /clean/* subtree (that would break the still-served landing/clean/ assets)", () => {
    const splatRule = rules_.map(parseRule).find((r) => r.source.startsWith("/clean/*") || r.source === "/clean/:splat");
    assert.equal(
      splatRule,
      undefined,
      "landing/clean/ui.js, landing/clean/engine/* etc. are still runtime dependencies of the landing " +
        "(#1356 keeps the byte-parity mirror); a /clean/* redirect would break every one of them",
    );
  });

  test("the destination is a bare in-page anchor, so the query string is never overwritten by an explicit one", () => {
    // Cloudflare Pages' `_redirects` destination syntax can carry its own
    // literal query string (e.g. "/?query=string"), which docs say replaces
    // the incoming one. The destination here must carry none of its own, or
    // #1333's ?url= would be clobbered instead of forwarded.
    for (const source of ["/clean", "/clean/"]) {
      const rule = rules_.map(parseRule).find((r) => r.source === source);
      assert.ok(rule, `no rule for ${source}`);
      assert.ok(
        !rule.destination.includes("?"),
        `${source} -> ${rule.destination} must not declare its own query string, or the incoming ?url= is discarded instead of forwarded`,
      );
    }
  });
});
