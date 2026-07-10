/**
 * MUGA — Unit tests for web/report-link.js (sdd/web-cleaning-insight,
 * Slice 1: Report flow).
 *
 * web/report-link.js is a pure module: it builds a prefilled GitHub
 * new-issue URL, opened by the UI as a user-initiated navigation (zero
 * page egress, spec "Report flow" / "Zero-egress promise rescope"). No
 * DOM access, fully unit-testable.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildReportUrl } from "../../web/report-link.js";

describe("buildReportUrl() (spec: Report flow)", () => {
  test("builds a github.com issues/new href containing the cleaned and original URLs", () => {
    const href = buildReportUrl({
      originalUrl: "https://example.com/?utm_source=newsletter",
      cleanUrl: "https://example.com/",
      removed: ["utm_source"],
      unwrapped: false,
      destinationHost: "example.com",
    });
    assert.match(href, /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/new\?/);
    const url = new URL(href);
    assert.ok(url.searchParams.has("title"));
    const body = url.searchParams.get("body");
    assert.ok(body.includes("https://example.com/?utm_source=newsletter"));
    assert.ok(body.includes("https://example.com/"));
  });

  test("truncates the body with a visible marker for extremely long URLs", () => {
    const hugeUrl = `https://example.com/${"a".repeat(8000)}`;
    const href = buildReportUrl({
      originalUrl: hugeUrl,
      cleanUrl: hugeUrl,
      removed: [],
      unwrapped: false,
      destinationHost: "example.com",
    });
    const url = new URL(href);
    const body = url.searchParams.get("body");
    assert.ok(body.length <= 6000, `body must stay within the ~6000-char budget, got ${body.length}`);
    assert.ok(/truncated/i.test(body), "truncated body must contain a visible truncation marker");
  });

  test("includes the destination host in the body when the link was unwrapped", () => {
    const href = buildReportUrl({
      originalUrl: "https://l.facebook.com/l.php?u=https://real-destination.example",
      cleanUrl: "https://real-destination.example/",
      removed: [],
      unwrapped: true,
      destinationHost: "real-destination.example",
    });
    const url = new URL(href);
    const body = url.searchParams.get("body");
    assert.ok(body.includes("real-destination.example"), "body must mention the unwrapped destination host");
  });
});
