<!-- herdr-setup (appended by install.ps1 from github.com/tnbm25nrpy-commits/custom_herdr) -->
- **Delegation:** for code work beyond a few tool calls, the main session orchestrates and delegates: load the `delegate` skill before the first subagent spawn. A project's own delegation rules (project CLAUDE.md, a project `orchestrate` skill, project agents like `bauer`) override it.
- Subagents and herdr workers (started from a task file, or running as `impl-*`, `reviewer*`, `explore-*`) ignore the point above and never delegate.
- **Show images:** inside herdr-app (HC_TERMINAL_ID set), every screenshot/render/image the user should see goes to the Show panel via the `show-image` skill (`~/.claude/scripts/show-image.ps1 <path> -Title ..`). The user cannot see images you Read.
