/**
 * MUGA: broken-site-report — the single funnel every "report a problem"
 * surface goes through (popup "Report this page", Settings "Report a
 * problem", the Developer tools URL tester).
 *
 * Each surface opens the broken-site.yml GitHub issue form, prefilled
 * (#1507, maintainer decision 2026-10-15): hostname, MUGA version, browser,
 * action taken, params removed, host-scoped params, the full page URL in its
 * own field, and a settings snapshot. The report is a link-out, not a flow:
 * nothing is published until the reporter clicks Submit on GitHub, and the
 * form's required privacy checkbox is where they review it (ADR-0011 note).
 *
 * The full URL is prefilled only when it parses as http(s) and is within
 * the 2000-char cap (AGENTS.md); anything else omits the `url` field
 * entirely rather than sending an empty or garbage value.
 *
 * ── Pure module guarantees ────────────────────────────────────────────
 *   - No DOM access
 *   - No chrome.* / storage / fetch
 *   - No clock / Math.random
 *   - No network
 *   - Never throws — malformed input degrades to safe defaults
 */

import { SETTINGS_FIELDS } from "./settings-schema.js";
import { PREF_DEFAULTS } from "./prefs.js";
import { parseListEntry, domainMatches } from "./cleaner.js";

/** Redirect-destination length cap shared across MUGA (AGENTS.md: ≤ 2000 chars). */
const MAX_REPORT_URL_LENGTH = 2000;

/**
 * Parses `url` defensively and returns its hostname, or "" if the URL is
 * missing, malformed, or not http(s). Never throws (AGENTS.md: wrap every
 * `new URL()` in try/catch).
 *
 * @param {string|null|undefined} url
 * @returns {{ hostname: string, isValidHttpUrl: boolean }}
 */
function _parseReportUrl(url) {
  if (typeof url !== "string" || url.length === 0) {
    return { hostname: "", isValidHttpUrl: false };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { hostname: "", isValidHttpUrl: false };
    }
    return { hostname: parsed.hostname, isValidHttpUrl: true };
  } catch {
    return { hostname: "", isValidHttpUrl: false };
  }
}

/**
 * Decides whether the full URL is safe to include: the user must have
 * opted in AND the URL must be a valid http(s) URL within the length cap.
 * Any single failed gate omits the full URL — no partial/best-effort
 * inclusion.
 *
 * @param {string|null|undefined} url
 * @param {boolean|undefined} includeFullUrl
 * @param {boolean} isValidHttpUrl
 * @returns {boolean}
 */
function _canIncludeFullUrl(url, includeFullUrl, isValidHttpUrl) {
  return (
    includeFullUrl === true &&
    isValidHttpUrl &&
    typeof url === "string" &&
    url.length <= MAX_REPORT_URL_LENGTH
  );
}

/**
 * Public validation gate for a Settings-reachable report flow (#1353):
 * true only for a well-formed http(s) URL. Wraps the module's private
 * `_parseReportUrl` gate — the popup and the QA URL tester both learn
 * whether a URL is reportable only as a side effect of building the whole
 * fields/body object; a surface that has no live cleaning result yet (a
 * user just pasted a URL and hasn't run the check) needs the yes/no answer
 * on its own, to show friendly inline validation instead of nothing.
 *
 * Never throws — malformed/garbage input returns false.
 *
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
export function isReportableUrl(url) {
  return _parseReportUrl(url).isValidHttpUrl;
}

/**
 * Builds the field set for the broken-site.yml GitHub issue form. Returns a
 * plain object keyed by the template's field IDs (GitHub prefills a form
 * field from the query param of the same id), plus `template`, `title` and
 * `labels`. The `url` key is present whenever the URL is a valid http(s)
 * URL within the length cap, and omitted otherwise.
 *
 * Defensive defaults — never throws on bad input:
 *   - url null/undefined/malformed → hostname "", url key omitted
 *   - action/settings empty        → key omitted
 *   - removedParams empty/missing  → params key omitted
 *   - scopedParams empty/missing   → scoped key omitted
 *
 * @param {object} input
 * @param {string} input.url - the page URL being reported
 * @param {string} [input.action] - cleaner action taken (e.g. "cleaned")
 * @param {string} [input.settings] - buildSettingsSnapshot() output
 * @param {string[]} [input.removedParams] - tracking params MUGA removed
 * @param {string[]} [input.scopedParams] - host-anchored params MUGA applies here (#1229)
 * @param {string} [input.version] - MUGA version (manifest)
 * @param {string} [input.browser] - browser identifier (e.g. navigator.userAgent)
 * @returns {object} plain fields object for URLSearchParams
 */
