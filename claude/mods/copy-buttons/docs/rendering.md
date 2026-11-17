# How Claude Code draws a reply, and what the plugin relies on

Facts the hover buttons depend on, each checked against Claude Code 2.1.312 and
2.1.314 on a real screen (tmux, see `manual-testing.md`) unless marked
otherwise. A Claude
Code update can change any of them; the guard in `hooks/register.tsx` (height
and parts must match) keeps a wrong guess from drawing a button on a wrong row.

## The reply's rows

- A reply is drawn two columns in (`● ` on its first row), so its text has
  `columns - 2` cells.
- Lines wrap as wrap-ansi wraps them with `trim: false` (Ink calls
  `Bun.wrapAnsi`): at spaces, a word wider than the row broken where the row
  ends. A row after the first loses one leading space, where more than spaces
  follows (Ink's `mv()`); more stay. `hooks/wrap.ts` `wrap()` follows this;
  `tests/fixtures/` holds rows taken from screens.
- Widths, as Claude Code counts them in wrapping and in tables, are
  `hooks/width.ts` `widthOf()`'s: by grapheme, an emoji sequence 2, any other
  the sum of its code points' (a mark drawn on its letter, Hebrew points and
  a virama among them, 0; an East Asian wide character, Tangut too, 2; else
  1, a mark drawn beside its letter too, such as the Devanagari vowel signs
  `ि` and `ी`, since Claude Code 2.1.326, which counted it 0 before), so a
  Devanagari conjunct takes a column per consonant and per vowel sign drawn
  beside it. Checked on Hebrew, Devanagari, Tamil, Cyrillic with accents,
  Vietnamese and Tangut. Claude Code's own
  `Bun.stringWidth` is Bun 1.4.4's; Bun 1.3.10's differs (it counts Hebrew
  points), so a local `bun` is no oracle for it. tmux draws Devanagari wider
  than Claude Code lays it out and pushes the overflow onto a row of its own,
  so on a tmux screen everything below such a row sits a row lower than laid
  out (the card too looks a row off there).
- A list item's wrapped rows start under its text (past `1. ` or `- `); nested
  items add their own marker's width. On a narrow screen an item has
  `columns - 14` for its indent and marker: the indent is kept to that less 2,
  the marker's cell (marker and space) to what is left, 2 at least, so
  `1. level four` can read `1.level four` (`Fs()` in Claude Code's list).
- A list item ending in a table, a heading or a blank line has a blank row
  after it.
- Ordered lists count `1.` at the top, `a.` one deep (`z.` then `aa.`), `i.`
  two deep, and `1.` deeper still. One deep a list starting below 1 counts in
  numbers; two deep, so does one starting below 1 or running past 3999. A
  marker wider than the cell a narrow screen leaves it wraps in the cell
  (`3998` over `.`), the item as tall as its marker or its text.
- Code blocks are drawn flush: no indent inside a list item, and their wrapped
  rows start at column 0 of the reply too.
- A code block written right after a paragraph or a list item's text touches it
  (no blank row between). Two code blocks can touch too (an indented block, a
  blank line, then a fence).
- A quote's lines read `▎ ` + the line; an empty quote line is `▎`. A quote at
  the reply's left edge is a box with a bar: its wrapped rows start with `▎ `
  again and wrap two columns narrower. Like a table, it has a blank row before
  and after it even where the Markdown has none (`para` then `> quote` on the
  next line; `> quote` then a fence, a list, a heading or `---`); checked on
  Claude Code 2.1.317. A quote in a list item is drawn as text,
  bar and all: its wrapped rows start at column 0.
- A fence whose info is not a language Claude Code's highlighter knows (its
  `supportsLanguage`, compared in lower case: highlight.js's ids and aliases,
  `hooks/languages.ts`) has the info, as written, on a row of its own above
  the code, part of the block: `ts:src/app.ts`, `ts src/app.ts`,
  `python title="main.py"`, `foolang`, `vue`. `ts`, `TS`, `tsx`, `text` have
  none. A grammar a plugin adds is known to Claude Code but not to the list,
  and syntax highlighting turned off draws the row for every language; the
  guard keeps the buttons on the closing line then. Checked on Claude Code
  2.1.317 and 2.1.322.
- The reply's lists, quotes and tables are drawn each on its own and the
  blocks between them as one text, its blank rows at either end trimmed. So
  a code block drawn as a blank row (empty, no info row) is drawn as nothing,
  the blank rows around it too, next to a list, a quote or a table or at the
  reply's start or end; between two blocks of the same text (two paragraphs,
  a heading and a paragraph, a rule) it is a blank row with one on each side.
  A quote's blocks are trimmed so too. In a list item such a block is always
  nothing, the blank rows around it kept. Checked on Claude Code 2.1.322.
