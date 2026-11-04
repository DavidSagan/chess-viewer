#!/bin/bash
# Starts a release build: tags the current commit on main and pushes the tag. GitHub Actions then
# builds the viewer and publishes it as a GitHub Release (.github/workflows/release.yml).
#
# Usage: tools/release.sh 1.2.0
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "release: $*" >&2; exit 1; }

[ $# -eq 1 ] || fail "usage: tools/release.sh <version>, for example 1.2.0"
version="${1#v}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "version must look like 1.2.0, not '$1'"
tag="v$version"

[ "$(git branch --show-current)" = main ] || fail "not on main"
[ -z "$(git status --porcelain)" ] || fail "uncommitted changes; commit or stash them first"

git fetch --quiet --tags origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
  || fail "main is not in sync with origin/main; push or pull first"
if git rev-parse --quiet --verify "refs/tags/$tag" > /dev/null; then
  fail "$tag already exists"
fi
[ -f .github/workflows/release.yml ] || fail "this commit has no release workflow"

git tag -a "$tag" -m "Chess PDF Viewer $version"
git push --quiet origin "refs/tags/$tag"

repo="$(git remote get-url origin | sed -E 's#^.*github\.com[:/]##; s#\.git$##')"
echo "Pushed $tag. The build is running:"
echo "  https://github.com/$repo/actions/workflows/release.yml"
echo "The release will appear at:"
echo "  https://github.com/$repo/releases/tag/$tag"
