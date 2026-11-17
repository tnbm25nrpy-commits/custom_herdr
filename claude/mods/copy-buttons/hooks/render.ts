import { Lexer, Tokenizer } from './vendor/marked.js'
import type { Token, Tokens } from './vendor/marked.js'

import { isHighlighted } from './languages'
import { boxed, piped } from './table'
import type { Grid } from './table'

// Lays a reply's Markdown out as text the way the terminal draws it, minus
// the wrapping at the screen's width: what the person sees, to paste where
// Markdown is not read. Each rule below was taken from the terminal's drawing.

// A rendered line; `isFlush` keeps it at the left edge inside a list, where
// the terminal draws code blocks and quotes unindented. `hang` is where its
// wrapped rows start (past a list item's marker); `part` marks a code
// block's or a table's line, `isPartStart` its first, and `codeAt` is where
// a code line's code starts (past a quote's `▎ `). `isQuote` marks a quote's
// line, its wrapped rows starting with its bar again. A table drawn in boxes
// is one line holding its cells (`grid`), drawn whole or fitted to the
// screen's width. An empty code block the terminal draws as nothing is one
// line too, `isGone`, taking no row: its part is still there to count. A
// list item's line names the item (`item`): the columns before its marker,
// its marker's cell (the marker and a space) and, on its first line, the
// marker, which a narrow screen draws in less room.
export type Item = { indent: number; cell: number; marker?: string }
export type Line = {
  text: string
  isFlush?: true
  hang?: number
  part?: 'code' | 'table'
  isPartStart?: true
  codeAt?: number
  isQuote?: true
  isGone?: true
  grid?: Grid
  item?: Item
}

// Inline marks are dropped (`**`, `*`, backticks), entities left as written
// (`&amp;`); a link reads `text (url)`, `text (url) ("title")` with a title,
// or the url alone where the text is it (an email: the address); a reference
// link, which the terminal does not resolve, stays as written; `~~` stays.
function inline(tokens: readonly Token[] | undefined): string {
  if (tokens === undefined) return ''
  return tokens
    .map(token => {
      switch (token.type) {
        case 'strong':
        case 'em':
          return inline(token.tokens)
        case 'codespan':
          return token.text
        case 'del':
          return token.raw
        case 'br':
          return '\n'
        case 'link': {
          if (!token.raw.includes('](') && !token.raw.startsWith('<') && token.raw !== token.href) return token.raw
          const text = inline(token.tokens)
          if (text === token.href || `mailto:${text}` === token.href) return text
          return `${text} (${token.href})${token.title ? ` ("${token.title}")` : ''}`
        }
        case 'image':
          return `${token.text} (${token.href}${token.title ? ` "${token.title}"` : ''})`
        case 'text':
          return 'tokens' in token && token.tokens !== undefined ? inline(token.tokens) : token.text
        default:
          return 'text' in token && typeof token.text === 'string' ? token.text : token.raw
      }
    })
    .join('')
}

const toLines = (text: string): Line[] => text.split('\n').map(line => ({ text: line }))

// Ordered lists count 1., a., i. by depth, and 1. deeper still: letters
// past z run on to aa, ab; a list that starts below 1 counts in numbers, and
// one that runs past 3999 in numbers where it would count in roman.
const ROMANS: [number, string][] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'],
  [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
]

function letters(n: number): string {
  let out = ''
  for (let rest = n; rest > 0; rest = Math.floor(rest / 26)) {
    rest--
    out = String.fromCharCode(97 + (rest % 26)) + out
  }
  return out
}

function roman(n: number): string {
  let rest = n
  let out = ''
  for (const [value, numeral] of ROMANS) {
    while (rest >= value) {
      out += numeral
      rest -= value
    }
  }
  return out
}

function ordinal(n: number, depth: number, first: number, last: number): string {
  if (depth === 1 && first >= 1) return letters(n)
  if (depth === 2 && first >= 1 && last <= 3999) return roman(n)
  return String(n)
}

// A quote in a list item is drawn as text, its bar too: its wrapped rows do
// not start with it again.
const asText = ({ isQuote, ...line }: Line): Line => line

