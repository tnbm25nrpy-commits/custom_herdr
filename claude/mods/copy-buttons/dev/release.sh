#!/bin/sh
# Release a version: move CHANGELOG.md's [Unreleased] entries under it, set it
# in plugin.json and as the tag marketplace.json installs from, run
# dev/release-check.sh, then commit to main, tag and make the GitHub release.
# Nothing is committed if a check fails. Run by the Release workflow
# (.github/workflows/release.yml).
#
# The commit is made through GitHub's API (createCommitOnBranch), not git
# commit and git push: GitHub signs a commit it makes, so the release commit
# shows as Verified with no signing key on the runner. The tag is made the
# same way, after the commit.
#
#   dev/release.sh 1.4.0
set -eu
cd "$(dirname "$0")/.."

die() { printf '%s\n' "$*" >&2; exit 1; }
# Rewrite a file through a filter: edit <file> <command...>
edit() { f=$1; shift; "$@" < "$f" > "$f.tmp" && mv "$f.tmp" "$f"; }

[ $# -eq 1 ] || die 'usage: dev/release.sh <version>, e.g. 1.4.0'
version=$1
tag=v$version
echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "$version is not x.y.z"

[ "$(git branch --show-current)" = main ] || die 'release from main'
[ -z "$(git status --porcelain)" ] || die 'commit or stash your changes first'
git fetch -q origin main --tags
[ "$(git rev-list --count HEAD..origin/main)" = 0 ] || die 'main is behind origin/main: pull first'
if git rev-parse -q --verify "refs/tags/$tag" > /dev/null; then die "$tag already exists"; fi

previous=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' .claude-plugin/plugin.json | head -n 1)
if [ "$version" = "$previous" ] ||
  [ "$(printf '%s\n%s\n' "$previous" "$version" | sort -V | tail -n 1)" != "$version" ]; then
  die "$version does not come after $previous"
fi

notes=$(awk '/^## \[Unreleased\]/ { on = 1; next } /^## \[/ { on = 0 } on' CHANGELOG.md)
if [ -z "$(printf '%s' "$notes" | tr -d '[:space:]')" ]; then
  printf 'CHANGELOG.md has nothing under [Unreleased]. Commits since v%s:\n\n' "$previous" >&2
  git log --format='  %s' "v$previous..HEAD" >&2
  exit 1
fi

edit CHANGELOG.md awk -v v="$version" -v p="$previous" -v d="$(date +%F)" '
  /^## \[Unreleased\]$/ { print; print ""; print "## [" v "] - " d; next }
  /^\[Unreleased\]: / {
    url = $2; sub(/\/compare\/.*/, "", url)
    print "[Unreleased]: " url "/compare/v" v "...HEAD"
    print "[" v "]: " url "/compare/v" p "...v" v
    next
  }
  { print }'
edit .claude-plugin/plugin.json sed "s/\"version\": *\"$previous\"/\"version\": \"$version\"/"
edit .claude-plugin/marketplace.json sed "s/\"ref\": *\"v[^\"]*\"/\"ref\": \"$tag\"/"

if ! dev/release-check.sh; then
  git checkout -- CHANGELOG.md .claude-plugin
  die "Not released: the files are back as they were."
fi

# The entries as GitHub shows them: no leading blank lines, each item on one line.
body=$(printf '%s\n' "$notes" | awk '
  !started && /^$/ { next }
  /^  +[^ ]/ && item ~ /^- / { sub(/^ +/, ""); item = item " " $0; next }
  { if (started) print item; item = $0; started = 1 }
  END { if (started) print item }')

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
head=$(git rev-parse HEAD)

# expectedHeadOid: refused if main moved on since this checkout.
commit=$(jq -n \
  --arg repo "$repo" --arg head "$head" \
  --arg headline "chore(release): $version" --arg body "$body" \
  --arg changelog "$(base64 -w0 CHANGELOG.md)" \
  --arg plugin "$(base64 -w0 .claude-plugin/plugin.json)" \
  --arg marketplace "$(base64 -w0 .claude-plugin/marketplace.json)" \
  '{
    query: "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }",
    variables: { input: {
      branch: { repositoryNameWithOwner: $repo, branchName: "main" },
      expectedHeadOid: $head,
      message: { headline: $headline, body: $body },
      fileChanges: { additions: [
        { path: "CHANGELOG.md", contents: $changelog },
        { path: ".claude-plugin/plugin.json", contents: $plugin },
        { path: ".claude-plugin/marketplace.json", contents: $marketplace }
      ] }
    } }
  }' | gh api graphql --input - --jq .data.createCommitOnBranch.commit.oid) ||
  die "Not released: the release commit was not made (main moved on since the checks? release again)."
[ -n "$commit" ] || die "Not released: GitHub returned no release commit."

# Everything below runs after the commit is on main: a step that fails says
# how to finish by hand. Releasing again would stop at the version check.
on_main="The release commit $commit is on main"
tag_object=$(gh api "repos/$repo/git/tags" -f tag="$tag" -f message="copy-buttons $version" \
    -f object="$commit" -f type=commit --jq .sha) &&
  gh api "repos/$repo/git/refs" -f ref="refs/tags/$tag" -f sha="$tag_object" --silent ||
  die "$on_main, but $tag is not made: run gh api repos/$repo/git/refs -f ref=refs/tags/$tag -f sha=$commit, then gh release create $tag --verify-tag --title $version --notes-file <its CHANGELOG entries>."
gh release create "$tag" --verify-tag --title "$version" --notes "$body" ||
  die "$on_main and $tag is made, but its GitHub page is not made: run gh release create $tag --verify-tag --title $version --notes-file <its CHANGELOG entries>."

printf '\nReleased %s: %s.\n' "$version" "$commit"
