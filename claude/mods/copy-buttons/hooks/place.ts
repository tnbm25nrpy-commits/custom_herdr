import { GAP } from './fit'
import { widthOf } from './width'
import type { Layout, Span } from './wrap'

// The ways a part's buttons can be shown, widest first, each by the columns
// and rows it takes (a code block: `⧉ copy`, then its icon alone; a table:
// its three buttons one under another, then one as its icon alone). The last
// is the narrowest, one row high, which also covers a row's end.
export type Size = { width: number; height: number }
export type SizesOf = (kind: Span['kind']) => readonly Size[]

// A code block or table that gets buttons of its own: which of the reply's
// parts it is, the row it starts on (the reply's row k is drawn at k + 1,
// below the blank row), its rows as drawn, the column its card ends at, from
// the reply's left edge, and `size`, which of its kind's sizes it shows;
// `pastWidest`, where its buttons sit past its widest row, the column they
// start at on whichever row they are drawn. Else they sit at the screen's
// right.
export type Block = { index: number; kind: Span['kind']; top: number; rows: string[]; right: number; size: number; pastWidest?: number }

// Columns a row of the reply takes, its two of indent counted and the space
// a wrap leaves at its end not.
const used = (row: string) => 2 + widthOf(row.trimEnd())

// Whether buttons fit at the screen's right of the rows from `row` they take,
// a gap after each row's text and a column after them.
const fitsAtRight = (rows: readonly string[], row: number, size: Size, columns: number) =>
  rows.slice(row, row + size.height).every(text => used(text) + GAP <= columns - 1 - size.width)

// Each part's buttons on its first row, in its kind's sizes from the widest:
// past its widest row, where the screen has room for them and a column
// after; else, its card as wide as the screen, at the screen's right, where
// the row leaves room. Failing every size, the narrowest over the row's end
// (`placeOn`). A part `isEmpty` says has nothing to copy gets none.
export function placeBlocks(layout: Layout, isEmpty: readonly boolean[], columns: number, sizesOf: SizesOf): Block[] {
  return layout.parts.flatMap(({ kind, start, end }, index): Block[] => {
    if (isEmpty[index] === true) return []
    const rows = layout.rows.slice(start, end + 1)
    const block = { index, kind, top: start + 1, rows }
    const pastWidest = Math.max(...rows.map(used)) + GAP
    const sizes = sizesOf(kind)
    for (const [size, each] of sizes.entries()) {
      if (pastWidest + each.width + 1 <= columns) return [{ ...block, right: pastWidest + each.width + 1, size, pastWidest }]
      if (fitsAtRight(rows, 0, each, columns)) return [{ ...block, right: columns, size }]
    }
    return [{ ...block, right: columns, size: sizes.length - 1 }]
  })
}

// Where a part's buttons go on one of its rows (the first on screen), and in
// which size: past its widest, where they were placed so; else at the
// screen's right, where the row leaves room; else in the narrowest size over
// the row's end, a space before it (`isOver`), the two taking the screen's
// last columns.
export function placeOn(block: Block, row: number, columns: number, sizesOf: SizesOf) {
  if (block.pastWidest !== undefined) return { at: block.pastWidest, size: block.size, isOver: false }
  const sizes = sizesOf(block.kind)
  const size = sizes[block.size] ?? { width: 0, height: 1 }
  if (fitsAtRight(block.rows, row, size, columns)) return { at: columns - 1 - size.width, size: block.size, isOver: false }
  const narrowest = sizes.length - 1
  return { at: columns - 1 - (sizes[narrowest]?.width ?? 0), size: narrowest, isOver: true }
}

// The part of a block on screen: its first row there (`from`, as `top`
// counts) and its rows from it; none while the reply is off screen (`null`)
// or the block is scrolled past. A surface that does not say counts it all.
export function onScreenPart(block: Block, onScreen: { first: number; last: number } | null | undefined) {
  if (onScreen === null) return undefined
  const from = Math.max(block.top, onScreen?.first ?? block.top)
  const to = Math.min(block.top + block.rows.length - 1, onScreen?.last ?? Infinity)
  if (to < from) return undefined
  return { from, lines: block.rows.slice(from - block.top, to - block.top + 1) }
}