export function buildBrokenSiteReportFields(input) {
  // Defensive: destructuring defaults (`= {}`) only cover `undefined`, not an
  // explicit `null` argument — normalise both to an empty object up front.
  const { url, action, removedParams, scopedParams, version, browser, settings } = input || {};
  const { hostname, isValidHttpUrl } = _parseReportUrl(url);

  const fields = {
    template: "broken-site.yml",
    title: `[Broken] ${hostname}`,
    hostname,
    browser: browser == null ? "" : String(browser),
    version: version == null ? "" : String(version),
    // Exactly the template's own labels. A `labels` query param can replace
    // the template's set for a reporter allowed to label, so passing only
    // "broken-site" here would drop needs-triage, the entry state (#1269),
    // for exactly those reports. Asserted against broken-site.yml in tests.
    labels: REPORT_LABELS,
  };

  if (typeof action === "string" && action !== "") {
    fields.action = action;
  }

  if (Array.isArray(removedParams) && removedParams.length > 0) {
    fields.params = removedParams.join(", ");
  }

  // #1229: which of those params came from a HOST-ANCHORED fact. Carries no
  // information about the user — these are MUGA's own published rules for a
  // hostname the report already names — and it is what makes the report
  // actionable: a scoped fact was admitted on ONE upstream's word for this
  // exact host and can be withdrawn in the next payload, where a built-in has
  // been shipping to everyone for months and is unlikely to be new breakage.
  // Omitted entirely when there are none, so a report from a host with no
  // scoped facts reads exactly as it did before.
  if (Array.isArray(scopedParams) && scopedParams.length > 0) {
    fields.scoped = scopedParams.join(", ");
  }

  // #1507 (maintainer decision 2026-10-15): the full URL is prefilled in its
  // own form field. Nothing is published until the reporter clicks Submit on
  // GitHub, and the form's required privacy checkbox plus the field's own
  // "check this URL" hint are where the review happens. The scheme and length
  // gates still hold: a non-http(s) or oversized URL is never prefilled.
  if (isValidHttpUrl && typeof url === "string" && url.length <= MAX_REPORT_URL_LENGTH) {
    fields.url = url;
  }

  if (typeof settings === "string" && settings !== "") {
    fields.settings = settings;
  }

  return fields;
}

// ── Report link (#1507) ───────────────────────────────────────────────────

/** The issue-form endpoint both report surfaces open. */
export const REPORT_ISSUE_BASE = "https://github.com/yocreoquesi/muga/issues/new";

/**
 * Practical ceiling for the prefilled link. GitHub answers 414 a little
 * above 8 KB of request line; 8000 leaves headroom for the method, version
 * and any redirect GitHub adds for a signed-out reporter. A 2000-char URL
 * encodes to at most ~6 KB, so it always fits on its own.
 */
export const MAX_REPORT_LINK_LENGTH = 8000;

/** Mirrors broken-site.yml's `labels:` (asserted in tests). */
const REPORT_LABELS = "broken-site,bug,needs-triage";

/** Appended to a snapshot that had to be cut to fit the link. */
const TRUNCATED_MARK = "(truncated)";

/**
 * Fields dropped, in order, if the link still does not fit once the
 * snapshot is gone. The URL goes last: it is the most useful line in the
 * report and the one the maintainer decision exists to carry.
 */
const DROP_ORDER = ["params", "scoped", "url"];

function _serialize(fields) {
  return `${REPORT_ISSUE_BASE}?${new URLSearchParams(fields).toString()}`;
}

/**
 * Builds the GitHub issue-form link for a broken-site report: the
 * broken-site.yml form (via `template=`, so its labels and required privacy
 * checkbox apply) prefilled from buildBrokenSiteReportFields().
 *
 * Keeps the link within MAX_REPORT_LINK_LENGTH by trimming the settings
 * snapshot from its end first (its lines are ordered most useful first),
 * then dropping it, and only then the param lists and the URL.
 *
 * @param {object} input - same shape as buildBrokenSiteReportFields()
 * @param {{ maxLength?: number }} [opts]
 * @returns {string} the prefilled https://github.com/... link; never throws
 */
