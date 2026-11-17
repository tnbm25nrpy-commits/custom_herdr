import { widthOf } from './width'

// A copy action: the reply's, or a code block's named by its file or its
// language (`name`, before any number is put to it).
// `formats`, where it has two, are what its presses copy in turn, each one's
// text laid out when pressed; `size` tells how much a copy took (`5 lines`).
export type Action = {
  key: string
  label: string
  text: string
  isReply: boolean
  name?: string
  isFile?: boolean
  formats?: readonly { format: 'markdown' | 'rendered' | 'spreadsheet'; text: () => string }[]
  size?: (copied: string) => string
}

// Names numbered where several share one (`bash 1`, `bash 2`); a name alone is kept.
export function numbered(names: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return names.map(name => {
    if (names.filter(other => other === name).length === 1) return name
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    return `${name} ${n}`
  })
}

// One thing on the row: a copy action, or a button paging through the
// actions that did not fit (`› 3 more`, `‹ back`).
export type Item = { kind: 'action'; action: Action } | { kind: 'more'; count: number } | { kind: 'back' }

// Columns between two items on the row.
export const GAP = 2

export const labelOf = (item: Item) =>
  item.kind === 'action' ? item.action.label : item.kind === 'more' ? `› ${item.count} more` : '‹ back'

// An item's columns: an action's icon, a space and its label; a page button's label.
export const widthOfItem = (item: Item) => (item.kind === 'action' ? 2 : 0) + widthOf(labelOf(item))

const widthOfRow = (items: readonly Item[]) =>
  items.reduce((sum, item) => sum + widthOfItem(item), 0) + GAP * Math.max(0, items.length - 1)

const asItems = (actions: readonly Action[]): Item[] => actions.map(action => ({ kind: 'action', action }))

const SHORT: Record<string, string> = {
  bash: 'sh',
  shell: 'sh',
  zsh: 'sh',
  console: 'sh',
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  ruby: 'rb',
  rust: 'rs',
  golang: 'go',
  kotlin: 'kt',
  csharp: 'cs',
  powershell: 'ps1',
  markdown: 'md',
  yaml: 'yml',
  plaintext: 'txt',
  text: 'txt',
  dockerfile: 'docker',
  table: 'tbl',
}

const FILE_ROOM = 10

// The code blocks' labels cut short: a language to its usual short name, else
// its first four letters; a file name past ten columns to nine and `…`;
// numbered again where short names now repeat.
export function abbreviate(actions: readonly Action[]): Action[] {
  const shortOf = (action: Action) => {
    const name = action.name ?? action.label.replace(/ \d+$/, '')
    if (action.isFile === true) return [...name].length > FILE_ROOM ? `${[...name].slice(0, FILE_ROOM - 1).join('')}…` : name
    const language = name.toLowerCase()
    return SHORT[language] ?? (language.length > 6 ? language.slice(0, 4) : language)
  }
  const blocks = actions.filter(action => !action.isReply)
  const labels = numbered(blocks.map(shortOf))
  let next = 0
  return actions.map(action => (action.isReply ? action : { ...action, label: labels[next++] ?? action.label }))
}

// Pages of the row in `room` columns: the reply's action on the first,
// `‹ back` leading the others, then as many code blocks as fit with
// `› N more` where some are left.
function paginate(actions: readonly Action[], room: number): Item[][] {
  const reply = actions.filter(action => action.isReply)
  const blocks = actions.filter(action => !action.isReply)
  const pages: Item[][] = []
  let next = 0
  do {
    const items: Item[] = pages.length === 0 ? asItems(reply) : [{ kind: 'back' }]
    const first = next
    while (next < blocks.length) {
      const block = blocks[next] as Action
      const left = blocks.length - next - 1
      const trial = [...items, { kind: 'action', action: block } as const, ...(left > 0 ? [{ kind: 'more', count: left } as const] : [])]
      // A page takes one block even where it does not fit, so paging ends.
      if (widthOfRow(trial) > room && next > first) break
      items.push({ kind: 'action', action: block })
      next++
    }
    if (next < blocks.length) items.push({ kind: 'more', count: blocks.length - next })
    pages.push(items)
  } while (next < blocks.length)
  return pages
}

// Where the row goes and what it holds, trying in turn: every label whole
// beside the closing line's text; whole on the blank row above it; cut short
// there; then paged there, `page` the one shown.
export function layoutRow(
  actions: readonly Action[],
  beside: number,
  above: number,
  page: number,
): { isAbove: boolean; items: Item[]; pages: number } {
  const whole = asItems(actions)
  if (widthOfRow(whole) <= beside) return { isAbove: false, items: whole, pages: 1 }
  if (widthOfRow(whole) <= above) return { isAbove: true, items: whole, pages: 1 }
  const short = abbreviate(actions)
  if (widthOfRow(asItems(short)) <= above) return { isAbove: true, items: asItems(short), pages: 1 }
  const pages = paginate(short, above)
  const shown = pages[Math.min(Math.max(0, page), pages.length - 1)] ?? []
  return { isAbove: true, items: shown, pages: pages.length }
}

// Where a copy's notice sits on its row, by the columns from the screen's
// right to the notice's end: its first letter over the pressed action's icon
// (`over` columns from the screen's right), held within the screen and off the
// row's first `min` columns. The first of the notice's `widths`, longest
// first, that fits there; none where none does.
export function placeNotice(
  widths: readonly number[],
  over: number,
  min: number,
  columns: number,
): { choice: number; right: number } | undefined {
  for (const [choice, width] of widths.entries()) {
    const most = columns - min - width
    if (most >= 0) return { choice, right: Math.min(Math.max(0, over - width), most) }
  }
  return undefined
}
