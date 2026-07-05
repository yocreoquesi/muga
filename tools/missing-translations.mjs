/**
 * MUGA: Missing-translations diff tool (#361, extended #990)
 *
 * Reads `src/lib/i18n.js` and produces, for each community-maintained
 * language (PT, DE, FR, IT, JA), a markdown bullet list of i18n keys
 * that are missing or empty in that language. The output is suitable
 * for pasting into the per-language tracking issues, or for the
 * non-blocking CI parity report (see .github/workflows/ci.yml).
 *
 * Usage:
 *   node tools/missing-translations.mjs           # all community locales, stdout
 *   node tools/missing-translations.mjs pt        # PT only
 *   node tools/missing-translations.mjs de        # DE only
 *   node tools/missing-translations.mjs fr        # FR only
 *   node tools/missing-translations.mjs it        # IT only
 *   node tools/missing-translations.mjs ja        # JA only
 *
 * Idempotent: same input → same output. Keys are emitted in the order
 * they appear in TRANSLATIONS.
 */
import { TRANSLATIONS } from "../src/lib/i18n.js";

export const COMMUNITY_LOCALES = ["pt", "de", "fr", "it", "ja"];

/**
 * Returns the list of keys missing in `lang`. A key is "missing" if
 * its locale slot is undefined, null, or an empty string after trim.
 *
 * @param {string} lang - The locale code to check.
 * @returns {string[]} Keys missing in this locale, in declaration order.
 */
export function missingKeys(lang) {
  const out = [];
  for (const [key, entry] of Object.entries(TRANSLATIONS)) {
    const val = entry?.[lang];
    if (typeof val !== "string" || val.trim() === "") out.push(key);
  }
  return out;
}

/**
 * Produces a markdown report for one language. Suitable for direct
 * paste into a GitHub issue body.
 */
export function formatReport(lang) {
  const missing = missingKeys(lang);
  const total = Object.keys(TRANSLATIONS).length;
  const langLabel = lang.toUpperCase();

  const lines = [];
  lines.push(`# ${langLabel} translations needed`);
  lines.push("");
  if (missing.length === 0) {
    lines.push(`All ${total} translation keys are present in ${langLabel}. Nothing to do at the moment.`);
    lines.push("");
    lines.push(`This issue is kept open as a tracking point. When new keys are added without a ${langLabel} value, regenerate this list with:`);
    lines.push("");
    lines.push("```bash");
    lines.push(`node tools/missing-translations.mjs ${lang}`);
    lines.push("```");
    return lines.join("\n");
  }

  lines.push(`${missing.length} of ${total} keys missing in ${langLabel}. Each key below needs a translation in \`src/lib/locales/${lang}.mjs\`.`);
  lines.push("");
  lines.push(`**Contribution flow:** edit the matching key in \`src/lib/locales/${lang}.mjs\`, run \`npm test\`, open a PR. Community-locale PRs do not need native-speaker review by the maintainer (the maintainer is not a native speaker of any of them); the EN+ES floor enforced by the test suite is what gates a merge.`);
  lines.push("");
  lines.push("## Missing keys");
  lines.push("");
  for (const key of missing) {
    lines.push(`- [ ] \`${key}\``);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("Regenerate this list:");
  lines.push("```bash");
  lines.push(`node tools/missing-translations.mjs ${lang}`);
  lines.push("```");
  return lines.join("\n");
}

// CLI entry. Skipped when this module is imported (e.g. by the smoke test).
// #708: guard against `process.argv[1]` being undefined (indirect imports via
// stdin/eval). Without the guard, `.replace` throws on the undefined access.
const _argvOne = (process.argv[1] || "").replace(/\\/g, "/");
if (_argvOne && (import.meta.url === `file://${_argvOne}` || import.meta.url.endsWith(_argvOne))) {
  const arg = (process.argv[2] || "").toLowerCase();
  const targets = arg ? [arg] : COMMUNITY_LOCALES;
  for (const lang of targets) {
    if (!COMMUNITY_LOCALES.includes(lang)) {
      console.error(`Unknown locale: ${lang}. Valid: ${COMMUNITY_LOCALES.join(", ")}`);
      process.exit(1);
    }
    process.stdout.write(formatReport(lang));
    process.stdout.write("\n\n");
  }
}
