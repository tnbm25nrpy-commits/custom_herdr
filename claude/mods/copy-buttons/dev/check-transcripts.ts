// Looks for what Claude Code writes that the transcript reader
// (hooks/readers.ts) does not expect, in the transcripts written here: the
// tokens its scan prints for each, against those each row's parsed fields
// call for. Where Claude Code writes rows the scan reads otherwise (a new row
// type holding the same words, a field renamed), they differ. Also flags what
// the scan would miss quietly: an interactive session's transcript with
// answers and no closing line, and row types or content not seen before.
//
// No test: what it reads, and so finds, depends on what was done here
// lately. A case it turns up belongs in dev/check-readers.ts, where it stays.
// dev/check-live.ts runs it on the one transcript a new Claude Code writes.
//
//   bun dev/check-transcripts.ts [transcript.jsonl ...]   (default: the newest 30)
//
// Reads only: each transcript is copied first, so one still being written
// reads whole.

import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { posix, powershell, windows } from '../hooks/readers'
import { fold } from '../hooks/transcript'

const NEWEST = 30
const PROJECTS = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')
const reader = process.platform === 'win32' ? windows(PROJECTS, powershell(process.env.SystemRoot)) : posix

// What Claude Code wrote up to 2.1.314. A type not here may be one the scan
// should read, or one it reads by mistake (as `api-request-blob` once was).
const ROW_TYPES = new Set([
  'user', 'assistant', 'system', 'attachment', 'api-request', 'api-request-blob', 'api-request-shape', 'last-prompt', 'atis-latch', 'mode',
  'permission-mode', 'ai-title', 'custom-title', 'agent-name', 'file-history-snapshot', 'file-history-delta', 'cost-state', 'queue-operation',
  'relocated', 'worktree-state', 'bridge-session', 'dev-mods', 'tools-used',
])
const CONTENT = new Set(['assistant text', 'assistant tool_use', 'assistant thinking', 'assistant redacted_thinking', 'user text', 'user tool_result', 'user image'])

type Row = { type?: string; subtype?: string; isSidechain?: boolean; uuid?: string; entrypoint?: string; version?: string; message?: { content?: unknown } }
type Token = { token: string; line: number }

// The token a row calls for, by its fields: what the scan means to print.
function tokenOf(row: Row): string | undefined {
  if (row.isSidechain === true) return undefined
  const content = row.message?.content
  const first = Array.isArray(content) ? (content[0] as { type?: string } | undefined)?.type : undefined
  if (row.type === 'system' && row.subtype === 'turn_duration') return 'D'
  if (row.type === 'assistant' && first === 'tool_use') return 'U'
  if (row.type === 'assistant' && first === 'text' && row.uuid !== undefined) return `T ${row.uuid}`
  if (row.type === 'user' && !(Array.isArray(content) && content.some(item => (item as { type?: string }).type === 'tool_result'))) return 'P'
  return undefined
}

const files = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : readdirSync(PROJECTS)
      .flatMap(dir => {
        try {
          return readdirSync(join(PROJECTS, dir)).filter(name => name.endsWith('.jsonl')).map(name => join(PROJECTS, dir, name))
        } catch {
          return []
        }
      })
      .map(file => ({ file, at: statSync(file).mtimeMs }))
      .sort((a, b) => b.at - a.at)
      .slice(0, NEWEST)
      .map(({ file }) => file)

const scratch = mkdtempSync(join(tmpdir(), 'copy-buttons-transcripts-'))
const unknownTypes = new Map<string, number>()
const unknownContent = new Map<string, number>()
const versions = new Set<string>()
let failed = 0
let finals = 0

