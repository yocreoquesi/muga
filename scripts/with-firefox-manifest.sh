#!/usr/bin/env bash
# Temporarily swap manifest.json to MV2 for Firefox, run a command,
# and guarantee restoration even on failure or interrupt.
set -euo pipefail

SRC="src/manifest.json"
# The backup lives OUTSIDE src/ on purpose (#1481): tools/strip-test-seams.mjs
# copies --source-dir wholesale before stripping, so a backup left inside
# src/ (the old src/manifest.v3.json) leaked into every build that runs
# through this wrapper while it sat there — build:firefox's dist/firefox
# artifact (and, via the pre-#1481 raw-src AMO sign, the published XPI too).
BACKUP="$(mktemp)"

cleanup() {
  if [ -f "$BACKUP" ]; then
    cp "$BACKUP" "$SRC"
    rm -f "$BACKUP"
  fi
}
# PIPE matters as much as INT/TERM here: `npm run lint | head` closes the pipe
# early, and without a PIPE trap the script dies before restoring, leaving the
# Firefox MV2 manifest sitting in src/manifest.json.
trap cleanup EXIT INT TERM PIPE

cp "$SRC" "$BACKUP"
cp src/manifest.v2.json "$SRC"

"$@"
