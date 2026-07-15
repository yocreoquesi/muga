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
 * Both now scan every occurrence and report the first genuinely-foreign value.
 * No data loss either way (nothing is stripped) — this widens detection only.
 * MUGA's own Amazon.es tag is `muga0b-21`.
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
  test("notify path: a foreign tag behind OUR own duplicate raises detected_foreign", () => {
    const raw = "https://amazon.es/dp/X?tag=muga0b-21&tag=creator-99";
    const r = processUrl(raw, { ...BASE, notifyForeignAffiliate: true }, []);
    assert.equal(r.action, "detected_foreign", "a foreign duplicate behind our tag must be detected");
    assert.equal(r.detectedAffiliate?.value, "creator-99", "the foreign value, not our own, must be reported");
  });

  test("notify path: a foreign tag behind a WHITELISTED duplicate is still detected", () => {
    const raw = "https://amazon.es/dp/X?tag=mine-21&tag=creator-99";
    const r = processUrl(raw, { ...BASE, notifyForeignAffiliate: true, whitelist: ["amazon.es::tag::mine-21"] }, []);
    assert.equal(r.detectedAffiliate?.value, "creator-99", "the non-whitelisted foreign duplicate must be detected");
  });

  test("preservedAffiliate: a foreign tag behind our own duplicate is reported", () => {
    const raw = "https://amazon.es/dp/X?tag=muga0b-21&tag=creator-99";
    const r = processUrl(raw, { ...BASE }, []);
    assert.equal(r.preservedAffiliate?.value, "creator-99", "a preserved foreign tag must not be masked by our own first occurrence");
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

  test("control: only our own tag → nothing detected or preserved (unchanged)", () => {
    const raw = "https://amazon.es/dp/X?tag=muga0b-21";
    const r = processUrl(raw, { ...BASE, notifyForeignAffiliate: true }, []);
    assert.notEqual(r.action, "detected_foreign", "our own tag alone must never read as foreign");
    assert.equal(r.preservedAffiliate, null, "our own tag alone is not a preserved foreign affiliate");
  });
});