try {
  for (const original of files) {
    const file = join(scratch, basename(original))
    copyFileSync(original, file)
    const bytes = readFileSync(file)
    // Whole rows only, as the scan reads them: a row still being written
    // waits.
    const whole = bytes.subarray(0, bytes.lastIndexOf(10) + 1)
    const lines = whole.toString('utf8').split('\n').slice(0, -1)

    const want: Token[] = []
    let closings = 0
    let answers = 0
    let interactive = false
    lines.forEach((line, i) => {
      let row: Row
      try {
        row = JSON.parse(line)
      } catch {
        return
      }
      if (row.version !== undefined) versions.add(row.version)
      if (row.entrypoint === 'cli') interactive = true
      if (row.type !== undefined && !ROW_TYPES.has(row.type)) unknownTypes.set(row.type, (unknownTypes.get(row.type) ?? 0) + 1)
      const content = row.message?.content
      if ((row.type === 'assistant' || row.type === 'user') && Array.isArray(content) && content.length > 0) {
        const kind = `${row.type} ${(content[0] as { type?: string }).type}`
        if (!CONTENT.has(kind)) unknownContent.set(kind, (unknownContent.get(kind) ?? 0) + 1)
      }
      const token = tokenOf(row)
      if (token === 'D') closings++
      if (token?.startsWith('T ')) answers++
      if (token !== undefined) want.push({ token, line: i + 1 })
    })

    const ran = Bun.spawnSync(reader.scan(file, 0))
    const printed = ran.stdout.toString().trim().split(/\r?\n/)
    const offset = printed.pop()
    const got = printed.filter(token => token !== '')
    const name = basename(original)
    const problems: string[] = []

    if (ran.exitCode !== 0) problems.push(`the scan exited ${ran.exitCode}: ${ran.stderr.toString().trim()}`)
    if (offset !== `O ${whole.length}`) problems.push(`the scan ended at ${JSON.stringify(offset)}, the whole rows at byte ${whole.length}`)
    const differs = got.findIndex((token, i) => token !== want[i]?.token)
    const at = differs >= 0 ? differs : got.length < want.length ? got.length : -1
    if (at >= 0) {
      // The rows between the last token both agree on and the next one the
      // fields call for: where the scan read something they do not.
      const from = want[at - 1]?.line ?? 0
      const to = want[at]?.line ?? lines.length + 1
      const between = [...new Set(lines.slice(from, to - 1).map(line => {
        try {
          return (JSON.parse(line) as Row).type ?? '?'
        } catch {
          return 'not JSON'
        }
      }))]
      problems.push(
        `token ${at + 1} of ${want.length}: the scan printed ${JSON.stringify(got.slice(at, at + 3))}, the rows call for ${JSON.stringify(want.slice(at, at + 3).map(t => t.token))}` +
          ` (row ${to} on${between.length > 0 ? `; rows ${from + 1}–${to - 1} between are ${between.join(', ')}` : ''})`,
      )
    }
    if (interactive && answers > 0 && closings === 0) problems.push('an interactive session with answers and no closing line (`system` `turn_duration`): has it been renamed?')

    // What the plugin acts on: which answers end their turn.
    const ofScan = { finals: new Set<string>(), others: new Set<string>(), pending: null as string | null }
    const ofRows = { finals: new Set<string>(), others: new Set<string>(), pending: null as string | null }
    fold(ofScan, got)
    fold(ofRows, want.map(t => t.token))
    const lost = [...ofRows.finals].filter(uuid => !ofScan.finals.has(uuid)).length
    const gained = [...ofScan.finals].filter(uuid => !ofRows.finals.has(uuid)).length
    if (lost + gained > 0) problems.push(`final answers: ${lost} missed, ${gained} taken wrongly`)
    finals += ofRows.finals.size

    if (problems.length === 0) {
      console.log(`✔ ${name}: ${got.length} tokens, ${ofRows.finals.size} final answers`)
    } else {
      failed++
      console.log(`✘ ${name} (${original})\n${problems.map(problem => `  ${problem}`).join('\n')}`)
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

const counted = (map: Map<string, number>) => [...map].map(([kind, n]) => `${kind} (${n})`).join(', ')
if (unknownTypes.size > 0) console.log(`\nRow types not seen before: ${counted(unknownTypes)}. Does the scan read any of them by mistake, or miss one it should read?`)
if (unknownContent.size > 0) console.log(`\nMessage content not seen before: ${counted(unknownContent)}. Should the scan count any as an answer or a tool call?`)
const written = [...versions].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
console.log(
  `\n${failed === 0 ? 'All' : `${failed} of`} ${files.length} transcripts ${failed === 0 ? 'read as their rows call for' : 'read otherwise than their rows call for'}` +
    ` (${finals} final answers; written by Claude Code ${written.length > 1 ? `${written[0]} to ${written.at(-1)}` : (written[0] ?? '?')}).`,
)
process.exit(failed === 0 ? 0 : 1)
