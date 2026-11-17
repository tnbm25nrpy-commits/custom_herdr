// A reply's text as the plugin reads, draws and copies it: without its
// control characters. Claude Code draws none as written (an escape sequence
// loses its ESC, or colours what follows), so a copy holding them would put
// on the clipboard what the screen never showed, for a terminal to act on
// when it is pasted: `ESC [ 201 ~` ends a bracketed paste, and what follows
// it runs as typed. And the engine refuses a tree whose text holds one, which
// took the row and a block's flash off a reply written with any.
//
// A tab and a newline stay. A line's end written `\r\n` or `\r` is a newline,
// as the Markdown parser reads it.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g

export const clean = (text: string): string => text.replace(/\r\n?/g, '\n').replace(CONTROL, '')
