#!/usr/bin/env node
// Parse a Chrome Web Store API response and decide success / noop / failure.
//
// CWS returns HTTP 200 with an `itemError` array in the body when it rejects
// an upload — checking only the HTTP status silently masks failures. v1.13.4
// through v1.16.0 all silently failed this way (issue #616).
//
// Decision precedence:
//   1. body.itemError present → noop (only if ITEM_NOT_UPDATABLE WITH a
//      confirming "same/identical/already" detail) or failure.
//   2. httpCode >= 400 → failure.
//   3. otherwise → success.
//
// ITEM_NOT_UPDATABLE alone is NOT enough to declare noop: it can also mean
// the item is in an invalid state from a previous failed upload. Requiring a
// detail string with "same" / "identical" / "already" prevents the regex from
// collapsing real failures into the re-run-of-existing-tag path.
//
// CLI usage:
//   node scripts/cws-check-response.mjs <http_code> <body>
// Prints `result=<success|noop|failure>` on stdout, GitHub Actions
// `::error::` / `::notice::` on stderr. Exits 1 on failure, 0 otherwise.

// CWS phrases for "this version is already in the store" vary:
//   - "Cannot update with the same version"        → matches "same"
//   - "Uploaded package is identical to ..."        → matches "identical"
//   - "This version has already been uploaded."     → "already been uploaded"
//   - "Version was already used."                   → "already used"
// The `(been |is |was )?` slot keeps the verb adjacent to "already" so that
// "Item is already being processed" stays a failure (no uploaded/published/
// exists/used follows "already").
const NOOP_DETAIL_REGEX =
  /same|identical|already (been |is |was )?(uploaded|published|exists|used)/i;

export function checkResponse(httpCode, body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }

  const itemError =
    parsed && Array.isArray(parsed.itemError) ? parsed.itemError : null;

  if (itemError && itemError.length > 0) {
    const errs = itemError.map((e) => ({
      code: e.error_code || "UNKNOWN",
      detail: Array.isArray(e.error_detail)
        ? e.error_detail.join(" ")
        : e.error_detail || "",
    }));

    const allNoop = errs.every(
      (e) =>
        e.code === "ITEM_NOT_UPDATABLE" && NOOP_DETAIL_REGEX.test(e.detail)
    );

    if (allNoop) {
      return {
        result: "noop",
        message:
          "CWS reports this version was already uploaded — treating as no-op",
      };
    }

    const summary = errs
      .map((e) => `${e.code}: ${e.detail || "(no detail)"}`)
      .join(" | ");
    return {
      result: "failure",
      message: `CWS rejected — ${summary}`,
    };
  }

  if (httpCode >= 400) {
    return {
      result: "failure",
      message: `CWS request failed with HTTP ${httpCode}`,
    };
  }

  return { result: "success", message: "" };
}

const invokedAsCli =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("cws-check-response.mjs");

if (invokedAsCli) {
  const httpCode = parseInt(process.argv[2], 10);
  const body = process.argv[3] || "";
  const { result, message } = checkResponse(httpCode, body);

  console.log(`result=${result}`);
  if (message) {
    const annotation = result === "failure" ? "::error::" : "::notice::";
    console.error(`${annotation}${message}`);
  }
  process.exit(result === "failure" ? 1 : 0);
}
