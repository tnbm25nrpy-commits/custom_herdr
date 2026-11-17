// Checks the buttons on a real screen: Claude Code, signed out, resumes a
// turn holding a note between tool calls and a final answer with a code
// block and a table, this plugin loaded from the folder (dev/screens.ts).
// The pointer moves and clicks as a terminal reports them, and each copy is
// read back from tmux's buffer, where Claude Code's OSC 52 lands. Nothing is
// sent to the model.
//
//   bun dev/check-buttons.ts
//
// Stops at the first check that fails, showing the screen.

import { renderReply } from '../hooks/render'
import { widthOf } from '../hooks/width'
import { VERSION, withHome } from './screens'
import type { Pane } from './screens'

const ANSWER = ['Run this:', '', '```bash', 'echo hello', 'ls -la', '```', '', '| name | n |', '|---|--:|', '| a | 1 |', '| b, c | 2 |', '', 'Done.'].join('\n')
const NOTE = 'Let me look first.'
const TURN = [{ prompt: 'set it up' }, { text: NOTE }, { tool: 'ls' }, { text: ANSWER }, { closing: true as const }]
const OPTIONS = { icon: 'standard', replyFormat: 'markdown', blockButtons: 'hover' }
const SIZE = { columns: 80, height: 30 }

// Where `text` is on the screen: its row and its first column, 1-based as a
// mouse report counts them; the first one found after `after` if given.
type At = { row: number; column: number }
function find(screen: string, text: string, after?: string): At | undefined {
  const lines = screen.split('\n')
  const from = after === undefined ? 0 : lines.findIndex(line => line.includes(after))
  if (from < 0) return undefined
  for (let i = from; i < lines.length; i++) {
    const at = lines[i]!.indexOf(text)
    if (at >= 0) return { row: i + 1, column: widthOf(lines[i]!.slice(0, at)) + 1 }
  }
  return undefined
}
const rowOf = (screen: string, text: string) => find(screen, text)?.row

const MOVE = 35
const LEFT = 0
const point = (pane: Pane, at: At) => pane.mouse(MOVE, at.column + 1, at.row)
// A press as a person's lands: the pointer moved onto it first.
const click = (pane: Pane, at: At) => {
  point(pane, at)
  pane.mouse(LEFT, at.column + 1, at.row)
  pane.mouse(LEFT, at.column + 1, at.row, true)
}

// What a click on `label` copies.
async function copy(pane: Pane, label: string, after?: string): Promise<string> {
  const at = await pane.waitFor(`button ${label}`, screen => find(screen, label, after))
  const NOTHING = '(nothing copied)'
  pane.setClipboard(NOTHING)
  click(pane, at)
  return pane.waitFor(`a copy from ${label}`, () => {
    const copied = pane.clipboard()
    return copied === NOTHING ? undefined : copied
  })
}

let checks = 0
function check(what: string, ok: boolean, pane: Pane, detail = '') {
  if (!ok) {
    console.log(`✘ ${what}${detail === '' ? '' : `\n${detail}`}\n\nThe screen:\n${pane.screen()}`)
    process.exit(1)
  }
  checks++
  console.log(`✔ ${what}`)
}
const same = (what: string, got: string, want: string, pane: Pane) =>
  check(what, got === want, pane, `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`)

await withHome(async home => {
  const pane = home.open({ entries: TURN, ...SIZE, plugin: OPTIONS })

  // The plugin loaded, and found the answer final: the closing line drawn,
  // then its Reply.
  const closing = await pane.waitFor('closing line', screen => rowOf(screen, '✻ '))
  const reply = await pane.waitFor('Reply on the closing line', screen => (rowOf(screen, '⧉ Reply') === rowOf(screen, '✻ ') ? rowOf(screen, '⧉ Reply') : undefined)).catch(() => undefined)
  check('the plugin loads and puts Reply on the closing line', reply === closing, pane, '  (Claude Code drew the turn; is the plugin loaded, and the answer read as final?)')
  check('the note between tool calls gets no buttons', pane.screen().split('⧉').length === 2, pane)

  // A code block: its button on hover, at the right of its first row.
  const code = find(pane.screen(), 'echo hello')!
  point(pane, code)
  const copyAt = await pane.waitFor('a code block\'s button on hover', screen => find(screen, '⧉ copy'))
  check('hovering a code block shows its button on its first row', copyAt.row === code.row, pane)
  check('and nothing at its left', find(pane.screen(), '▎') === undefined, pane)
  same('its button copies its code', await copy(pane, '⧉ copy'), 'echo hello\nls -la', pane)
  check('and reads ✓ copied', (await pane.waitFor('✓ copied', screen => rowOf(screen, '✓ copied'))) === code.row, pane)

  // A table: its three buttons on hover, one under another.
  const cell = find(pane.screen(), '│ a ')!
  point(pane, cell)
  const top = rowOf(pane.screen(), '┌')!
  const buttons = await pane.waitFor('a table\'s buttons on hover', screen => {
    const rows = ['⧉ markdown', '⧉ sheet', '⧉ boxed'].map(label => rowOf(screen, label))
    return rows.every(row => row !== undefined) ? rows : undefined
  })
  check('hovering a table shows its three buttons from its first row', buttons.join() === [top, top + 1, top + 2].join(), pane, `  rows ${buttons.join(', ')}, the table's first ${top}`)
  same('sheet copies it as spreadsheet rows', await copy(pane, '⧉ sheet'), 'name\tn\na\t1\nb, c\t2', pane)

  // Reply: markdown first, then rendered while it reads ✓.
  same('Reply copies the markdown', await copy(pane, '⧉ Reply'), ANSWER, pane)
  same('a second press while it reads ✓ copies it rendered', await copy(pane, '✓ Reply'), renderReply(ANSWER), pane)
  pane.close()

  // Always shown: the buttons with the pointer away.
  const always = home.open({ entries: TURN, ...SIZE, plugin: { ...OPTIONS, blockButtons: 'always' } })
  const shown = await always.waitFor('a code block\'s button with the pointer away', screen => find(screen, '⧉ copy'))
  check('with blockButtons always, a code block shows its button unhovered', shown.row === rowOf(always.screen(), 'echo hello'), always)
  always.close()
})

console.log(`All ${checks} checks passed with Claude Code ${VERSION}.`)
