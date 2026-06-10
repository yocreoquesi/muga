/**
 * Pragmatic global declarations for the browser-extension environment.
 * Avoids pulling in @types/chrome (deep dependency) for the first static-
 * analysis pass (#823). Real typed shims can replace these in a follow-up.
 */

/* eslint-disable no-var */
declare var chrome: any;
declare var browser: any;
