#!/usr/bin/env bash
# Temporarily swap manifest.json to MV2 for Firefox, run a command,
# and guarantee restoration even on failure or interrupt.
set -euo pipefail

SRC="src/manifest.json"
BACKUP="src/manifest.v3.json"

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
