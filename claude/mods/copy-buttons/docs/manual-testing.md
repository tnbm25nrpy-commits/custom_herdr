# Testing on a real screen

`claude plugin test .` checks the trees the hooks draw, not the screen. To see
where things land, drive a real Claude Code in a tmux server of its own and read
the screen back. `dev/check-buttons.ts` does this for the main paths (hover,
click, what each copy holds); the rest is below.

## Start a session on a fixed reply

Resume a session whose reply holds what you want to look at; nothing is sent to
the model. Disable the installed plugin and load this folder, options passed
for this session only:

```sh
tmux -L spike new-session -d -s s -x 120 -y 300 -c ~/.claude/mods/copy-buttons \
  "claude --resume <session-id> --plugin-dir ~/.claude/mods/copy-buttons \
   --settings '{\"enabledPlugins\":{\"copy-buttons@copy-buttons\":false},\
\"pluginConfigs\":{\"copy-buttons@inline\":{\"options\":{\"icon\":\"standard\",\"blockButtons\":\"hover\"}}}}'"
tmux -L spike set -g set-clipboard on   # copies land in tmux's buffer
```

To get a reply with given content, write it as a session of its own:
`dev/screens.ts` writes one (a prompt, the answer and the turn's closing line,
each row compact JSON, as Claude Code writes them; `"role": "assistant"` with a
space is not read as the model's) and resumes it in a home of its own, signed
out, the first run's questions answered. `dev/check-rendering.ts` draws
`dev/samples/` that way.

`/reload-plugins` in that session picks up changed hooks.

## Drive the pointer

Send SGR mouse reports as typed input; columns and rows are 1-based:

```sh
E=$(printf '\033'); m() { tmux -L spike send-keys -t s -l "${E}[<$1;$2;$3$4"; }
m 35 10 20 M          # move (hover) to column 10, row 20
m 0 10 20 M; m 0 10 20 m   # left press, release
m 32 40 22 M          # drag (move with the button held)
m 64 50 10 M          # wheel up; 65 wheel down
```

Send wheel reports slowly when looking for a row: a burst scrolls past it.
`C-End` jumps to the bottom.

## Read the screen

```sh
tmux -L spike capture-pane -p -t s      # text
tmux -L spike capture-pane -p -e -t s   # with colours (e.g. the card's 48;2;80;80;80)
tmux -L spike show-buffer               # what the last copy put on the clipboard
```

Compare a block's rows hovered and not: the card's text must match the reply's
exactly, or a drag while hovered copies the difference.

## Screens for the layout tests

`tests/fixtures/` holds replies and their rows as Claude Code drew them at
several widths; the tests lay each reply out at each width and expect those
rows. `bun dev/capture-fixtures.ts` takes them again (after a Claude Code
update, say), nothing sent to the model: each reply resumed with no plugins at
each width, in a pane tall enough for the whole conversation, the rows kept
from the reply's `●` to the last one before the blank row above its `✻`, two
columns of indent taken off and spaces at the end trimmed. A fixture drawn as
before is left as it is; `git diff tests/fixtures/` shows one drawn otherwise.

## Things to check after a change

- Hover a code block and a table: the buttons alone, at the top right, gone
  when the pointer leaves it; a click flashes it in the selection colour (the
  theme's `selectionBg`, the same as a drag's) for 500ms, whether the pointer
  stays or leaves, its buttons staying as long as `✓ copied` shows.
- With `blockButtons` `always`: the buttons shown with the pointer away, one
  over a row's end in a narrow window on hover only.
- Click each button; `show-buffer` holds the right text; `✓ copied` shows,
  and stays its moment after the pointer leaves. Send the press and a move
  away in one go too (`m 0 …M; m 0 …m; m 35 60 2 M`): the copy still lands.
- A narrow window (30–50 columns): wrapped blocks, the icon alone, covering.
- A block scrolled half off the top and the bottom: the mark only on its rows
  on screen, the button on its first one.
- A reply holding a table wider than the window (the last table of
  `dev/samples/05-tables.md`: narrowed at 80 columns, drawn as lines at 46):
  the card's rows the screen's own, every other block with its own button.
- A reply holding tables in list items and quotes, and text in other scripts
  (`dev/samples/11-nested-tables.md` and `12-scripts.md`): each table its own
  buttons; below Hindi, tmux draws the reply a row lower.
- Lists seven deep and a table of 205 rows (`dev/samples/13-deep-lists.md`
  and `14-long-table.md`): the table's card over all its rows,
  `… 5 more rows not shown` included.
