#!/bin/sh

# Script to remove all 'Thanks [@0xKheops](https://github.com/0xKheops)! ' lines from all CHANGELOG.md files

set -e

# Find all CHANGELOG.md files in the monorepo
find "$(dirname "$0")/.." -type f -name "CHANGELOG.md" | while read -r changelog; do
  # Use sed to remove only the specified text from any line, preserving the rest of the line
  if grep -q "Thanks \[@0xKheops](https://github.com/0xKheops)! " "$changelog"; then
    echo "Cleaning $changelog"
    sed -i.bak 's/Thanks \[@0xKheops](https:\/\/github\.com\/0xKheops)! //g' "$changelog"
    rm -f "$changelog.bak"
  fi
done