function endsApart(item: Tokens.ListItem | undefined): boolean {
  const last = item?.tokens.at(-1)
  if (last?.type === 'list') return endsApart((last as Tokens.List).items.at(-1))
  return last?.type === 'space' || last?.type === 'heading' || last?.type === 'table'
}

function list(token: Tokens.List, depth: number): Line[] {
  const lines: Line[] = []
  const start = typeof token.start === 'number' ? token.start : 1
  token.items.forEach((item, i) => {
    const marker = token.ordered ? `${ordinal(start + i, depth, start, start + token.items.length - 1)}.` : '-'
    const lead = `${marker} ${item.task ? `[${item.checked ? 'x' : ' '}] ` : ''}`
    const pad = ' '.repeat(marker.length + 1)
    const body = blocks(item.tokens, depth + 1, true, true).map(asText)
    // A blank line before an item after one that ends in a blank line, a
    // heading or a table.
    if (i > 0 && endsApart(token.items[i - 1])) lines.push({ text: '' })
    // A line of a nested item stays its item's, now further in.
    const itemOf = (line: Line, isFirst: boolean): Item =>
      line.item !== undefined
        ? { ...line.item, indent: line.item.indent + pad.length }
        : { indent: 0, cell: pad.length, ...(isFirst ? { marker } : {}) }
    body.forEach((line, j) => {
      const hang = pad.length + (line.hang ?? 0)
      if (j === 0) lines.push({ ...line, text: lead + line.text, hang, item: itemOf(line, true) })
      else if (line.isFlush === true || line.text === '') lines.push(line)
      else lines.push({ ...line, text: pad + line.text, hang, item: itemOf(line, false) })
    })
  })
  return lines
}

// A table's cells as the reply reads them.
const gridOf = (token: Tokens.Table): Grid => ({
  header: token.header.map(cell => inline(cell.tokens)),
  rows: token.rows.map(row => row.map(cell => inline(cell.tokens))),
  align: token.align,
})

// A code block's or a table's lines, the first marking where it starts.
export const asPart = (texts: readonly string[], part: 'code' | 'table', more: Omit<Line, 'text'> = {}): Line[] =>
  texts.map((text, i) => ({ ...more, text, part, ...(i === 0 ? { isPartStart: true } : {}) }))

// In boxes, one line holding its cells, drawn where the reply is laid out; in
// a list item or a quote as Markdown, at the left edge like code.
function table(token: Tokens.Table, isInside: boolean): Line[] {
  const grid = gridOf(token)
  if (isInside) return asPart(piped(grid), 'table', { isFlush: true })
  return [{ text: '', part: 'table', isPartStart: true, grid }]
}

// A fence whose info the highlighter does not know has the info on a row of
// its own above the code, as written (`ts:src/app.ts`).
function infoRow(token: Tokens.Code): string[] {
  const info = token.lang ?? ''
  return info !== '' && !isHighlighted(info) ? [info] : []
}

function block(token: Token, depth: number, isInside: boolean): Line[] {
  switch (token.type) {
    case 'heading':
    case 'paragraph':
      return toLines(inline(token.tokens))
    case 'text':
      return toLines('tokens' in token && token.tokens !== undefined ? inline(token.tokens) : token.text)
    case 'code':
      return asPart([...infoRow(token as Tokens.Code), ...token.text.split('\n')], 'code', { isFlush: true })
    case 'hr':
      return [{ text: '---' }]
    case 'blockquote':
      return blocks(token.tokens, depth, true).map(line => ({
        ...line,
        text: line.text === '' ? '▎' : `▎ ${line.text}`,
        isFlush: true as const,
        isQuote: true as const,
        ...(line.part === 'code' ? { codeAt: (line.codeAt ?? 0) + 2 } : {}),
      }))
    case 'list':
      return list(token as Tokens.List, depth)
    case 'table':
      return table(token as Tokens.Table, isInside)
    case 'space':
      return []
    default:
      return toLines(token.raw.replace(/\n+$/, ''))
  }
}

