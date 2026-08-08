#!/usr/bin/env node
/**
 * Builds the add-on-level AMO listing fields (name, summary, description)
 * from the single source they already live in: docs/store-listing.md.
 *
 * Why this exists: `web-ext sign --amo-metadata=<file>` spreads the WHOLE
 * JSON object into the `PUT /addon/{id}/` body (see web-ext's
 * lib/util/submit-addon.js#doNewAddonOrVersionSubmit), so anything the AMO
 * add-on API accepts at the top level can be shipped from that file. MUGA's
 * amo-metadata.json only ever carried `version`, so the listing name and
 * copy on AMO were never updated by a release. Editing them meant
 * remembering to do it by hand in the dashboard, which is exactly the kind
 * of step that gets skipped.
 *
 * Deliberately NOT sent: `categories` and `tags`. The AMO API takes those as
 * slugs, and a wrong slug fails the entire PUT, which would take the version
 * submission down with it. A cosmetic field is not worth risking the release
 * on a guess; those two stay manual in the dashboard.
 *
 * Source of truth, split on purpose:
 *   - name        <- src/manifest.json, the same string the extension ships
 *                    under. Sourcing it from the markdown too would create a
 *                    third place for it to drift.
 *   - summary     <- docs/store-listing.md, AMO "Summary" section
 *   - description <- docs/store-listing.md, AMO "Detailed description"
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** AMO caps the listing name at 50 characters. */
export const AMO_NAME_MAX = 50;

/** AMO caps the summary at 250 characters. */
export const AMO_SUMMARY_MAX = 250;

/**
 * Returns the "## Firefox Add-ons (AMO)" section of the listing document.
 * The file also holds a Chrome Web Store section whose headings have the
 * same names, so slicing to the AMO section first is what keeps the two
 * from being confused.
 *
 * @param {string} markdown - full docs/store-listing.md contents
 * @returns {string}
 */
export function amoSection(markdown) {
  const start = markdown.indexOf("## Firefox Add-ons (AMO)");
  if (start === -1) {
    throw new Error('docs/store-listing.md has no "## Firefox Add-ons (AMO)" section');
  }
  const rest = markdown.slice(start + 1);
  const nextTop = rest.indexOf("\n## ");
  return nextTop === -1 ? rest : rest.slice(0, nextTop);
}

/**
 * Extracts the body under an `### <heading>` up to the next `###`.
 *
 * Drops horizontal rules and the italic character-count annotations the
 * document carries for human editors (e.g. `*(234 chars)*`), neither of
 * which belongs in what gets sent to AMO.
 *
 * @param {string} section - output of amoSection()
 * @param {RegExp} headingPattern - matches the heading text after "### "
 * @returns {string}
 */
export function sectionBody(section, headingPattern) {
  const lines = section.split(/\r?\n/);
  const startIdx = lines.findIndex(
    (l) => l.startsWith("### ") && headingPattern.test(l.slice(4).trim())
  );
  if (startIdx === -1) {
    throw new Error(`docs/store-listing.md AMO section has no heading matching ${headingPattern}`);
  }

  const body = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("### ")) break;
    if (line.trim() === "---") continue;
    if (/^\*\(\d+\s+chars?\)\*$/.test(line.trim())) continue;
    body.push(line);
  }

  return body.join("\n").replace(/^\s+|\s+$/g, "");
}

/**
 * Builds the add-on-level metadata block for amo-metadata.json.
 *
 * Throws rather than truncating when a field is over its AMO limit: unlike
 * release notes, which are informational and safe to cut short, a truncated
 * name or summary is public marketing copy nobody proofread. Failing the
 * release is the cheaper outcome.
 *
 * @param {{ manifest?: object, storeListing?: string }} [sources]
 * @returns {{ name: object, summary: object, description: object }}
 */
export function buildAmoListing(sources = {}) {
  const manifest =
    sources.manifest ??
    JSON.parse(fs.readFileSync(path.join(ROOT, "src", "manifest.json"), "utf8"));
  const markdown =
    sources.storeListing ??
    fs.readFileSync(path.join(ROOT, "docs", "store-listing.md"), "utf8");

  const section = amoSection(markdown);
  const name = manifest.name;
  const summary = sectionBody(section, /^Summary\b/);
  const description = sectionBody(section, /^Detailed description$/);

  if (!name) throw new Error("src/manifest.json has no name");
  if (name.length > AMO_NAME_MAX) {
    throw new Error(`AMO name is ${name.length} chars, limit is ${AMO_NAME_MAX}: "${name}"`);
  }
  if (!summary) throw new Error("AMO summary is empty");
  if (summary.length > AMO_SUMMARY_MAX) {
    throw new Error(`AMO summary is ${summary.length} chars, limit is ${AMO_SUMMARY_MAX}`);
  }
  if (!description) throw new Error("AMO detailed description is empty");

  // AMO takes localized fields as { locale: value }. MUGA's store copy is
  // authored in English only; the in-extension UI localization is separate
  // and does not translate the listing.
  return {
    name: { "en-US": name },
    summary: { "en-US": summary },
    description: { "en-US": description },
  };
}
