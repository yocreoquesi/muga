/**
 * MUGA: Identity competitor adapter — TEST FIXTURE ONLY.
 *
 * Returns the input URL unchanged. Used by the benchmark unit tests to
 * exercise the adapter integration shape end-to-end without pretending
 * to represent any real cleaning tool. The benchmark runner does NOT
 * load this adapter; it lives only here for tests.
 *
 * If you want to add a REAL competitor, ship a separate adapter under
 * this directory and wire it into runner.mjs's competitor list. See
 * README-CONTRACT.txt.
 */

export const identityAdapter = {
  name: "identity",
  label: "Identity (no-op test fixture)",
  source: "n/a — internal test fixture",
  version: "0",
  clean(rawUrl) {
    return rawUrl;
  },
};