// Blocks in order, one blank line between two where the Markdown has blank
// lines between them, after a heading, and around a table or a quote but one
// in a list item or a quote (`isInside`); two other blocks written on
// consecutive lines (a paragraph and the code under it) touch.
const isSetApart = (token: Token | undefined) => token?.type === 'table' || token?.type === 'blockquote'

// A code block drawn as a blank row: nothing in it and no info row above.
const isBlank = (token: Token) => token.type === 'code' && token.text === '' && infoRow(token as Tokens.Code).length === 0

// The terminal draws the reply's lists, quotes and tables each on its own,
// and the blocks between them as one text, its blank rows at either end
// trimmed: a blank code block there is drawn as nothing, nor the blank rows
// around it (`- item`, then an empty fence, then text). Within the text, as
// between two paragraphs, it is a blank row. A quote's blocks are trimmed
// so too; a list item's blank code blocks are all drawn as nothing, the
// blank rows around them kept.
const isOwnDrawing = (token: Token) => token.type === 'list' || token.type === 'blockquote' || token.type === 'table'

function gone(tokens: readonly Token[]): Set<Token> {
  const out = new Set<Token>()
  let run: Token[] = []
  const trim = () => {
    const solid = run.filter(token => token.type !== 'space')
    let first = 0
    while (first < solid.length && isBlank(solid[first] as Token)) out.add(solid[first++] as Token)
    for (let last = solid.length - 1; last >= first && isBlank(solid[last] as Token); last--) out.add(solid[last] as Token)
    run = []
  }
  for (const token of tokens) {
    if (isOwnDrawing(token)) trim()
    else run.push(token)
  }
  trim()
  return out
}

function blocks(tokens: readonly Token[] | undefined, depth: number, isInside = false, isItem = false): Line[] {
  const lines: Line[] = []
  const isGone = isItem ? new Set((tokens ?? []).filter(isBlank)) : gone(tokens ?? [])
  const goneLine: Line = { text: '', part: 'code', isPartStart: true, isGone: true }
  let previous: Token | undefined
  let isApart = false
  for (const token of tokens ?? []) {
    if (token.type === 'space') {
      isApart = true
      continue
    }
    if (isGone.has(token) && !isItem) {
      lines.push(goneLine)
      continue
    }
    const drawn = isGone.has(token) ? [goneLine] : block(token, depth, isInside)
    if (drawn.length === 0) continue
    const isBoxed = !isInside && (isSetApart(previous) || isSetApart(token))
    const isSpaced = isApart || previous?.type === 'heading' || isBoxed
    if (previous !== undefined && isSpaced) lines.push({ text: '' })
    lines.push(...drawn)
    previous = token
    isApart = false
  }
  return lines
}

// The terminal reads no link definitions (`[r1]: https://…`): they stay as
// text, and the reference links they would resolve stay as written.
class NoDefinitions extends Tokenizer {
  override def(): undefined {
    return undefined
  }
}

// A table alone, laid out as the terminal draws it.
export const renderTable = (token: Tokens.Table): string => boxed(gridOf(token)).join('\n')

// The reply's tokens as the terminal reads them.
export const lex = (markdown: string): Token[] => new Lexer({ gfm: true, tokenizer: new NoDefinitions() }).lex(markdown)

// A table as a spreadsheet pastes it: a tab between cells, a newline between
// rows, each cell's text as the reply reads (marks dropped, a link with its
// url); a cell holding a tab, a newline or a quote is quoted, quotes doubled.
export function tsvOf(token: Tokens.Table): string {
  const cell = (text: string) => (/[\t\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)
  const row = (cells: readonly Tokens.TableCell[]) => cells.map(c => cell(inline(c.tokens))).join('\t')
  return [row(token.header), ...token.rows.map(row)].join('\n')
}

export function renderReply(markdown: string): string {
  const tokens = lex(markdown)
  return blocks(tokens, 0)
    .flatMap(line => (line.isGone === true ? [] : line.grid === undefined ? [line.text] : boxed(line.grid)))
    .map(text => text.replace(/\s+$/, ''))
    .join('\n')
}

// The reply's lines as `renderReply` lays them out, a table in boxes still
// its cells, with what the wrapping at the screen's width needs.
export const renderLines = (markdown: string): Line[] => blocks(lex(markdown), 0)
