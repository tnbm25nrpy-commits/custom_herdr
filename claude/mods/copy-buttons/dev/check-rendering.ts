// Checks the `rendered` copy against the terminal's own drawing, sample by
// sample: each sample is drawn by Claude Code as an answer, in a pane wide
// enough that nothing wraps (dev/screens.ts); the sample goes through
// renderReply, and the result is compared line by line with the screen.
// Nothing is sent to the model.
//
//   bun dev/check-rendering.ts [sample.md ...]   (default: dev/samples/*.md)
//
// With CHECK_OUT=<folder>, each sample's screen and rendered copy are
// written there (<name>.screen.txt, .rendered.txt) to diff.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { renderReply } from '../hooks/render'
import { draw, VERSION } from './screens'

const HERE = dirname(new URL(import.meta.url).pathname)
const COLUMNS = 400

const samples = process.argv.slice(2).length > 0
  ? process.argv.slice(2).map(path => resolve(path))
  : readdirSync(join(HERE, 'samples')).filter(name => name.endsWith('.md')).sort().map(name => join(HERE, 'samples', name))

// Where the copy differs from the screen on purpose, or tmux draws otherwise:
// a table's rows past 200, which the copy keeps and the screen leaves out for
// a line saying how many; and Devanagari, of which tmux drops vowel signs and
// spaces, compared by its consonants (as in tests/copy-buttons.test.tsx).
function asDrawn(screen: string[], copy: string[]): string[] {
  let lines = copy
  screen.forEach((row, i) => {
    if (!/^… [\d,]+ more rows? not shown$/.test(row) || lines[i] === row) return
    const end = lines.findIndex((line, k) => k >= i - 1 && line.startsWith('└'))
    if (end >= 0) lines = [...lines.slice(0, i - 1), lines[end]!, row, ...lines.slice(end + 1)]
  })
  return lines
}
const consonants = (row: string) => (/[\u0900-\u097f]/.test(row) ? row.replace(/[^\u0915-\u0939]/g, '') : row)

const answers = samples.map(sample => readFileSync(sample, 'utf8').trimEnd())
const copies = answers.map(answer => renderReply(answer).split('\n'))
const drawn = await draw(samples.map((sample, i) => ({ name: basename(sample), answer: answers[i]!, columns: COLUMNS, rows: copies[i]!.length })))

let failed = 0
for (const [i, sample] of samples.entries()) {
  const want = drawn[i]!
  const got = asDrawn(want, copies[i]!)
  const out = process.env.CHECK_OUT
  if (out !== undefined) {
    mkdirSync(out, { recursive: true })
    const name = basename(sample, '.md')
    writeFileSync(join(out, `${name}.screen.txt`), `${want.join('\n')}\n`)
    writeFileSync(join(out, `${name}.rendered.txt`), `${got.join('\n')}\n`)
  }
  const same = (i: number) => got[i] !== undefined && consonants(want[i]!) === consonants(got[i])
  const diffs = want.flatMap((_, i) => (same(i) ? [] : [i])).concat(got.length > want.length ? [want.length] : [])
  if (diffs.length === 0) {
    console.log(`✔ ${basename(sample)}: ${want.length} lines identical`)
    continue
  }
  failed++
  console.log(`✘ ${basename(sample)}: ${diffs.length} lines differ`)
  for (const i of diffs.slice(0, 12)) {
    console.log(`  line ${i + 1}\n    screen:   ${JSON.stringify(want[i] ?? null)}\n    rendered: ${JSON.stringify(got[i] ?? null)}`)
  }
}

console.log(failed === 0 ? `all samples match Claude Code ${VERSION}` : `${failed} of ${samples.length} samples differ from Claude Code ${VERSION}`)
process.exit(failed === 0 ? 0 : 1)
