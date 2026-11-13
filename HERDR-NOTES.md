# herdr customization notes

Findings from customizing herdr on Windows 11 (as of 2026-11-09). Read this before changing herdr,
herdr-app, or how Claude runs inside them.

---

## 1. Identify which herdr you're in first

There are **two different products**, and both are installed:

| | **herdr-app** (what the user actually uses) | herdr TUI (installed, not used day to day) |
|---|---|---|
| What | Desktop GUI app (gpui), terminals hosted by **herdr-core** (`hc`) | Terminal multiplexer that runs inside another terminal |
| Binaries | `%LOCALAPPDATA%\Programs\herdr-app\herdr-app.exe`, `%LOCALAPPDATA%\Programs\herdr-core\hc.exe` | `~\.herdr\packages\standalone\releases\0.9.0-master-sessions-...\herdr.exe` (its CLI reports 0.7.4) |
| Home/config | `~/.config/herdr-app/` (settings, layouts, mods, themes, keys) | `%APPDATA%\herdr\config.toml`, logs in the same folder |
| Signs you're inside it | `HC_TERMINAL_ID=t6`, `HC_TERMINAL_SOCKET=\\.\pipe\herdr-core-me-default.sock`, `TERM_PROGRAM=ghostty` | `HERDR_*` env vars; `herdr status` shows a running server |

**Check first:** `env | grep -iE 'HC_|HERDR|TERM_PROGRAM'`. Last time this check was skipped, and time went
into WezTerm and herdr TUI config that the user doesn't use.

---

## 2. herdr-app / hc cheat sheet

Full docs: `herdr-app --help`, `herdr-app --skill`, `herdr-app commands` (all `do` commands as JSON),
`hc --help`, `hc --skill`, and **`~/.config/herdr-app/AGENTS.md`** (main guide for layouts, mods and
settings; `herdr.d.ts` and `gpui-kit.d.ts` beside it document the API).

```sh
herdr-app ls                     # spaces > tabs > terminals with pane IDs (JSON)
herdr-app status                 # layout, focus, mod/file errors
herdr-app shot out.png           # PNG of the app's last frame (works even if covered/minimized)
herdr-app do <cmd> --key value   # e.g. pane.split, terminal.open, terminal.kill, tab.new
herdr-app check <mod folder>     # load a mod once, report errors

hc ls [--all] [--json] [--label k=v]   # core terminals (addresses t1, t2, ...)
hc get <t>                       # JSON incl. labels: herdr.space, herdr.tab, argv, cols/rows
hc send <t> <text>               # paste text + Enter into a terminal
hc read <t>                      # print screen + history
hc label <t> k=v                 # tag terminals; find them again with hc ls --label
```

**Verify visual changes with `herdr-app shot` + reading the PNG.** It's the app's own rendering, so no
screen capture is needed, and terminal images are included.

### Gotchas
- **`terminal.open --name X` does NOT make `X` an hc address.** `hc send X` fails with "no terminal".
  Tag the terminal with `hc label <t> key=val` and look it up via `hc ls --json --label key=val`.
- `terminal.open --place right` splits the **focused** pane, which may be in another tab. To split
  next to a specific agent, use `pane.split {direction:"right", pane:<id>}`. To get the pane ID of a
  terminal, find its `terminal` entry in `herdr-app ls`. The caller's own terminal is `$HC_TERMINAL_ID`.
- `pane.split` / `terminal.open` return `{"pane":"p…","terminal":"tN"}`. The terminal label
  `herdr.tab` (via `hc get`) tells you which tab it's in.
- Don't stop/restart herdr-app or herdr-core yourself (the guide forbids it): terminals live in core.
- **Env vars:** a user env var set via `[Environment]::SetEnvironmentVariable(...,'User')` was
  visible in **new** herdr-app terminals right away, with no core restart. Already-running processes
  (e.g. the current Claude) don't see it.
- Shipped layouts/mods get overwritten on every app start (edits are moved to `<name>-edited`).
  Use `layout.clone` / `mod.clone` and edit the copy. Current custom ones: layout
  `main-dynamic-tabs`, mod `mods/tabs-dynamic` (tab widths: `TAB_MIN`/`TAB_MAX` at the top of main.js).
- **Tab names = Claude session name** (2026-11-09): Claude Code puts its session name in the terminal
  title (`hc get tN` → `title`; a fresh session shows just "Claude Code"). `mods/tabs-dynamic/main.js`
  `sessionName()` labels each tab nobody renamed (`!tab.named`) with the agent pane's `panes()[i].title`
  (leading glyphs stripped). It falls back to the tab number when the title is only "Claude Code".
  `tab.rename` still wins. Display only: the tab itself stays unnamed. Backup: `main.js.bak-session-name`.
