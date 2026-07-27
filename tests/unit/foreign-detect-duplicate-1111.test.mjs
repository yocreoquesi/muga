/**
 * MUGA — Regression test for #1111 part 3 (audit-2026-07 follow-up).
 *
 * Both foreign-affiliate DETECTION points decided from `get()` — the FIRST
 * occurrence of the param — while a duplicated tag can carry our own (or a
 * whitelisted) value first and a genuine foreign creator value second
 * (?tag=ours&tag=foreign). get() returned "ours", the code `continue`d, and the
 * foreign duplicate was never surfaced:
 *
 *   - handleAffiliatePipeline Step 3 → no `detected_foreign` notification.
 *   - detectPreservedAffiliate → preservedAffiliate = null (popup shows nothing,
 *     attribution ledger records nothing) even though a foreign tag IS kept.
 *
 * Both now scan every occurrence and report the first non-empty,
 * non-whitelisted value. No data loss either way (nothing is stripped) —
 * this widens detection only.
 *
 * drop-affiliate-injection (PR 1a): the "our own injected tag" exemption
 * that used to be skipped during this scan is REMOVED — OUR_TAGS no longer
 * exists, so "muga0b-21" (the value formerly known as MUGA's own Amazon.es
 * tag) is no longer special. It is now just an ordinary tag value like any
 * other; several assertions below were updated to reflect that a duplicate
 * whose FIRST occurrence is this value is reported as-is (no skip).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { processUrl } from "../../src/lib/cleaner.js";

const BASE = {
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  stripAllAffiliates: false,
  whitelist: [],
  blacklist: [],
};

describe("#1111 pt.3 — foreign detection scans every occurrence, not just the first", () => {
  test("notify path: with no more 'our own tag' exemption, the FIRST duplicate occurrence is reported", () => {
    // Pre-PR-1a "muga0b-21" was skipped as MUGA's own injected tag, so
    // "creator-99" (the second occurrence) was reported instead. OUR_TAGS is
    // now removed — there is nothing left to skip, so the first non-empty
    // value is reported, same as any other duplicate-tag scenario.
    const raw = "https://amazon.es/dp/X?tag=muga0b-21&tag=creator-99";
    const r = processUrl(raw, { ...BASE, notifyForeignAffiliate: true }, []);
    assert.equal(r.action, "detected_foreign", "a duplicate tag must be detected");
    assert.equal(r.detectedAffiliate?.value, "muga0b-21", "the first non-empty, non-whitelisted value is reported");
  });

  test("notify path: a foreign tag behind a WHITELISTED duplicate is still detected", () => {
    const raw = "https://amazon.es/dp/X?tag=mine-21&tag=creator-99";
    const r = processUrl(raw, { ...BASE, notifyForeignAffiliate: true, whitelist: ["amazon.es::tag::mine-21"] }, []);
    assert.equal(r.detectedAffiliate?.value, "creator-99", "the non-whitelisted foreign duplicate must be detected");
  });

  test("preservedAffiliate: with no more 'our own tag' exemption, the FIRST duplicate occurrence is preserved/reported", () => {
    const raw = "https://amazon.es/dp/X?tag=muga0b-21&tag=creator-99";
    const r = processUrl(raw, { ...BASE }, []);
    assert.equal(r.preservedAffiliate?.value, "muga0b-21", "the first non-empty value is reported as the preserved affiliate");
  });

  test("control: a single foreign tag is still detected (unchanged)", () => {
    const raw = "https://amazon.es/dp/X?tag=creator-99";
    const r = processUrl(raw, { ...BASE, notifyForeignAffiliate: true }, []);
    assert.equal(r.detectedAffiliate?.value, "creator-99");
  });

  test("a foreign tag behind an EMPTY first occurrence is detected (old get() returned '' and missed it)", () => {
    const raw = "https://amazon.es/dp/X?tag=&tag=creator-99";
    const r = processUrl(raw, { ...BASE, notifyForeignAffiliate: true }, []);
    assert.equal(r.detectedAffiliate?.value, "creator-99", "an empty first occurrence must not mask a foreign second value");
    assert.equal(r.preservedAffiliate?.value, "creator-99", "same for the preserved-affiliate signal");
  });

  test("control: a lone tag value (formerly 'our own tag') IS now flagged as foreign (no more exemption)", () => {
    // drop-affiliate-injection (PR 1a): "muga0b-21" is no longer MUGA's own
    // tag — there is no OUR_TAGS entry to compare against anymore, so a
    // single occurrence of this value is just an ordinary third-party tag.
    const raw = "https://amazon.es/dp/X?tag=muga0b-21";
    const r = processUrl(raw, { ...BASE, notifyForeignAffiliate: true }, []);
    assert.equal(r.action, "detected_foreign", "any present tag value is now a third-party/creator referral");
    assert.equal(r.preservedAffiliate?.value, "muga0b-21", "detectPreservedAffiliate no longer exempts this value either");
  });
});
