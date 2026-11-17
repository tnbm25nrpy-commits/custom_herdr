// Runs the transcript readers' own scripts (hooks/readers.ts) on transcripts
// written to a temporary folder: `claude plugin test` cannot, as the tests
// there have no process to run and stand in for the scripts' output. The
// POSIX reader runs on sh and awk, but on Windows, where the plugin reads
// with PowerShell; the Windows one where `pwsh` or `powershell.exe` is
// found, and is skipped otherwise. The reading the plugin does in the
// engine's own process (`locateIn`, `scanIn`) runs on every platform, with
// Node's file system calls standing in for the engine's, and must print what
// the scripts print.
//
//   bun test ./dev/check-readers.ts
//
// Not named *.test.ts: `claude plugin test` would take it up, and it does not
// load there.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

import { FILE_LIMIT, locateIn, posix, powershell, scanIn, windows } from '../hooks/readers'
import type { Files, Reader } from '../hooks/readers'

// Rows as Claude Code writes them, cut to the fields the scan reads, in the
// order it writes them.
const row = {
  prompt: (uuid: string, text: string) => ({ parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: text }, uuid }),
  text: (uuid: string, text: string, isSidechain = false) => ({
    parentUuid: null,
    isSidechain,
    message: { model: 'claude', id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'text', text }] },
    type: 'assistant',
    uuid,
  }),
  thinking: (uuid: string) => ({
    parentUuid: null,
    isSidechain: false,
    message: { model: 'claude', id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'thinking', thinking: '' }] },
    type: 'assistant',
    uuid,
  }),
  toolUse: (uuid: string) => ({
    parentUuid: null,
    isSidechain: false,
    message: { model: 'claude', id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }] },
    type: 'assistant',
    uuid,
  }),
  toolResult: (uuid: string) => ({
    parentUuid: null,
    isSidechain: false,
    type: 'user',
    message: { role: 'user', content: [{ tool_use_id: 'toolu_1', type: 'tool_result', content: 'ok', is_error: false }] },
    uuid,
  }),
  closing: (uuid: string) => ({ parentUuid: null, isSidechain: false, type: 'system', subtype: 'turn_duration', durationMs: 1000, uuid }),
  snapshot: () => ({ type: 'file-history-snapshot', messageId: 'm', snapshot: {}, isSnapshotUpdate: false }),
  // A request's messages written again, the model's tool call among them.
  blob: (role: 'user' | 'assistant', content: object) => ({ type: 'api-request-blob', sessionId: 's', hash: 'h', message: { role, content: [content] } }),
}
const lines = (...rows: object[]) => rows.map(one => `${JSON.stringify(one)}\n`).join('')
const bytes = (text: string) => new TextEncoder().encode(text).length

// The shell the Windows reader runs on here: Windows PowerShell 5.1, as the
// plugin runs it, else PowerShell 7 where there is no other.
const POWERSHELL = ['powershell.exe', 'pwsh'].find(name => Bun.which(name) !== null)

let config: string
let projects: string
beforeEach(() => {
  // A space in the folder, as in a profile's name on Windows; its long name,
  // as a reader prints it, where the temporary folder's is short (RUNNER~1).
  config = realpathSync.native(mkdtempSync(join(tmpdir(), 'copy-buttons readers-')))
  projects = join(config, 'projects')
  mkdirSync(projects)
})
afterEach(() => rmSync(config, { recursive: true, force: true }))

// A transcript in a project folder, its time set so `ls -t` and
// LastWriteTime order them.
function transcript(project: string, name: string, text: string, secondsAgo = 0): string {
  mkdirSync(join(projects, project), { recursive: true })
  const file = join(projects, project, `${name}.jsonl`)
  writeFileSync(file, text)
  const at = new Date(Date.now() - secondsAgo * 1000)
  utimesSync(file, at, at)
  return file
}

// Node's file system calls, as the engine's answer them.
const files: Files = {
  list: async dir => readdirSync(dir, { withFileTypes: true }).map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other', isLink: entry.isSymbolicLink() })),
  stat: async path => {
    const stat = statSync(path)
    return { kind: stat.isFile() ? 'file' : stat.isDirectory() ? 'dir' : 'other', size: stat.size, mtimeMs: stat.mtimeMs }
  },
  read: async path => new Uint8Array(readFileSync(path)),
}

