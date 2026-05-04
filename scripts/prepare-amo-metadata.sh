#!/usr/bin/env bash
# Reads the latest CHANGELOG.md entry and injects release_notes into amo-metadata.json.
# Usage: bash scripts/prepare-amo-metadata.sh [version]
#   version: optional, defaults to package.json version
#
# Truncation to AMO's 3000-char release_notes cap lives in tools/amo-build-metadata.mjs
# (testable). v1.13.0's release notes were 4938 chars and silently broke the AMO upload —
# do not reintroduce inline truncation logic here.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-$(node -p "require('./package.json').version")}"

# Extract the changelog section for this version (between ## [version] and next ## [)
NOTES=$(sed -n "/^## \[$VERSION\]/,/^## \[/{/^## \[$VERSION\]/d;/^## \[/d;p}" "$ROOT/CHANGELOG.md" | sed '/^$/d')

if [ -z "$NOTES" ]; then
  echo "Warning: no CHANGELOG entry found for version $VERSION, using generic notes"
  NOTES="Bug fixes and improvements. See https://github.com/yocreoquesi/muga/releases"
fi

printf '%s' "$NOTES" | node "$ROOT/tools/amo-build-metadata.mjs" "$VERSION"
