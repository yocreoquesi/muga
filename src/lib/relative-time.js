/**
 * MUGA: Relative-time formatting (#453, B20 Group A)
 *
 * Pure function extracted from options.js so it can be unit-tested
 * without DOM globals. Mirrors the mode-label.js pattern.
 *
 * Uses the i18n TRANSLATIONS keys: time_just_now, time_minutes_ago,
 * time_hours_ago, time_yesterday, time_days_ago — all with %s placeholder
 * (replaced at call site via String.replace).
 */

import { t } from "./i18n.js";

/**
 * Formats a relative time string from a UTC millisecond timestamp.
 * Covers "just now" (< 2 min), minutes, hours, yesterday, and older.
 *
 * @param {number|null|undefined} fetchedAt - Millisecond timestamp or falsy
 * @param {string} [lang="en"] - BCP-47 language code
 * @returns {string} Human-readable relative time, or "—" when fetchedAt is falsy
 */
export function formatRelativeTime(fetchedAt, lang = "en") {
  if (!fetchedAt) return "—";
  const diffMs = Date.now() - fetchedAt;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 2) return t("time_just_now", lang);
  if (diffMin < 60) return t("time_minutes_ago", lang).replace("%s", String(diffMin));
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return t("time_hours_ago", lang).replace("%s", String(diffHours));
  if (diffHours < 48) return t("time_yesterday", lang);
  const diffDays = Math.floor(diffHours / 24);
  return t("time_days_ago", lang).replace("%s", String(diffDays));
}
