/**
 * MUGA — Source-grep ratchet (#824)
 *
 * Enforces the #709 decision: tests should assert BEHAVIOR through public
 * interfaces, not verify that source code contains particular strings.
 * Source-string assertions create zombie code — deleting a function breaks
 * a test, so contributors re-add the zombie "to fix the test."
 *
 * ## How this ratchet works
 *
 * For every test file in tests/unit/ we count occurrences of the heuristic
 * patterns that indicate source-text assertions:
 *
 *   /[A-Za-z]+Source\.(includes|match|indexOf|slice)\(/g
 *
 * This regex catches `swSource.includes(`, `cleanerSource.match(`, etc.
 *
 * #1405 widened it. Counting a name SUFFIX missed every test that reads
 * source into `optionsJs`, `popupHtml`, `body`, ... and asserts with
 * `assert.match(optionsJs, /.../)`: the Settings work for #1350-#1352 added
 * dozens of those and the ratchet counted zero. `countSourceGreps` now also
 * tracks IDENTIFIERS BOUND TO SOURCE TEXT:
 *
 *   - `X = readFileSync(...)` where the argument names a `src/` path, either
 *     as a string literal or through a path constant assigned from one;
 *   - `Y = X.slice(...)` / `Y = extract(X, ...)`, transitively (a function
 *     body cut out of the source is still source text), but never through
 *     `JSON.parse(...)`;
 *
 * and counts, for each bound identifier, `X.(includes|match|indexOf|slice)(`
 * plus `assert.match(X, ...)` / `assert.doesNotMatch(X, ...)`. It is still a
 * heuristic (a helper like `read("src/...")` hides the binding), but it
 * follows the data instead of the spelling. The baseline was re-counted with
 * it rather than grandfathering the old numbers, so the ceilings can now
 * ratchet down from what is really there.
 *
 * ### Ratchet invariants
 *
 *   - A file whose count is BELOW its baseline → OK.
 *   - A file whose count is ABOVE its baseline → FAIL. Counts may only go
 *     DOWN (behavioral migration) not UP (new source-string assertions).
 *   - A NEW file with a nonzero count not in the baseline → FAIL.
 *
 * ### Lowering a baseline
 *
 * When you migrate a source-string assertion to a behavioral test, LOWER
 * the corresponding baseline number here. The baseline is a CEILING, not
 * a target. Seeing slack (actual < baseline) is fine and expected during
 * the migration arc. The "slack guard" test below reminds you to ratchet
 * down once the count is more than 10 below the ceiling (10 gives buffer
 * for in-flight PRs changing the same file without merge conflicts).
 *
 * ### Adding a new source-string assertion
 *
 * Do NOT do this. Prefer a behavioral test. If you genuinely cannot (e.g.
 * the module cannot be imported in Node because it calls chrome.* at the
 * top level, AND the invariant you need to verify has no observable
 * behavioral proxy), then:
 *
 *   1. Add the file with the exact current count to BASELINE (if absent).
 *   2. If the file already exists, increment its count by exactly 1.
 *   3. Add a comment in the baseline entry explaining WHY.
 *   4. Reference #824 in the commit message.
 *
 * ### Exempt files
 *
 * Some test files use source-text analysis as the CORRECT pattern because
 * the SUBJECT UNDER TEST is the source artifact itself (config consistency,
 * duplication guards, workflow structure). They are listed in EXEMPT below
 * with a reason comment and are skipped by the ratchet.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UNIT_DIR = __dirname; // this file lives in tests/unit/

// ── Heuristic pattern ────────────────────────────────────────────────────────
// Matches *Source.includes( / *Source.match( / *Source.indexOf( / *Source.slice(
// where * is one or more identifier characters (e.g. swSource, cleanerSource).
const SOURCE_GREP_PATTERN = /[A-Za-z]+Source\.(includes|match|indexOf|slice)\(/g;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A string literal holding a `src` path segment: "src/x.js", "../../src/x", "src". */
const SRC_PATH_LITERAL = /["'`](?:[^"'`\n]*[/\\])?src(?:[/\\"'`])/;

/**
 * Counts source-text assertions in a test file's text (#824, widened #1405).
 * See the header for what is counted and why.
 *
 * @param {string} text
 * @returns {number}
 */
function countSourceGreps(text) {
  let count = (text.match(SOURCE_GREP_PATTERN) || []).length;

  // Every `const|let|var NAME = <rhs>` with the rhs up to its `;` (bounded).
  const assigns = [];
  const assignRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  for (let m; (m = assignRe.exec(text)); ) {
    const start = m.index + m[0].length;
    const semi = text.indexOf(";", start);
    const end = Math.min(semi === -1 ? text.length : semi + 1, start + 400);
    assigns.push({ name: m[1], rhs: text.slice(start, end) });
  }

  const pathIds = assigns
    .filter((a) => SRC_PATH_LITERAL.test(a.rhs) && !/readFileSync\(/.test(a.rhs))
    .map((a) => new RegExp(`\\b${escapeRe(a.name)}\\b`));
  const namesSrcPath = (args) => SRC_PATH_LITERAL.test(args) || pathIds.some((re) => re.test(args));

  const bound = new Set();
  for (const a of assigns) {
    const m = a.rhs.match(/^readFileSync\(([\s\S]*)/);
    if (m && namesSrcPath(m[1])) bound.add(a.name);
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const a of assigns) {
      if (bound.has(a.name) || /^JSON\.parse\(/.test(a.rhs)) continue;
      const derived = [...bound].some((x) => {
        const e = escapeRe(x);
        return new RegExp(`^${e}\\.(?:slice|substring|substr)\\(`).test(a.rhs) ||
          new RegExp(`^[A-Za-z_$][\\w$]*\\(\\s*${e}\\b`).test(a.rhs);
      });
      if (derived) {
        bound.add(a.name);
        grew = true;
      }
    }
  }

  for (const x of bound) {
    const e = escapeRe(x);
    // `*Source` names are already counted by SOURCE_GREP_PATTERN above.
    if (!/Source$/.test(x)) {
      count += (text.match(new RegExp(`(?<![\\w$.])${e}\\.(?:includes|match|indexOf|slice)\\(`, "g")) || []).length;
    }
    count += (text.match(new RegExp(`\\bassert\\.(?:match|doesNotMatch)\\(\\s*${e}\\b`, "g")) || []).length;
  }
  return count;
}

// ── Exempt files ─────────────────────────────────────────────────────────────
// Files where source-analysis IS the correct pattern — the subject under test
// is the source artifact itself, not a behavioral proxy for it.
const EXEMPT = new Set([
  // Workflow YAML structure guards — analyzing CI config is the point.
  "workflow-hardening.test.mjs",
  "workflows-hardened.test.mjs",
  "ingestion-scheduled-workflow.test.mjs",

  // Security nonce handshake — structural contracts across content-script
  // files that cannot be imported in Node (chrome.* top-level calls).
  "gate-nonce.test.mjs",

  // Bundle/STRIP parity — verifies four content-script files are byte-identical
  // on the hot-path STRIP table; duplication enforcement is the purpose.
  "strip-table-parity.test.mjs",
  "cleaner-bundle-sync.test.mjs",

  // Toast i18n sync — cleaner.js carries an inline copy of toast keys because
  // content scripts cannot import ES modules; sync guard is correct pattern.
  "content-cleaner-toast-sync.test.mjs",

  // Manifest-order checks — verifies key ordering/presence in JSON manifests
  // as a structural contract, not a proxy for behavior.
  "caps-manifest-sync.test.mjs",
  "rules-manifest-sync.test.mjs",

  // Drift guard that reads THIS category of test files to count assertions;
  // meta-analysis of the test suite is inherently source-reading.
  "service-worker-patterns-drift-guard.test.mjs",

  // This file itself — the heuristic regex and its inline examples contain
  // the patterns we are searching for, causing false self-detection.
  "source-grep-ratchet.test.mjs",
]);

// ── Baseline ─────────────────────────────────────────────────────────────────
// Snapshot of source-grep counts as of the #824 PR (2026-06-10).
// Keys are bare filenames (no path). Values are INTEGER ceilings.
//
// Counts may go DOWN (migrate assertions → lower the number).
// A file may only go UP with an explicit baseline bump + rationale.
// A new file appearing with count > 0 and NOT in this map → test fails.
//
// Top offenders targeted for migration in the #824 arc (NOT this PR):
//   service-worker-patterns.test.mjs  76  ← largest; SW not importable in Node
//   misc-regression.test.mjs          29  ← mixed; some migratable
//   content-cleaner-patterns.test.mjs 27  ← content script not importable
//   content-script.test.mjs           19  ← content script not importable
const BASELINE = {
  // Files with SW/content-script source that cannot be imported in Node —
  // migration requires extracting pure functions or an integration harness.
  "service-worker-patterns.test.mjs": 90, // #1405 re-count: 78 -> 90. SW not importable; behavioral migration is long arc (#824). +1 for the FORCE_FETCH_REMOTE_RULES "Update now" handler existence guard (Update now feature) — the (a)/(b)/(c) gate coverage itself is behavioral via a pure forceFetchRemoteRules() mirror, only the "handler exists" check is source-text. Lowered 80 → 77 (cookie-consent removal, Slice A of 6): dropped the cookie-consent-accept Slice 2a modeActive gate-wiring guard and the #1027 Slice 2 PR B1 maybeFetchRemoteTier2Rules wake-schedule wiring guard — both fed subsystems removed in this slice. 77 → 78 (browsewrap Phase 1, implicit-accept-on-install): added ONE swSource.match() extraction pinning recordImplicitAcceptOnInstall's existence + install-only gating + the unconditional welcome-tab open; the fresh/update/existing-user branching is covered behaviorally via a pure onInstalledConsentGate() mirror. 78 → 79 (browsewrap Phase 2, shortener click/hover split): added ONE swSource.match() extraction pinning that the RESOLVE_SHORTENER handler re-checks resolveShortenersOnClick/resolveShortenersOnHover per message.source; the gate logic itself is covered behaviorally via a pure resolveShortenerSourceGate() mirror. 79 → 78 (#1266 item 5 slice 4): maybeFetchRemoteRules and REMOTE_REFRESH_INTERVAL_MS moved to src/background/remote-rules-wake.js, importable in Node, so the "Remote-rules on-wake time-gated fetch" block now imports and drives the REAL function (see tests/unit/remote-rules-wake.test.mjs for the throttle/error-recovery coverage that move unlocked) instead of running against makeMaybeFetchHelper(), a hand-written mirror; the swSource.match() pinning REMOTE_REFRESH_INTERVAL_MS's value is replaced with a real import-and-compare, and the function-existence regex check is redundant with the real import succeeding at all, so it is deleted rather than re-pointed. The onInstalled/onStartup/PROCESS_URL call-site guards and the chrome.alarms regression guard are unchanged — they pin composition-root wiring in service-worker.js, which stays there by design.
  "misc-regression.test.mjs": 40, // #1405 re-count: 29 -> 40. mixed bag; partial migration possible (#824)
  "content-cleaner-patterns.test.mjs": 43, // #1405 re-count: 35 -> 43. content script not importable (#824). +7 for #allowlist-full-inert: ping-blocking, runRedirectUnwrap, and click-interception isSiteFullyExempt guards. +1 (browsewrap Phase 2): a negative guard confirming the retired followShortenersEnabled pref does not remain in cleaner.js after the click/hover split.
  "content-script.test.mjs": 20,            // content script not importable (#824); +1: same-document click-guard mirror (carousel regression)
  "dnr-ids.test.mjs": 8,                    // verifies SW + remote-rules import the ids module (#824)
  "dnr-consent-gate.test.mjs": 12, // #1405 re-count: 8 -> 12. SW not importable; mixed with behavioral tests (#824). +1 for #921 rule-1001 gate guard
  "allowlist-dnr.test.mjs": 3, // #1405 re-count: 1 -> 3. 7 -> 1 (#1266 item 5, #1268): syncAllowlistDNR and applyDnrState moved to src/background/dnr-sync.js, importable in Node, so this file now imports the real functions instead of a mirror; the applyDnrState ordering/gate-closed guards became real behavioral assertions against recorded updateDynamicRules calls. What remains is the storage.onChanged wiring read through swSource.slice() (the composition root in service-worker.js, no behavioral proxy); the #1405 binding-aware count sees it as 3 assertions on that one slice.
  "verify-warnings-regression.test.mjs": 6, // regression guards; some migratable (#824)
  "i18n-orphan.test.mjs": 5,               // reads HTML/JS to find orphaned i18n keys (#824)
  "browser-detect.test.mjs": 14, // #1405 re-count: 4 -> 14. verifies popup/options import the module (#824)
  "popup-reactive-status.test.mjs": 3, // #1405 re-count: 4 -> 3. popup source; mixed behavioral/source (#824)
  "custom-params-dnr.test.mjs": 0,         // 3 -> 0 (#1266 item 5, #1268): syncCustomParamsDNR moved to src/background/dnr-sync.js, importable in Node, so this file now imports the real function directly instead of a mirror, and the source-region guard that used to confirm the empty-normalized-list fix landed in production is redundant with the behavioral tests above it — deleted rather than re-pointed.
  "storage.test.mjs": 14, // #1405 re-count: 2 -> 14. verifies storage structure patterns (#824)
  "url-regex-sync.test.mjs": 3, // #1405 re-count: 2 -> 3. verifies SW + cleaner regex are byte-identical (#824)
  "docs-prefs-table.test.mjs": 1,          // reads storage source to verify docs table (#824)
  "options-write-path-override.test.mjs": 5, // #1405 re-count: 2 -> 5. SW ENABLE/DISABLE_REMOTE_RULES handlers not importable in Node; 2 guards pin the reconcile wiring (#888 write-path follow-up, #824)
  "referer-beacon-privacy-dnr.test.mjs": 27, // #1405 re-count: 9 -> 27. SW not importable; syncSuppressRefererDNR/syncBlockBeaconsDNR/syncBlocklistRefererDNR/syncBlocklistBeaconsDNR existence + applyDnrState gate-open/gate-closed wiring + storage.onChanged guards, mirroring allowlist-dnr.test.mjs's pattern (referer-beacon-privacy PR 2, #824)
  "referer-beacon-privacy-ff.test.mjs": 30, // #1405 re-count: 7 -> 30. SW not importable; onBeforeSendHeadersSuppressReferer/onBeforeRequestBlockBeacons existence + fail-open + isFirefoxMV2 listener-registration wiring guards, mirroring referer-beacon-privacy-dnr.test.mjs's pattern (referer-beacon-privacy PR 3, #824)

  // #1405: first counted by the widened heuristic (identifiers bound to src/
  // text via readFileSync, and assert.match/doesNotMatch on them). These are
  // CEILINGS at the count found on 2026-09-24, not endorsements: ratchet down.
  "a11y-contrast.test.mjs": 1,
  "a11y-structure.test.mjs": 9,
  "amp-redirect.test.mjs": 15,
  "audit-2.5.0-copy-cleanups.test.mjs": 4, // rebase re-count onto the #1405 widened heuristic (audit behaviour branch, 2026-09-24): 2 -> 4, no new assertions added, the wider identifier-binding count simply now sees 2 more on the same file (#824)
  "bounce-state-affiliate-redirect.test.mjs": 2,
  "bounce-state-wrappers-parity.test.mjs": 4,
  "cleaner.test.mjs": 3,
  "content-autoinject-notice.test.mjs": 26,
  "content-copy-safe-injection.test.mjs": 6,
  "content-unwrap-no-affiliate-redirect.test.mjs": 4,
  "context-menu-hint.test.mjs": 5,
  "copy-absolute-claims.test.mjs": 1,
  "creator-allowlist.test.mjs": 12,
  "css-token-resolution.test.mjs": 3,
  "dnr-enabled-internal-default.test.mjs": 6,
  "experimental-param-classes-migration.test.mjs": 5,
  "export-import.test.mjs": 12,
  "firefox-mv2-mainworld-injection.test.mjs": 12,
  "firefox-mv2.test.mjs": 40,
  "history-defuser.test.mjs": 8,
  "honor-creator-mode.test.mjs": 8,
  "hot-path-cleanurl-no-reserialize.test.mjs": 2,
  "hover-preview.test.mjs": 12,
  "i18n-hardcoded.test.mjs": 1,
  "import-settings-cap.test.mjs": 3,
  "increment-stat.test.mjs": 5,
  // #1448: "no message.type check is gated..." now also scans for a next
  // PLAIN "\nfunction " declaration (not just "\nasync function"), because a
  // plain deps-factory helper (_remoteRulesDeps, which gained an isFirefoxMV2
  // field) sits between the message listener and the next async function and
  // was being swept into the "listener body" scan by the old async-only
  // heuristic. service-worker.js is not Node-importable (module-scope
  // chrome.* calls), so this stays a source guard; +1 raise, not a new kind
  // of check.
  "mv-parity.test.mjs": 7,
  "onboarding-aria-i18n.test.mjs": 2,
  "onboarding-tab-dedup-967.test.mjs": 1,
  "onboarding.test.mjs": 40,
  "options-aria-i18n.test.mjs": 5,
  "options-dev-tools-gate.test.mjs": 28,
  "options-display-prefs.test.mjs": 3,
  "options-import-param-validation.test.mjs": 23,
  "options-patterns.test.mjs": 101,
  "options-report-flow-staleness.test.mjs": 4,
  "options-report-upstream-button.test.mjs": 21,
  "options-shortener-split.test.mjs": 9,
  "options-show-badge-toggle.test.mjs": 7,
  "options-strip-globally-button.test.mjs": 23,
  "options-surfaced-prefs.test.mjs": 13,
  "options-sync-save-failed.test.mjs": 3, // new file, audit behaviour branch (#1430): sync-mutation.js is importable in Node and covered behaviorally in sync-mutation.test.mjs; these 3 pin that addEntry/removeEntry actually wire the sync_save_failed toast + skip re-render on a failed write, read from options.js source (#824)
  "popup-aria-i18n.test.mjs": 9,
  "popup-autoinject-badge.test.mjs": 16,
  "popup-count-celebration.test.mjs": 15,
  "popup-honored-creator-badge.test.mjs": 7,
  "popup-length-bar-guard.test.mjs": 7,
  "popup-preserved-creator.test.mjs": 9,
  "popup-rerender-leaks.test.mjs": 2,
  "popup-suspicious-section.test.mjs": 21,
  "prev-version-persistence-1100.test.mjs": 5,
  "redirect-unwrap.test.mjs": 26,
  "referer-beacon-privacy-foundation.test.mjs": 1,
  "remote-rules-status.test.mjs": 1,
  "report-button.test.mjs": 18,
  "sanitize-import.test.mjs": 43,
  "service-worker-autoinject-passthrough.test.mjs": 1,
  "session-storage-race-1097.test.mjs": 2,
  "settings-activity-controls-relocation.test.mjs": 39, // 38 -> 39 (b5-3 audit fix #1): +1 source-grep assertion pinning that renderActivityLedgerPanel now accepts an explicit attributionLedgerEnabledOverride parameter, so the toggle-race fix (call sites pass the in-memory enabled state instead of the function re-reading storage) cannot regress silently (#824)
  "settings-activity-domain-stats.test.mjs": 21,
  "settings-activity-ledger-copy.test.mjs": 36,
  "settings-activity-ledger.test.mjs": 62,
  "settings-activity-suspicious-params.test.mjs": 52,
  "store-links.test.mjs": 4, // new file, audit behaviour branch (#1387): store-links.js's own URL/getRateUrl() behavior is covered behaviorally above; these 4 pin that it imports isFirefox() rather than reimplementing it, and that both call sites import getRateUrl from the shared module, read from source (#824)
  "strip-test-seams.test.mjs": 4,
  "tos-version-sync.test.mjs": 1,
  "validation.test.mjs": 5,
  "web-engine-purity.test.mjs": 4,
  // Audit 2026-09 copy/a11y guards on static HTML and locale files
  // (browser-only pages; nothing to exercise behaviourally in node).
  "onboarding-cta-copy.test.mjs": 1,
  "options-toggle-accessible-names.test.mjs": 4,
  "settings-hint-copy-drift.test.mjs": 4,
  "settings-report-copy.test.mjs": 3,
  "scoped-facts-process-url.test.mjs": 11, // #1409: 3 wiring checks on service-worker.js (browser-only composition root), counted per bound slice
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("countSourceGreps — what the ratchet counts (#1405)", () => {
  // Fixtures are built by concatenation so this file's own text does not
  // contain the shapes it counts.
  const R = "readFile" + "Sync";

  test("assert.match on an identifier read from a src/ path is counted", () => {
    const text = `const optionsJs = ${R}(join(ROOT, "src/options/options.js"), "utf8");\n` +
      "assert.match(optionsJs, /renderPanel/);\nassert.doesNotMatch(optionsJs, /old/);\n";
    assert.equal(countSourceGreps(text), 2);
  });

  test("a path constant that names src/ binds the identifier read through it", () => {
    const text = `const OPTIONS = join(ROOT, "src", "options", "options.js");\n` +
      `const js = ${R}(OPTIONS, "utf8");\nassert.ok(js.includes("x"));\n`;
    assert.equal(countSourceGreps(text), 1);
  });

  test("a slice or extracted body of source text is still source text", () => {
    const text = `const optionsJs = ${R}("../../src/options/options.js", "utf8");\n` +
      "const body = extractFunctionBody(optionsJs, 'render');\nconst head = body.slice(0, 10);\n" +
      "assert.match(body, /try/);\nassert.match(head, /async/);\n";
    // body.slice( is itself counted, like *Source.slice( always was.
    assert.equal(countSourceGreps(text), 3);
  });

  test("a non-src file and parsed JSON are not source-text assertions", () => {
    const text = `const doc = ${R}("docs/README.md", "utf8");\nassert.match(doc, /x/);\n` +
      `const rules = JSON.parse(${R}("src/rules/x.json", "utf8"));\nassert.ok(rules.includes("a"));\n`;
    assert.equal(countSourceGreps(text), 0);
  });

  test("the original *Source heuristic is still counted, once", () => {
    const text = `const swSource = ${R}("src/background/service-worker.js", "utf8");\n` +
      "assert.ok(swSource.includes('x'));\nassert.match(swSource, /y/);\n";
    assert.equal(countSourceGreps(text), 2);
  });
});

describe("Source-grep ratchet (#824) — counts may go DOWN, never UP", () => {
  const files = readdirSync(UNIT_DIR)
    .filter((f) => f.endsWith(".test.mjs") && !EXEMPT.has(f));

  for (const filename of files) {
    test(`${filename}: source-grep count does not exceed baseline`, () => {
      const src = readFileSync(join(UNIT_DIR, filename), "utf8");
      const actual = countSourceGreps(src);
      const ceiling = BASELINE[filename] ?? 0;

      assert.ok(
        actual <= ceiling,
        `${filename} has ${actual} source-grep assertion(s) but the baseline ceiling is ${ceiling}.\n` +
          `New source-string assertions are blocked by the #824 ratchet.\n` +
          `Prefer a behavioral test that exercises the public interface instead.\n` +
          `If a source-string assertion is genuinely unavoidable (module not importable in Node),\n` +
          `raise BASELINE["${filename}"] in tests/unit/source-grep-ratchet.test.mjs by exactly 1\n` +
          `and explain why in the commit message. See #824 for the migration guide.`,
      );
    });
  }

  test("baseline has no phantom entries (every key maps to a real test file)", () => {
    // Prevents stale entries accumulating after a file is renamed/deleted.
    const allFiles = new Set(
      readdirSync(UNIT_DIR).filter((f) => f.endsWith(".test.mjs")),
    );
    for (const key of Object.keys(BASELINE)) {
      assert.ok(
        allFiles.has(key),
        `BASELINE contains "${key}" but that file no longer exists in tests/unit/.\n` +
          `Remove the stale entry from BASELINE in source-grep-ratchet.test.mjs.`,
      );
    }
  });

  test("baseline slack guard — lower ceilings when files drop by more than 10 (keeps ratchet tight)", () => {
    // If a file's actual count drops > 10 below its ceiling, the baseline is
    // stale. This isn't a hard failure — it's a maintenance reminder.
    // It becomes a hard failure if slack > 20 to force cleanup.
    const largeSlack = [];
    for (const [filename, ceiling] of Object.entries(BASELINE)) {
      const filePath = join(UNIT_DIR, filename);
      let actual = 0;
      try {
        actual = countSourceGreps(readFileSync(filePath, "utf8"));
      } catch {
        continue; // phantom-entries test will catch missing files
      }
      const slack = ceiling - actual;
      if (slack > 20) largeSlack.push({ filename, ceiling, actual, slack });
    }
    assert.deepStrictEqual(
      largeSlack,
      [],
      `The following baseline entries have > 20 slack — lower the ceiling to stay tight:\n` +
        largeSlack
          .map((e) => `  ${e.filename}: ceiling=${e.ceiling} actual=${e.actual} (slack=${e.slack})`)
          .join("\n") +
        "\nEdit BASELINE in tests/unit/source-grep-ratchet.test.mjs.",
    );
  });
});
