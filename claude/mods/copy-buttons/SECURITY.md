# Security

## Reporting a vulnerability

Please do not open a public issue. Report it privately:
[Report a vulnerability](https://github.com/leonasdev/copy-buttons/security/advisories/new).

Say what you did, what happened, and your Claude Code version, operating
system and terminal. You can expect an answer within a week.

## What counts

- A copy that puts on the clipboard something the screen did not show.
- A transcript, a path or a reply that makes the plugin run anything but its
  own read-only commands (`sh` with `ls`, `grep`, `xargs`, `wc`, `awk`, `head`
  and `tail`, or `powershell.exe` on Windows), or read a file outside Claude
  Code's projects folder.

A Claude Code update that moves or hides the buttons is a bug, not a
vulnerability: [open an issue](https://github.com/leonasdev/copy-buttons/issues).

## Supported versions

Only the latest release gets fixes.
