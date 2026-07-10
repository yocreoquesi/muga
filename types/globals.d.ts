/**
 * Pragmatic global declarations for the browser-extension environment.
 * Avoids pulling in @types/chrome (deep dependency) for the first static-
 * analysis pass (#823). Real typed shims can replace these in a follow-up.
 */

/* eslint-disable no-var */
declare var chrome: any;
declare var browser: any;

/**
 * esbuild `define` substitution for the content-script bundle (web-cleaner-
 * tool #1029, tools/bundle-content.mjs). Not a real runtime identifier —
 * declared here so typecheck stays green if src/content/**\/*.mjs is ever
 * added to jsconfig.json's `include`.
 */
declare var __MUGA_VERSION__: string;