// `inProcess`: read as the plugin reads, with the engine's calls first and
// the reader's commands where those find nothing.
type Platform = { name: string; reader: () => Reader; env: () => Record<string, string>; inProcess?: boolean }
const platforms: Platform[] = []
if (process.platform !== 'win32') platforms.push({ name: 'posix', reader: () => posix, env: () => ({ CLAUDE_CONFIG_DIR: config }) })
if (POWERSHELL !== undefined) {
  // Windows PowerShell with the plugin's own arguments, by its path under the
  // system's folder where that is known (not on WSL).
  const shell = POWERSHELL === 'powershell.exe' ? powershell(process.env.SystemRoot) : [POWERSHELL, '-NoProfile', '-NonInteractive', '-Command']
  platforms.push({ name: 'windows', reader: () => windows(projects, shell), env: () => ({}) })
  // PowerShell's first start, pwsh's on a fresh runner above all, can take
  // longer than a test's 5 seconds: it is paid here, untimed, not by the
  // first test that runs a reader.
  beforeAll(() => {
    Bun.spawnSync([...shell, 'exit 0'])
  }, 120_000)
} else {
  test.skip('windows: no pwsh or powershell.exe here', () => {})
}
// In the engine's process, its commands those of the platform found above.
const host = platforms[0]
if (host !== undefined) platforms.push({ ...host, name: 'in-process', inProcess: true })