- **Active tab highlight** (2026-11-09): `mods/tabs-dynamic/main.js` `item()`: active tab = 1px `t.accent`+`8c` alpha border, `t.selected` bg, `font_weight(500)` (2px full accent + 600 was too bright), accent-tinted icon (was 1px `t.border` + `t.raised`, hard to see). Backup: `main.js.bak-active-highlight`.
- **Active tab always visible** (2026-11-09): the tab strip no longer scrolls (`overflow_hidden`, was `overflow_x_scrollbar`; a scrolled-away active tab was invisible and gpui-kit has no scroll-into-view for plain scroll areas). Active tab: `flex_none()` sized to its name, `max_w(ACTIVE_MAX=360)` (was a fixed 200px min that left a gap before the X; backup `main.js.bak-active-fit`); inactive tabs shrink to `TAB_MIN=38` (icon + status) with tighter padding past 6 tabs. Every tab has `.tooltip(name)`. Backup: `main.js.bak-active-wide`.
- **Active tab min width** (2026-11-12): a short-named active tab (e.g. just "2") shrank to its text although the strip had room. `render()` computes `share = clamp((stripW - 3*(n-1))/n, TAB_MIN, TAB_MAX)` (the inactive tabs' equal share); the active tab gets `min_w(share)` + `max_w(max(ACTIVE_MAX, share))`, its label `flex_grow(1)` so the X stays right. Backup: `main.js.bak-active-share`.
- **Active tab drawn first** (2026-11-09): `render()` builds `shown = [active, ...rest]` (display only; real order and `tab.move` indexes via `space.tabs` unchanged). Backup: `main.js.bak-active-first`.
  Since 2026-11-10 only when needed: `tab-scroll` and the active tab report their width via `on_size_change` (`this.stripW`, `this.activeW`); the active tab moves first only if `index * (TAB_MIN + 3) + activeW > stripW` (the tabs before it at minimum width would push it off the strip). Otherwise real order. Backup: `main.js.bak-active-first-overflow`.
- **New Claude tab shortcut** (2026-11-09): `keys.json` global `ctrl-shift-a` →
  `{"command":"tab.new","args":{"argv":["claude"]}}`: a new tab in the selected space, cwd = focused
  terminal's. herdr wraps `argv` itself as `powershell.exe -NoExit -Command "& 'claude'"`, so pass the bare
  program; passing the powershell wrapper nests it twice. Backup: `keys.json.bak-claude-tab`.
- Mods are trusted JS (command + network access). A mod can be a pane (`pane.split {mod, props}`),
  can show images with `image("mods/<name>/file.png")` (path relative to `~/.config/herdr-app`, and
  saving the file refreshes it live), and can receive dropped files via `.on_drop`.

---

## 3. Images / screenshots

### Current solution: the "Show" panel mod (built 2026-11-09)
Rebuilt from a r/herdr post by u/jactor2 ("Show: a panel I built into Herdr"), which had no public repo.
Lifecycle: Claude sends an image → it lands in the panel → you mark it up → save a copy → send it back
→ it arrives in Claude's prompt as `[Image #1]`.

| Piece | Where |
|---|---|
| Mod (panel + editor in one file) | `~/.config/herdr-app/mods/show/main.js` |
| Ingest: copy into inbox, read size, look up the sender's tab, write a sidecar JSON, reveal the panel | `mods/show/bin/show-add.ps1 <path> [-Title] [-Group] [-Terminal tN] [-MarkedFrom id] [-NoReveal]` |
| Burn marks into a PNG (System.Drawing) | `mods/show/bin/show-flatten.ps1 -In -Shapes <json> -Out` |
| Inbox | `~/.config/herdr-app/show/inbox/<id>__<name>` + `<id>.json` (the panel reads only sidecars) |
| Layout | `layouts/main-dynamic-tabs.json`: `{"id":"show","mod":"show"}` as the 3rd child of the `panel-body` stack (beside files, changes) |
| Tab bar button | `mods/tabs-dynamic/main.js`: `panelButton("show", ...)` always shown; `syncPanel` accepts "show". Backups: `show/*.bak`, `show/layout-backup-*.json` |
| Claude entry point | `~/.claude/scripts/show-image.ps1` → show-add.ps1; skill `~/.claude/skills/show-image` |
| Card clicks | Single click on the image → `goToSession(item)`: `agent.focus {terminal}` (switches tab) if the sender is in `agents()`, else `tab.select {id: item.tab}` + `pane.focus`. Double click → editor. Uses `ClickEvent.click_count` in one `on_click` (the 1st click of a double still jumps, which is fine). Backup: `main.js.bak-click-*` |
| Enforcement (2026-11-09) | `~/.claude/hooks/show-enforce.mjs` in `~/.claude/settings.json`: PostToolUse (`Read\|Bash\|PowerShell\|mcp__.*screenshot.*`, mode `post`) adds a "show it" reminder after an image Read or screenshot command; Stop (mode `stop`) scans the turn's transcript and blocks once (`stop_hook_active`) if images were touched and no `show-image.ps1`/`show-add.ps1` ran. No-op without `HC_TERMINAL_ID`. Skips `show/inbox`, `show/tmp`, `*.marked.png`, `image-cache`. Also a rule line in `~/.claude/CLAUDE.md` and a "REQUIRED" skill description. Backup: `settings.json.bak-show-enforce` |
| Commands (bindable in keys.json) | `show.edit-latest`, `show.send-latest`, `show.collapse-all`, `show.expand-all`, `show.delete-top-group` (1st call arms, 2nd deletes the newest group), `show.delete-all` (same arm-then-confirm, header "Delete all" button next to Collapse all, 2026-11-12); in an open editor: `show.demo`, `show.probe`, `show.save`, `show.send`, `show.next`, `show.prev` |

How each part works:
- **Panel:** `watchFolder(inbox)` + `fs.readdir`/`readFile` of the sidecars. Always shows every tab's images
  (the "This tab"/"All" scope chips were removed 2026-11-09); `herdr.tab` of the sender (via `hc get` at ingest) only labels sections. Files dropped on the panel are ingested too.
- **Editor:** the same mod opened with `openOverlay({mod:"show", props:{editor:id}, kind:"dialog", width:0.92, height:0.9})`.
  Shapes are stored in image pixels and drawn with `globalThis.window.paint_path(PathBuilder...)` in
  absolute layers over `image()`. Tools: pen, arrow, box, circle (64-point polygon), note (InputState), numbered step.
- **Prev/next (2026-11-09):** in the editor, ←/→ (ignored while a note is being typed) or the ‹ › toolbar buttons step through the inbox in the panel's order (all images, section by section). Marks are kept per image in memory while the editor stays open. Backup: `main.js.bak-arrows`.
- **Pen only (2026-11-10):** the editor toolbar has no tool buttons any more; the tool is always `pen` (freehand). The title gets the free space (`flex_1().min_w(0).truncate()`), the status text is capped at `max_w(240)`. The arrow/box/circle/note/step drawing code is still in main.js (used by `show.demo` and old marks). Backup: `main.js.bak-pen-only`.
- **Sections (2026-11-09):** the panel groups cards into collapsible sections. Key = sidecar `group` (set by `show-image.ps1 -Group "topic"` / `show-add.ps1 -Group`; a marked copy inherits its original's group), else the sending tab (label = tab name, else the agent's title, else "Tab n"; "space / tab" with several spaces), else "Other". Sections sorted by newest item; the header shows chevron, label, count, time. Open/closed state is in the mod's localStorage key `sections` (`{key: true|false}`, true = open); default is only the newest section open; a new image forces its section open. Top-bar button Collapse all/Expand all = commands `show.collapse-all` / `show.expand-all`. Grouping lives in one function (`groupItems`) shared with the editor, so ←/→ walks sections in panel order (collapsed ones included). 80-card cap counts rendered cards only. Backups: `main.js.bak-sections`, `show-add.ps1.bak-sections`.
- **Delete a group (2026-11-10):** each section header has a ✕ at the right. 1st click arms it (red "Delete N?", disarms after 3 s via `cx.timer.after`), 2nd click unlinks every image + sidecar in the group (`removeMany`, shared with the card ✕) and drops its `sections` key. Clicks stop propagation so the header doesn't toggle. Backup: `main.js.bak-delgroup`.
- **Card ⤢ (open in Windows viewer) removed 2026-11-10** at the user's request; cards keep ✕ and ➜. The editor's "Open" button still uses `openExternal`. Backup: `main.js.bak-noopen`.
- **Send back:** `Set-Clipboard -Path <png>`, then `run("pane.focus",{terminal})`, then `run("terminal.paste")`.
  herdr pastes it as a dropped file and **Claude Code turns it into `[Image #n]`** (verified). The target
  is the terminal that sent the image, else an agent in the current tab. It refuses if that terminal has no
  visible pane, so the paste can't land in the wrong pane. Side effect: overwrites the clipboard.

### Lessons from building the mod
- **The props of a mod opened as an overlay come from `props()`**, not reliably from `init`'s first argument.
- `image(path)` resolves against `~/.config/herdr-app`. Folders outside `mods/` (e.g. `show/inbox`) work, and
  writing images there doesn't hot-reload the mod (writing under `mods/<name>/` would).
- Write `mod.json` **before** `main.js`. When herdr first sees a mod folder without `{"place":"none"}`, it docks
  a copy into the active layout (a stray block at the root). Remove it from the layout JSON if that happens.
- `PathBuilder` arcs with `%` coordinates draw garbage. Use pixel coordinates and polygons.
- `import { image, PathBuilder } from "gpui-kit"`: it isn't a global. The `window` global (Window, has `paint_path`)
  is shadowed if you import herdr's `window()`, so use `globalThis.window`.
- Mouse event coordinates (`position`, `local_position`, `bounds`) are in **window px**, but layout sizes
  (`.w()`, `on_size_change`, paths) are in **layout px**. They differ by herdr's UI zoom: a canvas laid out
  1280 wide reported `bounds.width` 1408 (×1.1). Dividing `local_position` by your own scale therefore drifts
  more the further from the origin you click. Map clicks to content with
  `(e.position - e.bounds) / e.bounds.width * contentWidth` (see `pos()` in mods/show).
  The `show.probe` command draws a calibration frame in the open editor.
- **`closeOverlay()` tears down that overlay's script**: a pending `await` in it never returns. The editor's
  Send back used to close the dialog and then `await` Set-Clipboard, so nothing was pasted (fixed 2026-11-09).
  Finish every await first, then close, then do only synchronous `run(...)` calls (`sendBack`'s `beforePaste`).
  Tested end-to-end: scratch tab + `show-add.ps1 -Terminal tN`, `show.edit-latest`, `show.demo`, `show.send`, `hc read tN`.
- **A handler's `cx` dies at the first `await`** (stale-context error, swallowed in an async fn).
  The Show panel's ✕ originally ran `async remove(item, cx) { await fs.unlink(..); this.reload(cx) }`:
  the files were deleted, then `reload` set `loading = true` and `cx.spawn` threw, so `loading` stayed
  true and every later reload (watch + timer) was skipped. The panel froze until restart (fixed 2026-11-09).
  Do the async work in `cx.spawn(async (cx) => ...)` and use that AsyncContext.
- `herdr-app check` passes even when overlay props are wrong. Always verify with `herdr-app shot`.
  Use mod commands (`herdr-app do <mod>.<cmd>` → `nextCommand()`) to drive UI states for screenshots
  instead of automating the mouse on the user's real display.
- Python heredocs that write JS: `"\\n"` inside `'''...'''` becomes a real newline. Use `String.fromCharCode(10)`
  or raw strings.
- PowerShell: `New-Object X (a), (b)` nested inside a method call's argument list caused a parse error.
  Assign it to a variable first.

### Older, simpler approach (still there)
- **herdr-app terminals render the Kitty graphics protocol**, including Unicode placeholders.
- `~/.claude/scripts/kitty-show.ps1 <img> [-Cols N]` draws an image in the current terminal (chunked
  base64, `f=100` PNG; non-PNG is converted with ffmpeg; width defaults to the terminal width).
- The first show-image.ps1 opened a terminal "viewer" pane per tab (hc label `viewer=1`) and drew
  images there with kitty-show. It has been replaced by the Show panel.

### What does NOT work
- **Claude Code does not display images it `Read`s**, even with `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`
  (tested in herdr-app). Read images are visible to the model only. The user env var is still set;
  it does no harm.
- Tool output from Claude's Bash/PowerShell isn't rendered raw into the terminal, so a script
  can't draw "into the chat". That's why the separate viewer pane exists.
- **Windows Terminal 1.24:** Sixel only, no Kitty graphics.
- **WezTerm 20240203 (latest stable) on Windows:** `enable_kitty_graphics = true` is needed, but its
  **bundled 2023 ConPTY (conpty.dll + OpenConsole.exe) strips Kitty APC sequences** (`ESC _G…`).
  OSC 1337 (`wezterm imgcat`) does get through.
  - Copying only Windows Terminal's newer `OpenConsole.exe` next to the old `conpty.dll` breaks
    WezTerm (it exits instantly).
  - A **matched pair from NuGet `Microsoft.Windows.Console.ConPTY` 1.25.260930003** (MS-signed;
    `runtimes/win-x64/native/conpty.dll` + `build/native/runtimes/x64/OpenConsole.exe`) fixes it.
  - Irrelevant for herdr-app, which ships its own ConPTY (`herdr-core\conpty\`). `~/.wezterm.lua`
    is left over from this test.
- herdr TUI has `[experimental] kitty_graphics = true` in `%APPDATA%\herdr\config.toml`, but it needs a
  Kitty-capable outer terminal. Its panes didn't show test images inside a fixed WezTerm either. Not pursued.

### claude-show-your-work plugin (github.com/iamumeransari/claude-show-your-work)
- Claude Code plugin with tools show_image/video/html/audio/document. Drawing is done by
  Claude Code via Kitty graphics + Unicode placeholders. Hooks: ui.render, tool.call, etc. (newer plugin API).
- README: Ghostty/kitty on macOS/Linux only. Uses macOS tools (sips, osascript, mdfind), ffmpeg,
  poppler, Chrome. Has telemetry (PostHog, opt-out) and a daily self-update. It names herdr ("pictures need
  `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`").
- Not installed. It might partly work in herdr-app since the terminal supports Kitty graphics. Untested.

### Ideas not built yet
- Video/PDF: extract frames/pages with ffmpeg/pdftoppm and push them into the Show inbox.
- Inbox cleanup (nothing is deleted automatically yet), restoring the clipboard after Send back,
  a before/after compare view, a "send path only" button.

---

## 4. Windows / tooling gotchas

- **PowerShell 5.1 strips embedded `"` from native-exe arguments.** JSON like
  `herdr-app do x '{"a":"b"}'` arrives broken (also `hc send t7 'claude "..."'`). Fixes:
  - build the raw command line yourself: `ProcessStartInfo.Arguments = 'do pane.split "' + ($json -replace '"','\"') + '"'`
    (see `Invoke-Native` in show-image.ps1), or
  - call from Bash instead of PowerShell.
- With `$ErrorActionPreference='Stop'`, a native command writing to stderr (even redirected
  `2>$null`) throws in PS 5.1. Wrap it: `& { $ErrorActionPreference='Continue'; hc ... 2>$null }`.
- Testing hooks from Git Bash: `echo`/`printf` collapse `\\` in single-quoted JSON (`"C:\\x"` becomes the invalid
  `"C:\x"`), so the hook sees `{}` and looks broken. Build test JSON with `node -e "JSON.stringify(...)"` instead.
- `-replace '\', ...` is an invalid regex (use `'\\'`).
- Screenshotting another window: `CopyFromScreen` captures whatever is on top and `SetForegroundWindow`
  is usually refused. **`PrintWindow(hwnd, hdc, 2)`** (PW_RENDERFULLCONTENT) captures the window itself,
  and works for WezTerm. For herdr-app, use `herdr-app shot`.
- `strings` isn't available in Git Bash. `grep -aoiE 'pattern' file.exe` works for searching binaries.
- Auto-mode permission classifier **blocks running downloaded binaries** ("Code from External")
  until the user explicitly OKs it in chat.
- `herdr --no-session` (TUI, monolithic) binds the default API socket `%APPDATA%\herdr\herdr.sock`.
  Don't run it next to a live TUI session.
- In the herdr TUI, nesting is refused when `HERDR_*` env vars are inherited ("inception detected").
  Strip them before launching a test instance.

---

## 5. Related setup elsewhere

- Worker script `~/.claude/scripts/herdr-worker.ps1` runs `claude --agent <def>` as a visible worker, waits for
  its report file, then ends it. Rules: global `delegate` skill, Webapps skill `orchestrate`, `Archive\CLAUDE.md`.
  The exit line carries the report header (`[STATUS=.. | VERDICT=..]`, keys whitelisted in `Get-ReportHeader`).
  Codex has been removed everywhere; don't reintroduce it.
- **herdr-app mode (2026-11-09, tested end to end):** with `HC_TERMINAL_ID` set, the script runs
  `hc run --bg --json --no-notify --name N --cwd D --label herdr-worker=<def> -- claude ...`. That makes the worker a
  sub-agent of the calling terminal (`parent` = orchestrator, dies with it). herdr-app lists it indented under the
  orchestrator in the Agents sidebar with live status, without a pane. The legacy TUI path (`HERDR_ENV=1`,
  `herdr agent start`) is still there.
  - `hc wait <t> --json` returns `ended:true, reason:"status"` when the **turn** ends; the process is still alive.
    Get liveness from `hc get` `state` (`live`/`finished`). `hc get` `status` is an object `{app,msg,state}`;
    `hc wait` `status` is a string.
  - `hc kill` then `hc rm` (`rm` on a live terminal errors with "kill it first").
  - `-Pane` (`herdr-app do terminal.keep --terminal tN --place right`) needs a retry: herdr-app only learns about
    the new terminal a moment later ("no running terminal"). It also splits the **focused** pane, so in the test the
    worker landed in another tab where the user was typing. Off by default; the rules say not to use it.
- Global default (2026-11-09): `~/.claude/CLAUDE.md` points every project to the `delegate` skill
  (`~/.claude/skills/delegate/`), generic `impl-*` / `explore-*` / `reviewer*` in `~/.claude/agents/`.
  Project agents with the same name shadow them; the skill is not named `orchestrate` to avoid clashing
  with the Webapps project skill.
- Files touched by the image work: `~/.claude/scripts/{kitty-show,show-image}.ps1`,
  `~/.claude/skills/show-image/SKILL.md`, user env `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`,
  `~/.wezterm.lua`, test images in `~/.claude/show-test/`.

## Background image / transparent terminal (2026-11-09)
- In-app only: no window-level transparency (you can't see the desktop through the window); docs have no blur/acrylic.
- `layouts/main-dynamic-tabs.json` root: `"background": {"image": "backgrounds/purple-space.png", "fit": "cover"}`
  (path relative to `~/.config/herdr-app/`), `"terminal_opacity": 0.62`.
- The pane frame background must be transparent (`main` block `pane.background: "#00000000"`), or it hides the image.
- Mods paint theme colors themselves, so a node `background` alone doesn't help the sidebar. Override the theme
  colors with alpha on the root instead: `"colors": {"chrome": "#1a0f2499", "surface": "#1c102899", "canvas": "#00000000"}`.
  `#rrggbbaa` works there.
- Still opaque: pane header. (Show/Files/Changes were opaque via `.bg(t.background)`, now `t.chrome`, see "Right panel translucent".) Backup of the pre-background layout: `~/.config/herdr-app/layouts/.main-dynamic-tabs.bak-bg.json`.
- Matching theme: `themes/nebula.json` (purple). Set with `herdr-app do app.theme --name nebula`. This writes to
  `layouts/.state/<layout>.json` → `theme.dark`, which beats the layout's own `theme` field. The previous theme was `ember`.
  The red bits left over (Claude Code's context bar, mascot icons) come from Claude Code itself, not the herdr theme.

## Claude Code band above the prompt (quota-bar mod, 2026-11-09)
- Bottom statusline removed: `statusLine` deleted from `~/.claude/settings.json` (backup `settings.json.bak-statusline`;
  `~/.claude/statusline.ps1` is still on disk, unused).
- One centered row above the prompt: `context N% used · <model> · 5h: N%  week: N% · <mode>`, drawn by the Claude Code mod
  `~/.claude/mods/quota-bar` (loaded via `CLAUDE_CODE_PLUGIN_DIRS` in settings `env`, hot-reloads on save).
  Colors: `CONTEXT_STEPS`, `quotaColor`, `MODES` at the top of `hooks/register.tsx`. `/quota` toggles it.
  Backup of the old bar/legend version: `~/.claude/mod-backups/quota-bar-*`.
- **Mods can't read the live permission mode.** `classic.*` hook inputs carry `permission_mode` (correct only per
  prompt/turn). The `PromptHint` render's `hint` text leaves out the mode pill ("(shift+tab to cycle) · ..."), and the
  transcript only gets a `permission-mode` record per prompt. What works: the PromptHint redraws on each shift+tab, so the mod
  then runs `hc read $HC_TERMINAL_ID` (~350 ms + 900 ms later) and parses the footer pill (`auto mode on`, `manual mode on`,
  `plan mode on`, `accept edits on`). Instant and exact inside herdr-app.
- Mod gotchas: `$.state` writes inside a `ui.render` hook are denied (defer with `$.clock.after`); a helper that takes `$`
  must be a top-level function; `classic.PreToolUse`'s `e` is the tool call, not the classic stdin shape.
- Testing a Claude Code mod without touching the user's panes: `hc run --bg --no-notify --name x claude`, then
  `hc keys tN shift+tab` / `hc read tN`, then `hc kill tN; hc rm tN`.
- Hint line hidden (2026-11-09): the `PromptHint` render returns `<Box height={0} />`. Claude Code still draws its mode pill
  there (`⏵⏵ auto mode on ·`); a mod can't hide the pill, which is also what `hc read` detection relies on. A press-counting
  tracker (no pill) was tried and failed (edits→plan didn't register).
- **The blank row between the band and the prompt belongs to Claude Code** (it shows `● high · /effort` there while working).
  `marginBottom={-1}` on the band only collapses the band to 0 rows. Careful: `grep -vE "^\s*$"` on `hc read` output hides
  blank rows, which once made it look like the gap was gone.
- **Moved below the prompt (2026-11-09, current state):** the row is now drawn by the `PromptHint` render (replacing the
  hint text) after Claude Code's own mode pill, e.g. `⏵⏵ auto mode on ·   context 9% used · Opus 5.5 · 5h: 31%  week: 4%`.
  Nothing is drawn above the prompt anymore (no AbovePrompt hook), and the mode code / `hc read` pill parsing is gone, since
  the pill shows the mode. Centering: pad with spaces, `(e.viewport.columns - width)/2 - LEFT` (LEFT = 20, the indent + pill).
  `width="100%"` on the row pushes the engine's trailing `·` onto a second line. `/quota` gives back the engine's hint.

## Waiting-on-background status (2026-11-09)
- Problem: Claude Code emits OSC 7501 `idle` the moment its turn ends, even if a background Bash task (`gh run watch`, `sleep N; ...`) is running and will wake it.
- Mechanism: extra Stop hook `~/.claude/hooks/herdr-wait-state.ps1`. If `HC_TERMINAL_ID` is set and claude.exe has background tool shells (direct children: bash.exe with `shell-snapshots`, or cmd/powershell with `CLAUDE_CODE_SHELL_LAUNCHER_SCRIPT` / `\tasks\`, excluding the hook's own ancestors) it starts a hidden detached watcher (one per claude pid, lock `%TEMP%\herdr-wait-state\<pid>.lock`).
- Watcher: after ~1.5 s emits `working` with msg `waiting: <cmd>`; polls every 3 s via `hc get <t> --json`. If status.msg changed, Claude took over: exit silently (never re-emits, so a `blocked` prompt is not masked). When the shells are gone and the status is still ours, emits `idle`. Cap 6 h.
- AttachConsole trick: tool/hook processes have no console, so the watcher does FreeConsole, AttachConsole(claude pid), opens `CONOUT$` and WriteFiles `ESC]7501;state=..:app=claude-code:msg=<b64>ESC\`. Pass `[uint32]` explicitly in PS 5.1 (0xC0000000 otherwise goes negative).
- Limits: ScheduleWakeup has no process, so it is not covered. (Background subagents: see below.)
- Subagents (added 2026-11-09): the hook reads stdin `transcript_path` + `session_id` -> `<transcript dir>\<session id>\subagents\agent-*.meta.json`.
  The meta gets `"finished":true` **at hand-back, even while the agent still has background work** ("waiting on its own background work")
  and it may wake later; older Claude Code never writes `finished`. Rules: running = not finished and transcript changed since
  claude.exe started and within 15 min; or finished but transcript written > 2 s after the Stop hook and < 30 s ago (woken).
  The meta and transcript of a plain hand-back share one mtime, so "recently written" alone would show "working" for 30 s after every result.
  A subagent's background shells and Monitor tasks are bash.exe children of claude.exe -> caught by the shell scan.
- Watcher re-scans shells + subagents every 3 s (subagents first, WMI only if none, ~0.3 s), updates msg, goes idle after 2 quiet rounds.
  It reads the hc status right before every send. The hook deletes `*.lock` of dead claude pids or older than 7 h; Get-HcStatus reads async (a hung hc can't block it).
  Backup before this change: `~/.claude/hooks/herdr-wait-state.ps1.bak-subagents`. `-DryRun [-ClaudePid n]` prints detected shells and derived msg.
- Review fixes (2026-11-09): the watcher only replaces a plain `idle` (checks `hc get` first), so it never hides `blocked`
  or a new turn; the final `idle` and the 6 h cap only overwrite our own `working` status. Known limit: a background task
  that never ends (a dev server started with run_in_background, a persistent Monitor) keeps the session "waiting" for up to 6 h.
- `hc get` reports `state:"done"` (not `idle`) when an agent finished while unwatched; anything gating on "idle" must accept
  both. End-to-end verified 2026-11-09: a background `sleep 40` read its own session as `working` / "waiting: sleep 40; ...".

## Worker panes stalling on startup prompts (2026-11-09)
- New worktrees = unknown paths -> claude shows the folder-trust dialog and the project-MCP approval prompt; the worker pane stalls.
- MCP approval normally lives in the project's gitignored `.claude/settings.local.json`, so worktrees lack it.
  Fix: `"enabledMcpjsonServers": ["github","playwright"]` in `~/.claude/settings.json` (named list, not enableAllProjectMcpServers).
- Trust lives per path in `~/.claude.json` (`projects["C:/..."].hasTrustDialogAccepted`).
  Fix: `herdr-worker.ps1` runs `~/.claude/scripts/trust-dir.mjs $Cwd` before launch (atomic write, no-op if already trusted).

## OS notifications (native Windows toast)
Herdr's own toast is drawn inside its window, so it is invisible when another app is in front. The mod `os-notify` watches `agents()` once a second. When an agent goes to `blocked`, or from `working` to `done`, while `window().active` is false, it shows a native Windows toast. Clicking the toast focuses that agent. At most one toast per agent every 5 s. The first snapshot after start is ignored.

Files:
- `mods/os-notify/main.js`, `mod.json` (`place: none`)
- `mods/os-notify/bin/toast.ps1` (WinRT toast, AUMID `Herdr.Notify`, silent because Herdr plays its own sound)
- `mods/os-notify/bin/activate.ps1` (click handler; the input is untrusted, only `t=[A-Za-z0-9_-]{1,64}` is accepted, then it runs `herdr-app do agent.focus --terminal <t>` and raises the window)
- `mods/os-notify/bin/setup.ps1` (writes the registry keys, extracts `herdr.png`)
- layout `layouts/main-dynamic-tabs.json`: block `os-notify` (0px, NOT hidden) at the end of the `work` column.

Registry (HKCU only):
- `HKCU\Software\Classes\AppUserModelId\Herdr.Notify` (DisplayName, IconUri)
- `HKCU\Software\Classes\herdr-notify` (URL protocol -> `conhost --headless powershell ... activate.ps1 "%1"`)
- Windows adds `HKCU\...\Notifications\Settings\Herdr.Notify` itself after the first toast.

Remove: delete the two HKCU keys (`Remove-Item -Recurse HKCU:\Software\Classes\AppUserModelId\Herdr.Notify, HKCU:\Software\Classes\herdr-notify`), delete `mods/os-notify/`, delete the `os-notify` block from the layout.

Gotchas:
- A `hidden: true` block does NOT start the mod (no timer ran). Use a 0px non-hidden block.
- `ToastNotifier.Setting` throws 0x80070490 until the AUMID has been used once, so toast.ps1 checks it after `Show` (and only errors on an explicit non-Enabled value).
- The auto-mode classifier blocks HKCU registry writes by agents ("Unauthorized Persistence"). The user must run or approve setup.ps1.
- Do not use the exe path as AUMID: a click would start a second herdr-app. A custom protocol plus `agent.focus` avoids that.
- `herdr-app do agent.focus --terminal <t>` exits at once; `Start-Process -Wait` does not hang. `conhost --headless` works here, so no .vbs launcher is needed.
- A URI like `herdr-notify:focus?t=x&y=1;calc` is accepted but only runs with the validated `x`. `;`, `$()`, `%20`, spaces, quotes and empty input are rejected.
- The mod fires only while Herdr is inactive; with the window in front the in-app toast does the job.
- **False "finished" toasts with background subagents (fixed 2026-11-10):** Claude Code emits OSC 7501 `idle` the instant a turn ends,
  even right after launching a background subagent, so herdr shows `done` until `herdr-wait-state.ps1` (Stop hook, needs ~1.5 s sleep +
  2 PS startups) flips it back to `working`, or the subagent hand-back wakes the session. Measured with a haiku test session polled by
  `hc get` every 0.2 s: working -> done 20.2 -> working 22.1 -> done 25.2 -> working 27.6 ("waiting: sleep 25") -> done 47.1. Each 1.8-2.4 s gap
  was caught by the 1 s poll. Fix: `done` toasts only after the agent has stayed `done` for `DONE_GRACE` = 6 s (pending map, cleared on any
  other status or when the window is active). `blocked` stays immediate. Backup: `main.js.bak-debounce`. herdr's done sound wasn't checked
  (the user doesn't use sounds).

## Theme switch mod (2026-11-09)
- `mods/theme-switch/`: picker dialog (0.8 x 0.8) on `ctrl-shift-y` (`mod.open:theme-switch`) and a palette button in the tab bar (next to Show).
  Left: nebula, ember, atom-one-dark + the 23 omarchy themes (`backgrounds/omarchy/index.json`). Right: wallpaper thumbnails + "No image".
  Click a theme = `app.theme` + its first wallpaper; click a thumbnail = wallpaper only; up/down = apply live; Esc closes.
- Applying a wallpaper rewrites `layouts/main-dynamic-tabs.json` (root `background`, `colors.chrome/surface` = theme bg + `99`; the sidebar node background is deleted, see below)
  with `writeTextFile(path, text, expected)` (compare-and-swap) and keeps the file's CRLF line endings (a plain LF rewrite made the file differ from the backup).
- Light themes (catppuccin-latte, flexoki-light, lupine, rose-pine, white): `app.theme` only sets the *light* half of the state theme, so the mod also writes
  `settings.json` `"appearance": "light"` (dark themes set it back to `"dark"`). Verified: white shows light.
- Side effect: the light half of `layouts/.state/...` theme stays at the last light theme picked; reset with `app.theme paper`.
- Test commands: `herdr-app do theme-switch.apply:<theme>`, `theme-switch.bg:<n>` (-1 = no image) while the dialog is open.
- Source: `git clone --depth 1 https://github.com/basecamp/omarchy` into `~/omarchy-src/`. Converter `~/omarchy-tools/convert.py <omarchy/themes> ~/.config/herdr-app`
  maps `colors.toml` to `themes/<name>.json` and webp/jpg wallpapers to `backgrounds/omarchy/<theme>/*.jpg` (max 2560 wide) + `thumbs/` (320px) via ffmpeg. `intros/*.mp4` are skipped.
- Applies are serialized (one in flight, rapid picks collapse to the latest) after a review found that holding Down mixed one theme's wallpaper with another's colors.
- Backups: `layouts/.main-dynamic-tabs.bak-themeswitch.json`, `keys.json.bak-themeswitch`, `mods/tabs-dynamic/main.js.bak-themeswitch`.
- 2026-11-12: light themes removed from the picker, 11 dark themes added, every theme has 3+ wallpapers.
  - Removed catppuccin-latte, flexoki-light, lupine, rose-pine, white: moved (not deleted) to `C:\Users\me\herdr-removed-light-themes\` (`themes/`, `backgrounds/`, `index.json.orig`). `themes/win98.json` untouched.
  - New themes (`themes/*.json`, palettes from the projects' repos, MIT): dracula, rose-pine-moon, synthwave-84, oxocarbon, night-owl, ayu-mirage, monokai, solarized-dark, poimandres, github-dark, moonfly. Sources + deviations per theme: `backgrounds/extra/SOURCES.md`.
  - Wallpapers in `backgrounds/extra/<theme>/<n>-<name>.jpg` + `thumbs/` (the mod inserts `/thumbs/` before the filename). dracula (4) and rose-pine-moon (3) come from the official wallpaper repos (MIT / CC0); the rest are generated.
  - ember and atom-one-dark moved from the hardcoded `own` list in `mods/theme-switch/main.js` into `backgrounds/omarchy/index.json` (nebula stays in `own`, now 3 images). Backup: `mods/theme-switch/main.js.bak-themes2`.
  - Generators (re-runnable, palette-driven, PIL+numpy): `C:\Users\me\theme-tools\gen_backgrounds.py <app-home> [theme[:style]]` (starfield, aurora, mountains, dunes, topo), plus `make_themes.py`, `build_index.py`, `check.py` (static check), `shotfor.sh` (live check).
  - Gotcha: removing the theme file that the layout state points to gives `layout.error` ("not applied") and `mod.open` shows nothing. Fix: `herdr-app do app.theme:<valid>` then `herdr-app do layout.switch:main-dynamic-tabs`.
  - Gotcha: `mod.open:theme-switch` toggles. Check `herdr-app status` overlays before sending `theme-switch.apply:` (it only reaches a shown copy).
  - Gotcha: `herdr-app do layout.reset` deletes `layouts/.state/<layout>.json` even for a cloned layout (the theme then falls back to settings.json).

## Hover outline on every section (2026-11-09)
- Every sidebar/panel section now draws a 1px `t.border` outline (rounded 10) that turns `t.accent` while the mouse is over it, so it follows
  every theme. Terminal panes keep the layout's `focus` accent border (keyboard focus), so a hovered side panel and the focused pane can both be lit.
- Shipped `spaces`, `agents`, `files`, `changes` were cloned to `mods/my-spaces|my-agents|my-files|my-changes`; the layout's blocks point to the clones.
  Root element: `.id(..).rounded(10).border_1().border_color(this.hot ? t.accent : t.border).on_hover((h, cx) => { this.hot = h; cx.notify(); })`.
  `mods/show/main.js` got the same change (backup `main.js.bak-outline`). Layout `sidebar-lists` got `padding [0,8]`, `gap 8` so the cards float like the panes.
  Layout backup: `layouts/.main-dynamic-tabs.bak-outline.json`. Clones are never updated by herdr, so new upstream features of those mods won't arrive.
- Show panel fix (2026-11-09): image cards no longer get an accent border (fresh/hover removed; only the section outline is accent). `on_size_change` reports
  **window px** (root 368 layout px read 405 at zoom 1.1), so the card width is `listW / settings().zoom - 22`; before, cards overflowed the panel's right edge and covered its outline.
- Show editor cropped left/right edges (fixed 2026-11-10): the editor's `scale` used the `area` from `on_size_change` (window px) as if it were layout px,
  so at zoom 1.1 the canvas was ~10% bigger than the area and `justify_center` + `overflow_hidden` cut ~5% off each side (top/bottom for tall images).
  Now `scale` divides `area` by `settings().zoom`. The panel cards were already correct (verified: stored w/h match the real files). Backup `main.js.bak-editor-zoom`. Verified by the user (edge-test image, both edge stripes visible).
- Show: images sent by herdr worker panes (hc `parent` set, no `herdr.tab` label, closed when done) said "session is gone" (2026-11-09). `show-add.ps1` now walks `hc get` → `parent` up to the tabbed terminal and stores that as `terminal` (the worker is kept as `sender`). Backup `bin/show-add.ps1.bak-parent`.
- Outline follows the mouse (2026-11-09): the layout's pane `focus` border can't know about the pointer, so `mods/ring` (0px block `ring` at the end of the `work` column)
  flips `main` block `pane.focus.color` between `accent` and `border` with `run("layout.set", {layout: <tree>})` (enter = immediate, leave = 50 ms debounce for the gap between sections).
  **`layout.set` applies in ~20 ms; editing the layout file with `writeTextFile` took 250 ms+ before the app showed it** (first version of ring, felt laggy). `layout.set` also persists the file. The side-section mods
  (`my-spaces|my-agents|my-files|my-changes|show`) publish `setShared("ring.<name>", hovered)` from their `on_hover`. Pointer over a section -> the focused pane loses its accent outline;
  pointer elsewhere -> accent again (also self-heals on mod start). Tested by forcing the shared flag (layout file toggled both ways, screenshots). Backup: `layouts/.main-dynamic-tabs.bak-ring.json`.
  Known limit: a hovered but unfocused terminal pane in a split tab is not outlined (only the focused one).

## Side panel (Show) closed itself after a few seconds (fixed 2026-11-09)
- Cause: `mods/tabs-dynamic/main.js` `syncPanel` remembers the panel per space (store: `data/tabs-dynamic/store.json`).
  A space with no remembered choice (`null`) counted as "wants closed", so every detected space change
  (agent.focus / card click jumping spaces, the user switching) or mod reload ran `layout.hide panel`.
  `store.json` was all `null`, so the panel always lost.
- Fix: only restore a remembered *open* panel (`want && want !== now`); never auto-hide. Verified by switching
  Webapps → Archive → herdr with the panel open: it stays. Backup (original): `main.js.bak-panel-autoclose`.
- Debug trick used: mods can't `appendFile`; log by `fs.writeFile` of an in-memory buffer to a file in the app home.
- **The real cause of the hover close** (2026-11-09): `mods/ring/main.js` applies `layout.set` with the layout it reads
  from the layout *file* (panel `hidden: true`, default tab/size) whenever the pointer enters/leaves a section
  (`ring.*` shared flags). Hovering the Show panel therefore closed it. Fix: `carryLive()` copies live
  `hidden`/`active`/`size` from `layout()` into the file layout before `layout.set`. Backup: `ring/main.js.bak-hidden`.
  Rule: never `layout.set` a layout from disk without merging live state. (The `syncPanel` auto-hide fix above is still
  a valid hardening for space switches.)

## Theme reverting to red ember on focus (2026-11-09)
- Cause: **`layout.set` deletes `layouts/.state/<layout>.json`**, which is where `app.theme` stores the pick. `mods/ring` runs
  `layout.set` on every hover enter/leave, so the app fell back to `settings.json` `"theme": "ember"` (the red theme from the start).
- Fix: `mods/theme-switch` `writeAppearance(mode, name)` now also writes `settings.json` `"theme"` = picked theme, and
  `refreshCurrent` falls back to it when the state file is missing. Set settings theme to `everforest` (the current pick).
  Backup: `mods/theme-switch/main.js.bak-themefallback`. Verified: state file gone after `layout.set`, still everforest.
- The layout's other state (panel active/hidden, sizes) is also wiped by `layout.set`; ring's `carryLive()` copies it from `layout()`.

## Claude icons follow the theme (2026-11-09)
- The red Claude glyph is herdr's program icon `icons/claude.svg` (hardcoded `fill="#D97757"`, drawn as a picture).
- `~/.config/herdr-app/programs.json` overrides it with `"tint": true` for both `claude` (process name) **and `claude-code`**
  (the agent's own report; child agents like `rev-*` resolve through it, so `claude` alone left them red). Live, no restart.
- Tinted icons are drawn in each mod's text color: tabs `t.accent` (active) / `t.muted`, agents list `t.foreground`, pane header `t.dim`.
  Undo: delete `programs.json`.

## Pane header corners (2026-11-09)
- Top corners of pane cards showed a square dark fill outside the radius-10 border: the shipped `pane` header mod paints
  `.bg(t.background)` without rounding. Fix: `mod.clone pane -> my-pane`, added `.rounded_t(10)` (match layout `pane.radius`),
  layout `main-dynamic-tabs` `main.content.pane.header.content.mod` = `my-pane`. Backup: `layouts/.main-dynamic-tabs.bak-pane-corners.json`.
- `herdr-app shot` returns the LAST rendered frame: while the window is in the background it doesn't repaint, so shots stay
  pixel-identical and edits look like they didn't apply. Bring the window forward (or wait for activity) before trusting a shot.

## Space icons follow the theme (2026-11-09)
- The letter tiles in `mods/my-spaces` `row()` used a hardcoded `MARK` palette (teal/orange/blue..) + white letter, ignoring the theme.
- Now monochrome: tile bg `t.accent` for the active space, `t.muted` otherwise, letter in `t.background`. Works for dark and light themes.
  `shared("space.colors")` is still assigned in `render()` (other mods like `picker` read it), just no longer drawn here. Backup: `main.js.bak-themed-icons`.

## Sidebar footer slimmed (2026-11-09)
- Footer block `sidebar-footer` now uses clone `mods/my-chrome` (of `workspace-chrome`, `footer` prop); the `brand` block still uses shipped `workspace-chrome`.
- Footer: only Settings (h 24, 12px text, 12px icon), "Add machine" removed, no top border / chrome bg, `justify_end` so there's a gap under the agents card. Layout footer size 69 -> 38 px.
- Backup: `layouts/.main-dynamic-tabs.bak-footer.json`. Add machine is still reachable via `herdr-app do mod.open '{"name":"machine-add"}'`.
- Bottom status bar removed (2026-11-09): `status` block (mod `workspace-status`, 28px) deleted from the `work` column; panes/panel take the height.
  Its "N agents · N needs you" now sits right of Settings in `mods/my-chrome` footer (hidden on the narrow rail). Dropped: "This computer"/branch label and the palette-key hint.
  Backups: `layouts/.main-dynamic-tabs.bak-status.json`, `mods/my-chrome/main.js.bak-status`.
- **Sidebar/tab bar alignment** (2026-11-09): `brand` block is 46px, `tabs` was 42px, so the tab bar's bottom line and the sidebar header missed each other at the divider. `tabs` → 46px, `sidebar-lists` padding `[0,8]` → `[8,8]` so the Spaces card top matches the pane top (work-body padding 8). Padding only takes `n` or `[v,h]`, so the 8px also adds at the bottom above the footer. Backup: `layouts/.main-dynamic-tabs.bak-even.json`.

## CI watcher under Show (mods/ci-watch, 2026-11-09)
- Shows the **local CI** of Webapps, not GitHub Actions (the user ran out of Actions minutes; `my-webapps/scripts/ci-local/run.ps1` replaces it).
- Layout: the `panel` column now holds `panel-body` (stack files/changes/show, `weight 1`, min 160) + block `ci` (`mod: ci-watch`, 120 px, min 48, max 500), `gap 8`.
  Same width as Show, own drag handle for height. Backup: `layouts/.main-dynamic-tabs.bak-ci.json`. Moving it to the left sidebar = move the block into `sidebar-lists`.
- Data (read-only, polled every 3 s while active, 10 s idle):
  - Ship queue `Webapps/.ship-queue`: `lock/holder` (name/since/heartbeat/state; heartbeat > 60 min = stale), `queue/<epoch-ns>-<name>` tickets (mtime > 30 min = dead).
  - Running jobs: `docker ps` projects `cil-<sha7>-<job>` (ignore service `db`); run start = earliest CreatedAt.
  - Done/failed: `Webapps/ci-local-logs/<sha7>/<job>.result` (`<sha> <base> PASS|FAIL|FILTERED <secs>`) with mtime >= run start (mtimes via `stat`, since the mod fs API has no stat).
  - sha -> branch: `git -C my-webapps worktree list --porcelain` (every 30 s).
- Review fixes (2026-11-09): `stat` is NOT on herdr-app's PATH (only Git\cmd), so the mod calls `Git/usr/bin/stat.exe` by absolute path (fallback: no mtimes, then old FAIL results get counted). Earliest start per sha is kept in memory across polls; a failing `docker ps` clears the runs; `ci-watch.demo` is not overwritten by an in-flight poll. Backup: `mods/ci-watch/main.js.bak-review`.
- Commands: `ci-watch.demo` (fake data, for screenshots), `ci-watch.live`, `ci-watch.refresh`. Hover outline: `ring.ci` (added to `mods/ring` KEYS).
- First draft was GitHub-based (gh api); discarded. Its report: `~/.claude/scratch/ci-watch/reports/impl-ci-watch.github-old.md`.
- **Minimal look (2026-11-09):** the user only wants "is something running / how much is queued / RAM left" to decide whether another session may go.
  The card is now one row of three numbers: `running` (ci-local runs; a held ship lock without a docker run counts as 1; pulsing accent dot, green when 0),
  `queued` (ship-queue tickets, yellow when > 0), `GB RAM free` (yellow < 8 GB, red < 4 GB). Names/branches only in tooltips. Click = refresh. Block 62 px.
  RAM: Git's `usr/bin/cat.exe /proc/meminfo` MemFree (~40 ms, matches CIM FreePhysicalMemory; the mod runtime has no os/memory API). Backup of the detailed version: `main.js.bak-verbose`.
- Writing JS through `node -e '...'` with template literals: `\n` / `\s` inside the inner template got un-escaped (real newline in a string literal, regex lost `\s`). Use the Edit tool for code with escapes.

## In-app notifications off (mods/no-toast, 2026-11-09)
- The user sees done/blocked in the Agents sidebar and doesn't want herdr's in-app toasts. There is NO setting for them: `notify()` and herdr's own
  "agent finished / needs you" toasts are drawn by the shipped mod `toast` (fixed name; `settings.json` only has `sounds`).
- Shipped mods are restored at every app start (an edit is moved to `toast-edited[-n]`), so a 0 px layout block `no-toast` (end of the `work` column)
  re-writes `mods/toast/main.js` with a version that closes its overlay on first render (marker line `// PATCHED by mods/no-toast`), re-checks
  6x every 5 s after start, and deletes `toast-edited*` folders that only hold our patch. Side effect: herdr probably shows one "restored" toast at
  start before the patch lands.
- Not affected: sounds (`settings.json` `sounds.enabled`), native Windows toasts from `mods/os-notify` (only when herdr is in the background).
- Test: `herdr-app do no-toast.test` (posts a notification; nothing appears, `herdr-app status` overlays stays []).
- Undo: remove the `no-toast` layout block, copy `mods/no-toast/toast.original.js` over `mods/toast/main.js`. Layout backup: `layouts/.main-dynamic-tabs.bak-notoast.json`.
- **Go/wait strip (2026-11-09):** RAM is shown as % free; the pulsing dot is gone. A 4 px strip at the card's left is green / yellow / red (tooltip = reasons).
  Rules from 1085 ci-local job results (`~/.claude/scratch/ci-watch/reports/explore-ci-load.md`): fail rate ~6% with 1 run alive, ~13% with 2, ~50% with 3+;
  causes = docker address pool exhaustion ("all predefined address pools have been fully subnetted", ~30 pools, one network per job), CPU contention
  (Connection refused / Playwright timeouts), "Cannot allocate memory". Docker VM = 20 CPUs / 15.3 GiB (WSL default, no .wslconfig); run.ps1 has no cross-run guard.
  Red: >= 2 runs, >= 22 cil networks, RAM < 15%. Yellow: 1 run, leftover cil networks of a dead run, queue > 0, RAM < 25%. Else green.
  Backup before: `mods/ci-watch/main.js.bak-verdict`.

## Spinner stray dot (2026-11-09)
- `svg(...).spin(900)` bleeds a 1px dot at the edge of the rotated image (looks like a dot leading the arc). Padding the SVG
  only moves the dot outward, so it comes from sampling at the quad edge, not from the drawing.
- Fix: padded copy `mods/my-chrome/spinner.svg` (viewBox `-2 -2 28 28`) drawn at 14px inside `div().size(12).overflow_hidden()`
  so the edge falls outside the clip. Applied in my-agents, my-pane, tabs-dynamic (backups `main.js.bak-spinner`).
  Shipped mods (picker, agents, tabs, pane) still use the plain spinner.

## CI watcher: "ready" stat + Bundle & Ship button (mods/ci-watch, 2026-11-09)
- 4th stat `ready` = branches with state `ok`/`moved` from `bash Webapps/_tools/ship-ready.sh list --json` (own 10 s throttle `SHIP_MS` inside the poll). Script missing/failing => `–` + reason in the tooltip; the other stats are unaffected.
  Bash by absolute Git path (`Git/bin/bash.exe` already puts /usr/bin on PATH, tested with PATH=System32 only). Tooltip: `<branch> <state> "<title>" [sql=yes]` per line.
- Button "Bundle & Ship" (112x34, right of the stats, card height unchanged at 62 px, layout untouched). Enabled only when ready >= 1 and no holder/ticket named `bundle-*`; disabled = muted + `cursor_not_allowed` + tooltip with the reason.
  Click 1 arms ("Sicher? / Klick nochmal", 5 s), click 2 spawns; then "gestartet: <name>" for 10 s (errors red, text in the tooltip). In demo mode the 2nd click starts nothing.
- Spawn: mod API `hc([...])` from `herdr` (no HC_TERMINAL_ID / PATH needed; `exec` of hc.exe by absolute path is the fallback):
  `run --bg --json --no-notify --name ship-bundle-<HHMMSS> --cwd C:/Users/me/Desktop/Webapps --label ship=bundle -- claude --permission-mode auto "<PROMPT>"`.
  `--label` must be `K=V` (`ship-bundle` alone is rejected: "expected key=value"), so `ship=bundle`. Without a terminal the session has no parent (`parent: null`, `die_with_parent: false`), so it outlives the mod. Args go through as an array: the PROMPT (quotes, em dash, umlauts) arrived as ONE argv entry (tested with a `node -e` echo via a temporary command, since removed).
- Gotcha: `line_height(11)` / a bare string child inside a flex div rendered no text; wrap labels in `div().text_size(..)`. Multi-line label = one div per line (no automatic wrapping, text just clips).
- Gotcha again: a Python heredoc un-escaped `\n` in JS strings (same as the node -e note above). Edit tool only.
- Backup: `mods/ci-watch/main.js.bak-bundle`. Demo data (`ci-watch.demo`) has 2 ready + 1 merged entry.

## Purple-stars wallpaper for nebula + parallax verdict (2026-11-10)
- Active wallpaper: `backgrounds/purple-stars-hd.jpg`, 2560x1440, rendered by `backgrounds/src/gen-purple-stars.py <out> <src>`
  (numpy+Pillow; crisp gaussian star splats, clusters, a few spiked stars, cloud glow from the heavily blurred
  `backgrounds/src/purple-stars-1000-tinted.jpg`). That source is the user's 1000x667 star photo, tinted with ffmpeg
  `hue=s=0.2,colorchannelmixer=rr=0.80:gg=0.50:bb=1.05,colorlevels=romin=0.045:gomin=0.02:bomin=0.075`. Used directly it looked
  low-res, and its CDN (futurecdn `-1000-80`) serves nothing larger. Seed 7 in the script; change it for a different sky.
- Nebula's first image in `mods/theme-switch` (purple-space.png second), thumbs in `backgrounds/thumbs/`.
  Use a NEW filename when replacing a wallpaper, in case the app caches images by path.
  Backups: `mods/theme-switch/main.js.bak-milkyway`, `layouts/.main-dynamic-tabs.bak-milkyway.json` (pre-change state).
- The first `herdr-app shot` right after editing the layout still showed the old image; a second shot a few seconds later had the new one.
- Mouse parallax background: NOT possible. Root `background` is a static image (`fit` cover|contain only, no offset), and
  mods only get `on_mouse_move` while the pointer is over their own element, never over terminals.

## Agents sidebar: Spaces, then status (2026-11-12)
- `mods/my-agents` has a new sort `spaces` ("Spaces, then status", folder icon). It is now the default: the first start sets `shared agents.sort = spaces` once (localStorage `sortDefault`). Priority and the old "Grouped by space" are still in the sort menu (popup height 140 -> 172).
- Each space has a header with a chevron that folds it. Inside are status sections (Needs you / Done / Working / Idle, ids `sp-<space>-sec-<rank>`) that fold on their own. Rows show only the tab or agent name (no "Space ·" prefix) and use the compact status like Priority does.
- Fold state (groups and parent agents) is now kept in localStorage `folds` (it used to reset on reload). Backup: `main.js.bak-space-status`.
- Same-named spaces are merged in the Spaces view (group key `sn-<lowercased name>`, placed where the first one sits in `spaces()`). These are really separate spaces: three called "Webapps" existed on 2026-11-12, made by separate `space.new` calls. There is no command to move a tab or a live terminal into another space (`tab.move` only reorders), so they can't really be merged without restarting the agents.
- Bigger text (2026-11-12): space headers 14px semibold in `t.foreground` (row 34px, chevron 13), agent rows 14px / 34px high, sub-agent rows 13px / 28px. Status section headers stay 11px. Backup: `main.js.bak-bigger`.

## Mod space-dedupe: no duplicate spaces (2026-11-12)
- `mods/space-dedupe` (`place: none`, 0px layout block after `no-toast`; backup `layouts/.main-dynamic-tabs.bak-dedupe.json`). Every second it looks for a space created after the mod started whose machine + name + first terminal's live cwd match an older space. If the new one is only a plain shell (1 tab, no agent), it runs `tab.new {space: <older>, folder: cwd}`, then `space.close {confirmed}`, then `space.select`. If it already runs an agent, it is left alone and only logged. "~" spaces don't count. Spaces that existed at start are never touched. Tested 2026-11-12 with `herdr-app do space.new --folder ...\Webapps`, which became a new tab in the existing Webapps space.
- **GOTCHA (an agent got killed by mistake):** `tab.new` inserts the new tab right after the **active** tab, not at the end, so the tabs after it get new numbers. Never pick a tab to close by its number or position in a list from before. Close by the terminal you created (`hc get <t>` labels `herdr.tab`), or use `pane.close {terminal}`.
- Recovery: a Claude session whose terminal got killed can be resumed by finding its transcript (`~/.claude/projects/<cwd>/*.jsonl`, `aiTitle` = the tab title) and running `hc send <shell terminal> "claude --resume <id>"` in a new shell tab. `tab.new --argv '["claude","--resume",id]' --task ..` got killed after 2 s (cause unclear).
- Space headers (2026-11-12, later): no chevron, `font_normal`, color `t.accent + "b3"` (accent at 70%, follows the theme). Backup: `main.js.bak-accent-title`.
- Status headers inside spaces removed (2026-11-12): rows are still sorted Needs you > Done > Working > Idle within each space; the dots show the state. Backup: `main.js.bak-no-sec-headers`.

## Real wallpapers instead of generated ones (2026-11-12)
- The user disliked the procedural wallpapers (starfield/aurora/topo/dunes/mountains). All of them are replaced with images from github.com/D3Ext/aesthetic-wallpapers (MIT): 3 each for atom-one-dark, ayu-mirage, ember, github-dark, monokai, moonfly, night-owl, oxocarbon, poimandres, solarized-dark, synthwave-84; 1 each for everforest, kanagawa, nebula. dracula, rose-pine-moon and `backgrounds/omarchy/<theme>/` are untouched.
- Files: `backgrounds/extra/<theme>/<n>-<name>.jpg` (max 2560 wide, q90) + `thumbs/` (320 wide); new file names on purpose (the app may cache by path). Mapping to the repo paths: `backgrounds/extra/SOURCES.md` and `backgrounds/extra/d3ext-map.json`.
- Old generated jpgs + thumbs moved (not deleted) to `C:\Users\me\herdr-removed-generated-wallpapers\<theme>\`. Generators (`gen_backgrounds.py`) stay in `theme-tools` but are unused.
- `backgrounds/omarchy/index.json` `backgrounds` arrays rewritten (CRLF kept); the nebula `own` entry in `mods/theme-switch/main.js` now points at `extra/nebula/1-wallhaven-9mjw78.jpg` (backup `main.js.bak-d3ext`). `theme-tools/check.py` follows the new nebula file name.
- Tools in `C:\Users\me\theme-tools\`: `browse_d3.py` (overview sheets of all candidates, filters width >= 1920, ratio >= 1.3), `score_d3.py` (Lab palette-distance hint; it over-ranks plain black logo images, so the final choice was made by eye), `picks_d3.json` (the picks), `install_d3.py` (convert + move old + rewrite index, re-runnable), `picks_sheet.py` / `final_sheet.py` (contact sheets).
- Gotcha: some repo images are ultra-wide (3:1+, e.g. wide_nebula, Z5hj_CoA) and look soft when the app crops them to 16:9; they were swapped for 16:9 ones. A contact sheet that stretches every image to 16:9 hides this; use `final_sheet.py` (cover crop, like the app).

## Todo kanban board (2026-11-12)
- `mods/todo/` (`mod.json` `place: none`, `main.js`, `todo.svg`): global kanban board. Default columns Todo / In progress / Done; columns can be added (+ Column, name edited at once), renamed (click the name), deleted (✕ arms for 3 s, 2nd click deletes, like Show's group delete). Cards: Enter in the "+ Add card" field, double click or ✎ to edit, ✕ deletes, ‹ › move to the previous/next column, ↑ ↓ reorder (buttons appear on hover), or drag & drop (see below).
- Data: `data/todo/board.json` (`{version, columns:[{id,name,cards:[{id,text}]}]}`), created if missing, saved after every change via `writeTextFile` (compare-and-swap, one write at a time), re-read every 5 s when it changed on disk and nothing is unsaved. An invalid file keeps the last good board on screen and is not overwritten. Left empty (3 default columns).
- Look: `theme()` only; no opaque root bg. Columns `t.surface` (translucent via the layout's `colors`), cards `t.background` + `e6` alpha, header `t.chrome`, rounded 10 + 1px `t.border` (accent while hovered). Wallpaper shows through. Not wired into `ring` (not in scope): optional `setShared("ring.todo", h)` + "todo" in ring's KEYS.
- Layout `layouts/main-dynamic-tabs.json`: in the `work` column `work-body` is now inside stack `work-stack` (`active: work-body`) next to block `todo` (`mod: todo`, padding 8). Open board = `layout.select {stack:"work-stack", child:"todo"}`; it covers terminals + right panel + CI card, the sidebar and tab bar stay. Backup: `layouts/.main-dynamic-tabs.bak-todo.json`.
- Tab bar (`mods/tabs-dynamic/main.js`, backup `main.js.bak-todo`): "Todo" button left of Show (highlighted while `work-stack.active === "todo"`); clicking a tab (tab.select) closes the board. Icon `mods/todo/todo.svg`.
- Commands: `herdr-app do todo.toggle` / `todo.demo` (in-memory demo board, not saved) / `todo.reload` / `todo.add:<text>` (adds to the first column). GOTCHA: `<mod>.<command>` only reaches a SHOWN copy, and the todo copy in the hidden stack child is not shown, so `todo.toggle` can only CLOSE the board ("unknown command" while closed). To open/toggle at any time use `herdr-app do tabs-dynamic.todo-toggle` (tab bar mod is always shown; bind it in keys.json if wanted).
- Gotchas: a column needs `h_full()` or it collapses to its content height (flex_1 + absolute scroll area gives 0 px); `todo.demo` data stays in the running copy: touch `mods/todo/main.js` (hot reload) to drop it.
- Review fixes (2026-11-12, backup `mods/todo/main.js.bak-review`): no saves while `badFile` (an invalid hand-edited board.json is no longer overwritten by the next UI change; a valid reload clears it); the save loop stops if `todo.demo` starts mid-save; double click inside the card's edit input no longer restarts the edit; the last column can't be deleted (an empty `columns` list is treated as an invalid file). Known limits: CAS conflict = last writer wins (an external edit within the 5 s reload window gets overwritten); Files/Changes/Show buttons toggle the panel *behind* the open board.
- Keyboard moves (2026-11-12, backup `mods/todo/main.js.bak-keys`): a single click selects a card (accent border, `t.selected` bg) and focuses the board (`cx.focus_handle()` + root `track_focus`). Ctrl+←/→ moves the selected (else hovered) card to the previous/next column (appended at the end), Ctrl+↑/↓ reorders it. Ignored while editing/renaming or when an input has focus (`handle.is_focused()`). keys.json's ctrl-left/right are in the `terminal` context only, so no clash.
- Card description (2026-11-12, backup `mods/todo/main.js.bak-desc`): cards are `{id, text, desc?}`; `desc` is an optional multi-line string (max 10000 chars, key omitted when blank, old files without it load unchanged). Shown under the title in `t.muted` size 12 with line breaks kept, clamped to 3 lines (`max_h(51)` + `overflow_hidden` with `line_height(1.4)`; gpui-kit has no `line_clamp`) unless the card is selected (full text). Edit mode (double click / ✎): title Input + `TextareaState` (`set_auto_grow(3, 12)`) + Cancel/Save buttons. Enter in the title saves, Enter in the textarea = newline, Ctrl+Enter saves (textarea `submit` event with `secondary`, plus the root `on_key_down` as fallback), Esc cancels. Empty title = no change; an emptied description removes `desc`. GOTCHA: `line_height(16)` is a multiplier, not px (text vanished); use a ratio like 1.4.
- Drag & drop (2026-11-12, backup `mods/todo/main.js.bak-drag`): cards can be dragged (built by hand from mouse events, no gpui-kit drag payload; same pattern as tabs-dynamic tab reordering). Card `on_mouse_down` records `press` (buttons/inputs stop their own press, no press while editing/renaming); the root's `on_mouse_move` starts the drag after > 5 px, so click, double click and the hover buttons are unchanged (`on_click` ignores a finished drag for 250 ms). Cards/columns/an end filler (only rendered while dragging) report `hit {col, index}` from their own `on_mouse_move` (upper/lower half of the card = before/after); drop = splice + `save(cx)`, dropping where it came from = no change/no save. Feedback: dragged card opacity .4, target column border `t.accent`, 3 px accent insertion line (absolute, no layout shift), `cursor_grabbing`. Stale state: cancelled by mouse up anywhere on the board, root hover-out, Escape and the next non-card mouse down; a move without a press does nothing. Not verifiable without real mouse input: only the static drag look was checked (test state + screenshot).
- Show/Files/Changes while the board is open (2026-11-12, backup `mods/tabs-dynamic/main.js.bak-showfix`): the click now closes the board (work-stack -> work-body) and shows that panel; before, it toggled the panel hidden behind the board. Empty card title on save keeps the old title (description still saved).
- Tab bar closes the board on ANY active-tab change (2026-11-12, `mods/tabs-dynamic/main.js` render, `this.lastTab`; backup `.bak-tabclose`): click, wheel, keys, space switch, a tab closing. Todo header now gets the accent outline on hover like Show and the columns (`this.hotHead`, backup `mods/todo/main.js.bak-headoutline`).
- Drag known limits (review 2026-11-12): a mouse-up that never reaches the board root (release outside the window) can leave a drag following the pointer; Escape or any click cancels it. FIX (backup `mods/todo/main.js.bak-stuckdrag`): `dragMove` cancels the drag when the pointer is within 4 px of the board root's edge (about to leave), or when a move arrives after a >400 ms pause that began within 40 px of the edge (it left and came back). Uses `e.local_position` / `e.bounds` of the root's on_mouse_move. A drop over a column header goes to the end, not the top.

## my-agents: pin over the icon (2026-11-12)
- Hovering an agent row now swaps the program icon (Claude glyph) for the pin/unpin button (16px slot, same size as the icon). The time stays visible. Before, the pin replaced the time. Backup: `mods/my-agents/main.js.bak-pin-icon`.
- While a row is hovered, its icon is gone, so clicking the icon to fold sub-agents is not possible then; the separate fold chevron still works.

## Pane header title centered (2026-11-12)
- `mods/my-pane` header: icon + name + folder sit between two `flex_1().min_w(0)` spacers (status + hover buttons live in the right one, `justify_end`), so the title stays centered and buttons appearing on hover don't shift it. Backup: `mods/my-pane/main.js.bak-center`.

- **Show header icon buttons** (2026-11-12): "Delete all" is now a Lucide trash icon (`mods/show/trash.svg`; still arms to a red "Delete N?" on the first click), and "Collapse all/Expand all" is a Lucide menu icon (`mods/show/menu.svg`). Both have tooltips. Backup: `main.js.bak-icon-buttons`.

## CI card: only running / queued / RAM (mods/ci-watch, 2026-11-12)
- The user wants only three numbers, styled like the rest of the GUI. The card now uses `t.chrome` (the same translucent bg as the Spaces/Agents cards; it used opaque `t.background` before, which looked out of place), with 16px medium values, 11.5px `t.dim` labels and thin `t.border` separators. Zero values are dim, queued > 0 is yellow, RAM < 25% is yellow and < 15% is red. Tooltips are kept. Click = refresh.
- Removed: verdict strip/word, the "ready" stat, the Bundle & Ship button, the `ship-ready.sh` polling, `hcRun`. Backups: `main.js.bak-shipbutton` (version with the button), `main.js.bak-redesign`, `main.js.bak-bundle`.
- Why the bundle agent never showed in the Agents sidebar: `hc run --bg` makes a terminal with NO pane/tab, and the sidebar only lists terminals in tabs (`hc ls --json`: entries without `"where"` are such hidden ones). `herdr-app do terminal.keep --terminal <t> --place tab` gives one a tab in the *selected* space (no `space` arg). Used by hand on `t84 ship-bundle-112222`, which landed in the herdr space. `herdr-app do` takes `--flag value`; a JSON object as the argument was rejected as an unknown command.

## my-agents: clicked agent no longer drops to the bottom (2026-11-12)
- Bug: clicking a done agent made it jump to the bottom of its space (Idle). `hold()` only kept it with Done if some render saw it *focused + done*; herdr usually reports focused + idle in one update, so the hold never started.
- Fix: `hold()` keeps the last render's status per agent (`this.prev`). The focused agent ranks as Done if it is idle now and was `done` or `working` in the last render (or was already held as Done). So: clicked done agent stays in place; an agent that finishes while you watch it (working -> idle) moves up to Done, not down to Idle. Any other change (working, blocked) still moves it at once. Leaving it still drops it to Idle, as before.
- Backup: `mods/my-agents/main.js.bak-hold-race`.

## CI card: "queued" replaced by "ready to ship" (mods/ci-watch, 2026-11-12)
- Sessions "queue" work with `ship-ready.sh add` → `Webapps/.ship-queue/ready/wt__<name>` (key=value: branch, sha, title, sql, review). The old "queued" stat counted only `queue/` (sessions waiting for the ship lock), which is almost always 0, so the user saw nothing.
- The middle stat is now the count of `ready/` files (foreground when > 0, dim at 0). Tooltip: one line per branch (`[SQL]` flag, title cut to 70 chars), plus "waiting for ship lock: …" when `queue/` has tickets. Backup: `main.js.bak-queued`.

## Sidebar footer as a card (2026-11-12)
- `sidebar-footer` block moved *into* `sidebar-lists` (3rd child, `px 62`, same as the `ci` card) so it gets the column's padding/gap and floats like the other cards. Old 38px footer outside the column removed.
- Space came from Spaces only: weights spaces 0.8377 -> 0.7912, agents 1.1623 -> 1.2088 (keeps the agents card at ~482 layout px at 1032 window px / zoom 1.1).
- `mods/my-chrome` footer = ci-style card: left cell gear (16px) + "settings" label (click = `app.settings`, accent dot when an update is ready), separator, right cell agent count (16px number, "· N" in `t.blocked` + label "agents · needs you"). Rail: gear only.
- Hover outline publishes `ring.footer`; `"footer"` added to `KEYS` in `mods/ring/main.js`.
- Backups: `layouts/.main-dynamic-tabs.bak-footercard.json`, `mods/my-chrome/main.js.bak-footercard`, `mods/ring/main.js.bak-footercard`.

## Sidebar and Show panel same width (2026-11-12)
- Layout: `sidebar` 268 -> 300 px, `panel` 331 -> 284 px. The sidebar cards sit inside `sidebar-lists` padding 8 per side, so panel = sidebar - 16 makes the *visible* cards equal (~310 screen px each at zoom 1.1).
- `mods/ring/main.js` `init`: 300 ms after load, `layout.resize panel` to (sidebar px, or `shared("sidebar.width") ?? 300` on the rail) - 16. Dragged panel widths get saved to the layout file (ring's `layout.set` persists live sizes), so this resets the panel on every app start or ring reload.
- Rail-restore fallback in `my-chrome`/`my-agents` `toggleSidebar` 268 -> 300.
- No CLI command reads the live layout (`layout.get` doesn't exist); measure the screenshot instead.
- Backups: `layouts/.main-dynamic-tabs.bak-equalwidth.json`, `mods/ring/main.js.bak-equalwidth`.

## Spaces card: bigger rows as drop targets (2026-11-12)
- `mods/my-spaces` `row()`: rows 44px high (worktree rows 36), 6px gap between rows (list `.gap(collapsed ? 0 : 6)`), name 16px `font_medium`, max_w 200, letter tile 26px / 14px letter, px 10. For a planned drag-and-drop onto spaces, so they're easy to tell apart. Rail (collapsed) mode unchanged. Backup: `main.js.bak-bigger-rows`.

## Todo -> agent dispatch (2026-11-12)
- Idea: drag a todo card onto a space in the Spaces card; a new tab in that space starts `claude --model claude-opus-5-5 --effort high --permission-mode auto` with the card as its task; the card shows the agent and moves to In progress / Done by itself.
- **Drag across mods:** the todo board publishes `setShared("todo.drag", {card, text, ts})` once a card drag starts (> 5 px). Leaving the board (root `on_hover(false)`, or the pointer at the board's LEFT edge) no longer cancels: the in-board drop target is cleared, the shared value stays. It is cleared (setShared null) by: mouse up on the board, Escape, the root's `on_mouse_down_out` (next press anywhere else), a 20 s timer, and by my-spaces after a drop. `mods/my-spaces` `row()`: with a fresh (< 20 s) `todo.drag` and no own press (`pressed === null`), local rows get an accent fill/border and "start agent"; `on_mouse_up("left")` on such a row = drop. Remote spaces refuse (red note), reorder/click-to-select are unchanged. Board header shows "Drop on a space to start an agent" while dragging.
- **NOT verified with a real mouse** (no automation on the user's display): whether GPUI delivers `on_hover` / `on_mouse_up` to the Spaces rows while the button is held from a press that started in the todo mod. All mods draw into one GPUI window, so it should; if it does not, drops simply never arrive (nothing breaks, the 20 s expiry cleans up). Quick check by hand: drag a card to the left, the row must light up. Test without mouse: `todo.dragdemo` (board open) highlights the first local space; `my-spaces.dispatch:<cardId>:<spaceId>` runs the drop path.
- **Dispatch** (`my-spaces` `startAgent`): reads `data/todo/board.json` (title + desc), refuses when the card's agent is `in_progress`/`blocked` and its terminal is in `agents()` (red note on the row, 3 s), writes `data/todo/briefs/<card>.md`, runs `herdr-app.exe do tab.new --space <id> --name <title cut to 32> --argv '[claude ...]' --task <one line> [--folder ..]` (absolute path `%LOCALAPPDATA%\Programs\herdr-app\herdr-app.exe`; it prints `{space, tab, terminal}`; fallback `run("tab.new")` + diffing the space's tabs), writes `data/todo/status/<card>.json` `{card, state: in_progress, space, space_name, tab, terminal, summary, started}`. Folder = the space's LIVE folder (`place()` = first terminal's cwd), not `w.folder`: space "herdr" was created in Desktop\Webapps but lives in Desktop\herdr. tab.new selects the new tab, which also closes the board.
- **Done script:** `mods/todo/bin/todo-status.ps1 -Card <id> -State done|blocked|in_progress [-Summary ..]` merges into the status JSON (keeps space/terminal, sets `state`, `summary`, `updated`, `finished`, `terminal = $env:HC_TERMINAL_ID` if unset), UTF-8 no BOM, tmp + Move-Item. The brief tells the agent to run it as its very last step.
- **Tracking in the todo mod:** `load()` (5 s timer + `watchFolder(data/todo/status)`) calls `syncStatus()` after reading board.json (serialized with a `loading` flag, skipped while editing/dragging/unsaved). Status -> `card.agent {terminal, space, space_name, tab, state, summary, started, finished, applied}` (kept by `sanitize()`); when `state !== agent.applied` the card moves once to the top of the "In progress|doing|wip" (else 2nd) or "Done" (else last) column. `blocked` does not move. A user's later drag is not undone. The todo copy keeps running while its block is hidden: verified, the card moved with the board closed (board.json rewritten 120 ms after the status file). Card row: live state from `agents()` by terminal (spinner "working", "needs you", "idle", "✓ done", "agent closed"), space name, click = `agent.focus` + close the board; Done cards show the summary (3 lines). Deleting a card deletes its status + brief.
- Commands: `todo.dragdemo`, `todo.del:<cardId>` (new, scripting), `my-spaces.dispatch:<cardId>:<spaceId>`. `herdr-app do pane.close` takes `--pane`, not `--terminal` (look up the pane in `herdr-app ls`).
- End-to-end test passed 2026-11-12: card "Reply OK then mark this card done" -> space herdr -> tab with "Opus 5.5 with high effort", agent replied OK, ran the script, card moved Todo -> In progress -> Done with summary; test tab closed by its own pane, card/status/brief removed.
- GOTCHA: `mods/todo/main.js` was edited by another session at the same time (hover outline on the header, stuck-drag edge cancel `lastMove`); I merged with small Edits only. The stuck-drag rule cancels at the board's top/right/bottom edge; the LEFT edge (sidebar) now keeps the drag alive.
- GOTCHA: `herdr-app shot` lags ~15-20 s behind while the window is in the background; wait before shooting.
- Backups: `mods/todo/main.js.bak-agents`, `mods/my-spaces/main.js.bak-agents`.
- **Review fixes (2026-11-12, backups `mods/todo/main.js.bak-agents-rev`, `mods/my-spaces/main.js.bak-agents-rev`):**
  - `startAgent`: per-card in-flight set (`this.starting`, checked + set before the first await, cleared in `finally`); a second drop/dispatch of the same card while the first runs is refused ("card already has an agent"). The row shows "starting…" (45 s max) at once until the result note replaces it. "Live" = status `in_progress`/`blocked` whose terminal is in `agents()` OR `terminals()`. The `run("tab.new")` fallback is used ONLY when `herdr-app.exe` does not exist (`fs.stat` first); an exec failure/timeout shows an error note and is never retried (the tab may exist).
  - Stale drag: `row()` `on_hover(true)` stores `dropHit = {id, ts}` only while `todo.drag` is set; mouse up dispatches only if `dropHit` is this row and its `ts` equals the current drag's `ts`. Otherwise the mouse up is handled as before (reorder/select).
  - todo edge cancel: only the RIGHT and BOTTOM edges (<= 4 px) and the "pause > 400 ms within 40 px of those edges" rule cancel. The TOP and LEFT edges keep the drag alive (Spaces is top-left; a diagonal drag crosses the top). Safety net: 20 s expiry + `on_mouse_down_out`.
  - `--name`: `herdr-app do` does NOT accept `--name=<v>` ("needs a value"); `--name <v>` takes a value starting with "-" fine, but leading dashes/whitespace are stripped from the tab name anyway (empty -> "todo").
  - `todo-status.ps1`: bad card id writes to stderr via `[Console]::Error.WriteLine` and exits 2 (`Write-Error` + `$ErrorActionPreference='Stop'` exited 1).
  - Retest: card "-Reply OK then mark this card done" dispatched twice 1 s apart to space herdr: exactly one new terminal (3 -> 4), tab named "Reply OK then mark this card do…" (dash stripped), card -> Done with summary; test tab closed by pane, card deleted via `todo.del`, status + brief gone. GOTCHA: closing a tab closes the board, and `todo.*` commands only reach a shown board: open with `tabs-dynamic.todo-toggle` before `todo.del`.

## Sidebar header as a card (2026-11-12)
- `brand` block (46px, still `window_drag`) now uses clone `mods/my-chrome` (default render, no props) instead of shipped `workspace-chrome`.
- Render: outer `div` with `pt(8).px(8)` (inset at top/sides; `sidebar-lists` padding gives the 8px gap below), inner card `rounded(10)`, `t.chrome` bg, 1px `t.border` -> `t.accent` on hover, publishes `ring.brand` (`"brand"` added to ring `KEYS`).
- Backups: `layouts/.main-dynamic-tabs.bak-brandcard.json`, `mods/my-chrome/main.js.bak-brandcard`, `mods/ring/main.js.bak-brandcard`.
- Re-review fix (2026-11-12): **the mod runtime's `fs/promises` has no `stat`** (only readFile, writeFile, readdir, exists, unlink, rmdir, mkdir; gpui-kit.d.ts ~22141). `fs.stat` threw, so every dispatch silently used the `run("tab.new")` fallback. Now `fs.exists(HERDR_APP)`; verified end to end on the exec path (one terminal for two drops 1 s apart). After a tab is made, the card is also blocked from re-drops for 60 s (`this.launched`), even if writing its status file fails. Backup: `mods/my-spaces/main.js.bak-agents-rev2`.
- Still open: a real mouse drag board -> Spaces (whether GPUI delivers hover/mouse-up to my-spaces during a press that started in todo) has not been tested by the user yet. An agent that finishes after its card was deleted leaves an orphan `data/todo/status/<id>.json` (harmless, ignored).

## Git repo + sync scripts (2026-11-12)
- This folder is the git repo `github.com/<you>/herdr-setup` (private, branch main). `manifest.ps1` lists what is tracked (custom mods, layout `main-dynamic-tabs`, keys/programs/settings, themes, backgrounds, the herdr-related `~/.claude` scripts/hooks/skills/agents/quota-bar, `~/theme-tools`, `~/omarchy-tools`).
- `export.ps1` = live -> repo (mirrors deletions, skips `*.bak*`/`*.d.ts`); `install.ps1` = repo -> live (backs up replaced files as `.bak-install-<ts>`, merges `claude-settings.herdr.json` into `~/.claude/settings.json`, appends `claude-CLAUDE.herdr.md` to `~/.claude/CLAUDE.md`, then `layout.switch:main-dynamic-tabs`). Home paths are stored as `C:\Users\me` and rewritten on install (`-HomeDir <dir>` installs into a scratch folder for testing).
- `.gitattributes` `* -text`: files are stored byte-for-byte (the layout keeps CRLF; theme-switch compares it with CAS).
- **New mod / script / hook = add it to `manifest.ps1`**, run `export.ps1`, commit, push.

## Sidebar tint removed (2026-11-13)
- The sidebar column had its own `"background": "<theme bg>b3"`, which stacked on top of the `chrome/surface` alpha and made the left side darker than the panes.
  Removed from `layouts/main-dynamic-tabs.json` (backup `layouts/.main-dynamic-tabs.bak-sidebar-bg.json`) and `mods/theme-switch/main.js` now does `delete sb.background` instead of writing it (backup `main.js.bak-sidebar-bg`).

## Right panel translucent (2026-11-13)
- Show, Files and Changes painted their root card with `.bg(t.background)` (opaque theme color), so the right panel hid the wallpaper.
  Now `.bg(t.chrome)` like the sidebar cards (`my-spaces`, `ci-watch`): `mods/show/main.js`, `mods/my-files/main.js`, `mods/my-changes/main.js`, backups `main.js.bak-translucent`.
  Small buttons inside Show still use `t.background`.
- Sidebar divider line removed (2026-11-13): layout root `divider.width` 1 -> 0 (backup `layouts/.main-dynamic-tabs.bak-divider.json`).
- Tab bar flat (2026-11-13): `mods/tabs-dynamic/main.js` bar root lost `.bg(t.chrome).border_b(1).border_color(t.border)`, so tabs sit directly on the wallpaper like the floating cards (backup `main.js.bak-flat-bar`).
- Tabs same size as the brand card (2026-11-13): tab `h(29) rounded(7)` -> `h(38) rounded(10)`, px 10 -> 12; bar root `.pt(8)` so tabs span 8..46 like the brand card (46px block, 8px inset). Backup `mods/tabs-dynamic/main.js.bak-tab-height`.

## Todo board closes on agent click (2026-11-13)
- `mods/my-agents/main.js` (backup `.bak-todoclose`): agent row / number row / listed sub-agent clicks go through `focusPane(arg)` = `pane.focus` + close the board (`layout.select work-stack -> work-body`). Needed because clicking the agent that is already focused (the current tab's pane) changes neither tab nor focus.
- `mods/tabs-dynamic/main.js` (backup `.bak-paneclose`): besides the tab change, a change of `focused().pane` also closes the board (keys, scripts, other mods). Checked: board open + `pane.focus` on another tab's pane -> board closed, that pane shown.

## Todo card photos (2026-11-13)
- Cards get optional `images: string[]` (file names `<ms>-<rand5>.<ext>`, png/jpg/jpeg/gif/webp/bmp, max 20) in `data/todo/images/<cardId>/`; `sanitize()` keeps only names matching `[\w.-]{1,80}` + image extension. Shown with `image("data/todo/images/<id>/<name>")` (relative to appHome): 56 px thumbs, max 4 + "+n", click = `explorer.exe <file>`. `image().size_full()` in a square box renders contained (no object-fit API).
- Adding: Ctrl+V (`bin/todo-paste.ps1`, `-STA`, Forms clipboard: file drop list -> copy image files, else bitmap -> PNG), drop (`on_drop` on card = attach, on column = new card; `bin/todo-copy.ps1`), "Add photo" in edit mode (`bin/todo-pick.ps1`, OpenFileDialog). Helpers share `bin/todo-lib.ps1` (50 MB cap per file) and print the new names on stdout.
- GOTCHA: a focused `Input`/`Textarea` consumes Ctrl+V itself (its Paste action runs before ancestor `on_key_down`), so the root key handler only works while the board's own focus handle is focused (a card clicked). For inputs use `state.on("paste_other", ...)` = "a paste found no text (an image, say)" (same as frame/feedback). Wired on the edit title/description (-> edited card) and each "+ Add card" input (-> new "Pasted image" card in that column).
- GOTCHA: the mod runtime's `fs/promises` has no `copyFile`/`rm` (only readFile, writeFile, readdir, exists, unlink, rmdir, mkdir; reads below home only); copying goes through PowerShell, dir removal = readdir + unlink + rmdir.
- Card/column delete removes the image dir. my-spaces `startAgent` adds `## Images` (absolute paths) to the brief.
- Scripting: `todo.paste[:<cardId>]`, `todo.attach:<cardId>:<absPath>`, `todo.edit:<cardId>` (board must be open).
- Not verified with real input: Ctrl+V keystroke, Explorer drop, picker dialog (all code paths tested via the commands). Backups `mods/todo/main.js.bak-photos`, `mods/my-spaces/main.js.bak-photos`.

## Agent map (2026-11-13)
- `mods/agent-map/` (`mod.json` `place: none`, `main.js`, `map.svg` + `st-*.svg` station icons, `LICENSE-lot-map.txt`): a live map of every Claude agent, in the style of lot-map (alexeyw, MIT; geometry, timings, route/worn-spoke/folding rules ported from its `hooks/draw.ts`, `feed.ts`, `palette.ts`; credit comment at the top of main.js). Opened like Todo: layout `layouts/main-dynamic-tabs.json` stack `work-stack` has a third child block `agent-map` (padding 8; backup `layouts/.main-dynamic-tabs.bak-agentmap.json`). Tab bar (`mods/tabs-dynamic/main.js`, backup `.bak-agentmap`): "Map" button next to Todo (highlighted while `work-stack.active === "agent-map"`), command `tabs-dynamic.map-toggle`; every "a board is open" check is now `(work-stack.active ?? "work-body") !== "work-body"` (tab click/change, pane focus, Files/Changes/Show buttons close Todo and Map alike). Todo and Map switch to each other with one click.
- Data: `data/agent-map/<terminal>.jsonl` written by a Claude Code hook (schema = `schema.md` of the task, fields ts/sid/sub/ev/id/tool/station/label/file/write/bg). The mod reads only files whose name equals a live agent's address (`agents()[i].address`, chars outside `[A-Za-z0-9_-]` -> `_`), incrementally: offset per file, `watchFolder(dir)` (reads only the changed `.jsonl` files it reports; the folder itself or an empty batch = read all) + 2 s poll (reads all, also drops gone agents), a half-written last line waits (a last line without newline counts only when it already parses), reset when the text got shorter or its first 160 chars changed (the hook trims by tmp + rename). Files whose last event is older than 24 h are ignored; files of terminals that are gone are hidden (state dropped). Reading goes on while the board is hidden (only after the first open: a mod copy starts when first shown); the frame timer does not.
- Board: one map per live agent that has a file (1 = one big map, 2 = side by side, 3-4 = 2x2 or one row, whichever gives the bigger maps, 5+ = 3 per row, scrolling past 9), a feed of the last 16 rows over all agents (folding of consecutive finished rows at one station = `+N`), a Files column (last 10 min, newest first, coloured dots per agent, bold = written, red = written by 2+ agents), below the maps on windows < 860 px wide. Click a map (centre or card) = enlarge it (`ZOOM_MS` animation; click again, the empty area or Esc = back); double-click (`click_count >= 2`) or a click on an agent name in the feed = `agent.focus` + close the board. Station tooltip = last 4 labels. Stations: You, Files, Shell, Network, Browser, Agents, Skills, Memory (no Model station, no context ring). Centre ring = herdr status colour (working/blocked "needs you"/done/idle).
- Effects kept from lot-map: pulse out on `pre`, back on `post`, hollow pulse + ripple for the prompt, red node + red count badge on `fail` until that session's next `prompt` (a `prompt` also closes that session's still-running foreground calls, not bg and not subagent ones: Esc-interrupted calls never get a post), worn spokes (counts per session id, `log2(1+n)/7`), route through the last 7 stations (40 s hold, 20 s fade, newest leg draws itself), xN badge for parallel calls, clock hands (inner 1 min, outer 10 min) while a call runs, background calls stay lit until their post/fail (or session stop + 10 min), subagents as dots circling Agents with their calls flying from there, wide ring on `stop`.
- Animation: three paces, picked in `keepFrames` from `motion()`: `every(33)` only while a pulse, ring, glow/alarm (<= 6.2 s), running call (beat ring + clock hands), route-leg draw (first 0.7 s) or route-leg fade (last 20 s) is in flight; `every(250)` when only subagent dots move; none at rest. A route leg that is holding (static 40 s) schedules one `cx.timer.after` render for the start of its fade (`keepWake`), so nothing ticks while it holds. Timers are created inside `render(cx)` and stop themselves when the board is hidden or everything is still.
- Commands (shown copy only; open the board first with `herdr-app do tabs-dynamic.map-toggle`): `agent-map.demo` (looping 42 s script with 2 agents, a subagent, a failure, a background call and a file conflict, in memory only, files are not read meanwhile), `agent-map.clear` (forgets the state and ignores everything written before now; stops the demo; a mod reload resets both).
- Gotchas learned: (1) `on_size_change` reports WINDOW px (layout px x `settings().zoom`, measured with zoom 1.1: 1573 wide for a 1430 px layout box), so divide by the zoom before computing layout sizes (mouse events too, see Show notes). (2) `layout/.state/<layout>.json` disappears while every stack is at its default child, so it is not a reliable "is the map open" probe; use screenshots. (3) A mod reload (touching main.js) drops the demo; re-send `agent-map.demo`. (4) `window.paint_path` works for polylines with `dash_array`; curves are 16-segment polylines; the context ring uses `arc_to` (split in halves so no piece passes 180°). (5) Text cannot be stroked like lot-map's SVG "rim", so labels sit directly on the translucent card. (6) The map card is `t.surface` like Todo's columns (wallpaper shows through); on a very busy wallpaper the dim hint text needs `t.muted`.
- Tests (v1): a throwaway Node harness covered ingest/apply/settle; replaced by the permanent one below.
- Not verified with real input: hover tooltips, clicks on centre/header/feed names (code paths mirror the Todo agent click), many agents (> 9, scrolling), narrow windows (< 860 px stacked layout), `pane`-focus close while the map is open (same code path as the verified tab change).

## Footer outline stuck after Settings (2026-11-13)
- Clicking Settings in the `mods/my-chrome` footer card left the accent outline (and `ring.footer`) on until the next hover: Settings opens over the card, so GPUI never sends `on_hover(false)`.
- Fix: the Settings cell's click (`openSettings`) sets `this.hot = false`, `setShared("ring.footer", false)`, notifies, then runs `app.settings`. Same pattern applies to any hover-tracked card whose click opens an overlay. Backup: `mods/my-chrome/main.js.bak-settings-hover`.

## Agent map v2 (2026-11-13)
- Hook schema v2 (all additive; the mod reads v1 and v2 lines): `path` = original-case path next to the lowercase matching key `file`; stations `git` and `build` (precedence for a shell line: network > build > git > files/memory > shell); shell label without description = deciding command + subcommand (`git push`, `npm test`), never arguments; `file`/`write` on any station (redirect targets `>`/`>>`/`2>`/`&>`, relative paths resolved against the hook's `cwd`, following a leading `cd`/`pushd`/`Set-Location`; writes inside scripts are NOT detectable); new ev `ask` from a `PermissionRequest` hook (tool/station/label/file, `id` may be ""); `subid` on Agent/Task `post` lines (from `tool_response.agentId`, shape not verified against a live payload); `sub_stop` gets `label` = agent_type; unknown built-in tools: agent-ish names -> agents, ScheduleWakeup/Cron*/RemoteTrigger/PushNotification -> you, rest -> skills.
- Finding: "7 sub_stop vs 2 sub_start" was NOT a hook bug. Claude Code fires SubagentStop (never SubagentStart) for its internal compaction agent; those orphan stops sit right after a `compact` line and have no tool lines. Real subagents do fire SubagentStart. Readers ignore orphan stops.
- Mod: colours by hash of the terminal address with a sticky slot map (no shift when agents come/go); trim (600 -> 400 lines) no longer replays: reading resumes after the last applied raw line (fallback: only ts > last; full reset only if the new file's last line is older); `terminals()[].parent` links herdr workers to their orchestrator (cards ordered parent-first, `↳ parent`, `+N workers`); ask shown only while herdr status is `blocked`; Esc via root `track_focus` + `on_key_down` (board focuses 60 ms after opening); extra commands `agent-map.zoom` / `agent-map.escape` (same code as click/Esc, for CLI tests). 10 stations: BEND got a value for step 5.
- Tab bar badge (`mods/tabs-dynamic`): computed by the tab bar itself (the map mod only runs after its first open): reads the live agents' jsonl incrementally (watchFolder + 3 s timer, full re-read every 10th tick as a safety net; no `fs.stat` in the mod runtime, so no size check), keeps only fail timestamps and the last 10 min of writes. seenAt = mod load time, set to now while the map is open (memory only: a tabs-dynamic reload clears older badges).
- Tests: `node --test test/main.test.mjs` in the mod folder (loader hook + stubs for `herdr`/`gpui-kit`; `node --test test/` fails on Node 24, and herdr-app drops a `gpui-kit.d.ts` into `test/` whenever files there change: harmless, excluded by the manifest). Hook: `node --test ~/.claude/hooks/agent-map.test.mjs`.
- Not verified with a real key press: Esc (only via `agent-map.escape`, same method). Tooltips not hovered.

## Agent map: scroll instead of shrinking (2026-11-13)
- `mods/agent-map/main.js`: `MIN_FIT_W = 250`. The grid is fitted as before (both layouts, biggest maps win); only when even the best fit would make the maps narrower than 250 px (and there are 2+ agents) the board switches to scroll mode: up to 3 maps per row at >= 250 px each, maps area `overflow_y_scroll`, Feed/Files stay below. Replaces the old fixed "scroll past 9 agents" rule, so 6-9 agents on a small window scroll too. Backup: `main.js.bak-scroll`. Unit tests pass; not seen live (CLI `map-toggle` returned ok but the board did not appear in `herdr-app shot`, so open it with the Map button and check with many agents).

## Agent map: pane-less sub-agents, family view (2026-11-13)
- Bug: nested orchestrators/implementers never showed. `agents()` lists only terminals WITH a pane; `hc run` workers (herdr-worker.ps1 without `-Pane`) exist only in `terminals()` (`parent`, `name`, `status`, `state`). The earlier parent-link check only worked because those workers had panes. Fix: `boardAgents(agents(), terminals())` in `mods/agent-map/main.js` adds every live descendant (any depth, status `error` -> blocked, `done` -> idle, name = worker name, space from the root agent), used by the reader and the cards; the tab bar badge (`mods/tabs-dynamic/main.js` `mapScan`) walks `terminals()` the same way. Backups `main.js.bak-subagents` (both mods).
- User wish: the overview shows only main sessions (`boardCards(cards, null)`, `c.subs` = descendants); a main session with sub-agents is drawn with 1-2 offset sheets behind its card (`paperStack`, `SHEET = 5` px, card made narrower by the sheets so the footprint stays) + `+N sub-agents`. One click on it sets `this.family` -> board = that session + all its sub-agents (normal grid, feed/files follow); in there a click enlarges a map, empty area / Esc: unzoom -> leave the family -> close the board. Double-click on a pane-less sub-agent runs `terminal.peek` (nothing to `agent.focus`). `agent-map.zoom` now goes through `clickCard` (so it opens the family of the first card). Backup `main.js.bak-family`. Seen live with a session -> orch-x -> impl-y; real mouse clicks not tested (CLI only).
- Update (same day): navigation is one level at a time. `boardCards(cards, family)` = the family head + its DIRECT children (any card can be a head; `c.subs` = descendants for stacked/clickable cards); `this.path` holds the levels above. Left click: a card with subs (not the head) goes in, else enlarge; a left click on the enlarged map does nothing. `back()` (right click on the board root via `on_mouse_down("right")`, Esc): unzoom, else pop a level; false at the top (right click then does nothing, Esc closes the board). The head of the shown level gets `border_color(t.accent)` (the outline used elsewhere, e.g. my-chrome hover). Backups `main.js.bak-rightclick`, `main.js.bak-levels`.

## Agent map: native motion (2026-11-13)
- Before: every animation was script-drawn (`cx.timer.every(33/250/16)` -> notify -> whole render + whole-window redraw; the tick also ran cards()). Now: pulses, tail dots, ripples, beams, glow/alarm fades, lit node rings, route legs (fade-in, then 20 s fade after the hold) use `.transition` with a plan frozen per element (`tweenPlan`/`tween`, `this.fx` keyed by a stable id: card key + WeakMap uid per entry + kind; first draw = start value, one 16 ms render later = target). Beat ring and core breathing = `.loop` (period 1000 while running: the clock re-renders every 1 s, so a loop restart on re-render, untested, would fall on a cycle end). Subagent dots = `svg(orbit-N.svg).spin(7000)` (N = 1..6 dots; tooltips moved to the Agents station). Script renders remain for new data, one-shot wakes at boundaries (`soon()` -> `keepWake`), 1 s clock-hand ticks while a call runs, and the 16 ms zoom (map content is absolute px from the width, a native width transition can't scale it).
- Bench (Node, Proxy stubs, virtual clock): 42 s demo 1038 -> 223 script renders; at rest no timer.
- Findings: `PathBuilder...build()` results can be reused across renders and elements (static spokes/contours cached by geometry + width + stroke); wrapping a `paint_path` layer in a div and tweening the div's opacity works; absolute children of a bordered absolute node are placed relative to its padding box (offset by -border to cover the border); `spin` turns around the svg's centre. GPUI drops transition state while the board is hidden, so `poll` clears `this.fx`/`fxMemo` when not shown (else a reshow draws targets at once). Not tested: whether a changed delay with an unchanged target restarts a transition; whether re-specifying an unchanged `.loop` restarts it.
- Backup before: `main.js.bak-perf`.
- A `.loop` on width/height keeps the from/to it was first given while its element id stays the same. When a map changes size (opening a level, zoom), the core halo and beat ring kept the old pixel sizes and drew a wrong-sized, odd-looking ring around the core in nested levels. Fix: the loop ids carry the rounded map width (`breath-<key>-<run>-<wM>`, `beat-<key>-<station>-<wM>`), so a new size starts a fresh loop. Backup `main.js.bak-ring`.
