---
name: delegate
description: Default orchestrator rules for any project - explore-* / impl-* / reviewer agents, task files with Known facts, report headers, review loop, herdr worker panes, cost guard. Load before the first subagent spawn of a session. Skip when the project has its own delegation rules (e.g. the `orchestrate` skill in Webapps, the `bauer` rules in Archive); those win. Main session only; workers never delegate.
---

# Default delegation workflow (all projects)

Generalized from the Webapps `orchestrate` skill and the Archive `bauer` rules (2026-11-09). A project's own rules (CLAUDE.md, project skill, project agents in `.claude/agents/`) override this. Project agent definitions with the same name shadow the global ones in `~/.claude/agents/`.

## When to delegate

- **Do it yourself:** questions, explanations, a handful of tool calls, one small edit whose target you already know, config tweaks, anything where writing the task file costs more than the work.
- **Delegate:** feature work or fixes that touch more than a couple of files, multi-step changes, broad searches across the codebase, anything that should be reviewed before it counts as done.
- When in doubt on a code change of real size: delegate. The main session plans, decides and verifies; it does not grind through implementation turns.

## Roles

Spawn with `subagent_type: <name>` (or as a herdr pane, below). **Never pass `model`**: it overrides the definition. Effort is fixed per definition, so you pick the tier.

| Role | Model | `subagent_type` |
|---|---|---|
| Orchestrator (main session: plans, designs, diagnoses, picks tiers) | user's choice | n/a, never switch it |
| Read-only search | Haiku 5.5 | `explore-low`, `explore-medium`, `explore-high` |
| Code implementation | Sonnet 5.5 | `impl-low`, `impl-medium`, `impl-high` |
| Review | Opus 5.5, medium | `reviewer` |
| Review, security-sensitive (authn/authz, sessions, SQL, file paths/uploads, input validation, CSRF, secrets, untrusted input) | Opus 5.5, high | `reviewer-security` |

- **Tier:** low = mechanical, known pattern, single lookup; medium = normal feature/fix, multi-file trace; high = tricky logic, concurrency, security-adjacent, broad fan-out. Per task, not per session.
- **No `general-purpose` / `fork`** for search or implementation: they run on Opus and forks carry the whole orchestrator context (median 23M tokens per fork, measured 2026-11-09). Search -> `explore-*`, code -> `impl-*`.
- Project-specific roles (deploy, docs, ...) only exist where the project defines them. Otherwise the main session does that itself, and anything that publishes (push, deploy, release) needs the user's go-ahead.

## Flow

