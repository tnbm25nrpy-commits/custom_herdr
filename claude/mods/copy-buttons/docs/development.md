# Development

## Checks

| Command | What it checks | Needs |
| --- | --- | --- |
| `claude plugin test .` | The hooks, with Claude Code's own engine standing in for the screen and the transcript | |
| `bun test ./dev/check-readers.ts` | The scripts that read the transcript (`sh` and `awk`, PowerShell where found), which the tests stand in for, on transcripts written to a temporary folder | |
| `bun dev/check-buttons.ts` | The buttons on a real screen: hovers and clicks them, and reads back what they copy | tmux |
| `bun dev/check-rendering.ts` | The `rendered` copy against what Claude Code draws | tmux |
| `bun dev/capture-fixtures.ts` | Takes the screens the layout tests expect again; a fixture drawn otherwise is rewritten, and `git diff tests/fixtures/` shows how | tmux |
| `bun dev/check-live.ts` | Haiku answers a turn with the plugin loaded: Reply on its closing line, then the transcript Claude Code wrote | `CLAUDE_CODE_OAUTH_TOKEN`, from `claude setup-token` |

The tmux ones resume sessions of their own, signed out: nothing is sent to the model. `dev/release-check.sh` runs every check a release needs but the last two, and changes nothing. [manual-testing.md](manual-testing.md) covers what none of them can: other terminals, a narrow window, scrolling.

`bun dev/check-transcripts.ts` is no test: it reads the newest transcripts on your machine as the plugin does, and compares that with each row's fields, to find what Claude Code writes that the plugin does not expect. What it finds depends on what you have done lately; a case it turns up belongs in `dev/check-readers.ts`.

## CI

`.github/workflows/`:

- `ci.yml` runs the checks on each pull request and push to `main`, with the Claude Code in `.github/claude-code-version`, so a new Claude Code turns no pull request red; on macOS and Windows too for a release's tag.
- `release.yml`, run by hand on `main`, releases a version: see [Releasing](#releasing).
- `claude-code-watch.yml` looks for a new Claude Code every six hours and checks it once, on all three and live (with the `CLAUDE_CODE_OAUTH_TOKEN` secret). One that fails opens an issue; one that passes closes those of the versions before it, and commits `.github/claude-code-version` and README's "Tested with" to `main`, each raised on its own where it is older. A pull request that needs a new Claude Code to pass (a fix for what it changed) pins the checks to it in `.github/claude-code-version` itself, and can leave README to the watch run that follows.

## Releasing

Pushing to `main` reaches no one: the marketplace installs the tag named in `.claude-plugin/marketplace.json`, and only a release moves it.

1. Note each change users will see under `## [Unreleased]` in `CHANGELOG.md`.
2. Run the **Release** workflow from the Actions tab on `main`, with the version picked by [Semantic Versioning](https://semver.org) and the rule at the top of the changelog. It runs every check on Linux, macOS and Windows, then `dev/release.sh`, which dates the entries, sets the version in `plugin.json` and the tag in `marketplace.json`, runs `dev/release-check.sh`, then commits to `main`, tags and makes the GitHub release. If a check fails nothing is committed; if `[Unreleased]` is empty it lists the commits since the last release.

   The commit and the tag are made through GitHub's API, not pushed: GitHub signs a commit it makes, so the release commit is `github-actions[bot]`'s and Verified, with no signing key on the runner. If a step after the commit fails, the run's log says how to finish by hand: releasing again stops, since `plugin.json` already has the version.

## A release that needs a newer Claude Code

`plugin.json` can state the Claude Code versions the plugin runs on, as a semver range:

```json
"engines": { "claude-code": ">=2.1.330" }
```

Claude Code 2.1.323 and later read it: outside the range the plugin is not installed, updated or loaded, and the person is told the range and to run `claude update`. Earlier ones ignore it.

It is not set now. A lower bound of 2.1.323 or below keeps no one out: every Claude Code that reads the field meets it. Set it when a release starts to need a Claude Code later than 2.1.323, to that version, and raise the first version in README's "Tested with" with it.

Set no upper bound. Each new Claude Code would turn the plugin off for everyone until a release raised it, and a marketplace people add themselves does not update by itself; without one, an answer the plugin cannot follow keeps its buttons at the end of the answer.
