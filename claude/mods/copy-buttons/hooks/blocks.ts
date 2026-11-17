import type { Token, Tokens } from './vendor/marked.js'

import { lex, renderTable, tsvOf } from './render'

// A code block's contents, its language, and the file it names, if any.
export type CodeBlock = { code: string; language: string; file?: string }

// What a reply offers to copy besides itself, in reading order: its code
// blocks, and its tables as Claude wrote them, as a spreadsheet pastes them
// and as the terminal draws them (`rows` with the header).
export type Copyable =
  | ({ kind: 'code' } & CodeBlock)
  | { kind: 'table'; markdown: string; tsv: string; rendered: string; rows: number }

const FILE_KEYS = new Set(['title', 'file', 'filename', 'name', 'path'])

// What a fence's info names: the language first (`ts`), then a file where one
// is written: after it (`ts src/app.ts`), joined to it (`ts:src/app.ts`), or
// as a key (`python title="main.py"`). The file is kept to its last part.
export function readInfo(info: string): { language: string; file?: string } {
  const words = info.trim().split(/\s+/).filter(word => word !== '')
  const [first = '', ...rest] = words
  const [language = '', joined] = first.split(':', 2)
  const keyed = rest
    .map(word => /^(\w+)=["']?([^"']+)["']?$/.exec(word))
    .find(match => match !== null && FILE_KEYS.has((match[1] ?? '').toLowerCase()))?.[2]
  const bare = rest.find(word => !word.includes('=') && /[./\\]/.test(word))
  const path = joined || keyed || bare
  const file = path?.split(/[/\\]/).filter(part => part !== '').at(-1)
  return file === undefined ? { language } : { language, file }
}

// Found by the same parser that lays the reply out: a block or table inside a
// list item or a quote counts, a block's contents without the indent or `>`
// it is written under.
export function copyables(markdown: string): Copyable[] {
  const found: Copyable[] = []
  const walk = (tokens: readonly Token[] | undefined) => {
    for (const token of tokens ?? []) {
      if (token.type === 'code') {
        found.push({ kind: 'code', code: token.text, ...readInfo(token.lang ?? '') })
        continue
      }
      if (token.type === 'table') {
        const table = token as Tokens.Table
        const markdown = table.raw.trimEnd()
        found.push({ kind: 'table', markdown, tsv: tsvOf(table), rendered: renderTable(table), rows: table.rows.length + 1 })
        continue
      }
      if (token.type === 'list') {
        for (const item of token.items) walk(item.tokens)
        continue
      }
      if ('tokens' in token) walk(token.tokens)
    }
  }
  walk(lex(markdown))
  return found
}

// The code blocks alone.
export function codeBlocks(markdown: string): CodeBlock[] {
  return copyables(markdown).flatMap(found => {
    if (found.kind !== 'code') return []
    const { kind: _, ...block } = found
    return [block]
  })
}
