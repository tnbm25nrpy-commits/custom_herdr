// Claude Code on a real screen, in a detached tmux pane and a home of its own
// (the first run's questions answered, the folder trusted, the full-screen
// view on, nothing installed), with this plugin loaded from the folder or
// with no plugins. A conversation written as a session of its own is resumed
// signed out, nothing sent to the model (dev/capture-fixtures.ts,
// dev/check-rendering.ts, dev/check-buttons.ts); or a session is started, to
// talk to the model with a token passed on (dev/check-live.ts).
//
// Needs tmux. Runs the `claude` on PATH, or CLAUDE_BIN.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const claude = process.env.CLAUDE_BIN ?? Bun.which('claude')
if (claude === null) throw new Error('no claude on PATH: set CLAUDE_BIN')
export const CLAUDE = claude
export const VERSION = Bun.spawnSync([CLAUDE, '--version']).stdout.toString().trim().split(' ')[0]!
const PLUGIN = join(dirname(new URL(import.meta.url).pathname), '..')

// Panes drawn at once: each is a Claude Code of its own.
const AT_ONCE = 6
const WAIT_MS = 60_000

// What a conversation holds, in order: the person's prompt, the model's
// text, a tool call and its result, a turn's closing line.
export type Entry = { prompt: string } | { text: string } | { tool: string } | { closing: true }

// Each entry as Claude Code writes its rows: one compact JSON object a row
// (`"role": "assistant"` with a space is not read as the model's).
function rowsOf(entries: readonly Entry[], session: string, cwd: string): string {
  const base = { isSidechain: false, userType: 'external', entrypoint: 'cli', cwd, sessionId: session, version: VERSION, gitBranch: 'main' }
  let n = 0
  let parentUuid: string | null = null
  const rows: object[] = []
  const add = (row: object) => {
    const uuid = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
    rows.push({ ...base, parentUuid, ...row, uuid, timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString() })
    parentUuid = uuid
  }
  const model = (content: object) => ({ model: 'claude-opus-5-5', id: `msg_${n}`, type: 'message', role: 'assistant', content: [content], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } })
  for (const entry of entries) {
    if ('prompt' in entry) add({ type: 'user', message: { role: 'user', content: entry.prompt } })
    else if ('text' in entry) add({ type: 'assistant', requestId: `req_${n}`, message: model({ type: 'text', text: entry.text }) })
    else if ('tool' in entry) {
      const id = `toolu_${n}`
      add({ type: 'assistant', requestId: `req_${n}`, message: model({ type: 'tool_use', id, name: 'Bash', input: { command: entry.tool, description: 'Run it' } }) })
      add({ type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: 'ok', is_error: false }] } })
    } else add({ type: 'system', subtype: 'turn_duration', durationMs: 3000, messageCount: n, isMeta: false })
  }
  return rows.map(row => `${JSON.stringify(row)}\n`).join('')
}

// A conversation of one prompt, the answer and the turn's closing line.
export const answering = (answer: string): Entry[] => [{ prompt: 'show me' }, { text: answer }, { closing: true }]

export type Pane = {
  screen: () => string
  // Waits for `ready` to hold of the screen, and gives what it returned.
  waitFor: <T>(what: string, ready: (screen: string) => T | undefined) => Promise<T>
  // An SGR mouse report, as the terminal sends one: columns and rows 1-based.
  mouse: (button: number, column: number, row: number, release?: boolean) => void
  // Text typed, then keys by tmux's names (Enter, Escape, ...).
  type: (text: string) => void
  keys: (...names: string[]) => void
  // What the last copy put on the clipboard (OSC 52, into tmux's buffer),
  // and setting it, to tell the next copy from what was there.
  clipboard: () => string
  setClipboard: (text: string) => void
  close: () => void
}

export type Open = {
  // The conversation resumed; else a session of its own is started.
  entries?: readonly Entry[]
  columns: number
  height: number
  // This plugin loaded from the folder with these options; else no plugins.
  plugin?: Record<string, string>
  // Variables of this environment passed on (by name, so their values are
  // in no command line tmux keeps), and arguments for claude.
  pass?: readonly string[]
  args?: readonly string[]
}

// `projects` is the folder the panes' transcripts are written in.
export type Home = { open: (open: Open) => Pane; projects: string }

