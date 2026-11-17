import { widthOf, wrapAnsi } from './width'

// A table drawn as the terminal draws it: whole, to copy, or fitted to a
// screen, narrowed or turned into lines when it is too wide; in a list item
// or a quote, as Markdown. Each rule below was read from the terminal's own
// table drawing and checked on its screens.

// A table's cells as the reply reads them, and how each column aligns.
export type Grid = { header: string[]; rows: string[][]; align: readonly (string | null)[] }

// The columns the terminal leaves free beside a table, a column's narrowest
// width, the most rows a cell may wrap to before the table is drawn as lines,
// and the most rows drawn.
const SPARE = 4
const NARROWEST = 3
const TALLEST = 4
const MOST = 200

// Padded to `width` as the column aligns; a text as wide or wider is left as
// it is.
function place(text: string, width: number, align: string | null): string {
  const room = Math.max(0, width - widthOf(text))
  if (align === 'right') return ' '.repeat(room) + text
  if (align === 'center') return ' '.repeat(Math.floor(room / 2)) + text + ' '.repeat(room - Math.floor(room / 2))
  return text + ' '.repeat(room)
}

// A cell's rows at a column's width: wrapped (with `isTrimmed`, the spaces at
// each row's ends taken off), its rows left empty dropped, one empty row for
// nothing.
function cellRows(text: string, width: number, isHard: boolean, isTrimmed = false): string[] {
  if (width <= 0) return [text]
  const wrapped = wrapAnsi(text.trimEnd(), width, isHard)
  const rows = (isTrimmed ? wrapped.map(row => row.replace(/^ +| +$/g, '')) : wrapped).filter(row => row.length > 0)
  return rows.length > 0 ? rows : ['']
}

const moreRows = (hidden: number) => `… ${hidden.toLocaleString()} more ${hidden === 1 ? 'row' : 'rows'} not shown`

// The header's and the rows' cells, each wrapped to its column's width.
const wrapCells = (grid: Grid, rows: string[][], widths: number[], isHard: boolean) =>
  [grid.header, ...rows].map(cells => cells.map((text, c) => cellRows(text, widths[c] ?? 0, isHard)))

// The rows drawn in boxes from their wrapped cells (`wrapCells`), each cell
// padded by one in its column's width, the header centered, the body as each
// column aligns; a row as tall as its tallest cell, the others centered in
// it; a rule between every two rows.
function boxes(grid: Grid, wrapped: string[][][], widths: number[]): string[] {
  const rule = (left: string, mid: string, right: string) =>
    left + widths.map(width => '─'.repeat(width + 2)).join(mid) + right
  const row = (cells: string[][], isHeader: boolean) => {
    const tall = Math.max(1, ...cells.map(lines => lines.length))
    return Array.from({ length: tall }, (_, r) => {
      const texts = cells.map((lines, c) => {
        const own = r - Math.floor((tall - lines.length) / 2)
        return ` ${place(lines[own] ?? '', widths[c] ?? 0, isHeader ? 'center' : (grid.align[c] ?? null))} `
      })
      return `│${texts.join('│')}│`
    })
  }
  const [header = [], ...rows] = wrapped
  const lines = [rule('┌', '┬', '┐'), ...row(header, true)]
  for (const cells of rows) lines.push(rule('├', '┼', '┤'), ...row(cells, false))
  lines.push(rule('└', '┴', '┘'))
  return lines
}

// Each column as wide as its widest cell, three at least.
const ideal = (text: string) => Math.max(NARROWEST, widthOf(text))
const widest = (grid: Grid, rows: string[][], of: (text: string) => number) =>
  grid.header.map((text, c) => Math.max(of(text), ...rows.map(row => of(row[c] ?? ''))))

// The whole table in boxes, every row, every column as wide as its widest
// cell: as the terminal draws a table that fits.
export function boxed(grid: Grid): string[] {
  const widths = widest(grid, grid.rows, ideal)
  return boxes(grid, wrapCells(grid, grid.rows, widths, false), widths)
}