1. Cheap discovery yourself (Glob/grep); broader search -> `explore-*` with a report path.
2. Write a task file per implementer (template below) and start it. If it may commit, note `git rev-parse HEAD` first (the scan base).
3. **Scan before review** (yourself, seconds, no tokens): `bash ~/.claude/scripts/sec-scan.sh -C <cwd> [-b <base sha>] -o <scratchpad>/reports/scan-<name>.md`. Runs gitleaks (secrets) on the changed files and osv-scanner (known-vulnerable deps) when a manifest/lockfile changed. Exit 0 clean, 1 findings, 2 scanner error (mention it to the user, don't block on it). No git: pass the changed files as args.
   - Any finding: put the scan report under the reviewer's Known facts and have it confirm or dismiss each hit. A secret or a vulnerable dep that the change introduced is blocking; one that already existed is a note to the user.
   - A secret hit, or findings in an auth/SQL/path/input change -> `reviewer-security`, even if the change otherwise looks routine.
   - Clean scan: no extra step. Skip the scan for changes with no code or deps (docs, layouts, styling).
4. Every `impl-*` result goes through `reviewer` or `reviewer-security` before it counts as done. Verify findings against the code before acting. If the reviewer blocks the same change twice, take the fix over yourself. After a fix round, re-run the scan.
5. Failures (red test, unclear bug): diagnose from the real log and source yourself, then hand a precise fix spec to `impl-*`.
6. After each delegation check `git status` / `git diff --stat` against the allowed scope. Reports are evidence, not fact (an agent once rewrote an unrelated file during a research-only task).
7. Wrap-up: list open worktrees/branches with their state (merged / ready / blocked and why); remove fully merged worktrees.
8. Cleanup (user 2026-11-12): workers delete their own temp files before reporting and list deliberate leftovers under `Left behind:`. Once a step's report is acted on, delete its task file, report, scan report and those leftovers. At wrap-up delete the session's remaining scratchpad tasks/reports/handoff and any review, audit, plan or screenshot files this session created whose content is done (lasting part goes to the project's docs first). Delete only exact paths this session or its workers created, never via glob over shared dirs, never tracked files or CI gate markers; list other sessions' leftovers for the user instead.

**Parallel implementers** need disjoint "May edit" sets or separate git worktrees. A single sequential implementer works in the checkout itself unless the project says otherwise.

## Task file (every delegation, pane or Agent tool)

Prompts + reports are <1% of subagent tokens (measured over 428 runs); re-discovery turns dominate. So hand over what is known. Plain precise prose, no JSON or abbreviations.

```
# Task: <one line>
Cwd: <abs path>  Branch: <name or n/a>
May edit: <files/dirs>
Spec: <behaviour wanted, acceptance criteria>
Known facts (verified; start here, do not re-search):
- <path>:<from>-<to> - <what is there / why it matters>
- Explorer report: <scratchpad>/reports/<name>.md (if any)
Out of scope: <what not to touch>
Tests: <exact commands, or "find the project's targeted tests">
Commit: yes|no
```

- Known facts come from your own Glob/grep and explorer reports; point at report files instead of retyping them.
- For reviewers, Known facts are pointers, not truth; they still read the real diff. Include the scan report path when the scan found something (Flow step 3).
- Agent tool: same content in the prompt, or write the file and name its path.
- Task and report files go to the session scratchpad (`<scratchpad>/tasks/`, `<scratchpad>/reports/`), never into the repo.

## Report headers

The global agent definitions start their report with fixed key lines: `STATUS`, plus `COMMIT TESTS FILES RISKS` (impl) or `VERDICT BLOCKING NOTES` (reviewers). Read the full report only when `STATUS` != `done`, `VERDICT=CHANGES_REQUIRED`, any of `BLOCKING NOTES RISKS` > 0, the header is missing, or you need details. Clean header: still do the git check from step 6.

`STATUS: blocked` with reason `turn budget` (impl-* soft cap: low 30, medium 60, high 100 tool calls): spawn a fresh worker with the report's done/left/next step as Known facts. Repeated budget stops on one task: split it or explore first.

## Where workers run (herdr)

The user watches agents in herdr; in-process subagents are invisible there. `impl-*` and `reviewer*` run as visible workers via `C:\Users\me\.claude\scripts\herdr-worker.ps1`; `explore-*` stay in-process (Agent tool).

- **herdr-app** (the user's normal setup, `HC_TERMINAL_ID` set): the worker becomes an `hc` sub-agent of this session and appears under it in herdr-app's Agents sidebar with its status (working / blocked / idle); the user clicks it to peek. No pane by default. Don't pass `-Pane`: herdr-app places it beside whatever pane the user has focused, possibly in another tab.
- **herdr TUI** (`HERDR_ENV=1`): the worker gets its own split pane.

Start with the Bash tool, `run_in_background: true`, one call per worker:
`powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\me\.claude\scripts\herdr-worker.ps1" -Name <name> -Agent <definition> -TaskFile <scratchpad>/tasks/<name>.md -ReportFile <scratchpad>/reports/<name>.md -Cwd <dir> -PermissionMode <this session's mode>`

- `-Name`: `[a-z][a-z0-9_-]{0,31}`, unique, new per step (`impl-login-fix`, `rev-login-fix`, `rev2-login-fix`). Paths without `"`, `%`, `&`, `|`, `<`, `>`, `^`; the report file must not exist yet. Never add `--model`.
- Exit line `HERDR-WORKER <name> exit=<n> [<header>] ...`: 0 done (worker ended), 2 bad args, **3 neither herdr-app nor herdr -> use the Agent tool for every role**, 4 start failed, 5 no report (exited, or idle 90 s without one), 6 timeout (worker left running). On 4/5/6: inspect with `hc read <name> --lines 120` (herdr-app) or `herdr agent read <name> --source recent-unwrapped --lines 120` (TUI), tell the user, do not restart blindly. End a leftover herdr-app worker with `hc kill <t>` + `hc rm <t>` once the user has seen it.
- A worker waiting on a permission shows `blocked`; the user answers in it (herdr-app: click it in the Agents sidebar). Never answer for them via `hc send` / `herdr agent send`.

## Guards

- **Cost:** tell the user before fanning out more than about 5 agents in one step. A multi-agent `Workflow` run needs the user's explicit opt-in. Prefer 2-3 focused agents over 5+ broad ones.
- **Checkpoint:** before a fan-out or long review round, write a handoff file in the scratchpad (goal, decisions, agent plan, next steps) so a usage cutoff or compaction leaves something resumable. This skill is not re-read after compaction: reload it before delegating again.
- **Fresh agent per step:** hand state over via files on disk, not `SendMessage` to a finished agent.
- Codex is not used anywhere.
