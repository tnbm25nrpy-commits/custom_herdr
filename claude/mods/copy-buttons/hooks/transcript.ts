import type { EngineInterface } from 'claude-code'

import { locateIn, posix, powershell, scanIn, windows } from './readers'
import type { Files, Reader } from './readers'

// What one transcript says so far: the replies that ended their turn, those
// that did not, the latest text still waiting on what follows it, and how far
// it has been read.
type Index = {
  file: string
  offset: number
  finals: Set<string>
  others: Set<string>
  pending: string | null
  reading: Promise<void> | null
  readAt: number
}

// Folds a scan's tokens into the index: a reply is its turn's final answer
// when the turn's closing line is the next thing that matters after it.
export function fold(index: Pick<Index, 'finals' | 'others' | 'pending'>, tokens: readonly string[]) {
  for (const token of tokens) {
    const [kind, uuid] = token.split(' ')
    if (kind === 'T' && uuid !== undefined) {
      if (index.pending !== null) index.others.add(index.pending)
      index.pending = uuid
    } else if (kind === 'D' && index.pending !== null) {
      index.finals.add(index.pending)
      index.pending = null
    } else if ((kind === 'U' || kind === 'P') && index.pending !== null) {
      index.others.add(index.pending)
      index.pending = null
    }
  }
}

// Kept in memory only, one per transcript, gone with the session.
const indexes = new Map<string, Index>()
let located: { session: string; file: string } | null = null

// A render asks often while a reply streams; a read of the same file sooner
// than this after the last one waits for the next ask (the turn's end asks).
const REREAD_MS = 250

// The platform's way of reading the transcript, chosen once: where the
// transcripts are, and the commands that read one the engine's calls cannot
// (PowerShell on Windows, where `OS` is `Windows_NT`; POSIX tools on Linux,
// macOS and WSL). Each command is a process started, which on Windows takes a
// second or so: the engine's calls take a few milliseconds, and are tried
// first (`inProcess`) unless a probe or a test chose a reader of its own.
type Platform = { reader: Reader; projects?: string; sep: string; inProcess: boolean }
let platform: Promise<Platform> | null = null

function platformOf($: EngineInterface): Promise<Platform> {
  platform ??= (async () => {
    const isWindows = (await $.env.get('OS')) === 'Windows_NT'
    const sep = isWindows ? '\\' : '/'
    // Empty as unset, as `\${CLAUDE_CONFIG_DIR:-…}` reads it.
    const home = (isWindows ? await $.env.get('USERPROFILE') : await $.env.get('HOME')) || undefined
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || (home === undefined ? undefined : `${home}${sep}.claude`)
    const projects = config === undefined ? undefined : `${config}${sep}projects`
    if (!isWindows) return { reader: posix, projects, sep, inProcess: true }
    const reader = windows(projects ?? '\\.claude\\projects', powershell(await $.env.get('SystemRoot')))
    return { reader, projects, sep, inProcess: true }
  })()
  return platform
}

// For a probe or test that reads with a reader of its own; null chooses
// again by the platform at the next read.
export function useReader(chosen: Reader | null) {
  platform = chosen === null ? null : Promise.resolve({ reader: chosen, sep: '/', inProcess: false })
}

// The engine's file system calls, as the readers take them.
function filesOf($: EngineInterface): Files {
  return {
    list: path => $.fs.list(path),
    stat: path => $.fs.stat(path),
    read: async path => bytesOf((await $.fs.read(path, { as: 'bytes' })).base64),
  }
}

function bytesOf(base64: string): Uint8Array {
  const text = atob(base64)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return bytes
}

// Asks made while the session's file is being looked for wait on that look.
let locating: { session: string; found: Promise<string | undefined> } | null = null

async function locate($: EngineInterface, session: string, uuid: string): Promise<string | undefined> {
  if (located?.session === session) return located.file
  if (locating?.session === session) {
    const found = await locating.found
    if (located?.session === session) return found
  }

  const found = (async () => {
    const { reader: read, projects, sep, inProcess } = await platformOf($)
    const own = inProcess && projects !== undefined ? await locateIn(filesOf($), projects, sep, session) : undefined
    if (own !== undefined) {
      located = { session, file: own }
      return own
    }
    const ran = await $.process.run(read.locate(session, uuid), { timeoutMs: 10000 })
    if (ran.exitCode !== 0 || ran.stdout.trim() === '') return undefined
    const file = read.decodePath(ran.stdout)
    // A file found by the reply rather than by the session may be another
    // session's: look again next time, until the session's own exists.
    const name = `${session}.jsonl`
    const isOwn = file.endsWith(`/${name}`) || file.endsWith(`\\${name}`)
    if (isOwn) located = { session, file }
    return file
  })()
  locating = { session, found }
  try {
    return await found
  } finally {
    if (locating?.found === found) locating = null
  }
}

// The tokens of what was added since a byte offset: read in the engine's own
// process, or by the platform's command for a file past what one read takes
// (or where the engine's calls fail), which goes on from the same offset.
async function scanOf($: EngineInterface, file: string, offset: number): Promise<string[] | undefined> {
  const { reader, inProcess } = await platformOf($)
  const read = inProcess ? await scanIn(filesOf($), file, offset) : undefined
  if (read !== undefined) return read
  const ran = await $.process.run(reader.scan(file, offset), { timeoutMs: 20000 })
  if (ran.exitCode !== 0) return undefined
  return ran.stdout.split('\n').filter(line => line !== '')
}

// Reads what was added to the transcript since the last read; asks made while
// one read runs wait on that read.
async function refresh($: EngineInterface, index: Index): Promise<void> {
  if (index.reading !== null) return index.reading
  index.reading = (async () => {
    const tokens = await scanOf($, index.file, index.offset)
    if (tokens === undefined) return
    const end = tokens.pop()
    if (end?.startsWith('O ') !== true) return
    fold(index, tokens)
    index.offset = Number(end.slice(2))
    index.readAt = await $.clock.now()
  })().finally(() => {
    index.reading = null
  })
  return index.reading
}

// What any transcript read so far says of the reply, with no read of its
// own: what a draw can know at once.
export function knownVerdict(uuid: string): boolean | undefined {
  for (const index of indexes.values()) {
    if (index.finals.has(uuid)) return true
    if (index.others.has(uuid)) return false
  }
  return undefined
}

// A session's or a reply's id as Claude Code makes them: letters, digits, `-`
// and `_`. A transcript resumed may hold any text for a reply's, and both go
// into the reader's command: no command is run with another kind of id.
const ID = /^[\w-]{1,128}$/

// True when the reply with this uuid is its turn's final answer and the turn's
// closing line (`✻ Cooked for …`) follows it; false when not; undefined while
// the turn still runs or the transcript cannot be read, as for an id that is
// not one Claude Code makes.
export async function isFinalAnswer($: EngineInterface, uuid: string): Promise<boolean | undefined> {
  const session = await $.session.id()
  if (!ID.test(session) || !ID.test(uuid)) return undefined
  const file = await locate($, session, uuid)
  if (file === undefined) return undefined

  let index = indexes.get(file)
  if (index === undefined) {
    index = { file, offset: 0, finals: new Set(), others: new Set(), pending: null, reading: null, readAt: -Infinity }
    indexes.set(file, index)
  }

  const known = () => (index.finals.has(uuid) ? true : index.others.has(uuid) ? false : undefined)
  if (known() !== undefined) return known()
  if ((await $.clock.now()) - index.readAt >= REREAD_MS || index.readAt === -Infinity) {
    await refresh($, index)
  }
  return known()
}