export function buildBrokenSiteReportUrl(input, opts = {}) {
  const maxLength = Number.isFinite(opts?.maxLength) ? opts.maxLength : MAX_REPORT_LINK_LENGTH;
  const fields = buildBrokenSiteReportFields(input);
  let link = _serialize(fields);
  if (link.length <= maxLength) return link;

  if (typeof fields.settings === "string") {
    const lines = fields.settings.split("\n");
    while (lines.length > 0) {
      lines.pop();
      fields.settings = [...lines, TRUNCATED_MARK].join("\n");
      link = _serialize(fields);
      if (link.length <= maxLength) break;
    }
    if (link.length > maxLength) {
      delete fields.settings;
      link = _serialize(fields);
    }
  }

  for (const key of DROP_ORDER) {
    if (link.length <= maxLength) break;
    delete fields[key];
    link = _serialize(fields);
  }
  return link;
}

/**
 * Builds the markdown body for the options page's free-text GitHub issue
 * report. Includes a `**Full URL:**` line ONLY when the caller opted in AND
 * the URL is a valid http(s) URL within the length cap; otherwise falls
 * back to the current `**Domain:**` line (hostname only).
 *
 * @param {object} input
 * @param {string} input.url - the page URL being reported
 * @param {boolean} [input.includeFullUrl] - user opt-in checkbox state
 * @param {string} [input.hostname] - precomputed hostname (falls back to deriving from url)
 * @param {string} [input.version] - MUGA version
 * @param {string} [input.browser] - browser identifier
 * @param {string} [input.action] - cleaner action taken (e.g. "cleaned")
 * @param {string[]} [input.removedParams] - tracking params MUGA removed
 * @param {string[]} [input.scopedParams] - host-anchored params MUGA applies here (#1229)
 * @returns {string} markdown body
 */
export function buildBrokenSiteReportBody(input) {
  // Defensive: destructuring defaults (`= {}`) only cover `undefined`, not an
  // explicit `null` argument — normalise both to an empty object up front.
  const { url, includeFullUrl, hostname, version, browser, action, removedParams, scopedParams } =
    input || {};
  const parsed = _parseReportUrl(url);
  const safeHostname = hostname == null || hostname === "" ? parsed.hostname : String(hostname);
  const safeVersion = version == null ? "" : String(version);
  const safeBrowser = browser == null ? "" : String(browser);
  const safeAction = action == null || action === "" ? "none" : String(action);
  const safeRemoved =
    Array.isArray(removedParams) && removedParams.length > 0
      ? removedParams.join(", ")
      : "none";

  const locationLine = _canIncludeFullUrl(url, includeFullUrl, parsed.isValidHttpUrl)
    ? `**Full URL:** ${url}\n`
    : `**Domain:** ${safeHostname}\n`;

  // #1229: omitted rather than rendered as "none", so a report from a host with
  // no scoped facts produces exactly the body it produced before.
  const scopedLine =
    Array.isArray(scopedParams) && scopedParams.length > 0
      ? `**Host-scoped params:** ${scopedParams.join(", ")}\n`
      : "";

  return (
    `## URL Report\n\n` +
    locationLine +
    `**MUGA version:** ${safeVersion}\n` +
    `**Browser:** ${safeBrowser}\n` +
    `**Action taken:** ${safeAction}\n` +
    `**Params removed:** ${safeRemoved}\n` +
    scopedLine +
    `\n` +
    `## Problem\n\n` +
    `<!-- Describe what went wrong: params that should have been removed but weren't, or params that were removed but shouldn't have been -->\n\n` +
    `## Expected behavior\n\n` +
    `<!-- What should MUGA do with this URL? -->\n`
  );
}

// ── Settings snapshot (#1507) ─────────────────────────────────────────────

/**
 * SETTINGS_FIELDS kinds whose value is a single scalar a maintainer can set
 * to reproduce. `remoteRulesEnabled` is permissionGated too but has its own
 * line, so it is skipped below rather than reported twice.
 */
const SCALAR_KINDS = new Set(["boolean", "toastDuration", "language", "permissionGated"]);

/**
 * How each list's entries are tested against the reported page. Host lists
 * hold `domain[::param[::value]]` entries, param lists hold bare param
 * names, and creatorAllowlist holds `domain/path` referrer shapes. A list
 * missing here is reported as a bare count, never with entries, so a new
 * list kind fails closed.
 */
