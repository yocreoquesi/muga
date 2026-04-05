# MUGA Code Review Rules

> Gentleman Guardian Angel reviews every commit against these rules.
> Fail the review if any rule is violated. Warn on style inconsistencies.

---

## Architecture

- **Vanilla JS only** — no frameworks, no TypeScript, no build step. ES2022 target.
- **ES modules** for `src/lib/` and UI files. **IIFEs** for content scripts (MV3 content scripts cannot use ES module imports).
- **Named exports only** — no default exports anywhere.
- Content scripts communicate with the service worker exclusively via `chrome.runtime.sendMessage`. They never import from `src/lib/` directly.
- `browser-polyfill.min.js` is the only third-party runtime dependency.

## Security (CRITICAL — block on any violation)

- **No `innerHTML` with dynamic or user-controlled data.** Allowed uses: `container.innerHTML = ""` (reset), trusted SVG/HTML literals, and `sanitizeHTML()` output for keys in the `HTML_KEYS` allowlist.
- **Always `textContent`** for user-facing strings, translated text, and any value derived from URLs, storage, or message passing.
- **No `eval`, `new Function`, `setTimeout` with string argument, or inline event handlers.**
- **Validate sender on every `onMessage` handler:** `if (sender.id !== chrome.runtime.id) return false;`
- **Wrap every `new URL()` in try/catch.** Malformed URLs are no-ops, never thrown.
- **Protocol validation on redirect destinations:** only `http:` and `https:` are allowed.
- **URL length cap:** redirect destinations must be ≤ 2000 characters.
- **Input validation before storage:** all list entries validated by `isValidListEntry()`. Custom params validated with `/^[a-zA-Z0-9_.-]+$/`.
- **No secrets in source.** Affiliate IDs are public by design (they appear in URLs), but API keys, tokens, and credentials must never appear.

## Naming

| What | Convention | Example |
|------|-----------|---------|
| Functions | `camelCase`, verb-first | `processUrl`, `stripTrackingParams` |
| Module-private vars | `_camelCase` | `_pendingStats`, `_toastTimer` |
| Exported constants | `SCREAMING_SNAKE_CASE` | `TRACKING_PARAMS`, `PREF_DEFAULTS` |
| Internal constants | `SCREAMING_SNAKE_CASE` | `TRACKING_PREFIXES`, `AUTH_PATH_RE` |
| Files | `kebab-case` | `service-worker.js`, `redirect-unwrap.js` |
| DOM IDs | `kebab-case` | `enabled-toggle`, `stat-urls` |
| CSS classes | `kebab-case` | `.store-chip`, `.consent-gate` |
| Message types | `SCREAMING_SNAKE_CASE` strings | `"PROCESS_URL"`, `"ADD_TO_WHITELIST"` |
| Test files | `<module>.test.mjs` | `cleaner.test.mjs` |

## Error Handling

- Chrome storage calls: wrap in `try/catch`, log with `console.error("[MUGA] <context>:", err)`, return a safe default.
- Fire-and-forget calls: `.catch(() => {})` is acceptable ONLY with a comment explaining why: `catch { /* channel closed */ }`.
- Empty catches without a comment are forbidden.
- `void chrome.runtime.lastError;` immediately inside every callback-based Chrome API call that does not inspect the error.
- Service worker message handlers must always call `sendResponse` — even on error — to avoid leaving the channel open.
- URL parse failures (`new URL()`) return `null` or `continue` — never rethrow.

## Chrome Extension Patterns

- **Feature-detect before every Chrome API call:** `const hasDNR = typeof chrome.declarativeNetRequest !== "undefined"`. Never assume an API exists.
- **`return true`** from async `onMessage` handlers to keep the channel open.
- **Storage separation:** `chrome.storage.sync` for prefs (cross-device), `chrome.storage.local` for stats (device-specific), `chrome.storage.session` (with Map fallback) for ephemeral data.
- **Prefs caching:** module-level cache invalidated on `chrome.storage.onChanged`. Never read storage in a hot path without cache.
- **Disabled state guards:** every user-facing feature must check `prefs.enabled && prefs.onboardingDone` before acting. This includes: URL processing, click interception, context menus, DNR rules, badge updates, toast notifications.
- **Non-HTTP scheme guard:** reject `chrome://`, `about:`, `data:`, `blob:` URLs before processing.

## DOM & UI

