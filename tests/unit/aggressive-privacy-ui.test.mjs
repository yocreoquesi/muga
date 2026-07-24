/**
 * MUGA — referer-beacon-privacy PR 4: pure decision logic for the Options
 * page's "Aggressive privacy" UI (nudge reveal + one-time migration notice).
 *
 * Extracted to pure functions (Extract-Before-Mock) so the DOM/storage glue
 * in options.js stays a thin applicator with zero branching logic of its own.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldRevealAffiliateNudge,
  shouldShowBlocklistMigrationNotice,
  shouldHideMigrationNoticeOnStorageChange,
} from "../../src/lib/aggressive-privacy-ui.js";

test("shouldRevealAffiliateNudge: reveals on transition from unchecked to checked", () => {
  assert.equal(
    shouldRevealAffiliateNudge({ wasChecked: false, isChecked: true, dismissed: false }),
    true,
  );
});

test("shouldRevealAffiliateNudge: does NOT reveal when already checked at load (no transition)", () => {
  assert.equal(
    shouldRevealAffiliateNudge({ wasChecked: true, isChecked: true, dismissed: false }),
    false,
  );
});

test("shouldRevealAffiliateNudge: does NOT reveal when dismissed", () => {
  assert.equal(
    shouldRevealAffiliateNudge({ wasChecked: false, isChecked: true, dismissed: true }),
    false,
  );
});

test("shouldRevealAffiliateNudge: does NOT reveal when unchecking (not a checked transition)", () => {
  assert.equal(
    shouldRevealAffiliateNudge({ wasChecked: true, isChecked: false, dismissed: false }),
    false,
  );
});

test("shouldShowBlocklistMigrationNotice: shows for a non-empty blocklist, not yet shown", () => {
  assert.equal(
    shouldShowBlocklistMigrationNotice({ blacklist: ["example.com"], alreadyShown: false }),
    true,
  );
});

test("shouldShowBlocklistMigrationNotice: does NOT show for an empty blocklist", () => {
  assert.equal(
    shouldShowBlocklistMigrationNotice({ blacklist: [], alreadyShown: false }),
    false,
  );
});

test("shouldShowBlocklistMigrationNotice: does NOT show when already shown", () => {
  assert.equal(
    shouldShowBlocklistMigrationNotice({ blacklist: ["example.com"], alreadyShown: true }),
    false,
  );
});

test("shouldShowBlocklistMigrationNotice: fail-safe false on malformed/absent blacklist", () => {
  assert.equal(
    shouldShowBlocklistMigrationNotice({ blacklist: undefined, alreadyShown: false }),
    false,
  );
});

// TOCTOU follow-up: two Options tabs opened at the same time can both read
// referrerBeaconNoticeShown:false before either tab's write lands, so both
// would otherwise keep showing the notice. A chrome.storage.onChanged
// listener hides it in any tab where it is still visible once the flag
// flips to true (from another tab/context).
test("shouldHideMigrationNoticeOnStorageChange: hides when the flag flips to true in local storage while visible", () => {
  assert.equal(
    shouldHideMigrationNoticeOnStorageChange({
      area: "local",
      change: { oldValue: false, newValue: true },
      noticeVisible: true,
    }),
    true,
  );
});

test("shouldHideMigrationNoticeOnStorageChange: does NOT hide when the notice is not currently visible", () => {
  assert.equal(
    shouldHideMigrationNoticeOnStorageChange({
      area: "local",
      change: { oldValue: false, newValue: true },
      noticeVisible: false,
    }),
    false,
  );
});

test("shouldHideMigrationNoticeOnStorageChange: does NOT hide for an unrelated storage area", () => {
  assert.equal(
    shouldHideMigrationNoticeOnStorageChange({
      area: "sync",
      change: { oldValue: false, newValue: true },
      noticeVisible: true,
    }),
    false,
  );
});

test("shouldHideMigrationNoticeOnStorageChange: does NOT hide when the changed key is unrelated (no change object)", () => {
  assert.equal(
    shouldHideMigrationNoticeOnStorageChange({
      area: "local",
      change: undefined,
      noticeVisible: true,
    }),
    false,
  );
});

test("shouldHideMigrationNoticeOnStorageChange: does NOT hide when the flag flips back to false", () => {
  assert.equal(
    shouldHideMigrationNoticeOnStorageChange({
      area: "local",
      change: { oldValue: true, newValue: false },
      noticeVisible: true,
    }),
    false,
  );
});
