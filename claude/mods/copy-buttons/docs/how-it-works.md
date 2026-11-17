# How it works

To tell a turn's final answer from the notes Claude writes between tool calls, the plugin reads the session's transcript, which Claude Code keeps in `~/.claude/projects/`. It reads it through Claude Code's own file reads, starting no process. A transcript over 4 MiB, more than one such read takes, and a forked session that has not written its own yet, are read with read-only commands: `sh` with `ls`, `grep`, `xargs`, `wc`, `awk`, `head` and `tail` on Linux, macOS and WSL, or `powershell.exe` on Windows.

To put buttons on a code block or table, it lays the answer out as the terminal does at the window's width, and trusts that only while the answer's height matches the one Claude Code reports; otherwise they keep their buttons at the end of the answer. After a copy, the flash redraws their rows over Claude Code's own. What that layout relies on: [rendering.md](rendering.md).

It writes no files, keeps nothing between sessions and makes no network requests. Copying goes through Claude Code's own clipboard support.

The Claude desktop app has its own copy buttons for replies and code blocks, and its tables copy straight into spreadsheets, so there the plugin stays out of the way: it draws nothing and runs nothing.

## What it relies on

Things Claude Code does not promise to keep stable: the transcript format, where the closing `✻` line is drawn, how replies are rendered and wrapped, and the plugin API, which is in early access. A Claude Code update can change any of them.

- A `mermaid` code block is drawn as a diagram, which the plugin does not follow: in an answer holding one, code blocks and tables get no buttons of their own, and theirs are at the end of the answer instead.
- In tmux, an answer holding Devanagari (Hindi) is drawn a row lower below each line tmux finds too long, so a block's buttons and flash there look a row off.
