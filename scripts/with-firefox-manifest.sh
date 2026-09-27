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
# mktemp CREATES $BACKUP immediately (empty, mode 0600) — it exists before
# the real backup copy below ever runs. `[ -f "$BACKUP" ]` would therefore
# be true from that moment on, not from the moment the backup actually
# happened: an early exit or interrupt between mktemp and the copy would
# make cleanup() restore that empty file over src/manifest.json. Gate the
# restore on a flag set only after the copy succeeds instead.
backed_up=0

cleanup() {
  if [ "$backed_up" -eq 1 ]; then
    # `cat` (not `cp -p` / `mv`) writes only BACKUP's content into the
    # already-existing $SRC — it never touches $SRC's mode, so
    # src/manifest.json keeps its original permissions instead of picking
    # up mktemp's 0600.
    cat "$BACKUP" > "$SRC"
    # The trap fires twice on an interrupt: once for INT/TERM/PIPE (the
    # handler does not exit), then again on EXIT. Without this reset the
    # second pass would truncate $SRC through the `>` redirect before cat
    # fails on the already-deleted backup.
    backed_up=0
  fi
  rm -f "$BACKUP"
}
# PIPE matters as much as INT/TERM here: `npm run lint | head` closes the pipe
# early, and without a PIPE trap the script dies before restoring, leaving the
# Firefox MV2 manifest sitting in src/manifest.json — never pipe `npm run lint`.
trap cleanup EXIT INT TERM PIPE

cp "$SRC" "$BACKUP"
backed_up=1
cp src/manifest.v2.json "$SRC"

"$@"
