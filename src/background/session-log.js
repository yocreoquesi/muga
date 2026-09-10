/**
 * MUGA — Session log ring buffer + console overrides, extracted so it can be
 * imported in Node (#1266 item 5, slice 5)
 *
 * `src/background/service-worker.js` makes `chrome.*` calls at module scope,
 * so Node cannot import it, and the debug-log ring buffer this file carries
 * (`appendSessionLog` / `logAction`, plus the `console.error` / `console.warn`
 * overrides that mirror every warning and error into it) has only ever been
 * reachable through `swSource`-style source-text assertions in
 * `service-worker-patterns.test.mjs` — proof that a call site's TEXT is
 * present, never that the ring buffer actually bounds itself or serialises an
 * object the way `logAction` claims to. `tests/unit/session-log.test.mjs` now
 * imports the real functions and drives them directly.
 *
 * `appendSessionLog` still calls `sessionStorage` (the `chrome.storage.session`
 * wrapper from `../lib/storage.js`), but only inside the function body, never
 * at module scope — the same importability shape `dnr-sync.js` and
 * `toolbar-badge.js` use.
 *
 * ── Import-once guard ────────────────────────────────────────────────────
 *
 * #1266 is explicit that this module "must be imported exactly once, or the
 * console overrides double-wrap": `console.error = (...args) => { orig(...);
 * appendSessionLog(...) }` closes over whatever `console.error` already was.
 * Re-running that assignment wraps the PREVIOUS wrapper, so every error would
 * get logged twice, then four times, then eight.
 *
 * ES module resolution already makes a second `import "./session-log.js"`
 * from anywhere in the SAME module graph a no-op — Node (and every bundler
 * MUGA ships through) evaluates a module once per resolved specifier and
 * caches the result, so `service-worker.js` importing this file twice, or two
 * files both importing it, cannot by itself cause a double-wrap.
 *
 * The residual risk is a SEPARATE module registry re-evaluating this file
 * against the SAME process-wide `console` — a test harness that resets its
 * module cache between files without restarting the process, for instance.
 * That is not hypothetical enough to leave unguarded, so the install below is
 * idempotent by construction: it marks the function it installs with
 * `INSTALL_MARKER` and skips re-wrapping when that marker is already present
 * on the current `console.error` / `console.warn`. A second evaluation of
 * this module is therefore a no-op, not a double-wrap, regardless of why it
 * happened. `tests/unit/session-log.test.mjs` asserts this directly by
 * importing the module twice (via a cache-busting specifier) and checking the
 * wrap depth stays at one.
 */

import { sessionStorage } from "../lib/storage.js";

// --- Session log (actions + errors, exported via debug log) ---
const SESSION_LOG_MAX = 2000;

export function appendSessionLog(level, args) {
  const entry = { ts: Date.now(), level, msg: args.map(a => {
    try { return typeof a === "object" ? JSON.stringify(a) : String(a); } catch { return "[unserializable]"; }
  }).join(" ") };
  sessionStorage.get({ debugLog: [] }).then(data => {
    const log = [entry, ...data.debugLog].slice(0, SESSION_LOG_MAX);
    sessionStorage.set({ debugLog: log }).catch(() => { /* best-effort debug log */ });
  }).catch(() => { /* session storage may be unavailable */ });
}

/** Log a MUGA action as a structured object for rich debug output. */
export function logAction(action, detail) {
  if (typeof detail === "object") {
    appendSessionLog("action", [`[${action}]`, JSON.stringify(detail)]);
  } else {
    appendSessionLog("action", [`[${action}]`, detail]);
  }
}

// Marker used to detect an already-installed override — see module docblock.
const INSTALL_MARKER = Symbol.for("muga.sessionLog.consoleOverrideInstalled");

if (!console.error[INSTALL_MARKER]) {
  const _origError = console.error.bind(console);
  const wrappedError = (...args) => { _origError(...args); appendSessionLog("error", args); };
  wrappedError[INSTALL_MARKER] = true;
  console.error = wrappedError;
}

if (!console.warn[INSTALL_MARKER]) {
  const _origWarn = console.warn.bind(console);
  const wrappedWarn = (...args) => { _origWarn(...args); appendSessionLog("warn", args); };
  wrappedWarn[INSTALL_MARKER] = true;
  console.warn = wrappedWarn;
}
