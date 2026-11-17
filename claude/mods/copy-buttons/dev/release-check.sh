#!/bin/sh
# Everything to run before a release: the manifest and the directory's rules,
# the tests, the transcript readers' scripts, the buttons and the rendered
# copy on a real screen (in tmux), the types, a CHANGELOG entry for the
# version being released, and marketplace.json installing that version's tag.
# It changes nothing; dev/release.sh runs it before committing a release.
# What it cannot check (other terminals, a narrow window, scrolling) is in
# docs/manual-testing.md.
#
#   dev/release-check.sh
set -eu
cd "$(dirname "$0")/.."

step() { printf '\n== %s\n' "$1"; }

step 'validate'
claude plugin validate .
step 'validate --profile directory'
claude plugin validate . --profile directory
step 'test'
claude plugin test .
step 'readers'
bun test ./dev/check-readers.ts
step 'buttons'
bun dev/check-buttons.ts
step 'rendering'
bun dev/check-rendering.ts
step 'tsc'
npx -y -p typescript@5.6.3 tsc -p .

step 'changelog'
version=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' .claude-plugin/plugin.json | head -n 1)
# Keep a Changelog: a dated heading for the version, and its link at the end.
if grep -Eq "^## \[$version\] - [0-9]{4}-[0-9]{2}-[0-9]{2}$" CHANGELOG.md; then
  echo "CHANGELOG.md has $version"
elif grep -q "^## \[$version\]" CHANGELOG.md; then
  echo "CHANGELOG.md has $version undated: date it before the release commit" >&2
  exit 1
else
  echo "CHANGELOG.md has no entry for $version: move [Unreleased]'s entries under ## [$version] - <date>" >&2
  exit 1
fi
if ! grep -q "^\[$version\]: " CHANGELOG.md; then
  echo "CHANGELOG.md has no link for [$version] at its end" >&2
  exit 1
fi

step 'marketplace'
ref=$(sed -n 's/.*"ref": *"\([^"]*\)".*/\1/p' .claude-plugin/marketplace.json | head -n 1)
if [ "$ref" = "v$version" ]; then
  echo "marketplace.json installs v$version"
else
  echo "marketplace.json installs ${ref:-no tag}, not v$version" >&2
  exit 1
fi

printf '\nAll checks passed for %s.\n' "$version"
