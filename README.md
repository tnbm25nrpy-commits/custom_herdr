# herdr customizations

A setup for the **herdr-app** desktop app (herdr-core / `hc`) on Windows, plus the Claude Code pieces that plug into it.
Built and tested with herdr-app 0.1.15 / hc 0.1.20 on Windows 11.

- `HERDR-NOTES.md`: the full engineering log (why each change exists, gotchas, dead ends, backups). Read it before changing anything.
- `CLAUDE.md`: instructions for Claude sessions working in this folder.

## Quick start (try it out)

**You need (Windows 10/11):**

1. **herdr-app** installed and **started once**, then closed (creates `~/.config/herdr-app`).
2. **Claude Code** installed and logged in (`claude` works in a terminal).
3. **Node.js** 18+ and **Git for Windows** (some cards and hooks use its `bash`, `stat` and `cat`).
4. Optional: **Python 3**, only to regenerate themes or wallpapers (`home/theme-tools`).

**Install:**

```powershell
git clone https://github.com/tnbm25nrpy-commits/custom_herdr "$HOME\Desktop\custom_herdr"
cd "$HOME\Desktop\custom_herdr"
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -DryRun   # preview, changes nothing
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1           # install
```

Add `-Notifications` for native Windows toasts (writes 2 HKCU registry keys). Use `-NoClaude` to install only the herdr-app part and leave your Claude Code config alone.

**Then:** start herdr-app. If it doesn't switch layouts by itself, press `Ctrl+Shift+L` and pick `main-dynamic-tabs`. Pick a theme with `Ctrl+Shift+Y`. Start `claude` in a pane.

**Good to know:**

- Nothing is lost: every replaced file is kept as `<file>.bak-install-<timestamp>`, and `~/.claude/settings.json` is backed up as `settings.json.bak-herdr-install`. Settings are merged, never removed. Re-running is safe.
- Paths in the repo are stored as `C:\Users\me` and rewritten to your own home folder during install.
- The installer appends herdr rules to `~/.claude/CLAUDE.md` and adds agents and skills (`delegate`, `show-image`, `impl-*`, `reviewer*`, `explore-*`) to `~/.claude`. Delete any you don't want.
- The **CI card** (`mods/ci-watch`) is built for one specific local CI setup in `~/Desktop/Webapps`. Without it the card just shows dashes.
- No API keys or extra accounts needed beyond your own Claude Code login.

**Uninstall:** restore the `.bak-install-*` files (or delete the copied mods and layout in `~/.config/herdr-app`) and switch herdr-app back to the `main` layout.