- Tabs in code run to the next multiple of 8 columns, counted from where the
  code starts (past a quote's `▎ `), a wide character counting 2.
- `mermaid` fences are drawn as diagrams, not as code. The layout does not
  follow them: the diagram's rows would mean copying Claude Code's diagram
  drawing, large and likely to change. A reply holding one keeps every
  block's button on the closing line. Left so on purpose; a narrower way
  out, not taken: the blocks above the diagram sit where the layout puts
  them whatever its height, so they could keep their own buttons, but with
  no height to check them against (the guard checks the whole reply's).

## Tables

A table at the reply's left edge is drawn as `hooks/table.ts` `fitted()` lays
it out for the full `columns` (not the reply's `columns - 2`), read from Claude
Code's own table component and checked row for row on its screens at 13
widths from 30 to 130 (`tests/fixtures/`):

- It fits when its width is at most `columns - 4`: each column as wide as its
  widest cell (3 at least), the header centered, a rule between every two rows.
- Per column: an ideal width (its widest cell) and a minimum width (its longest
  word), both at least 3.
- Room for the cells: `columns - (1 + 3 × columnCount) - 4`, but at least
  `3 × columnCount`.
- If the ideal widths fit, they are used. Else, if the minimum widths fit, each
  column gets its minimum plus `floor(share × spare)`, `share` its ideal minus
  minimum over the sum of those. Else each gets `min(minimum, cap)`, `cap`
  the widest from `room - 3 × (columnCount - 1)` down that fits them in the
  room, and words may be broken (`hard`); a column whose longest word fits
  under the cap keeps it whole (Claude Code 2.1.326; before, every minimum
  was scaled down by `room / sumOfMinimums`).
- Each cell wraps at its column's width as wrap-ansi wraps with `trim: false`
  and word wrap (Claude Code calls `Bun.wrapAnsi`), empty rows dropped: a space
  where a row ends exactly starts the next row (`│  over the lazy dog`). A row
  is as tall as its tallest cell; shorter cells are centered vertically
  (`floor((tall - own) / 2)` blank rows above).
- If any cell takes more than 4 rows, or the drawn table is still wider than
  `columns - 4`, the table is drawn as lines instead: for each data row,
  `Header: value` lines (the header bold), rows separated by a rule of `─`
  `min(columns - 4, 40)` long. A long value wraps with `trim: true` in
  `columns - 4` less its `Header: `, the rest of it in `columns - 6` on rows
  indented 2, so no line is wider than the reply's rows (Claude Code 2.1.326;
  before, in `columns`, so the reply's rows wrapped a line's end again).
- At most 200 data rows are drawn, then `… N more rows not shown`, in boxes
  or as lines (after a rule there).
- A table inside a list item or a quote is drawn as `hooks/table.ts` `piped()`
  lays it out: as Markdown (`| a | b |` lines, `|---|` under the header, each
  column its widest cell, 3 at least, every cell the header's too as its
  column aligns), never narrowed, its rows wrapped like any text. In a list
  item it is drawn at column 0, like code, and touches the text above it when
  the Markdown does; in a quote each row reads `▎ ` + the row.

## What a render hook gets and may draw

- `e.props.onScreen` (`{ first, last, of }`): rows of the message's site,
  row 0 being the blank row the engine draws above it. `of` is the reply's rows
  plus 1. `first`/`last` are the rows the viewport shows; it is absent before
  the first draw and `null` while off screen.
- An engine node may not sit under a Box with `position`: the plugin draws a
  zero-height relative Box before the reply (hover scopes) and one after it
  (marks and buttons, at negative `top`).
- An absolutely placed Box past the rows the viewport shows is held at the
  viewport's edge, over other rows, not clipped. Everything is clipped to the
  rows on screen by hand (`onScreenPart`).
- A Box drawn over the reply with a background hides the reply's text there;
  one drawn under it shows only in cells the reply leaves empty. So the flash
  redraws the block's rows itself, from the layout.
- A colour may name any key the theme holds, not only those `ThemeKey` types:
  `selectionBg` is a drag selection's (38,79,120 dark, 180,213,255 light,
  ANSI blue in `dark-ansi`, cyan in `light-ansi`).
- Box `hover`: a keyed Box is a hover scope; `hover.scope` joins a named group
  across sites; `display: 'none'` with `hover: { display: 'flex' }` reveals. A
  Box drawn `display: 'flex'` with a hover reveal is refused (the whole render
  is skipped). A hover `backgroundColor` must be a theme key, a name or hex
  (`ansi:…` is refused).
- A `Client`'s props may not hold `undefined`.
- Theme colours seen on the dark theme: `subtle` 80,80,80; dim text 153,153,153;
  `suggestion` 177,185,249; `success` 78,186,101.

## The pointer and the selection

- Claude Code asks the terminal for every pointer move (mode 1003) and SGR
  reports; hover works wherever its own does. A terminal that reports clicks
  only gets no hover: `blockButtons: end-of-answer`.
- A drag selection copies what is on screen, the plugin's text included
  (buttons, a card's redrawn rows). It does not go through `ui.copy`, so it
  cannot be filtered. The reply's two-column indent is left out of it.
- Hover state freezes during a drag: what showed when the drag began stays.
- A click on a `Client` is the module's own: no selection starts there.
- A `Client` posts one `ui.message` a frame: a later post in the same frame
  replaces an undelivered one, so a post on the pointer's leave would drop a
  click just before it. What only lights while the pointer is somewhere is
  a hover group instead: a Box around a `Client`, given a `hover.scope`,
  lights its group while the pointer is on the `Client`.
- A click does not take the hover down.

## Side effects met while testing

- Changing a `userConfig` default in `plugin.json` and reloading a plugin loaded
  with `--plugin-dir` wrote the option into `~/.claude/settings.json` under
  `pluginConfigs["copy-buttons@inline"]`. Pass options with `--settings` instead.
