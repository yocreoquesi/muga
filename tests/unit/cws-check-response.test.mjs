/**
 * MUGA — CWS upload response parser regression tests (issue #616)
 *
 * v1.13.4 through v1.16.0 all silently failed the Chrome Web Store upload
 * because the workflow only checked HTTP status. CWS returns HTTP 200 with
 * `itemError` in the body when it rejects an upload — this parser is the
 * gate that prevents that silent-failure mode from reappearing.
 *
 * Fixtures here are real response shapes observed in the v1.13.4..v1.16.0
 * release runs (PKG_INVALID_ZIP, ITEM_NOT_UPDATABLE) plus the success and
 * noop paths that legitimate re-runs of an existing tag need.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkResponse } from "../../scripts/cws-check-response.mjs";

describe("checkResponse — success path", () => {
  test("HTTP 200 with no itemError → success", () => {
    const body = JSON.stringify({
      kind: "chromewebstore#item",
      id: "abc123",
      uploadState: "SUCCESS",
    });
    const r = checkResponse(200, body);
    assert.equal(r.result, "success");
  });

  test("HTTP 200 with empty body → success", () => {
    const r = checkResponse(200, "");
    assert.equal(r.result, "success");
  });

  test("HTTP 200 with non-JSON body → success (no itemError detected)", () => {
    const r = checkResponse(200, "not even json");
    assert.equal(r.result, "success");
  });

  test("HTTP 200 with itemError as empty array → success", () => {
    const r = checkResponse(200, JSON.stringify({ itemError: [] }));
    assert.equal(r.result, "success");
  });
});

describe("checkResponse — failure path (itemError in body, HTTP 200)", () => {
  test("PKG_INVALID_ZIP → failure (the v1.13.4..v1.16.0 silent-failure case)", () => {
    const body = JSON.stringify({
      itemError: [
        {
          error_code: "PKG_INVALID_ZIP",
          error_detail: "The package zip is invalid",
        },
      ],
    });
    const r = checkResponse(200, body);
    assert.equal(r.result, "failure");
    assert.match(r.message, /PKG_INVALID_ZIP/);
  });

  test("ITEM_NOT_UPDATABLE WITHOUT confirming detail → failure (not noop)", () => {
    // This is the trap the old regex fell into: ITEM_NOT_UPDATABLE alone was
    // treated as "version already uploaded — noop" but it can also mean the
    // item is in an invalid state from a previous failed upload (v1.16.0 run 3).
    const body = JSON.stringify({
      itemError: [
        {
          error_code: "ITEM_NOT_UPDATABLE",
          error_detail: "Item is being processed by another request",
        },
      ],
    });
    const r = checkResponse(200, body);
    assert.equal(r.result, "failure");
    assert.match(r.message, /ITEM_NOT_UPDATABLE/);
  });

  test("unknown error_code → failure", () => {
    const body = JSON.stringify({
      itemError: [
        {
          error_code: "SOMETHING_NEW_FROM_GOOGLE",
          error_detail: "Unknown failure mode",
        },
      ],
    });
    const r = checkResponse(200, body);
    assert.equal(r.result, "failure");
  });

  test("error_detail as array of strings is joined for the failure message", () => {
    const body = JSON.stringify({
      itemError: [
        {
          error_code: "PKG_INVALID_ZIP",
          error_detail: ["line one of the error", "line two of the error"],
        },
      ],
    });
    const r = checkResponse(200, body);
    assert.equal(r.result, "failure");
    assert.match(r.message, /line one/);
    assert.match(r.message, /line two/);
  });

  test("missing error_detail still produces a readable failure message", () => {
    const body = JSON.stringify({
      itemError: [{ error_code: "PKG_INVALID_ZIP" }],
    });
    const r = checkResponse(200, body);
    assert.equal(r.result, "failure");
    assert.match(r.message, /PKG_INVALID_ZIP/);
  });

  test("multiple itemError entries — any non-noop entry forces failure", () => {
    const body = JSON.stringify({
      itemError: [
        {
          error_code: "ITEM_NOT_UPDATABLE",
          error_detail: "Cannot update with the same version",
        },
        {
          error_code: "PKG_INVALID_ZIP",
          error_detail: "Package zip is invalid",
        },
      ],
    });
    const r = checkResponse(200, body);
    assert.equal(r.result, "failure");
  });
});

describe("checkResponse — noop path (legit re-run of existing tag)", () => {
  test("ITEM_NOT_UPDATABLE + 'same version' detail → noop", () => {
    const body = JSON.stringify({
      itemError: [
        {
          error_code: "ITEM_NOT_UPDATABLE",
          error_detail: "Cannot update with the same version",
        },
      ],
    });
    const r = checkResponse(200, body);
    assert.equal(r.result, "noop");
  });

  test("ITEM_NOT_UPDATABLE + 'already uploaded' detail → noop", () => {
    const body = JSON.stringify({
      itemError: [
        {
          error_code: "ITEM_NOT_UPDATABLE",
          error_detail: "This version has already been uploaded.",
        },
      ],
    });
    const r = checkResponse(200, body);
    assert.equal(r.result, "noop");
  });

  test("ITEM_NOT_UPDATABLE + 'identical' detail → noop", () => {
    const body = JSON.stringify({
      itemError: [
        {
          error_code: "ITEM_NOT_UPDATABLE",
          error_detail: "Uploaded package is identical to the previous one.",
        },
      ],
    });
    const r = checkResponse(200, body);
    assert.equal(r.result, "noop");
  });
});

describe("checkResponse — HTTP error path", () => {
  test("HTTP 401 → failure", () => {
    const r = checkResponse(401, "");
    assert.equal(r.result, "failure");
    assert.match(r.message, /HTTP 401/);
  });

  test("HTTP 403 → failure", () => {
    const r = checkResponse(403, "");
    assert.equal(r.result, "failure");
  });

  test("HTTP 500 → failure", () => {
    const r = checkResponse(500, JSON.stringify({ error: "internal" }));
    assert.equal(r.result, "failure");
  });

  test("itemError takes precedence over HTTP status (CWS quirk)", () => {
    // CWS returns 200 with errors in body; but if it ever returned 4xx with
    // itemError, we still want the body-driven decision so the failure message
    // carries the actionable error_code.
    const body = JSON.stringify({
      itemError: [
        { error_code: "PKG_INVALID_ZIP", error_detail: "bad zip" },
      ],
    });
    const r = checkResponse(400, body);
    assert.equal(r.result, "failure");
    assert.match(r.message, /PKG_INVALID_ZIP/);
  });
});
