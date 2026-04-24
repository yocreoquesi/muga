/**
 * MUGA: Input validation helpers
 *
 * Centralised validation logic shared between the service worker and the
 * options page. Keeping it here prevents the two consumers from silently
 * diverging when entry-format rules change (e.g., new ::variant keys).
 */

/**
 * Validates a blacklist/whitelist entry.
 *
 * Accepted formats:
 *   - "domain.com"                   (strip all params on this domain)
 *   - "domain.com::disabled"         (disable cleaning on this domain)
 *   - "domain.com::param::value"     (match a specific affiliate param/value)
 *
 * @param {*} entry - Value to validate.
 * @returns {boolean} True if the entry is valid, false otherwise.
 */
export function isValidListEntry(entry) {
  if (typeof entry !== "string" || entry.length === 0 || entry.length > 500) return false;
  const parts = entry.split("::");
  if (parts.length > 3) return false;
  if (!parts[0] || !/^[a-zA-Z0-9.-]+$/.test(parts[0])) return false;
  if (parts.length === 2 && parts[1] !== "disabled") return false;
  if (parts.length === 3 && (!parts[1] || !parts[2])) return false;
  return true;
}
