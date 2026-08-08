/**
 * MUGA — AMO listing metadata builder
 *
 * `web-ext sign --amo-metadata=<file>` spreads the whole JSON object into the
 * `PUT /addon/{id}/` body, so whatever this builder emits is what the public
 * AMO listing becomes on the next release. That makes it worth pinning
 * tightly: a parsing slip here does not fail loudly in CI, it quietly
 * republishes the wrong marketing copy, or the right copy with a stray `---`
 * or an editor's `*(234 chars)*` annotation in the middle of it.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import {
  buildAmoListing,
  amoSection,
  sectionBody,
  AMO_NAME_MAX,
  AMO_SUMMARY_MAX,
} from "../../tools/amo-listing-metadata.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const MANIFEST = JSON.parse(readFileSync(join(ROOT, "src", "manifest.json"), "utf8"));
const STORE_LISTING = readFileSync(join(ROOT, "docs", "store-listing.md"), "utf8");

describe("AMO listing — built from the real store-listing document", () => {
  const listing = buildAmoListing();

  it("takes the name from the manifest, not from a second copy in the markdown", () => {
    assert.equal(listing.name["en-US"], MANIFEST.name);
  });

  it("stays inside AMO's name and summary limits", () => {
    assert.ok(listing.name["en-US"].length <= AMO_NAME_MAX);
    assert.ok(listing.summary["en-US"].length <= AMO_SUMMARY_MAX);
  });

  it("reads the AMO summary, not the Chrome Web Store short description", () => {
    // The two sections carry different copy. The CWS one is the manifest
    // description; the AMO one is longer and mentions "without breaking pages".
    assert.match(listing.summary["en-US"], /without breaking pages/);
    assert.notEqual(listing.summary["en-US"], MANIFEST.description);
  });

  it("captures the whole detailed description, opening to closing line", () => {
    const description = listing.description["en-US"];
    assert.match(description, /^Remember when a link was just a link\?/);
    assert.match(description, /https:\/\/github\.com\/yocreoquesi\/muga$/);
  });

  it("carries none of the document's editing scaffolding", () => {
    for (const [field, value] of Object.entries(listing)) {
      const text = value["en-US"];
      assert.ok(!/^---$/m.test(text), `${field} contains a horizontal rule`);
      assert.ok(!/\*\(\d+\s+chars?\)\*/.test(text), `${field} contains a char-count annotation`);
      assert.ok(!/^### /m.test(text), `${field} contains a markdown heading`);
    }
  });

  it("emits exactly the three add-on fields, and no categories or tags", () => {
    // categories/tags are slug-typed on the AMO API and a wrong slug fails the
    // entire PUT, taking the version submission down with it. They stay manual
    // on purpose — see the note in tools/amo-listing-metadata.mjs.
    assert.deepEqual(Object.keys(listing).sort(), ["description", "name", "summary"]);
  });

  it("emits every field as an en-US localized object, the shape AMO expects", () => {
    for (const [field, value] of Object.entries(listing)) {
      assert.deepEqual(Object.keys(value), ["en-US"], `${field} is not a localized object`);
      assert.equal(typeof value["en-US"], "string");
    }
  });
});

describe("AMO listing — section parsing", () => {
  it("slices the AMO section, not the Chrome one, when both use the same headings", () => {
    const section = amoSection(STORE_LISTING);
    assert.ok(section.includes("Firefox Add-ons (AMO)"));
    assert.ok(!section.includes("## Chrome Web Store"));
    assert.ok(!section.includes("Keywords (Chrome Web Store"));
  });

  it("stops a body at the next ### heading", () => {
    const section = [
      "## Firefox Add-ons (AMO)",
      "",
      "### Summary (250 chars max)",
      "",
      "The summary.",
      "",
      "### Detailed description",
      "",
      "The description.",
    ].join("\n");

    assert.equal(sectionBody(section, /^Summary\b/), "The summary.");
    assert.equal(sectionBody(section, /^Detailed description$/), "The description.");
  });

  it("keeps blank lines inside a body, since paragraphs are the copy's structure", () => {
    const section = [
      "## Firefox Add-ons (AMO)",
      "",
      "### Detailed description",
      "",
      "First paragraph.",
      "",
      "Second paragraph.",
    ].join("\n");

    assert.equal(sectionBody(section, /^Detailed description$/), "First paragraph.\n\nSecond paragraph.");
  });

  it("throws a named error when the AMO section is missing entirely", () => {
    assert.throws(() => amoSection("# Store Listings\n\n## Chrome Web Store\n"), /Firefox Add-ons \(AMO\)/);
  });

  it("throws when a required heading is missing rather than emitting an empty field", () => {
    assert.throws(
      () => sectionBody("## Firefox Add-ons (AMO)\n\n### Summary\n\nx\n", /^Detailed description$/),
      /no heading matching/
    );
  });
});

describe("AMO listing — limits fail the build instead of truncating", () => {
  const validMarkdown = [
    "## Firefox Add-ons (AMO)",
    "",
    "### Summary (250 chars max)",
    "",
    "A short summary.",
    "",
    "### Detailed description",
    "",
    "A description.",
  ].join("\n");

  it("rejects a name over the AMO limit", () => {
    assert.throws(
      () =>
        buildAmoListing({
          manifest: { name: "M".repeat(AMO_NAME_MAX + 1) },
          storeListing: validMarkdown,
        }),
      /AMO name is \d+ chars/
    );
  });

  it("rejects a summary over the AMO limit", () => {
    const longSummary = validMarkdown.replace("A short summary.", "S".repeat(AMO_SUMMARY_MAX + 1));
    assert.throws(
      () => buildAmoListing({ manifest: { name: "MUGA" }, storeListing: longSummary }),
      /AMO summary is \d+ chars/
    );
  });

  it("rejects an empty description rather than blanking the live listing", () => {
    const emptyDescription = validMarkdown.replace("A description.", "");
    assert.throws(
      () => buildAmoListing({ manifest: { name: "MUGA" }, storeListing: emptyDescription }),
      /detailed description is empty/
    );
  });
});
