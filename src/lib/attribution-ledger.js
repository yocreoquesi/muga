/**
 * MUGA — Attribution Ledger presenter (#454, A1).
 *
 * Pure module — no DOM, no storage, no fetches, no clock. Transforms a
 * caller-managed array of cleaner pipeline events into popup view-state.
 *
 * The cleaner pipeline does NOT emit events today: `processUrl` returns a
 * result object and exits. So this module is a PRESENTER, not a subscriber.
 * The "stream" is whatever array the caller (popup, tests, future telemetry)
 * decides to keep around. We hand back a new ledger on every push so that
 * popup state can be threaded through plain reducers without surprise
 * mutation, and we cap the buffer at N (default 10) so the popup never has
 * to render an unbounded list.
 *
 * `fromCleanerResult` is a small adaptor that maps a `processUrl()` return
 * value into one of our event shapes. It's a convenience for the popup —
 * push-side callers can also build events by hand (e.g. from webNavigation
 * for the bare `navigate` event, which the cleaner never emits).
 *
 * Badge identifiers are i18n KEYS, not translated text. Translation happens
 * at the popup boundary so the same ledger can be re-rendered when the
 * user switches language without rebuilding event history.
 */

/** Default size of the ledger ring buffer. Caps how many events the popup ever renders. */
export const DEFAULT_LEDGER_CAPACITY = 10;

/**
 * Frozen list of event types the presenter recognizes. Anything else is
 * dropped by `pushEvent` so a buggy caller can't poison the buffer.
 *
 * drop-affiliate-injection (PR 1a): "inject-affiliate" was removed — MUGA
 * never inserts its own affiliate tag anymore, so that event can no longer
 * be produced.
 */
export const EVENT_TYPES = Object.freeze([
  "navigate",
  "clean",
  "preserve-affiliate",
  "honor-creator",
  "blocked-opaque",
]);

const EVENT_TYPE_SET = new Set(EVENT_TYPES);

/**
 * i18n key for the "this URL was cleaned" badge. The popup translates this
 * into a localized string. We do NOT reuse the impact-dashboard's
 * "params removed" copy because the ledger is per-URL, not aggregate.
 */
const BADGE_CLEANED = "ledger_badge_cleaned";

/**
 * Creates an empty ledger with the given capacity. Capacity is captured on
 * the ledger so individual instances can disagree (e.g. tests use 3).
 *
 * @param {number} [capacity=DEFAULT_LEDGER_CAPACITY]
 * @returns {{ events: Array<object>, capacity: number }}
 */
export function createLedger(capacity = DEFAULT_LEDGER_CAPACITY) {
  return { events: [], capacity };
}

/**
 * Returns a new ledger with `event` appended, evicting the oldest event
 * when the resulting length would exceed `ledger.capacity`. Invalid events
 * (non-object, missing/unknown `type`) are dropped — the same ledger
 * reference is returned so callers can rely on `===` to skip re-renders.
 *
 * @param {{ events: Array<object>, capacity: number }} ledger
 * @param {object} event
 * @returns {{ events: Array<object>, capacity: number }}
 */
export function pushEvent(ledger, event) {
  if (!event || typeof event !== "object") return ledger;
  if (!EVENT_TYPE_SET.has(event.type)) return ledger;

  const next = ledger.events.concat(event);
  // Drop oldest entries when we overflow capacity. This keeps the popup
  // render bounded and the eviction order deterministic (FIFO).
  while (next.length > ledger.capacity) next.shift();

  return { events: next, capacity: ledger.capacity };
}

/**
 * Maps a single ledger event to its view-friendly entry shape. Decision
 * is the event type (intentional — popup keys behaviour off it). Optional
 * fields are only set when semantically present.
 *
 * @param {object} ev
 * @returns {{url:string, decision:string, creatorCredit?:string, network?:string, badge?:string}}
 */
function entryFor(ev) {
  const entry = { url: ev.url, decision: ev.type };
  switch (ev.type) {
    case "clean":
      entry.badge = BADGE_CLEANED;
      break;
    case "preserve-affiliate":
      if (ev.network) entry.network = ev.network;
      break;
    case "honor-creator":
      if (ev.network) entry.network = ev.network;
      if (ev.creator) entry.creatorCredit = ev.creator;
      break;
    // navigate / blocked-opaque carry no extras.
    default:
      break;
  }
  return entry;
}

/**
 * Projects a ledger into popup view-state. Pure: same input → same output,
 * no aliasing of the ledger's internal events array (callers can mutate
 * the returned `entries` without affecting future pushes).
 *
 * @param {{ events: Array<object>, capacity: number }} ledger
 * @returns {{ entries: Array<object> }}
 */
export function presentLedger(ledger) {
  return { entries: ledger.events.map(entryFor) };
}

/**
 * Adapts a `processUrl()` result object into a presenter event. Returns
 * null when the action is unrecognized so callers can skip without
 * polluting the ledger with garbage entries.
 *
 * Action mapping (#946 — every `url` here is a COPY-SAFE value: tracking
 * stripped, third-party creator attribution intact):
 *   `untouched`        → navigate         (URL passed through unchanged; rawUrl)
 *   `cleaned`          → clean            (result.cleanUrl — tracking stripped)
 *   `blacklisted`      → clean            (result.cleanUrl — params stripped via blacklist)
 *   `detected_foreign` → preserve-affiliate (result.cleanUrl — third-party tag preserved; network from detectedAffiliate.pattern.group)
 *   `honored-creator`  → honor-creator    (result.cleanUrl — wrapper passed through unchanged; network + creator)
 *
 * drop-affiliate-injection (PR 1a): `processUrl()` can no longer produce
 * `action: "injected"` — MUGA never inserts its own affiliate tag anymore.
 * That case (and its `deriveTaglessUrl` reprocessing helper) was removed;
 * an `"injected"` action now falls through to the `default: return null`
 * branch, same as any other unrecognized action.
 *
 * `blocked-opaque` has no cleaner action today — it's a future event the
 * popup may emit when an opaque wrapper (t.co etc.) couldn't be resolved.
 * Callers build that event by hand for now.
 *
 * @param {string} rawUrl
 * @param {object|null|undefined} result - return value from processUrl
 * @param {{prefs?: object, domainRules?: Array, pathStripRules?: Array, pathAffiliateRules?: Array, referrer?: string}} [_ctx]
 *   Unused — kept for call-site compatibility with existing callers
 *   (pushAttributionAndPersist still builds and passes this bag). It was
 *   previously consulted only by the now-removed `injected` case.
 * @returns {object|null}
 */
export function fromCleanerResult(rawUrl, result, _ctx) {
  if (!result || typeof result !== "object") return null;

  switch (result.action) {
    case "untouched":
      return { type: "navigate", url: rawUrl };
    case "cleaned":
    case "blacklisted":
      return { type: "clean", url: result.cleanUrl ?? rawUrl };
    case "detected_foreign": {
      // detectedAffiliate carries the matched pattern; group identifies
      // the program family the foreign tag belongs to. cleanUrl already
      // carries the third-party tag (honor-creator attribution) — only
      // MUGA-irrelevant tracking noise was stripped ahead of this point.
      const network =
        result.detectedAffiliate?.pattern?.group ||
        result.detectedAffiliate?.pattern?.name;
      const ev = { type: "preserve-affiliate", url: result.cleanUrl ?? rawUrl };
      if (network) ev.network = network;
      return ev;
    }
    case "honored-creator":
      return {
        type: "honor-creator",
        url: result.cleanUrl ?? rawUrl,
        network: result.network,
        creator: result.creator,
      };
    default:
      return null;
  }
}