- Build DOM with `createElement` + `textContent` + `appendChild`. Never construct HTML strings for dynamic content.
- Event listeners via `addEventListener` only — no inline handlers, no `.onclick` assignment.
- `dataset` attributes for button/element metadata: `btn.dataset.choice`, `btn.dataset.list`.
- `focus()` on dynamically inserted interactive elements (modals, toasts, dialogs).
- Return focus to previous element on close when applicable.
- All `target="_blank"` links must have `rel="noopener noreferrer"`.

## Accessibility

- `aria-label` on every toggle, icon button, and non-text interactive element.
- `aria-expanded` on collapsible/toggle controls.
- `role="alertdialog"` on consent gates and confirm dialogs. `role="alert"` + `aria-live="assertive"` on toasts.
- `:focus-visible` outline (`2px solid var(--accent)`, `outline-offset: 2px`) on every interactive element. Never `:focus` alone.
- `.sr-only` class for visually hidden screen-reader text.
- `tabindex="0"` on non-interactive elements made keyboard-accessible.

## CSS

- CSS custom properties in `:root`: `--bg`, `--bg2`, `--border`, `--text`, `--text2`, `--accent`.
- Dark mode via `@media (prefers-color-scheme: dark)` — redefine variables only, no duplicate rules.
- System font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`.
- Global reset: `* { box-sizing: border-box; margin: 0; padding: 0; }`.
- Border radius: `10px` cards, `8px` buttons/dialogs, `6px` small elements, `3px` inline code.
- Transitions: `0.2s` for color/background, `0.15s` for opacity.

## HTML

- `data-i18n="key"` for all user-visible text. English fallback directly in the HTML.
- `hidden` attribute for initially hidden sections (toggled via JS, not CSS classes).
- Scripts at end of `<body>`: polyfill as `<script src>`, then page JS as `<script type="module" src>`.
- No inline styles in HTML. Content scripts set styles via `element.style.cssText` in JS. Preview replicas in options/popup pages that mirror content-script UI may also use `style.cssText` to stay in sync with the injected styles.

## i18n

- All user-visible strings go through `TRANSLATIONS` in `i18n.js`. Both `en` and `es` required for every key.
- Brand names (`MUGA`, `Fair to every click.`) may remain in English in both languages.
- Spanish must use correct grammar: proper gender agreement, `¡` opening exclamation, no unnecessary English loanwords when a Spanish equivalent exists.
- HTML in translations is only allowed for keys listed in the `HTML_KEYS` set, and only rendered via `sanitizeHTML()`.

## Comments & Documentation

- File-level `/** MUGA: <description> */` docblock on every file.
- JSDoc (`@param`, `@returns`) on all exported functions. Prose comments on internal functions.
- Section dividers: `// ── Section Name ─────────────────`.
- Issue references: `(#NNN)` in comments referencing GitHub issues.
- TODOs: `// TODO(CODE): description (#issue)`.
- WHY over WHAT: comments explain decisions and tradeoffs, not what the code obviously does.

## Testing

- Node.js built-in `node:test` + `node:assert/strict`. No third-party test frameworks.
- `describe()` for groups, `test()` or `it()` for assertions.
- `before()`/`after()` hooks for setup/teardown of shared state. Always restore original state.
- Content script logic tested via replicated functions with `// Keep in sync with <source>` comments.
- C11 sync tests verify replicas match source (constant values, regex patterns).
- Structural tests via `readFileSync` for modules that cannot be imported in Node.
- Every `processUrl` test must assert the specific `action`, `removedTracking` array, and `cleanUrl` — not just one of these.

## Business Rules (CRITICAL — block on violation)

- **Scenario A** (tracking strip): always active, no user consent needed.
- **Scenario B** (affiliate injection): only when `injectOwnAffiliate` is on AND no existing affiliate tag AND not a copy operation.
- **Scenario C** (foreign affiliate detection): default action is KEEP ORIGINAL. Auto-dismiss defaults to `"original"`. Never silently replace.
- **Scenario D** (blacklist): strip everything, no injection, no notification.
- **Whitelist entries are sacred:** whitelisted affiliates are never touched, never overridden.
- DNR rules must NOT strip params that `domain-rules.json` marks as `preserveParams`. Conflicting params must be handled by the content script only.

## Git & Workflow

- Conventional commits: `feat:`, `fix:`, `chore:`, `test:`, `docs:`.
- Never commit directly to `main`. Always: issue → branch → PR → squash merge.
- No `Co-Authored-By` or AI attribution in commits.
- All code comments and commit messages in English.
- Version must be consistent across `package.json`, `manifest.json`, `manifest.v2.json`.