// A home and a tmux server of their own, both gone once `use` has run.
export async function withHome<T>(use: (home: Home) => Promise<T>): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), 'copy-buttons-screens-'))
  const cwd = join(home, 'work')
  const projects = join(home, '.claude', 'projects', cwd.replace(/[/.]/g, '-'))
  mkdirSync(cwd)
  mkdirSync(projects, { recursive: true })
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', projects: { [cwd]: { hasTrustDialogAccepted: true } } }))
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ tui: 'fullscreen' }))
  writeFileSync(join(home, 'tmux.conf'), 'set -g set-clipboard on\n')
  const server = `copy-buttons-${process.pid}`
  // The server keeps this environment, for the panes' `pass`.
  const tmux = (...argv: string[]) => Bun.spawnSync(['tmux', '-L', server, '-f', join(home, 'tmux.conf'), ...argv], { env: process.env }).stdout.toString()
  const env = ['env', '-i', `PATH=${process.env.PATH}`, `HOME=${home}`, 'TERM=xterm-256color', 'DISABLE_AUTOUPDATER=1', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1']
  const quote = (arg: string) => `'${arg.replace(/'/g, `'\\''`)}'`
  let sessions = 0

  const open = ({ entries, columns, height, plugin, pass = [], args = [] }: Open): Pane => {
    const id = `00000000-0000-4000-9000-${String(++sessions).padStart(12, '0')}`
    if (entries !== undefined) writeFileSync(join(projects, `${id}.jsonl`), rowsOf(entries, id, cwd))
    const resume = entries === undefined ? [] : ['--resume', id]
    const load = plugin === undefined ? [] : ['--plugin-dir', PLUGIN, '--settings', JSON.stringify({ pluginConfigs: { 'copy-buttons@inline': { options: plugin } } })]
    const passed = pass.map(name => `${name}="$${name}"`)
    tmux('new-session', '-d', '-s', id, '-x', String(columns), '-y', String(height), '-c', cwd, [...env.map(quote), ...passed, ...[CLAUDE, ...resume, ...load, ...args].map(quote)].join(' '))
    const screen = () => tmux('capture-pane', '-p', '-t', id)
    return {
      screen,
      async waitFor(what, ready) {
        for (let waited = 0; waited < WAIT_MS; waited += 250) {
          const found = ready(screen())
          if (found !== undefined) return found
          await Bun.sleep(250)
        }
        throw new Error(`no ${what} within ${WAIT_MS / 1000}s; the screen:\n${screen()}`)
      },
      mouse: (button, column, row, release = false) => void tmux('send-keys', '-t', id, '-l', `\x1b[<${button};${column};${row}${release ? 'm' : 'M'}`),
      type: text => void tmux('send-keys', '-t', id, '-l', text),
      keys: (...names) => void tmux('send-keys', '-t', id, ...names),
      clipboard: () => tmux('show-buffer'),
      setClipboard: text => void tmux('set-buffer', '--', text),
      close: () => void tmux('kill-session', '-t', id),
    }
  }

  try {
    return await use({ open, projects })
  } finally {
    tmux('kill-server')
    rmSync(home, { recursive: true, force: true })
  }
}

// The answer as drawn: from its bullet to the closing line, the reply's
// two-column indent taken off, spaces at the end trimmed and the blank rows
// above the closing line left out. A row outside the indent is what tmux
// pushes past a row of Devanagari, which it draws otherwise than Claude Code
// lays it out (see tests/fixtures/nested.ts), and is left out too.
function drawnAnswer(screen: string): string[] | undefined {
  const lines = screen.split('\n')
  const end = lines.findLastIndex(line => /^✻ \S+ for /.test(line))
  const start = lines.slice(0, Math.max(end, 0)).findLastIndex(line => line.startsWith('● '))
  if (end < 0 || start < 0) return undefined
  const rows = lines
    .slice(start, end)
    .filter((line, i) => i === 0 || line.trim() === '' || line.startsWith('  '))
    .map(line => line.slice(2).trimEnd())
  while (rows.at(-1) === '') rows.pop()
  return rows
}

// An answer to draw, `columns` wide, in a pane with room for `rows` of it.
export type Shot = { answer: string; columns: number; rows: number; name: string }

// Each shot's rows as Claude Code draws them with no plugins, in the order
// given: once the closing line is drawn and the screen has stopped changing.
export function draw(shots: readonly Shot[]): Promise<string[][]> {
  return withHome(async home => {
    const drawn: string[][] = []
    for (let i = 0; i < shots.length; i += AT_ONCE) {
      await Promise.all(
        shots.slice(i, i + AT_ONCE).map(async (shot, j) => {
          // Tall enough for the whole conversation, so the full-screen view
          // draws it all at once: room for the prompt above and the input
          // box below, and for an answer drawn longer than expected.
          const pane = home.open({ entries: answering(shot.answer), columns: shot.columns, height: Math.ceil(shot.rows * 1.5) + 60 })
          let last = ''
          drawn[i + j] = await pane.waitFor(`${shot.name} drawn at ${shot.columns} columns`, screen => {
            const settled = screen === last ? drawnAnswer(screen) : undefined
            last = screen
            return settled
          })
          pane.close()
        }),
      )
    }
    return drawn
  })
}
