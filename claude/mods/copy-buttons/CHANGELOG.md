# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html):
a removed or renamed setting option, or a changed default, is a major version.

## [Unreleased]

## [1.5.7] - 2026-11-17

### Fixed

- A table copies as Claude Code 2.1.326 draws it: a vowel sign drawn beside
  its letter (Devanagari, Tamil, Bengali and others) takes a column; a table
  too narrow for its words cuts only its longest words; and one drawn as
  `Header: value` lines wraps a long value with no word left on a row of its
  own. On Claude Code 2.1.325 and before, such a table can copy a column or
  a row off what the screen shows.

## [1.5.6] - 2026-11-14

### Added

- An icon for the plugin, shown where a plugin directory lists it.

## [1.5.5] - 2026-11-12

### Fixed

- The buttons show sooner on a resumed session, on Windows above all: the
  transcript is read through Claude Code's own file reads instead of a
  command, so no PowerShell starts (which took a second or more before the
  first buttons showed, however short the transcript). A transcript over
  4 MiB is still read with `sh` or PowerShell, as before.

## [1.5.4] - 2026-11-11

### Fixed

- A copy's notice (`copied as markdown · click again for rendered`) shows when
  the buttons sit on the row above the closing line, as they do in a narrow
  terminal or beside many code blocks: it moves to the closing line, past its
  text. Where that line has too little room it reads just `copied as
  markdown`, and only where even that does not fit does the ✓ tell the copy
  alone. Before, the notice never showed with the buttons there.

## [1.5.3] - 2026-11-11

### Security

- A copy no longer holds control characters the screen did not show. Claude
  Code draws a reply without them, but a copy took the reply as written, so
  an escape sequence in it reached the clipboard: one that ends a bracketed
  paste (`ESC [ 201 ~`) could make a terminal run what follows it as typed.
  Every copy now leaves out control characters but a tab and a newline.
- On Windows, a path or an id holding `‘`, `’`, `‚` or `‛` can no longer end
  the literal it is written in, in the PowerShell script that reads the
  transcript: PowerShell reads each as it reads `'`, so the rest could be run
  as script, as with a resumed transcript whose message id was written for
  that. No command is run for a session or a reply whose id is not letters,
  digits, `-` and `_`, and PowerShell is run by its path under the system's
  folder, not by a name looked up.

### Fixed

- A reply written with a control character (in a fence's info, say, or in
  its code) keeps its buttons: before, Claude Code refused the row or a
  block's flash, and showed an error under the answer.
- On Windows, the buttons appear for a profile whose folder is named with
  `‘`, `’`, `‚` or `‛` (`C:\Users\D’Angelo`): before, the transcript was
  never read there.

## [1.5.2] - 2026-11-11

### Fixed

- A code block or table keeps its own buttons in an answer with a fence that
  names a file (`ts:src/app.ts`, `python title="main.py"`) or a language the
  highlighter does not know: the plugin now counts the row Claude Code draws
  the fence's info on, above the code. The `rendered` copy has that row too.
- A code block or table keeps its own buttons in an answer with an empty code
  block next to a list, a quote, a table, the answer's start or its end, or
  in a list item: Claude Code draws it as nothing there, and the plugin now
  does too. Before, either case sent every block's button to the end of the
  answer.

## [1.5.1] - 2026-11-10

### Fixed

- With Claude Code 2.1.318 or later, a code block or table keeps its own
  buttons in an answer holding a table too wide for the screen, which Claude
  Code draws as `Header: value` lines: the plugin now indents a long value's
  later rows two, as Claude Code does. Before, the answer could come out a
  row off from what the terminal drew, and every block's button went to the
  end of the answer.

## [1.5.0] - 2026-11-03

### Removed

- The purple bar at a code block's or table's left with the pointer on one of
  its buttons. Where the buttons sit tells which block they copy, and a click
  flashes the block it copied.

## [1.4.2] - 2026-11-03

### Fixed

- A code block or table keeps its own buttons in an answer that has a quote
  written right under a paragraph, a code block or a rule (or a block written
  right under a quote): the plugin now leaves the blank row Claude Code draws
  there. Before, every block's button went to the end of the answer. The
  `rendered` copy has that blank row too.

## [1.4.1] - 2026-10-30

### Fixed

- A forked session whose own transcript is not written yet finds its replies
  on Linux and macOS when the Claude config folder's path holds a space.
- A request's messages, which Claude Code writes to the transcript again, are
  no longer read as the model calling a tool, which could have taken an
  answer's buttons away.

## [1.4.0] - 2026-10-30

### Changed

- A click on a code block's or table's button flashes the block for a
  moment, in the colour a mouse selection takes, instead of keeping it grey
  while ✓ copied shows.

## [1.3.0] - 2026-10-30

### Added

- Setting `blockButtons`: show a code block's or table's buttons on hover
  (`hover`), all the time (`always`), or at the end of the answer
  (`end-of-answer`).

### Changed

- A hovered code block or table shows its buttons alone, so the block no
  longer looks like a button itself. The pointer on one shows a purple bar at
  its left; a click puts it on a grey card while ✓ copied shows.

### Removed

- Setting `blockHover`. Its `off` is now `blockButtons` `end-of-answer`.
- Setting `copiedNotice`: a copy is told above its button, as by default.

## [1.2.0] - 2026-10-30

### Changed

- The buttons at the end of an answer turn purple on hover, like a code
  block's.

### Fixed

- Code blocks and tables kept no hover buttons of their own in answers:
  - with a table too wide for the window
  - with a table inside a list or a quote
  - with lists nested four or more levels deep
  - in very narrow windows
  - in Hebrew, Hindi and other scripts with accent marks
- An empty code block got a button that copied nothing.

## [1.1.0] - 2026-10-29

### Added

- Hover buttons: point at a code block to copy it, or at a table to copy it
  as Markdown (`markdown`), as spreadsheet rows (`sheet`) or with its
  borders (`boxed`).
- Setting `blockHover`: mark the hovered block with a grey card
  (`highlight`) or a bar at its left (`bar`), or turn hover buttons off
  (`off`) for terminals that don't report mouse movement.
- Tables can be copied as Markdown. At the end of an answer, click a table's
  button again to switch to spreadsheet rows, then to boxed.

### Changed

- Buttons turn bold on hover instead of inverting.

## [1.0.0] - 2026-10-27

### Added

- Copy buttons at the end of each answer: the whole reply, each code block,
  each table.
- `Reply` copies the Markdown; click again for the text as shown on screen.
- Tables copy as spreadsheet rows, or as drawn.
- Settings: `icon`, `replyFormat`, `copiedNotice`.

[Unreleased]: https://github.com/leonasdev/copy-buttons/compare/v1.5.7...HEAD
[1.5.7]: https://github.com/leonasdev/copy-buttons/compare/v1.5.6...v1.5.7
[1.5.6]: https://github.com/leonasdev/copy-buttons/compare/v1.5.5...v1.5.6
[1.5.5]: https://github.com/leonasdev/copy-buttons/compare/v1.5.4...v1.5.5
[1.5.4]: https://github.com/leonasdev/copy-buttons/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/leonasdev/copy-buttons/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/leonasdev/copy-buttons/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/leonasdev/copy-buttons/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/leonasdev/copy-buttons/compare/v1.4.2...v1.5.0
[1.4.2]: https://github.com/leonasdev/copy-buttons/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/leonasdev/copy-buttons/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/leonasdev/copy-buttons/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/leonasdev/copy-buttons/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/leonasdev/copy-buttons/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/leonasdev/copy-buttons/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/leonasdev/copy-buttons/releases/tag/v1.0.0
