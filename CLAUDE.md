# herdr customization workspace

Before customizing herdr, read **HERDR-NOTES.md** in this folder (findings, gotchas, dead ends).

Key points:
- The user runs the **herdr-app desktop app** (herdr-core/`hc`, `HC_TERMINAL_ID` set), not the herdr TUI.
  Config lives in `~/.config/herdr-app/`; its guide is `~/.config/herdr-app/AGENTS.md`.
- Verify visual changes with `herdr-app shot <file.png>` and look at the PNG.
- Images for the user: `~/.claude/scripts/show-image.ps1 <path> -Title ".."` → "Show" panel mod
  (`~/.config/herdr-app/mods/show`): markup editor, Save copy, Send back as `[Image #n]`.
- PowerShell 5.1 mangles `"` in native args: send JSON to `herdr-app do` / `hc` from Bash, or build the raw command line.
- Clone shipped layouts/mods before editing; never stop herdr-app or herdr-core.
- Add new findings to HERDR-NOTES.md.
- This folder is the git repo (github.com/<you>/herdr-setup). After a change: add new files to `manifest.ps1`, run `export.ps1`, commit, push (see README).
  Update README.md "Features and changes" when a feature is added or removed.