for (const platform of platforms) {
  const run = (argv: string[]) => {
    const ran = Bun.spawnSync(argv, { env: { ...process.env, ...platform.env() } })
    return { exitCode: ran.exitCode, stdout: ran.stdout.toString() }
  }
  const locate = async (session: string, uuid: string) => {
    const own = platform.inProcess === true ? await locateIn(files, projects, sep, session) : undefined
    if (own !== undefined) return own
    const reader = platform.reader()
    const ran = run(reader.locate(session, uuid))
    return ran.exitCode === 0 ? reader.decodePath(ran.stdout) : ran.exitCode
  }
  const scan = async (file: string, offset: number) => {
    const read = platform.inProcess === true ? await scanIn(files, file, offset) : undefined
    return read ?? run(platform.reader().scan(file, offset)).stdout.trim().split(/\r?\n/)
  }

  describe(`${platform.name} locate`, () => {
    test('finds the session\'s own transcript, in whichever project it is', async () => {
      transcript('-other', 'other-session', lines(row.text('t1', 'hi')))
      const file = transcript('-home-me-project', 'session-1', lines(row.prompt('p1', 'hi')))
      expect(await locate('session-1', 't1')).toBe(file)
    })

    test('takes the newest of two transcripts named for the session', async () => {
      transcript('-old', 'session-1', '', 60)
      const file = transcript('-new', 'session-1', '')
      expect(await locate('session-1', 't1')).toBe(file)
    })

    test('where the session has none, takes the newest transcript holding the reply', async () => {
      transcript('-a', 'older', lines(row.text('t1', 'hi')), 60)
      const file = transcript('-a', 'forked-from', lines(row.text('t1', 'hi')), 30)
      transcript('-a', 'unrelated', lines(row.text('t2', 'hi')))
      expect(await locate('session-1', 't1')).toBe(file)
    })

    test('exits 3 where neither is found', async () => {
      transcript('-a', 'unrelated', lines(row.text('t2', 'hi')))
      expect(await locate('session-1', 't1')).toBe(3)
    })

    test('keeps a path outside ASCII', async () => {
      const file = transcript('-home-我-專案', 'session-1', '')
      expect(await locate('session-1', 't1')).toBe(file)
    })

    // As a profile named O'Brien or D’Angelo: PowerShell reads ‘ ’ ‚ and ‛ as
    // it reads ', so one written into a script undoubled ends its literal.
    test('finds and scans under a folder named with quotes, those PowerShell reads as one too', async () => {
      const root = config
      try {
        config = join(root, "o'brien d’angelo ‘a‚b‛c")
        projects = join(config, 'projects')
        mkdirSync(projects, { recursive: true })
        const text = lines(row.text('t1', 'hi'), row.closing('d1'))
        const file = transcript('-a', 'session-1', text)
        expect(await locate('session-1', 't1')).toBe(file)
        expect(await scan(file, 0)).toEqual(['T t1', 'D', `O ${bytes(text)}`])
      } finally {
        config = root
      }
    })
  })

  describe(`${platform.name} scan`, () => {
    test('prints a token for each row that matters, then the offset after the last', async () => {
      const text = lines(
        row.snapshot(),
        row.prompt('p1', '寫個 script'),
        row.thinking('k1'),
        row.toolUse('u1'),
        row.toolResult('r1'),
        row.text('t1', '好了：\n```sh\necho 你好\n```'),
        row.closing('d1'),
        row.prompt('p2', 'thanks'),
      )
      const file = transcript('-a', 's', text)
      expect(await scan(file, 0)).toEqual(['P', 'U', 'T t1', 'D', 'P', `O ${bytes(text)}`])
    })

    test('reads a row of megabytes, as a long tool result writes', async () => {
      const text = lines(row.text('t1', 'x'.repeat(3_000_000)), row.closing('d1'))
      const file = transcript('-a', 's', text)
      expect(await scan(file, 0)).toEqual(['T t1', 'D', `O ${bytes(text)}`])
    })

    test('leaves out a subagent\'s rows', async () => {
      const text = lines(row.text('side', 'from a subagent', true), row.text('t1', 'mine'))
      const file = transcript('-a', 's', text)
      expect(await scan(file, 0)).toEqual(['T t1', `O ${bytes(text)}`])
    })

    test('takes a request\'s messages written again for nothing, the model\'s tool call either', async () => {
      const text = lines(
        row.text('t1', 'the answer'),
        row.blob('assistant', { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }),
        row.blob('user', { type: 'text', text: 'a prompt' }),
        row.closing('d1'),
      )
      const file = transcript('-a', 's', text)
      expect(await scan(file, 0)).toEqual(['T t1', 'D', `O ${bytes(text)}`])
    })

    test('reads from the offset on, counted in bytes', async () => {
      const first = lines(row.prompt('p1', '中文的 prompt 👋'), row.text('t1', 'é'))
      const file = transcript('-a', 's', first)
      expect(await scan(file, 0)).toEqual(['P', 'T t1', `O ${bytes(first)}`])
      const more = lines(row.closing('d1'))
      appendFileSync(file, more)
      expect(await scan(file, bytes(first))).toEqual(['D', `O ${bytes(first + more)}`])
    })

    test('leaves a row still being written for the next read', async () => {
      const whole = lines(row.text('t1', 'done'))
      const closing = lines(row.closing('d1'))
      const file = transcript('-a', 's', whole + closing.slice(0, 20))
      expect(await scan(file, 0)).toEqual(['T t1', `O ${bytes(whole)}`])
      appendFileSync(file, closing.slice(20))
      expect(await scan(file, bytes(whole))).toEqual(['D', `O ${bytes(whole + closing)}`])
    })

    test('with nothing new, prints the offset it was given', async () => {
      const text = lines(row.text('t1', 'hi'))
      const file = transcript('-a', 's', text)
      expect(await scan(file, bytes(text))).toEqual([`O ${bytes(text)}`])
      expect(await scan(transcript('-a', 'empty', ''), 0)).toEqual(['O 0'])
    })
  })
}

describe('in-process', () => {
  test('leaves a transcript past what one read of the engine takes to the reader\'s command', async () => {
    const text = lines(row.text('t1', 'x'.repeat(FILE_LIMIT)), row.closing('d1'))
    const file = transcript('-a', 's', text)
    expect(await scanIn(files, file, 0)).toBeUndefined()
  })

  test('finds no transcript where the session has none, for the reader\'s command to look', async () => {
    transcript('-a', 'forked-from', lines(row.text('t1', 'hi')))
    expect(await locateIn(files, projects, sep, 'session-1')).toBeUndefined()
    expect(await locateIn(files, join(config, 'none'), sep, 'session-1')).toBeUndefined()
  })
})
