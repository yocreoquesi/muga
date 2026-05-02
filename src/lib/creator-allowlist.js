/**
 * MUGA — B13 (#445): Honor Creator Mode per-creator allowlist
 *
 * Pure CRUD module for the creator allowlist stored under
 * `chrome.storage.sync` as `creatorAllowlist: string[]`. Entries are
 * referrer-domain-shaped strings (e.g. `youtube.com/@LinusTechTips`,
 * `dot-css-news.com`) that the user explicitly opts in to honour creator
 * referral chains for. The options page wires this module to chrome.storage;
 * downstream behaviour (B14) reads the list to gate honouring.
 *
 * All exports are pure: addEntry/removeEntry return NEW arrays without
 * mutating the input. Validation rejects empty input, duplicates
 * (case-insensitive after normalization), and growth past
 * MAX_ALLOWLIST_ENTRIES (storage hygiene). Each entry is bounded to 200
 * characters and to a permissive-but-bounded character set so a paste
 * accident cannot poison sync storage with arbitrary data.
 */

/**
 * Hard cap on allowlist size. 100 entries × ~80 chars ≈ 8 KB, comfortably
 * within chrome.storage.sync's 8 KB per-item / 100 KB total budget.
 *
 * @type {number}
 */
export const MAX_ALLOWLIST_ENTRIES = 100;

/**
 * Maximum length for a single allowlist entry (defensive against paste
 * accidents). Domain + creator handle is rarely above 80 chars in practice.
 *
 * @type {number}
 */
const MAX_ENTRY_LENGTH = 200;

/**
 * Permissive-but-bounded character set: lowercase ASCII letters, digits,
 * dot, dash, underscore, slash (path separator), and `@` (creator handle).
 * Spaces, control characters, query-string punctuation, and ports are
 * rejected. The check runs AFTER `normalizeEntry`, so case is already
 * lowercased.
 *
 * @type {RegExp}
 */
const ALLOWED_CHARSET = /^[a-z0-9_./@-]+$/;

/**
 * Normalizes a raw allowlist entry: trims, lowercases, strips an `http(s)://`
 * prefix and a single trailing slash. Non-string input collapses to "".
 *
 * @param {*} raw - The raw user input.
 * @returns {string} The normalized form, or "" if input is unusable.
 */
export function normalizeEntry(raw) {
  if (typeof raw !== "string") return "";
  let s = raw.trim().toLowerCase();
  if (s.startsWith("https://")) s = s.slice(8);
  else if (s.startsWith("http://")) s = s.slice(7);
  if (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

/**
 * Returns true iff the (already-normalized or raw) entry is structurally
 * valid: non-empty after normalization, ≤ 200 chars, and matches the
 * bounded character set.
 *
 * @param {*} raw - Either raw user input or a normalized string.
 * @returns {boolean}
 */
export function isValidAllowlistEntry(raw) {
  const s = typeof raw === "string" ? normalizeEntry(raw) : "";
  if (!s) return false;
  if (s.length > MAX_ENTRY_LENGTH) return false;
  return ALLOWED_CHARSET.test(s);
}

/**
 * Adds a new entry to the allowlist. Returns a new list and an optional
 * error code. Possible error codes:
 *
 *   - `'empty'`    — input is empty/whitespace OR fails structural validation
 *   - `'duplicate'`— normalized form already exists in the list
 *   - `'max'`      — list is at MAX_ALLOWLIST_ENTRIES
 *
 * The list is never mutated. On error, the returned `list` is a shallow
 * copy of the input so callers can swap it in unconditionally.
 *
 * @param {string[]} list - Current allowlist (immutable).
 * @param {string}   raw  - Raw user input.
 * @returns {{ list: string[], error?: 'empty'|'duplicate'|'max' }}
 */
export function addEntry(list, raw) {
  const current = Array.isArray(list) ? list.slice() : [];
  if (!isValidAllowlistEntry(raw)) {
    return { list: current, error: "empty" };
  }
  const normalized = normalizeEntry(raw);
  // Case-insensitive duplicate check. Stored entries are already normalized
  // by addEntry, but legacy or imported lists could contain mixed-case data;
  // normalize on read to be robust.
  const seen = new Set(current.map(normalizeEntry));
  if (seen.has(normalized)) {
    return { list: current, error: "duplicate" };
  }
  if (current.length >= MAX_ALLOWLIST_ENTRIES) {
    return { list: current, error: "max" };
  }
  return { list: [...current, normalized] };
}

/**
 * Removes an entry from the allowlist. Matching is case-insensitive after
 * normalization. Absent entries are a no-op (returns an equivalent list).
 *
 * @param {string[]} list - Current allowlist (immutable).
 * @param {string}   raw  - Raw entry value to remove.
 * @returns {string[]} A new list without the matching entry.
 */
export function removeEntry(list, raw) {
  const current = Array.isArray(list) ? list.slice() : [];
  const target = normalizeEntry(raw);
  if (!target) return current;
  return current.filter((e) => normalizeEntry(e) !== target);
}
