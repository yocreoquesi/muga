/**
 * ESLint flat config (#823).
 *
 * Layer 2 of the static-analysis ratchet. Starts lean — only 5 rules
 * that catch real bugs and bad idioms without being noisy:
 *   no-undef              — catches missing imports / typos
 *   no-unused-vars        — catches dead code (args prefixed _ are ok)
 *   eqeqeq               — no accidental == coercions
 *   no-implicit-globals   — no accidental global leaks in scripts
 *   no-var                — enforces const/let discipline
 *
 * Scope: src/ + tools/ + tests/ (excludes node_modules, dist, landing,
 * landing-worker, and generated artifacts via the top-level ignores).
 *
 * The existing web-ext lint script ("lint") is unchanged; this adds
 * "lint:js" as a separate fast JS-only gate.
 */

import globals from "globals";

/** Shared rules applied to every config block. */
const RULES = {
  "no-undef": "error",
  "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "all", caughtErrorsIgnorePattern: "^_" }],
  "eqeqeq": ["error", "always", { null: "ignore" }],
  "no-implicit-globals": "error",
  "no-var": "error",
};

export default [
  // ── Global ignores ────────────────────────────────────────────────────────
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "landing/**",
      "landing-worker/**",
      "tmp/**",
      "test-results/**",
      // Generated content bundle — linting source is already covered
      "src/content/cleaner-bundle.js",
      // Vendored minified file
      "src/lib/browser-polyfill.min.js",
    ],
  },

  // ── src/lib — browser extension library ──────────────────────────────────
  // Most lib files are pure browser ESM. remote-rules.js and i18n.js are
  // isomorphic (also run in Node for tests) — they defensively check
  // `typeof process !== "undefined"`. Declare both browser and Node globals
  // here so no-undef does not trigger on either context.
  {
    files: ["src/lib/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        // Pragmatic WebExtensions globals — avoids pulling in @types/chrome
        chrome: "readonly",
        browser: "readonly",
      },
    },
    rules: RULES,
  },

  // ── src/background, src/content, src/popup, src/options, src/onboarding ──
  // Pure browser extension JS: needs chrome + browser + DOM globals.
  {
    files: [
      "src/background/**/*.js",
      "src/content/**/*.js",
      "src/popup/**/*.js",
      "src/options/**/*.js",
      "src/onboarding/**/*.js",
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        chrome: "readonly",
        browser: "readonly",
      },
    },
    rules: RULES,
  },

  // ── src/content/cleaner-bundle-src.mjs — bundler entry source ─────────────
  // ESM entry for the content-script bundle (see tools/bundle-content.mjs).
  // __MUGA_VERSION__ is an esbuild `define` substitution (web-cleaner-tool
  // #1029), not a real identifier — declare it as a global so no-undef
  // does not flag it.
  {
    files: ["src/content/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        chrome: "readonly",
        browser: "readonly",
        __MUGA_VERSION__: "readonly",
      },
    },
    rules: RULES,
  },

  // ── tools/ — Node.js build and ingestion scripts ───────────────────────────
  {
    files: ["tools/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        // screenshots/capture.mjs evaluates JS inside a browser page via
        // Playwright, so it uses browser globals (document, chrome) inside
        // page.evaluate() calls. Declare them to avoid false no-undef.
        chrome: "readonly",
        document: "readonly",
      },
    },
    rules: RULES,
  },

  // ── tests/unit — Node.js test runner ──────────────────────────────────────
  {
    files: ["tests/unit/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        // Node built-in test runner exposes describe/test etc. as globals
        describe: "readonly",
        test: "readonly",
        it: "readonly",
        before: "readonly",
        after: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        // Some unit tests mock the chrome API
        chrome: "readonly",
        window: "readonly",
        document: "readonly",
        location: "readonly",
      },
    },
    rules: RULES,
  },

  // ── tests/e2e — Playwright tests ──────────────────────────────────────────
  // Playwright tests run in Node but evaluate callbacks in the browser. The
  // chrome object inside page.evaluate() is a browser global; declare it to
  // avoid no-undef. Playwright's test/expect come from explicit imports.
  {
    files: ["tests/e2e/**/*.mjs", "tests/e2e/**/*.spec.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        // Browser/SW globals evaluated inside page.evaluate() / sw.evaluate()
        chrome: "readonly",
        window: "readonly",
        document: "readonly",
        location: "readonly",
        self: "readonly",  // ServiceWorkerGlobalScope in sw.evaluate() callbacks
      },
    },
    rules: RULES,
  },

  // ── tests/integration — Node.js integration tests ─────────────────────────
  {
    files: ["tests/integration/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        describe: "readonly",
        test: "readonly",
        before: "readonly",
        after: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
      },
    },
    rules: RULES,
  },
];