// The table as Markdown, as the terminal draws one in a list item or a quote:
// each column as wide as its widest cell, three at least, every cell (the
// header's too) as its column aligns, a rule of dashes under the header;
// never narrowed, its rows wrapped like any text.
export function piped(grid: Grid): string[] {
  const widths = widest(grid, grid.rows, ideal)
  const row = (cells: string[]) => `| ${cells.map((text, c) => place(text, widths[c] ?? 0, grid.align[c] ?? null)).join(' | ')} |`
  return [row(grid.header), `|${widths.map(width => `${'-'.repeat(width + 2)}|`).join('')}`, ...grid.rows.map(row)]
}

// The table as lines, for each row its cells as `Header: value`, a long value
// wrapped in the screen's width less four (its first row past the header, the
// rest two less, each indented two, the spaces at a row's ends taken off, as
// from Claude Code 2.1.326), rows apart by a rule as wide, forty at most; an
// empty cell under no header left out.
function asLines(grid: Grid, rows: string[][], hidden: number, columns: number): string[] {
  const headers = rows.length === 0 ? [] : grid.header.map(text => text.trim())
  const room = columns - SPARE
  const rule = '─'.repeat(Math.min(room, 40))
  const lines: string[] = []
  for (const cells of rows.length === 0 ? [grid.header] : rows) {
    const own: string[] = []
    cells.forEach((cell, c) => {
      const header = headers[c] ?? ''
      const value = cell.trimEnd().replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
      if (header === '' && value === '') return
      const first = cellRows(value, Math.max(header === '' ? room : room - widthOf(`${header}: `), 10), false, true)
      const wrapped = first.length <= 1 ? first : [first[0] ?? '', ...cellRows(first.slice(1).map(row => row.trim()).join(' '), room - 2, false, true)]
      own.push(header === '' ? (wrapped[0] ?? '') : `${header}: ${wrapped[0] ?? ''}`)
      own.push(...wrapped.slice(1).filter(row => row.trim() !== '').map(row => `  ${row}`))
    })
    if (own.length === 0) continue
    if (lines.length > 0) lines.push(rule)
    lines.push(...own)
  }
  if (hidden > 0) {
    if (lines.length > 0) lines.push(rule)
    lines.push(moreRows(hidden))
  }
  return lines
}

// The table as the terminal draws it on a screen `columns` wide, its first
// 200 rows, then a line saying how many more. Its columns are their widest
// cells where those fit in the screen less four; else, where their longest
// words fit, those widths and the room left shared by what each column lacks
// of its widest; else the longest words, each cut to one width, the widest
// that fits them in the room, words broken (as from Claude Code 2.1.326). Where a cell then wraps past four rows, or the table
// is still too wide, it is drawn as lines instead.
export function fitted(grid: Grid, columns: number): string[] {
  const rows = grid.rows.slice(0, MOST)
  const hidden = grid.rows.length - rows.length
  const count = grid.header.length
  const room = Math.max(columns - (1 + count * 3) - SPARE, count * NARROWEST)
  const longestWord = (text: string) => Math.max(NARROWEST, ...text.split(/\s+/).filter(word => word.length > 0).map(widthOf))
  const fewest = widest(grid, rows, longestWord)
  const most = widest(grid, rows, ideal)
  const sum = (widths: number[]) => widths.reduce((total, width) => total + width, 0)
  let widths = most
  let isHard = false
  if (sum(most) > room) {
    if (sum(fewest) <= room) {
      const spare = room - sum(fewest)
      const lacks = most.map((width, c) => width - (fewest[c] ?? 0))
      const lacking = sum(lacks)
      widths = fewest.map((width, c) => (lacking === 0 ? width : width + Math.floor(((lacks[c] ?? 0) / lacking) * spare)))
    } else {
      isHard = true
      let cap = room - (count - 1) * NARROWEST
      while (sum(fewest.map(width => Math.min(width, cap))) > room) cap--
      widths = fewest.map(width => Math.min(width, cap))
    }
  }
  const wrapped = wrapCells(grid, rows, widths, isHard)
  if (wrapped.some(cells => cells.some(lines => lines.length > TALLEST))) return asLines(grid, rows, hidden, columns)
  const lines = boxes(grid, wrapped, widths)
  if (Math.max(...lines.map(widthOf)) > columns - SPARE) return asLines(grid, rows, hidden, columns)
  return hidden > 0 ? [...lines, moreRows(hidden)] : lines
}