## Keep your own copy up to date (for tinkering)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File export.ps1   # copies live config into the repo, mirrors deletions
git status; git add -A; git commit -m "..."; git push
```

On the other PC: `git pull` then `install.ps1` again.

What is tracked is defined in **`manifest.ps1`** (one list for export and install). Never tracked: `*.bak*` backups, `*.d.ts` type files (herdr-app regenerates them), app state (`data/`, `layouts/.state/`, `shared.json`, `view.json`, `window.json`), the Show inbox, shipped mods (herdr-app restores those on every start anyway). When you add a new mod or script, add it to `manifest.ps1`.

## Repo layout

| Path | Goes to | Contents |
|---|---|---|
| `herdr-app/layouts/main-dynamic-tabs.json` | `~/.config/herdr-app/layouts/` | The custom layout (clone of the shipped `main`) that wires everything together |
| `herdr-app/mods/*` | `~/.config/herdr-app/mods/` | 15 custom mods (below) |
| `herdr-app/themes/`, `herdr-app/backgrounds/` | same | 33 themes, wallpapers (+ thumbs, sources/licenses in `backgrounds/extra/SOURCES.md`) |
| `herdr-app/keys.json`, `programs.json`, `settings.json` | same | Shortcuts, theme-tinted Claude icon, app settings (zoom 1.1, theme, telemetry off) |
| `claude/skills/show-image`, `claude/scripts/show-image.ps1`, `kitty-show.ps1` | `~/.claude/` | Send images from Claude to the Show panel |
| `claude/hooks/show-enforce.mjs` | `~/.claude/hooks/` | Reminds/forces Claude to show images it took |
| `claude/hooks/herdr-wait-state.ps1` | `~/.claude/hooks/` | Keeps an agent "working" while background tasks run |
| `claude/skills/delegate`, `claude/agents/*`, `claude/scripts/herdr-worker.ps1`, `trust-dir.mjs`, `sec-scan.sh` | `~/.claude/` | Delegation workflow with visible herdr worker agents |
| `claude/mods/quota-bar` | `~/.claude/mods/` | Claude Code mod: context / model / quota line under the prompt |
| `claude/mods/copy-buttons` | `~/.claude/mods/` | Copy buttons on code blocks, tables and replies ([leonasdev/copy-buttons](https://github.com/leonasdev/copy-buttons), needs `"tui": "fullscreen"`, set by the settings merge) |
| `home/theme-tools`, `home/omarchy-tools` | `~/` | Python tools that built the themes and wallpapers |
| `claude-settings.herdr.json`, `claude-CLAUDE.herdr.md`, `tools/` | (merged by install) | Settings fragment, CLAUDE.md rules, merge script |

## Features and changes

### Layout `main-dynamic-tabs`
A clone of the shipped `main` layout (shipped layouts are overwritten on every start, so all edits live in the clone).
- **Wallpaper behind everything**: root `background` image + `terminal_opacity 0.62`, transparent pane frames, theme colors with alpha so the sidebar and cards are translucent (no extra sidebar tint; Show/Files/Changes panel translucent too).
- **Floating cards**: sidebar (Spaces, Agents, footer, header) and the right panel are separate rounded cards with 8 px gaps, aligned with the pane tops and the tab bar.
- **Right panel**: stack Files / Changes / **Show**, with the **CI card** below it (own drag handle).
- **Todo board** and **Agent map** in a stack over the work area (`work-stack`): opens over terminals + right panel, sidebar and tab bar stay.
- Sidebar 300 px, right panel 284 px, so the visible cards are the same width (re-applied by `ring` on every start).
- Bottom status bar removed (its agent counts moved into the footer card).
- 0 px helper blocks for the background mods `os-notify`, `no-toast`, `space-dedupe`, `ring`.

### Tab bar: `mods/tabs-dynamic`
- **Dynamic tab widths**: inactive tabs share the strip (`TAB_MIN`/`TAB_MAX` at the top of `main.js`), shrinking down to icon + status; the active tab is sized to its name (min = an equal share).
- **Active tab always visible**: no scrolling strip; if the active tab would be pushed off, it is drawn first (display only, real order unchanged).
- **Tab name = Claude session name** (from the terminal title) for tabs you didn't rename; falls back to the tab number.
- Clear active-tab highlight (accent border, selected bg, accent icon), tooltips on every tab.
- Buttons: **Todo**, **Map**, **Show**, **theme palette**, Files/Changes. Opening a panel closes the Todo board; switching tabs or clicking an agent in the sidebar closes it too.
- Panel open/closed is remembered per space, never auto-hidden.

### Show panel: `mods/show` (+ `show-image` skill)
Claude sends an image → it appears in the panel → you mark it up → save a copy or **send it back** → it lands in Claude's prompt as `[Image #n]`.
- Claude side: `~/.claude/scripts/show-image.ps1 <path> -Title ".." [-Group topic]`; images from worker agents are attributed to their parent tab.
- Cards grouped into collapsible **sections** (by group or sending tab), newest open; Collapse/Expand all and **Delete all** icon buttons; ✕ per section (click twice) and per card.
- Click a card → jump to the session that sent it; double click → **editor** (pen markup, ←/→ to step through images, Save copy, Send back).
- Drop files on the panel to add them.
- Hook `show-enforce.mjs`: after Claude reads an image or takes a screenshot it gets a reminder, and its turn is blocked once if it never showed the image. Only active inside herdr-app.
- Commands: `show.edit-latest`, `show.send-latest`, `show.collapse-all`, `show.expand-all`, `show.delete-all`.

### Todo kanban: `mods/todo`
- Columns Todo / In progress / Done (add, rename, delete), cards with title + multi-line description.
- Edit (double click / ✎), keyboard moves (Ctrl+arrows), hover buttons, **drag & drop** between columns.
- **Todo → agent dispatch**: drag a card onto a space in the Spaces card → a new tab starts `claude` (Opus, high effort, auto mode) with the card as its brief. The card shows the agent's live state and moves itself to In progress / Done; the agent marks it done via `mods/todo/bin/todo-status.ps1`.
- **Photos on cards**: Ctrl+V pastes a screenshot or copied image files into the edited/selected card (in "+ Add card" = a new card in that column), drop image files on a card or column, or "Add photo" in edit mode (file picker). Thumbnails on the card (click = open), ✕ in edit mode removes. Stored in `data/todo/images/<card>/`; agent briefs list the image paths.
- Board stored in `~/.config/herdr-app/data/todo/board.json` (not in the repo).
- Open/close: Todo button in the tab bar or `herdr-app do tabs-dynamic.todo-toggle`.

### Agent map: `mods/agent-map` (+ hook `agent-map.mjs`)
A live map of what every Claude agent is doing, in the style of [lot-map](https://github.com/alexeyw/lot-map) (MIT, credited in `LICENSE-lot-map.txt`).
- Opens over the work area like the Todo board: **Map** button in the tab bar or `herdr-app do tabs-dynamic.map-toggle`; switching tabs closes it.
- One radial map per live agent: stations You, Files, Shell, Git, Build (tests/builds/linters), Network, Browser, Agents, Skills, Memory. Pulses fly out and back per tool call, worn spokes, a fading route line, clock hands on running calls, ×N for parallel calls, red dot on failures, subagents circle the Agents station (tooltip = their label). Context ring with percentage.
- Agent colours follow the terminal address (stable when agents come and go). herdr workers sit right after the agent that started them (`↳ parent`, `+N workers`). Card tooltip: folder, model, context.
- **Needs you**: while an agent waits for a permission, its card says which call waits (`needs you · Bash: git push`) and that station glows red.
- Feed of the last calls across all agents, and a **Files** list (last 10 min, original file-name case) with which agent touched which file; a file written by 2+ agents turns red (conflict). Shell writes count too: redirects (`>`), file commands, relative paths resolved against the working folder (writes inside scripts are not seen).
- **Map button badge** in the tab bar while the board is closed: red dot / count for new failures, amber `!` for a file conflict; opening the map clears it.
- Overview = main sessions only; a session with sub-agents (also pane-less `hc run` workers) looks like a small pile of paper and says `+N sub-agents`. Navigation one nesting level at a time: **left click goes in** (session -> it plus its direct sub-agents, outlined in the theme accent; a nested orchestrator is stacked again and opens its own level; a map without sub-agents enlarges), **right click (or Esc) goes one level back**; Esc at the top closes the board. Double-click opens the session (a pane-less sub-agent as a peek).
- Animations run natively (transitions, loops, spinning orbit svgs); the script only redraws on new data, at animation boundaries, once a second for clock hands while a call runs, and during the 0.34 s enlarge.
- Data: global Claude Code hook `~/.claude/hooks/agent-map.mjs` (async, only inside herdr-app, also on PermissionRequest) appends one line per event to `data/agent-map/<terminal>.jsonl`. No prompt text, command arguments or search patterns are stored (shell labels are command + subcommand, URLs only the host). Files of closed terminals are pruned after 24 h.
- Tests: `node --test ~/.claude/hooks/agent-map.test.mjs` and `node --test test/main.test.mjs` in the mod folder.

### Sidebar
- **Spaces** (`mods/my-spaces`): theme-colored letter tiles, bigger rows (drop targets for todo cards).
- **Agents** (`mods/my-agents`): default sort "Spaces, then status" (Needs you > Done > Working > Idle inside each space), same-named spaces merged, accent space headers, bigger text, fold state remembered, pin button over the icon on hover, a clicked done agent stays in place.
- **Header and footer cards** (`mods/my-chrome`): footer = Settings + "N agents · N needs you"; "Add machine" removed.
- Files/Changes (`mods/my-files`, `mods/my-changes`): clones with the hover outline.
- **Hover outline** on every card (accent while the mouse is over it); `mods/ring` moves the accent outline away from the focused pane while you hover a card.
- `mods/space-dedupe`: opening a folder that already has a space adds a tab there instead of creating a duplicate space.

### Panes: `mods/my-pane`
- Rounded header corners (no square fill outside the border), centered title, fixed spinner artifact.

### Themes and wallpapers: `mods/theme-switch`
- `Ctrl+Shift+Y` or the palette button: picker with ~30 dark themes (omarchy themes + dracula, rose-pine-moon, synthwave-84, oxocarbon, night-owl, ayu-mirage, monokai, solarized-dark, poimandres, github-dark, moonfly, nebula, ember, atom-one-dark) and 3+ wallpapers each.
- Click a theme = theme + its first wallpaper; click a thumbnail = wallpaper only; ↑/↓ applies live.
- Writes the pick to `settings.json` too, so the theme survives layout reloads.
- Claude icons and space tiles follow the theme (`programs.json` `tint: true`).

### Notifications
- `mods/no-toast`: herdr's in-app toasts off (re-patches the shipped `toast` mod after every start; undo info in HERDR-NOTES).
- `mods/os-notify`: **native Windows toast** when an agent needs you or finishes while herdr-app is in the background; click focuses that agent. Needs `install.ps1 -Notifications` once (HKCU registry keys).

### CI card: `mods/ci-watch`
- Three numbers for the local Webapps CI: running jobs, branches ready to ship, free RAM % (yellow/red thresholds), tooltips with details. Specific to the `~/Desktop/Webapps` setup.

### Shortcuts (`keys.json`)
- `Ctrl+Shift+A` new tab running `claude`
- `Ctrl+Shift+Y` theme picker
- plus herdr's defaults (`Ctrl+Shift+T` tab, `Ctrl+Shift+O/E` split, `Ctrl+Shift+L` layout, `Alt+1..9` spaces, `Ctrl+1..9` tabs, ...)

### Claude Code integration
- **quota-bar mod**: under the prompt, after the mode pill: `context N% used · model · 5h: N%  week: N%`. `/quota` toggles it. Loaded via `CLAUDE_CODE_PLUGIN_DIRS`.
- **copy-buttons mod** ([leonasdev/copy-buttons](https://github.com/leonasdev/copy-buttons), v1.5.7, MIT): copy buttons on code blocks and tables (on hover) and `Reply` at the end of each answer. Needs `"tui": "fullscreen"` (in the settings fragment). Update: `git -C ~/.claude/mods/copy-buttons pull`, then `export.ps1`.
- **Waiting status** (`herdr-wait-state.ps1`, Stop hook): an agent with background shells or subagents stays "working · waiting: <cmd>" in herdr instead of showing done.
- **Visible workers** (`delegate` skill + `herdr-worker.ps1`): `impl-*` / `reviewer*` agents run as `hc` sub-agents listed under their orchestrator in the Agents sidebar; `trust-dir.mjs` pre-trusts worktree folders so workers don't stall on the trust dialog.

## Not included

- herdr-app / herdr-core themselves, shipped mods, icons, frame (come with the app).
- App state: spaces, tabs, todo board, Show inbox, window position.
- The rest of `~/.claude` (research skill, other hooks, full `settings.json`, project memories).
