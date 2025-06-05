#!/bin/sh

# Script to read and print the version from packages/core/package.json

PACKAGE_JSON="$(dirname "$0")/../packages/core/package.json"

if [ ! -f "$PACKAGE_JSON" ]; then
  echo "Error: $PACKAGE_JSON not found."
  exit 1
fi

VERSION=$(grep '"version"' "$PACKAGE_JSON" | head -1 | sed -E 's/.*"version": *"([^"]+)".*/\1/')

if [ -z "$VERSION" ]; then
  echo "Error: Version not found in $PACKAGE_JSON."
  exit 1
fi

echo "Detected version: $VERSION"

TAG="v$VERSION"

# Check if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Git tag $TAG already exists. Deleting it."
  git tag -d "$TAG"
  git push --delete origin "$TAG"
fi

# Create the git tag
git tag "$TAG" -m "$TAG"

# Push the tag to origin
git push origin "$TAG"

echo "Created and pushed git tag: $TAG"
