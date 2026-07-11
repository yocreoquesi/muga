/** MUGA: Web-cleaner-tool report link (sdd/web-cleaning-insight, Slice 1)
 *
 * Pure module: builds the prefilled GitHub new-issue URL for the Report
 * flow (spec "Report flow"). The returned href is opened as a
 * user-initiated navigation (new tab), which is the ONLY exception to the
 * page's zero-egress promise (spec "Zero-egress promise rescope") — this
 * module itself never issues a request, it only builds a string.
 *
 * Inclusion is the user's choice: nothing here auto-redacts any part of
 * the URL. The UI shows a "this will be public" warning alongside the
 * control that opens this href (web/ui.js).
 *
 * No DOM access, no imports from src/, never throws.
 */

/** Conservative total body-length budget so the prefilled GitHub issue
 * form does not silently truncate at its own (undocumented) URL-length
 * limit; long URLs are truncated here with a visible marker instead. */
const BODY_CHAR_BUDGET = 6000;
const TRUNCATION_MARKER = "\n\n[... truncated, see the original link above ...]";

const REPORT_REPO = "yocreoquesi/muga";

/**
 * Builds the report body text describing the cleaned/original URLs (and,
 * when the link was unwrapped, the destination host), truncating long
 * URLs to stay within `BODY_CHAR_BUDGET`.
 *
 * @param {{originalUrl: string, cleanUrl: string, removed: string[], unwrapped: boolean, destinationHost: string|null}} params
 * @returns {string}
 */
function buildBody({ originalUrl, cleanUrl, removed, unwrapped, destinationHost }) {
  const lines = [
    "Reporting a URL cleaned by muga.app/clean.",
    "",
    "Original URL:",
    originalUrl,
    "",
    "Cleaned URL:",
    cleanUrl,
    "",
    `Removed parameters: ${Array.isArray(removed) && removed.length > 0 ? removed.join(", ") : "none"}`,
  ];
  if (unwrapped) {
    lines.push(
      "",
      `Redirect wrapper unwrapped. Final destination host: ${destinationHost ?? "unknown"}`,
    );
  }
  lines.push("", "What looks wrong?", "");

  let body = lines.join("\n");
  if (body.length > BODY_CHAR_BUDGET) {
    body = body.slice(0, BODY_CHAR_BUDGET - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
  }
  return body;
}

/**
 * Builds a prefilled `github.com/.../issues/new` href for reporting a
 * cleaning result. Safe to render as an anchor `href`: every dynamic value
 * is passed through `URLSearchParams`, so no raw/unescaped URL can break
 * the query string.
 *
 * @param {{
 *   originalUrl: string,
 *   cleanUrl: string,
 *   removed?: string[],
 *   unwrapped?: boolean,
 *   destinationHost?: string|null,
 * }} params
 * @returns {string} A `https://github.com/{repo}/issues/new?title=...&body=...` href.
 */
export function buildReportUrl({ originalUrl, cleanUrl, removed = [], unwrapped = false, destinationHost = null }) {
  const params = new URLSearchParams({
    title: "Reported cleaning result",
    body: buildBody({ originalUrl, cleanUrl, removed, unwrapped, destinationHost }),
  });
  return `https://github.com/${REPORT_REPO}/issues/new?${params.toString()}`;
}
