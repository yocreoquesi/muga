#!/usr/bin/env bash
# Reads the latest CHANGELOG.md entry and injects release_notes into amo-metadata.json.
# Usage: bash scripts/prepare-amo-metadata.sh [version]
#   version: optional, defaults to package.json version
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-$(node -p "require('./package.json').version")}"

# Extract the changelog section for this version (between ## [version] and next ## [)
NOTES=$(sed -n "/^## \[$VERSION\]/,/^## \[/{/^## \[$VERSION\]/d;/^## \[/d;p}" "$ROOT/CHANGELOG.md" | sed '/^$/d')

if [ -z "$NOTES" ]; then
  echo "Warning: no CHANGELOG entry found for version $VERSION, using generic notes"
  NOTES="Bug fixes and improvements. See https://github.com/yocreoquesi/muga/releases"
fi

# Build the release_notes JSON with node (handles escaping properly)
node -e "
const fs = require('fs');
const meta = JSON.parse(fs.readFileSync('$ROOT/amo-metadata.json', 'utf8'));
const notes = $(node -e "console.log(JSON.stringify(process.argv[1]))" -- "$NOTES");
meta.version.release_notes = { 'en-US': notes };
fs.writeFileSync('$ROOT/amo-metadata.json', JSON.stringify(meta, null, 2) + '\n');
console.log('amo-metadata.json updated with release notes for v' + '$VERSION');
"
