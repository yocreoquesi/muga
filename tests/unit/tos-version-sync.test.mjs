/**
 * MUGA — Terms of Use drift gate
 *
 * The Terms exist in three places that must agree:
 *
 *   1. src/privacy/tos.html — the copy shipped inside the extension, and the
 *      one a user actually reads. Authoritative.
 *   2. docs/tos.html        — the repository mirror, same body, its own
 *      styling and its own link to the neighbouring privacy page.
 *   3. TERMS_VERSION in src/lib/consent-storage.js — recorded per device so
 *      the stored record says which wording the user was shown.
 *
 * All three had drifted: the code said 1.2, the shipped document said 1.4 and
 * the mirror said 1.3, with different "Last updated" dates and materially
 * different clauses. The mirror still described a versioned re-acceptance flow
 * that was deleted in ADR-0007, and TERMS_VERSION named a wording no user was
 * ever shown, which is the one thing that field exists to get right.
 *
 * Nothing enforced any of it, because nothing reads TERMS_VERSION at runtime —
 * a legal document is exactly the kind of file where drift is silent and
 * expensive. These assertions are the enforcement.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { TERMS_VERSION } from "../../src/lib/consent-storage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const SHIPPED = readFileSync(join(ROOT, "src", "privacy", "tos.html"), "utf8");
const MIRROR = readFileSync(join(ROOT, "docs", "tos.html"), "utf8");

/** Pulls "1.5" out of the `.meta` line's "Version 1.5" fragment. */
function versionOf(html) {
  return html.match(/Version\s+(\d+\.\d+)/)?.[1];
}

/** Pulls the ISO date out of the `.meta` line's "Last updated:" fragment. */
function lastUpdatedOf(html) {
  return html.match(/Last updated:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
}

/**
 * Reduces a copy to comparable prose: body only, tags stripped, whitespace
 * collapsed. The two copies legitimately differ in styling (inline <style> vs
 * a linked stylesheet) and in where the Privacy Policy link points, so both
 * are normalised away — everything else must match exactly.
 */
function bodyText(html) {
  return html
    .replace(/[\s\S]*?<body>/i, "")
    .replace(/<\/body>[\s\S]*/i, "")
    .replace(/href="privacy(-page)?\.html"/g, 'href="PRIVACY"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("Terms of Use — version provenance", () => {
  it("the shipped document declares a version", () => {
    assert.ok(versionOf(SHIPPED), "src/privacy/tos.html has no 'Version X.Y' in its .meta line");
  });

  it("TERMS_VERSION matches the shipped document", () => {
    assert.equal(
      TERMS_VERSION,
      versionOf(SHIPPED),
      `TERMS_VERSION is "${TERMS_VERSION}" but src/privacy/tos.html says "${versionOf(SHIPPED)}". ` +
      "The stored consent record would name a wording no user was shown. " +
      "Bump TERMS_VERSION in src/lib/consent-storage.js whenever the Terms text changes."
    );
  });

  it("the docs mirror declares the same version as the shipped document", () => {
    assert.equal(versionOf(MIRROR), versionOf(SHIPPED));
  });

  it("both copies carry the same 'Last updated' date", () => {
    assert.equal(
      lastUpdatedOf(MIRROR),
      lastUpdatedOf(SHIPPED),
      "docs/tos.html and src/privacy/tos.html disagree on the last-updated date"
    );
  });
});

describe("Terms of Use — the two copies say the same thing", () => {
  it("the docs mirror is textually identical to the shipped document", () => {
    const shipped = bodyText(SHIPPED);
    const mirror = bodyText(MIRROR);

    if (shipped !== mirror) {
      // Point at the first divergence rather than dumping two walls of prose.
      let i = 0;
      while (i < shipped.length && i < mirror.length && shipped[i] === mirror[i]) i++;
      assert.fail(
        "docs/tos.html has drifted from src/privacy/tos.html.\n" +
        `First divergence at character ${i}:\n` +
        `  shipped: ...${shipped.slice(Math.max(0, i - 60), i + 90)}\n` +
        `  mirror:  ...${mirror.slice(Math.max(0, i - 60), i + 90)}\n` +
        "The shipped copy is authoritative; re-mirror it into docs/."
      );
    }
  });
});

describe("Terms of Use — no promise MUGA no longer keeps (ADR-0007)", () => {
  // The re-acceptance engine was deleted. A Terms document that still promises
  // a re-acceptance flow, or features gated until the user re-accepts, is
  // describing behaviour that does not exist.
  const REMOVED_PROMISES = [
    /re-acceptance flow/i,
    /delta-review flow/i,
    /gated until you re-accept/i,
  ];

  for (const [label, html] of [["shipped", SHIPPED], ["docs mirror", MIRROR]]) {
    it(`the ${label} copy does not promise a re-acceptance flow`, () => {
      for (const pattern of REMOVED_PROMISES) {
        assert.ok(
          !pattern.test(html),
          `${label} Terms still describe ${pattern} — that flow was removed in ADR-0007`
        );
      }
    });
  }
});
