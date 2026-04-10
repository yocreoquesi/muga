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
trap cleanup EXIT INT TERM

cp "$SRC" "$BACKUP"
cp src/manifest.v2.json "$SRC"

"$@"
