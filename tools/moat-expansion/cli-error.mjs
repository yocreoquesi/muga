/**
 * MUGA — moat-expansion shared CliError (#793).
 *
 * Tiny shared error class for the moat-expansion tool suite.
 * Mirrors the CliError pattern from tools/rule-ingestion/orchestrate-cli.mjs
 * but is scoped to moat-expansion only — NOT imported cross-tool.
 *
 * Exit code contract:
 *   0 — success
 *   1 — validation / bad-JSON / unexpected shape
 *   2 — fetch / network failure
 *   3 — I/O error (write failure)
 *
 * Public API (named export only — no default):
 *   CliError
 */

/**
 * Structured error for moat-expansion CLI exit-code propagation.
 *
 * @example
 *   throw new CliError("fetch failed: network unreachable", 2);
 */
export class CliError extends Error {
  /**
   * @param {string} message Human-readable error message.
   * @param {number} exitCode Process exit code (1=validation, 2=fetch, 3=I/O).
   */
  constructor(message, exitCode) {
    super(message);
    this.name = "CliError";
    /** @type {number} */
    this.exitCode = exitCode;
  }
}
