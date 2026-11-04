#!/bin/bash
# Builds the viewer for this computer. On a Mac, this leaves "Chess PDF Viewer.app" next to this
# script. Elsewhere, the app is in dist/.
# Usage: build.sh [version]
set -euo pipefail
cd "$(dirname "$0")"

version="${1:-0.0.0}"
rm -rf dist
npm ci
npx electron-builder --dir --publish never -c.extraMetadata.version="$version"

built="$(find dist -maxdepth 2 -name '*.app' -print -quit)"
if [ -n "$built" ]; then
  rm -rf "Chess PDF Viewer.app"
  cp -R "$built" "Chess PDF Viewer.app"
  echo "Built $PWD/Chess PDF Viewer.app"
fi
