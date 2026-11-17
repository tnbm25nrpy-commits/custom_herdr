// Takes the screens in tests/fixtures/ again, each fixture's answer drawn by
// Claude Code at each of the fixture's widths (dev/screens.ts). A fixture
// drawn as before is left as it is; one drawn otherwise is written with the
// new rows, and the script exits 1. After a Claude Code update,
// `git diff tests/fixtures/` shows what it draws otherwise, and
// `claude plugin test .` what the layout gets wrong.
//
//   bun dev/capture-fixtures.ts [fixture ...]   (default: every fixture)

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import * as deep from '../tests/fixtures/deep'
import * as nested from '../tests/fixtures/nested'
import * as samples from '../tests/fixtures/samples'
import * as tmuxAgents from '../tests/fixtures/tmux-agents'
import { draw, VERSION } from './screens'
import type { Shot } from './screens'

type Fixture = { answer: string; screens: Record<number, string[]> }
const FIXTURES: Record<string, Fixture> = { deep, nested, samples, 'tmux-agents': tmuxAgents }
const FOLDER = join(dirname(new URL(import.meta.url).pathname), '..', 'tests', 'fixtures')

// The fixture's file with its screens replaced, its header naming the
// Claude Code that drew them.
function rewrite(fixture: string, screens: Record<number, string[]>) {
  const file = join(FOLDER, `${fixture}.ts`)
  const source = readFileSync(file, 'utf8')
  const header = source.slice(0, source.indexOf('export const answer')).replace(/Claude Code \d+\.\d+\.\d+/, `Claude Code ${VERSION}`)
  const widths = Object.keys(screens).map(Number).sort((a, b) => b - a)
  const body = widths.map(columns => `  ${columns}: [\n${screens[columns]!.map(row => `    ${JSON.stringify(row)},\n`).join('')}  ],\n`).join('')
  writeFileSync(file, `${header}export const answer = ${JSON.stringify(FIXTURES[fixture]!.answer)}\n\nexport const screens: Record<number, string[]> = {\n${body}}\n`)
}

const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(FIXTURES)
for (const name of names) if (!(name in FIXTURES)) throw new Error(`no fixture ${name}: one of ${Object.keys(FIXTURES).join(', ')}`)

const shots: (Shot & { fixture: string })[] = names.flatMap(fixture =>
  Object.entries(FIXTURES[fixture]!.screens).map(([columns, rows]) => ({
    fixture,
    name: fixture,
    answer: FIXTURES[fixture]!.answer,
    columns: Number(columns),
    rows: rows.length,
  })),
)
const drawn = await draw(shots)

// A fixture drawn as before is left as it is, its header naming the Claude
// Code that first drew it so: no diff means nothing changed.
const changed = names.filter(name => {
  const screens = Object.fromEntries(shots.flatMap((shot, i) => (shot.fixture === name ? [[shot.columns, drawn[i]!]] : [])))
  if (Bun.deepEquals(screens, FIXTURES[name]!.screens)) return false
  rewrite(name, screens)
  return true
})
console.log(
  changed.length === 0
    ? `Took ${shots.length} screens with Claude Code ${VERSION}: all as before.`
    : `Took ${shots.length} screens with Claude Code ${VERSION}: ${changed.join(', ')} drawn otherwise, see git diff tests/fixtures/.`,
)
process.exit(changed.length === 0 ? 0 : 1)