const LIST_MATCHERS = Object.freeze({
  whitelist: "host",
  blacklist: "host",
  customParams: "param",
  userCustomRules: "param",
  creatorAllowlist: "creator",
});

/**
 * Parses the reported URL into what list entries are matched against.
 * Never throws: an unparseable URL yields no host and no params, so no
 * entry can match and every list degrades to a bare count.
 */
function _pageFacts(url) {
  if (typeof url !== "string") return { host: "", params: new Set() };
  try {
    const parsed = new URL(url);
    const params = new Set();
    // forEach, not keys(): Firefox Xray safety (#1009).
    parsed.searchParams.forEach((_value, key) => params.add(key.toLowerCase()));
    return { host: parsed.hostname.toLowerCase(), params };
  } catch {
    return { host: "", params: new Set() };
  }
}

/**
 * Whether one list entry applies to the reported page. Only these entries
 * may leave the device: they say nothing the report's own URL does not.
 */
function _entryMatchesPage(entry, matcher, page) {
  if (typeof entry !== "string" || entry === "") return false;
  if (matcher === "param") return page.params.has(entry.trim().toLowerCase());
  if (!page.host) return false;
  if (matcher === "host") {
    const { domain } = parseListEntry(entry);
    return domain !== "" && domainMatches(page.host, domain);
  }
  if (matcher === "creator") {
    const domain = entry.split("/")[0].trim().replace(/^www\./, "").toLowerCase();
    return domain !== "" && domainMatches(page.host, domain);
  }
  return false;
}

/** Formats one list as a count plus the entries that match the page. */
function _listLine(key, list, page) {
  const entries = Array.isArray(list) ? list : [];
  const count = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;
  const matching = entries.filter((e) => _entryMatchesPage(e, LIST_MATCHERS[key], page));
  return matching.length > 0
    ? `${key}: ${count}; matching this page: ${matching.join(", ")}`
    : `${key}: ${count}`;
}

/**
 * Builds the plain-text settings snapshot for a broken-site report, so the
 * maintainer can reproduce the user's configuration without learning their
 * browsing. Rules (maintainer decision on #1507):
 *   - scalar prefs: only keys that differ from PREF_DEFAULTS, derived from
 *     SETTINGS_FIELDS (never a hand-written list), plus disabledCategories;
 *   - lists: entry counts, plus only the entries that match the reported
 *     page. Never the full lists, since they describe the user's browsing;
 *   - remote rules: on or off, and the payload version in use.
 *
 * Line order puts the reproduction-critical lines first, because the report
 * link builder truncates the snapshot from the end when the link is long.
 *
 * @param {object} input
 * @param {object} input.prefs - the user's current prefs (getPrefs())
 * @param {string} input.url - the page being reported
 * @param {number} [input.remoteRulesVersion] - remoteRulesMeta.version in use
 * @returns {string} newline-separated snapshot; never throws
 */
export function buildSettingsSnapshot(input) {
  const { prefs: rawPrefs, url, remoteRulesVersion } = input || {};
  const prefs = rawPrefs && typeof rawPrefs === "object" ? rawPrefs : {};
  const page = _pageFacts(url);

  const changed = [];
  const lists = [];
  for (const field of SETTINGS_FIELDS) {
    if (field.key === "remoteRulesEnabled") continue;
    if (SCALAR_KINDS.has(field.kind)) {
      const value = prefs[field.key];
      if (value === undefined || value === null || typeof value === "object") continue;
      if (!Object.is(value, PREF_DEFAULTS[field.key])) changed.push(`${field.key}=${String(value)}`);
    } else if (Object.hasOwn(LIST_MATCHERS, field.key)) {
      lists.push(_listLine(field.key, prefs[field.key], page));
    }
  }
  changed.sort();

  const remoteOn = prefs.remoteRulesEnabled !== false;
  const version = Number(remoteRulesVersion);
  const remoteLine = `Remote rules: ${remoteOn ? "on" : "off"}, ${
    Number.isFinite(version) && version > 0 ? `payload version ${version}` : "no payload yet"
  }`;

  const categories = Array.isArray(prefs.disabledCategories) ? prefs.disabledCategories.map(String) : [];

  return [
    remoteLine,
    `Changed from defaults: ${changed.length > 0 ? changed.join(", ") : "none"}`,
    `disabledCategories: ${categories.length > 0 ? categories.join(", ") : "none"}`,
    ...lists,
  ].join("\n");
}
