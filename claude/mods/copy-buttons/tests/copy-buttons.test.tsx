import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { codeBlocks, copyables, readInfo } from '../hooks/blocks'
import { clean } from '../hooks/clean'
import { abbreviate, labelOf, layoutRow, placeNotice } from '../hooks/fit'
import { powershell, windows } from '../hooks/readers'
import { widthOf } from '../hooks/width'
import { renderReply } from '../hooks/render'
import type { RowItem, RowProps } from '../hooks/row'
import { fold, useReader } from '../hooks/transcript'
import { onScreenPart, placeBlocks, placeOn } from '../hooks/place'
import { layOut, wrap } from '../hooks/wrap'
import * as samples from './fixtures/samples'
import * as deep from './fixtures/deep'
import * as nested from './fixtures/nested'
import * as tmuxAgents from './fixtures/tmux-agents'

const ANSWER = [
  'Run this:',
  '',
  '```bash',
  'echo hi',
  'ls -la',
  '```',
  '',
  '```bash',
  'pwd',
  '```',
  '',
  '```ts',
  'console.log(1)',
  '```',
].join('\n')

const MESSAGE = {
  plugin: 'copy-buttons',
  component: 'AssistantMessage',
  requestId: 'msg-1',
  surface: 'terminal',
  props: { text: ANSWER, isFirstOfReply: true },
} as const

// What the transcript scan prints for the rows after the reply `msg-1`.
const AFTER = {
  closing: ['D'],
  toolUse: ['U', 'T other', 'D'],
  moreText: ['T other', 'D'],
  prompt: ['P'],
  running: [] as string[],
}

// Each test its own session: the lookup keeps what it read in memory.
let sessions = 0
// The row of a mounted reply, as its module is handed it, and a click on one
// of its items, as the person's would land.
type Mounted = {
  find: (query: { type?: string; key?: string; text?: string | RegExp; in?: string }) => Promise<{ props: Record<string, unknown> } | undefined>
  pointer: (event: { type: 'down' | 'move' | 'leave'; x: number; y: number; button?: 'left'; in: string }) => Promise<void>
}
const rowOf = async (ui: Mounted): Promise<RowItem[]> =>
  ((await ui.find({ type: 'Client' }))?.props.props as RowProps | undefined)?.items ?? []
const labels = async (ui: Mounted) => (await rowOf(ui)).map(item => item.text)
const item = async (ui: Mounted, key: string) => (await rowOf(ui)).find(one => one.key === key)
async function click(ui: Mounted, key: string) {
  const found = await item(ui, key)
  if (found === undefined) throw new Error(`no row item ${key}`)
  await ui.pointer({ type: 'down', x: found.from, y: 0, button: 'left', in: 'row' })
}

// Nothing sits beneath the plugin in a test: these stand for the engine, the
// transcript lookup finding the session's file and scanning it.
const engine = (on: On, after: readonly string[] = AFTER.closing) => {
  const session = `s${++sessions}`
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine reply</Text>
  })
  on('session.id', () => ({ value: session }))
  on('env.get', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    const isLocate = e.argv.includes(session)
    const stdout = isLocate ? `/p/${session}.jsonl` : ['T msg-1', ...after, 'O 100'].join('\n')
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return mock.clock(on)
}

test('finds each code block in reading order with its language', () => {
  expect(codeBlocks(ANSWER)).toEqual([
    { code: 'echo hi\nls -la', language: 'bash' },
    { code: 'pwd', language: 'bash' },
    { code: 'console.log(1)', language: 'ts' },
  ])
})

test('a block inside a list item or a quote counts, without its indent or >', () => {
  const markdown = [
    '1. Install:',
    '',
    '   ```bash',
    '   npm install',
    '     --save',
    '   ```',
    '2. Done',
    '',
    '> ```sh',
    '> echo quoted',
    '> ```',
    '',
    '```ts src/app.ts',
    'let a = 1',
    '```',
  ].join('\n')
  expect(codeBlocks(markdown)).toEqual([
    { code: 'npm install\n  --save', language: 'bash' },
    { code: 'echo quoted', language: 'sh' },
    { code: 'let a = 1', language: 'ts', file: 'app.ts' },
  ])
})

test('a fence names its file after the language, joined to it, or by a key', () => {
  expect(readInfo('ts src/app.ts')).toEqual({ language: 'ts', file: 'app.ts' })
  expect(readInfo('ts:src/app.ts')).toEqual({ language: 'ts', file: 'app.ts' })
  expect(readInfo('python title="main.py"')).toEqual({ language: 'python', file: 'main.py' })
  expect(readInfo("yaml filename='config/ci.yml'")).toEqual({ language: 'yaml', file: 'ci.yml' })
  expect(readInfo('js {1,3}')).toEqual({ language: 'js' })
  expect(readInfo('bash')).toEqual({ language: 'bash' })
  expect(readInfo('')).toEqual({ language: '' })
})

test('a block that names a file is labeled by it, cut short when the row is narrow', async ($, on) => {
  engine(on)
  const text = ['```ts src/app.ts', 'a', '```', '```ts src/app.ts', 'b', '```', '```yaml config/very-long-name.yml', 'c', '```', '```sh', 'd', '```'].join('\n')
  const ui = await $.ui.mount({ ...MESSAGE, props: { text, isFirstOfReply: true } })
  expect(await labels(ui)).toEqual([
    '⧉ Reply',
    '⧉ app.ts 1',
    '⧉ app.ts 2',
    '⧉ very-long-name.yml',
    '⧉ sh',
  ])
  await ui.unmount()

  const short = abbreviate([
    { key: 'r', label: 'Reply', text: '', isReply: true },
    { key: 'f', label: 'very-long-name.yml', text: '', isReply: false, name: 'very-long-name.yml', isFile: true },
    { key: 'l', label: 'python', text: '', isReply: false, name: 'python' },
  ])
  expect(short.map(a => a.label)).toEqual(['Reply', 'very-long…', 'py'])
})

test('a table copies as tab-separated rows, quoted where a cell needs it', () => {
  const markdown = [
    '| 名稱 | 數量 | 備註 |',
    '|---|--:|---|',
    '| **apple** | 3 | 紅色 |',
    '| `banana` | 12 | [連結](https://x.y) |',
    '| say "hi" | 1 | a<br>b |',
  ].join('\n')
  const [table] = copyables(markdown)
  expect(table).toMatchObject({
    kind: 'table',
    rows: 4,
    tsv: ['名稱\t數量\t備註', 'apple\t3\t紅色', 'banana\t12\t連結 (https://x.y)', '"say ""hi"""\t1\ta<br>b'].join('\n'),
  })
})

test('code blocks and tables come in reading order, tables in a list or quote too', () => {
  const markdown = ['| a |', '|---|', '| 1 |', '', '```sh', 'ls', '```', '', '- item', '', '  | b |', '  |---|', '  | 2 |'].join('\n')
  expect(copyables(markdown).map(part => part.kind)).toEqual(['table', 'code', 'table'])
})

test('a table copies its markdown, then for a spreadsheet, then rendered, a press while it reads ✓ taking the next', async ($, on) => {
  engine(on)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  const text = ['| a | b |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |', '', '```sh', 'ls', '```', '', '| c |', '|---|', '| 5 |'].join('\n')
  const ui = await $.ui.mount({ ...MESSAGE, props: { text, isFirstOfReply: true } })
  expect(await labels(ui)).toEqual(['⧉ Reply', '⧉ table 1', '⧉ sh', '⧉ table 2'])
  await click(ui, 'copy-table:0')
  expect(copied).toEqual(['| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |'])
  expect(await ui.find({ type: 'Text', text: 'copied as markdown' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · click again for spreadsheet' })).toBeDefined()

  await click(ui, 'copy-table:0')
  expect(copied[1]).toBe('a\tb\n1\t2\n3\t4')
  expect(await ui.find({ type: 'Text', text: ' · click again for rendered' })).toBeDefined()

  await click(ui, 'copy-table:0')
  expect(copied[2]).toBe(
    ['┌─────┬─────┐', '│  a  │  b  │', '├─────┼─────┤', '│ 1   │ 2   │', '├─────┼─────┤', '│ 3   │ 4   │', '└─────┴─────┘'].join('\n'),
  )
  expect(await ui.find({ type: 'Text', text: 'copied as rendered' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · click again for markdown' })).toBeDefined()

  await click(ui, 'copy-code:0')
  expect(copied[3]).toBe('ls')
  expect(await ui.find({ type: 'Text', text: 'copied 1 line' })).toBeDefined()
  await ui.unmount()
})

test('widths count emoji as two, combining marks as nothing', () => {
  expect(widthOf('✅')).toBe(2)
  expect(widthOf('✔️')).toBe(2)
  expect(widthOf('👨‍👩‍👧')).toBe(2)
  expect(widthOf('🇹🇼')).toBe(2)
  expect(widthOf('สวัสดี')).toBe(4)
  expect(widthOf('e\u0301')).toBe(1)
  expect(widthOf('「引號」')).toBe(8)
  expect(widthOf('ok')).toBe(2)
  // A mark on its letter nothing, one beside it a column: a Devanagari
  // conjunct a column for each consonant and for its vowel sign `ी`.
  expect(widthOf('שָׁלוֹם')).toBe(4)
  expect(widthOf('न्दी')).toBe(3)
  expect(widthOf('हिन्दी नमस्ते')).toBe(10)
  expect(widthOf('கொ')).toBe(2)
  expect(widthOf('𗀀')).toBe(2)
})

test('a reply is final when the closing line is the next thing after it', () => {
  const index = { finals: new Set<string>(), others: new Set<string>(), pending: null as string | null }
  fold(index, ['T a', 'D', 'T b', 'U', 'T c', 'T d', 'D', 'T e', 'P', 'T f'])
  expect([...index.finals]).toEqual(['a', 'd'])
  expect([...index.others]).toEqual(['b', 'c', 'e'])
  expect(index.pending).toBe('f')

  fold(index, ['D'])
  expect(index.finals.has('f')).toBe(true)
})

test('a final answer is drawn by the engine with the actions on its closing line', async ($, on) => {
  engine(on)

  const ui = await $.ui.mount(MESSAGE)
  expect(await ui.find({ type: 'Text', text: 'engine reply' })).toBeDefined()
  expect(await labels(ui)).toEqual(['⧉ Reply', '⧉ bash 1', '⧉ bash 2', '⧉ ts'])
  await ui.unmount()
})

test('a reply is not held while the transcript is read: its row comes after', async ($, on) => {
  const clock = mock.clock(on)
  const session = `slow-${++sessions}`
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine reply</Text>
  })
  on('session.id', () => ({ value: session }))
  on('env.get', () => ({ value: undefined }))
  // The scan answers only after half a second, as a long transcript's first read.
  on('process.run', async (_, e) => {
    const isLocate = e.argv.includes(session)
    if (!isLocate) await clock.sleep(500)
    const stdout = isLocate ? `/p/${session}.jsonl` : ['T msg-1', 'D', 'O 100'].join('\n')
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  // The draw does not wait on the scan: the reply is there, its row not yet.
  const ui = await $.ui.mount(MESSAGE)
  expect(await ui.find({ type: 'Text', text: 'engine reply' })).toBeDefined()
  expect(await ui.find({ type: 'Client' })).toBeUndefined()

  // Once the scan has answered, the reply draws again with its row.
  await clock.advance(500)
  expect(await labels(ui)).toEqual(['⧉ Reply', '⧉ bash 1', '⧉ bash 2', '⧉ ts'])
  await ui.unmount()
})

for (const [name, after] of [
  ['a tool call', AFTER.toolUse],
  ['more text', AFTER.moreText],
  ['the next prompt', AFTER.prompt],
  ['a turn still running', AFTER.running],
] as const) {
  test(`a reply followed by ${name} gets no actions`, async ($, on) => {
    engine(on, after)
    const ui = await $.ui.mount(MESSAGE)
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
  })
}

test('an action copies its text, then its icon reads ✓ a moment', async ($, on) => {
  const clock = engine(on)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })

  const ui = await $.ui.mount(MESSAGE)
  await click(ui, 'copy-code:0')
  expect(copied).toEqual(['echo hi\nls -la'])
  expect((await item(ui, 'copy-code:0'))?.text).toBe('✓ bash 1')
  expect((await item(ui, 'copy-code:0'))?.tone).toBe('done')
  expect(await ui.find({ type: 'Text', text: 'copied 2 lines' })).toBeDefined()

  await clock.advance(1500)
  expect(await item(ui, 'copy-code:0')).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'copied 2 lines' })).toBeUndefined()

  await click(ui, 'copy-reply')
  expect(copied[1]).toBe(ANSWER)
  await ui.unmount()
})

test('a reply is read without its control characters, a tab and a newline kept', () => {
  expect(clean('a\x1b[31mb\x07\tc\r\nd\re\x00\x7f\u009bf')).toBe('a[31mb\tc\nd\nef')
  expect(clean(ANSWER)).toBe(ANSWER)
})

test('a reply written with control characters is labeled and copied without them', async ($, on) => {
  engine(on)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  // An escape sequence in a fence's info, and one in its code that would end
  // a bracketed paste, the next line then run as typed.
  const text = ['Run this:', '', '```sh\x1b[31m', 'echo hi\x1b[201~', 'rm -rf ~', '```', '', '| a\x07 | b |', '| --- | --- |', '| 1 | 2\x1b |'].join('\n')
  const ui = await $.ui.mount({ ...MESSAGE, props: { text, isFirstOfReply: true } })
  expect(await labels(ui)).toEqual(['⧉ Reply', '⧉ sh[31m', '⧉ table'])

  await click(ui, 'copy-code:0')
  await click(ui, 'copy-reply')
  await click(ui, 'copy-table:0')
  await click(ui, 'copy-table:0')
  await click(ui, 'copy-table:0')
  expect(copied[0]).toBe('echo hi[201~\nrm -rf ~')
  expect(copied[1]).toBe(clean(text))
  expect(copied[3]).toBe('a\tb\n1\t2')
  for (const one of copied) expect(one).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/)
  await ui.unmount()
})

test('rendered lays the reply out as the terminal draws it', () => {
  const markdown = [
    '## Plan',
    '',
    'Use **bold** and `code`, see [docs](https://d.x) or https://u.x.',
    '',
    '1. one',
    '   1. sub',
    '- [x] done',
    '',
    '> quoted',
    '',
    '| Name | 數量 |',
    '|:--|--:|',
    '| apple | 3 |',
    '| 香蕉 | 12 |',
    '',
    '```sh',
    'echo hi',
    '```',
  ].join('\n')
  expect(renderReply(markdown)).toBe(
    [
      'Plan',
      '',
      'Use bold and code, see docs (https://d.x) or https://u.x.',
      '',
      '1. one',
      '   a. sub',
      '- [x] done',
      '',
      '▎ quoted',
      '',
      '┌───────┬──────┐',
      '│ Name  │ 數量 │',
      '├───────┼──────┤',
      '│ apple │    3 │',
      '├───────┼──────┤',
      '│ 香蕉  │   12 │',
      '└───────┴──────┘',
      '',
      'echo hi',
    ].join('\n'),
  )
})

test('rendered follows the terminal\'s spacing, links and tables, as seen on screen', () => {
  // Each case was read off Claude Code's own drawing (dev/check-rendering.ts).
  const cases: [string, string][] = [
    // A heading is followed by a blank line; text and code on consecutive lines touch.
    ['## Title\nText\n```sh\nls\n```\nAfter', 'Title\n\nText\nls\nAfter'],
    // A table has a blank line around it, and columns three wide at least.
    [
      'x\n| a | b |\n|---|---|\n| 1 | |\n\nafter',
      'x\n\n┌─────┬─────┐\n│  a  │  b  │\n├─────┼─────┤\n│ 1   │     │\n└─────┴─────┘\n\nafter',
    ],
    // Entities stay as written.
    ['a &amp; b &lt;c&gt;', 'a &amp; b &lt;c&gt;'],
    // Reference links and their definitions stay as written.
    ['See [doc][d].\n\n[d]: https://d.x', 'See [doc][d].\n\n[d]: https://d.x'],
    // A titled link, an image with a title, an email.
    ['[a](https://a.x "T") ![i](https://i.x "P") <me@e.x>', 'a (https://a.x) ("T") i (https://i.x "P") me@e.x'],
    // A quote inside a list item sits at the left edge, as code does there.
    ['- item\n\n  > quoted', '- item\n\n▎ quoted'],
  ]
  for (const [markdown, drawn] of cases) expect(renderReply(markdown)).toBe(drawn)
})

test('the reply copies markdown, then rendered on a press while it reads ✓', async ($, on) => {
  engine(on)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  const text = '**Hi** there'
  const ui = await $.ui.mount({ ...MESSAGE, props: { text, isFirstOfReply: true } })

  await click(ui, 'copy-reply')
  expect(copied).toEqual([text])
  expect((await item(ui, 'copy-reply'))?.text).toBe('✓ Reply')
  expect((await item(ui, 'copy-reply'))?.tone).toBe('done')
  const said = await ui.find({ type: 'Text', text: 'copied as markdown' })
  const hint = await ui.find({ type: 'Text', text: ' · click again for rendered' })
  expect(said?.props.color).toBe('success')
  expect(hint?.props.dimColor).toBe(true)

  await click(ui, 'copy-reply')
  expect(copied).toEqual([text, 'Hi there'])
  expect(await ui.find({ type: 'Text', text: 'copied as rendered' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · click again for markdown' })).toBeDefined()
  await ui.unmount()
})

test('the rendered reply format makes rendered the first copy', { options: { replyFormat: 'rendered' } }, async ($, on) => {
  engine(on)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  const ui = await $.ui.mount({ ...MESSAGE, props: { text: '`a`', isFirstOfReply: true } })
  await click(ui, 'copy-reply')
  expect(copied).toEqual(['a'])
  await ui.unmount()
})

const action = (label: string, isReply = false) => ({ key: label, label, text: '', isReply })
const ROW = [action('Reply', true), action('bash 1'), action('bash 2'), action('python'), action('javascript')]

test('labels are cut to the languages\' short names, renumbered where they repeat', () => {
  const short = abbreviate([...ROW, action('elixirlang')])
  expect(short.map(a => a.label)).toEqual(['Reply', 'sh 1', 'sh 2', 'py', 'js', 'elix'])
})

test('the row stays beside, then moves above, then cuts labels, then pages', () => {
  const labels = (r: ReturnType<typeof layoutRow>) => r.items.map(labelOf)
  // Whole: Reply 7, bash 1 8, bash 2 8, python 8, javascript 12, four gaps of 2 = 51.
  expect(layoutRow(ROW, 51, 51, 0)).toMatchObject({ isAbove: false, pages: 1 })
  expect(layoutRow(ROW, 50, 51, 0)).toMatchObject({ isAbove: true, pages: 1 })
  expect(labels(layoutRow(ROW, 50, 51, 0))).toEqual(['Reply', 'bash 1', 'bash 2', 'python', 'javascript'])
  // Short: Reply 7, sh 1 6, sh 2 6, py 4, js 4, four gaps = 35.
  expect(labels(layoutRow(ROW, 0, 35, 0))).toEqual(['Reply', 'sh 1', 'sh 2', 'py', 'js'])
  // Paged in 34: Reply, sh 1, sh 2 and `› 2 more` (7 + 6 + 6 + 8, three gaps = 33);
  // then `‹ back`, py, js.
  const first = layoutRow(ROW, 0, 34, 0)
  expect(first.pages).toBe(2)
  expect(labels(first)).toEqual(['Reply', 'sh 1', 'sh 2', '› 2 more'])
  expect(labels(layoutRow(ROW, 0, 34, 1))).toEqual(['‹ back', 'py', 'js'])
  // A page past the last shows the last.
  expect(labels(layoutRow(ROW, 0, 34, 9))).toEqual(['‹ back', 'py', 'js'])
})

test('a notice starts over its action, held on screen and off the closing line\'s text', () => {
  // `copied as markdown · click again for rendered` 45, `copied as markdown` 18.
  const widths = [45, 18]
  // Over the row's rightmost action, it ends at the screen's edge.
  expect(placeNotice(widths, 9, 0, 100)).toEqual({ choice: 0, right: 0 })
  // Over one further left, its first letter is over that action's.
  expect(placeNotice(widths, 60, 0, 100)).toEqual({ choice: 0, right: 15 })
  // Past the closing line's 48 columns only 34 are left: the short notice.
  expect(placeNotice(widths, 9, 48, 82)).toEqual({ choice: 1, right: 0 })
  // Kept off the closing line's text where its action is further left.
  expect(placeNotice(widths, 40, 48, 82)).toEqual({ choice: 1, right: 16 })
  // None where even the short one leaves no room.
  expect(placeNotice(widths, 9, 48, 60)).toBeUndefined()
  // No viewport: as wide as it needs.
  expect(placeNotice(widths, 9, 48, Infinity)).toEqual({ choice: 0, right: 0 })
})

// The reply's notice once Reply is pressed in a terminal this wide: what was
// copied, and what another press takes.
async function noticeAt($: Parameters<TestBody>[0], on: On, columns: number, text = ANSWER) {
  engine(on)
  on('ui.copy', () => ({ value: { isCopied: true } }))
  const ui = await $.ui.mount({ ...MESSAGE, viewport: { columns, rows: 40 }, props: { text, isFirstOfReply: true } })
  await click(ui, 'copy-reply')
  expect(await item(ui, 'copy-reply')).toMatchObject({ text: '✓ Reply' })
  const said = [
    (await ui.find({ type: 'Text', text: 'copied as markdown' })) !== undefined,
    (await ui.find({ type: 'Text', text: ' · click again for rendered' })) !== undefined,
  ]
  await ui.unmount()
  return said
}

// With the row above, the notice shows in the closing line past its 48
// columns. Five bash blocks make the row 57 columns (Reply 7, bash 1 to 5 8
// each, five gaps): beside the closing line from 107 columns, so at 100 it is
// above, and 52 hold the whole notice.
const FIVE = Array.from({ length: 5 }, (_, i) => `\`\`\`bash\necho ${i}\n\`\`\``).join('\n\n')
test('with the row above, the notice shows whole in the closing line where it fits', async ($, on) => {
  expect(await noticeAt($, on, 100, FIVE)).toEqual([true, true])
})

// ANSWER's row is 33 columns (Reply 7, bash 1 8, bash 2 8, ts 4, three gaps):
// beside the closing line from 83 columns.

test('with the row above, a closing line too narrow drops what another press takes', async ($, on) => {
  expect(await noticeAt($, on, 82)).toEqual([true, false])
})

test('with the row above, a closing line with no room leaves the ✓ alone', async ($, on) => {
  expect(await noticeAt($, on, 60)).toEqual([false, false])
})

test('a narrow terminal pages the row above the closing line', async ($, on) => {
  engine(on)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  // The blank row above has 25 columns: Reply, sh 1 and `› 2 more` (7 + 6 + 8,
  // two gaps); the short row whole would take 29.
  const ui = await $.ui.mount({ ...MESSAGE, viewport: { columns: 2 + 2 + 25, rows: 40 } })
  const labelsNow = async () => await labels(ui)
  expect(await labelsNow()).toEqual(['⧉ Reply', '⧉ sh 1', '› 2 more'])

  await click(ui, 'page-more')
  expect(await labelsNow()).toEqual(['‹ back', '⧉ sh 2', '⧉ ts'])
  await click(ui, 'copy-code:2')
  expect(copied).toEqual(['console.log(1)'])

  await click(ui, 'page-back')
  expect(await labelsNow()).toEqual(['⧉ Reply', '⧉ sh 1', '› 2 more'])
  await ui.unmount()
})

test('a failed copy says why in a toast, and nothing reads ✓', async ($, on) => {
  engine(on)
  const toasts: string[] = []
  on('ui.copy', () => ({ value: { isCopied: false, reason: 'no-clipboard' } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const ui = await $.ui.mount(MESSAGE)
  await click(ui, 'copy-code:0')
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/^✗ couldn't copy: no clipboard reachable\. Over SSH, allow OSC 52/)
  expect((await item(ui, 'copy-code:0'))?.text).toBe('⧉ bash 1')
  await ui.unmount()
})

test('the row is its own region: a quick second click is a second press', async ($, on) => {
  engine(on)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  const text = '**Hi** there\n\n```sh\nls\n```'
  const ui = await $.ui.mount({ ...MESSAGE, props: { text, isFirstOfReply: true } })
  expect(await ui.find({ type: 'Client' })).toMatchObject({ key: 'row' })

  // What would be a double click elsewhere: two clicks on the reply, two presses.
  await click(ui, 'copy-reply')
  await click(ui, 'copy-reply')
  expect(copied).toEqual([text, 'Hi there\n\nls'])
  // A click between two items presses nothing.
  const [reply] = await rowOf(ui)
  await ui.pointer({ type: 'down', x: (reply?.to ?? 0) + 1, y: 0, button: 'left', in: 'row' })
  expect(copied).toHaveLength(2)
  await ui.unmount()
})

test('the row brightens the item under the pointer in the accent colour, but not one that reads ✓', async ($, on) => {
  engine(on)
  on('ui.copy', () => ({ value: { isCopied: true } }))
  const ui = await $.ui.mount(MESSAGE)
  const drawnText = async (text: string) => ui.find({ type: 'Text', text, in: 'row' })
  const reply = await item(ui, 'copy-reply')

  await ui.pointer({ type: 'move', x: reply?.from ?? 0, y: 0, in: 'row' })
  expect((await drawnText('⧉ Reply'))?.props.bold).toBe(true)
  expect((await drawnText('⧉ Reply'))?.props.color).toBe('suggestion')
  expect((await drawnText('⧉ Reply'))?.props.dimColor).toBeUndefined()
  expect((await drawnText('⧉ Reply'))?.props.inverse).toBeUndefined()
  expect((await drawnText('⧉ bash 1'))?.props.dimColor).toBe(true)

  await click(ui, 'copy-reply')
  await ui.pointer({ type: 'move', x: reply?.from ?? 0, y: 0, in: 'row' })
  const copiedReply = await drawnText('✓ Reply')
  expect(copiedReply?.props.color).toBe('success')
  expect(copiedReply?.props.inverse).toBeUndefined()
  expect(copiedReply?.props.bold).toBeUndefined()

  await ui.pointer({ type: 'leave', x: 0, y: 0, in: 'row' })
  expect((await drawnText('⧉ bash 1'))?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('the nerd-font style draws the Nerd Font icon', { options: { icon: 'nerd-font' } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(MESSAGE)
  expect((await item(ui, 'copy-reply'))?.text).toBe('\u{F018F} Reply')
  await ui.unmount()
})

test('on Windows the transcript is read with PowerShell', async ($, on) => {
  useReader(null)
  const session = 'win-session'
  const argv: string[][] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine reply</Text>
  })
  on('session.id', () => ({ value: session }))
  on('env.get', (_, e) => ({ value: { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\me', SystemRoot: 'C:\\Windows' }[e.name] }))
  on('process.run', (_, e) => {
    argv.push([...e.argv])
    const isLocate = e.argv.some(arg => arg.includes('Get-ChildItem'))
    const path = `C:\\Users\\me\\.claude\\projects\\p\\${session}.jsonl`
    const stdout = isLocate ? btoa(path) : ['T msg-1', 'D', 'O 100'].join('\n')
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  mock.clock(on)

  const ui = await $.ui.mount(MESSAGE)
  expect(await item(ui, 'copy-reply')).toBeDefined()
  // By its path under the system's folder, not by a name looked up.
  const system = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  expect(argv.map(a => a[0])).toEqual([system, system])
  expect(argv[0]?.at(-1)).toContain("'C:\\Users\\me\\.claude\\projects'")
  expect(argv[1]?.at(-1)).toContain(`p\\${session}.jsonl'`)
  await ui.unmount()
  useReader(null)
})

// A transcript the engine's file system calls reach, under a projects folder
// of another project too: what the reply `msg-1` and its closing line write.
function files(on: On, projects: string, sep: string, session: string, size?: number) {
  const text = [
    { type: 'user', message: { role: 'user', content: 'hi' }, uuid: 'p1' },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] }, uuid: 'msg-1' },
    { type: 'system', subtype: 'turn_duration', uuid: 'd1' },
  ].map(row => `${JSON.stringify(row)}\n`).join('')
  const file = `${projects}${sep}-p${sep}${session}.jsonl`
  // A path of the other platform than the one that runs the tests is not
  // absolute there: the engine puts the working directory, or the drive,
  // before it, and on Windows writes it with backslashes.
  const slashed = (path: string) => path.replaceAll('\\', '/')
  const is = (path: string, want: string) => {
    const [got, wanted] = [slashed(path), slashed(want)]
    return got === wanted || got.endsWith(wanted.startsWith('/') ? wanted : `/${wanted}`)
  }
  const missing = () => {
    throw new Error('ENOENT')
  }
  on('fs.list', (_, e) => {
    if (!is(e.path, projects)) missing()
    return { value: ['-other', '-p'].map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.stat', (_, e) => {
    if (!is(e.path, file)) missing()
    return { value: { kind: 'file' as const, size: size ?? new TextEncoder().encode(text).length, mtimeMs: 1, isLink: false } }
  })
  on('fs.read', (_, e) => {
    if (!is(e.path, file)) missing()
    return { value: { base64: btoa(text) } }
  })
}

test('the transcript is read in the engine\'s own process, with no command run, on Windows too', async ($, on) => {
  useReader(null)
  const session = 'in-process'
  const ran: string[][] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine reply</Text>
  })
  on('session.id', () => ({ value: session }))
  on('env.get', (_, e) => ({ value: { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\me' }[e.name] }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  files(on, 'C:\\Users\\me\\.claude\\projects', '\\', session)
  mock.clock(on)

  const ui = await $.ui.mount(MESSAGE)
  expect(await labels(ui)).toEqual(['⧉ Reply', '⧉ bash 1', '⧉ bash 2', '⧉ ts'])
  expect(ran).toEqual([])
  await ui.unmount()
  useReader(null)
})

test('a transcript past what one read of the engine takes is scanned by the platform\'s command', async ($, on) => {
  useReader(null)
  const session = 'in-process-large'
  const ran: string[][] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine reply</Text>
  })
  on('session.id', () => ({ value: session }))
  on('env.get', (_, e) => ({ value: { HOME: '/home/me' }[e.name] }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: 'T msg-1\nD\nO 100', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  files(on, '/home/me/.claude/projects', '/', session, 5 * 1024 * 1024)
  mock.clock(on)

  const ui = await $.ui.mount(MESSAGE)
  expect(await labels(ui)).toEqual(['⧉ Reply', '⧉ bash 1', '⧉ bash 2', '⧉ ts'])
  // Found with the engine's calls; scanned, once, by sh.
  expect(ran).toHaveLength(1)
  expect(ran[0]?.at(-2)).toBe('/home/me/.claude/projects/-p/in-process-large.jsonl')
  await ui.unmount()
  useReader(null)
})

test('PowerShell is run by its name where the system\'s folder is not known', () => {
  expect(powershell()[0]).toBe('powershell.exe')
  expect(powershell('')[0]).toBe('powershell.exe')
  expect(powershell('D:\\WINNT')[0]).toBe('D:\\WINNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
})

test('a value written into a PowerShell script has every quote PowerShell reads as one doubled', () => {
  // A profile named D’Angelo: its path would end its literal at the ’.
  const reader = windows('C:\\Users\\D\u2019Angelo\\.claude\\projects', ['powershell.exe'])
  const locate = reader.locate("s'1", 'x\u2019; Start-Process calc; \u2018').at(-1) ?? ''
  expect(locate).toContain("$d = 'C:\\Users\\D\u2019\u2019Angelo\\.claude\\projects'")
  expect(locate).toContain("+ 'x\u2019\u2019; Start-Process calc; \u2018\u2018' +")
  expect(locate).toContain("('s''1' + '.jsonl')")
  const scan = reader.scan('C:\\p\\a\u201Ab\u201Bc\\s.jsonl', 0).at(-1) ?? ''
  expect(scan).toContain("'C:\\p\\a\u201A\u201Ab\u201B\u201Bc\\s.jsonl'")
})

test('no command is run for a reply or a session whose id is not one Claude Code makes', async ($, on) => {
  let session = 'odd-session'
  let ran = 0
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine reply</Text>
  })
  on('session.id', () => ({ value: session }))
  on('env.get', () => ({ value: undefined }))
  on('process.run', () => {
    ran++
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  mock.clock(on)

  // As a transcript resumed may hold: an id that would leave its literal.
  const odd = await $.ui.mount({ ...MESSAGE, requestId: 'x\u2019; Start-Process calc; \u2018' })
  expect(await odd.find({ type: 'Text', text: 'engine reply' })).toBeDefined()
  expect(await odd.find({ type: 'Client' })).toBeUndefined()
  await odd.unmount()

  session = 'odd session; rm -rf ~'
  const other = await $.ui.mount({ ...MESSAGE, requestId: 'msg-odd-2' })
  expect(await other.find({ type: 'Client' })).toBeUndefined()
  await other.unmount()
  expect(ran).toBe(0)
})

test('off fullscreen the reply draws without the row, and the session is told once', async ($, on) => {
  const clock = engine(on)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const offscreen = { columns: 120, rows: 40, isFullscreen: false }
  const ui = await $.ui.mount({ ...MESSAGE, viewport: offscreen })
  expect(await ui.find({ type: 'Text', text: 'engine reply' })).toBeDefined()
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await clock.advance(0)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('"tui": "fullscreen"')

  const other = await $.ui.mount({ ...MESSAGE, requestId: 'msg-2', viewport: offscreen })
  await clock.advance(0)
  expect(toasts).toHaveLength(1)
  await ui.unmount()
  await other.unmount()
})

test('other surfaces keep the engine drawing alone', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...MESSAGE, surface: 'desktop' })
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.unmount()
})

// Rows as a terminal drew them, the reply's two columns of indent taken off.
test('a line wraps as the terminal wraps it: at spaces, a word wider than the row broken', () => {
  const printf = `printf '[popup]\\nview = "sidebar"\\n' > $d/config.toml   # 用 sidebar 模式，agent 才會在 popup 裡`
  expect(wrap(printf, 48).map(row => row.trimEnd())).toEqual([
    `printf '[popup]\\nview = "sidebar"\\n' >`,
    '$d/config.toml   # 用 sidebar 模式，agent 才會在',
    'popup 裡',
  ])
  const cat = 'cat ~/.local/state/tmux-agents/main.json'
  expect(wrap(cat, 38).map(row => row.trimEnd())).toEqual(['cat', '~/.local/state/tmux-agents/main.json'])
  expect(wrap(cat, 28)).toEqual(['cat ~/.local/state/tmux-agen', 'ts/main.json'])
})

test('a reply lays out as the terminal draws it: list rows under their text, code flush', () => {
  const markdown = [
    '1. `C-a ,` 把目前的 window 改名成 `api`。',
    '2. `C-a Space` 打開 popup，在裡面跑 `claude`，**問它一句話並等它回答**。沒有任何對話的 session 可能沒辦法 resume。',
    '   - 想多試幾個的話，在 popup 裡按 `C-a c` 再開一個 agent。',
    '3. 從另一個終端機確認有記下來：',
    '   ```sh',
    '   cat ~/.local/state/tmux-agents/main.json',
    '   ```',
    '   裡面應該有 `"window": "api"`。',
  ].join('\n')
  const layout = layOut(markdown, 50)
  expect(layout.rows.map(row => row.trimEnd())).toEqual([
    '1. C-a , 把目前的 window 改名成 api。',
    '2. C-a Space 打開 popup，在裡面跑',
    '   claude，問它一句話並等它回答。沒有任何對話的',
    '   session 可能沒辦法 resume。',
    '   - 想多試幾個的話，在 popup 裡按 C-a c',
    '     再開一個 agent。',
    '3. 從另一個終端機確認有記下來：',
    'cat ~/.local/state/tmux-agents/main.json',
    '   裡面應該有 "window": "api"。',
  ])
  expect(layout.parts).toEqual([{ kind: 'code', start: 7, end: 7 }])
})

test('a code block in a quote counts, and a block ends where the next one starts', () => {
  const markdown = ['> ```sh', '> echo quoted', '> ```', '', '    indented code block', '', '```diff', '- old', '+ new', '```'].join('\n')
  const layout = layOut(markdown, 80)
  expect(layout.rows).toEqual(['▎ echo quoted', '', 'indented code block', '- old', '+ new'])
  expect(layout.parts).toEqual([
    { kind: 'code', start: 0, end: 0 },
    { kind: 'code', start: 2, end: 2 },
    { kind: 'code', start: 3, end: 4 },
  ])
})

// As the terminal drew it: a quote at the reply's left edge is set apart by a
// blank row on each side, written right under a paragraph, code or a rule, or
// with a fence, a list or a heading right under it; in a list item or a quote
// it touches what it is written against.
test('a quote at the left edge has a blank row before and after it', () => {
  const rows = (markdown: string) => layOut(markdown, 80).rows.map(row => row.trimEnd())
  expect(rows('para\n> quote\n> more')).toEqual(['para', '', '▎ quote', '▎ more'])
  expect(rows('```\ncode\n```\n> quote')).toEqual(['code', '', '▎ quote'])
  expect(rows('---\n> quote')).toEqual(['---', '', '▎ quote'])
  expect(rows('> quote\n```\ncode\n```')).toEqual(['▎ quote', '', 'code'])
  expect(rows('> quote\n- item')).toEqual(['▎ quote', '', '- item'])
  expect(rows('> quote\n# head')).toEqual(['▎ quote', '', 'head'])
  expect(rows('- item\n\n  para\n  > quote')).toEqual(['- item', '', '  para', '▎ quote'])
  expect(rows('> a\n>\n> b\n> > c')).toEqual(['▎ a', '▎', '▎ b', '▎ ▎ c'])
  // A code block under it still starts where it is drawn.
  expect(layOut('para\n> quote\n\n```\ncode\n```', 80).parts).toEqual([{ kind: 'code', start: 4, end: 4 }])
})

// As Claude Code 2.1.322 drew it: a fence's info the highlighter does not
// know, in any case, is drawn as written on the block's first row.
test('a fence naming no language the highlighter knows has its info on a row above the code', () => {
  const rows = (info: string) => layOut(`A\n\n\`\`\`${info}\nx = 1\n\`\`\`\n\nB`, 80).rows.map(row => row.trimEnd())
  for (const info of ['ts:src/app.ts', 'ts src/app.ts', 'python title="main.py"', 'foolang', 'vue', 'ts {1,3}']) {
    expect(rows(info)).toEqual(['A', '', info, 'x = 1', '', 'B'])
  }
  for (const info of ['ts', 'TS', 'tsx', 'text', 'console', '']) expect(rows(info)).toEqual(['A', '', 'x = 1', '', 'B'])
  // The row is the block's, in a list item and a quote too.
  expect(layOut('A\n\n```ts:src/app.ts\nx\n```', 80).parts).toEqual([{ kind: 'code', start: 2, end: 3 }])
  expect(layOut('1. Do:\n\n   ```ts:a.ts\n   x\n   ```', 80).rows).toEqual(['1. Do:', '', 'ts:a.ts', 'x'])
  expect(layOut('> ```ts:a.ts\n> x\n> ```', 80).rows).toEqual(['▎ ts:a.ts', '▎ x'])
  // Nothing in it, the info row is drawn alone.
  expect(rows('foolang').length).toBe(6)
  expect(layOut('- a\n\n```foolang\n```\n\nB', 80).rows.map(row => row.trimEnd())).toEqual(['- a', '', 'foolang', '', '', 'B'])
  expect(renderReply('```ts:src/app.ts\nx\n```')).toBe('ts:src/app.ts\nx')
})

// As Claude Code 2.1.322 drew it: lists, quotes and tables are drawn each on
// its own and the blocks between them as one text, its blank rows at either
// end trimmed, so a blank code block there is drawn as nothing. Between two
// paragraphs it is a blank row; in a list item, always nothing.
test('an empty code block next to a list, a quote, a table or the reply\'s edge is drawn as nothing', () => {
  const E = '```bash\n```'
  const T = '| a |\n|---|\n| 1 |'
  const rows = (markdown: string) => layOut(markdown, 80).rows.map(row => row.trimEnd())
  expect(rows(`- a\n\n${E}\n\nB`)).toEqual(['- a', '', 'B'])
  expect(rows(`- a\n- b\n\n${E}\n\n${E}\n\nB`)).toEqual(['- a', '- b', '', 'B'])
  expect(rows(`> q\n\n${E}\n\nB`)).toEqual(['▎ q', '', 'B'])
  expect(rows(`${T}\n\n${E}\n\n${T}`)).toHaveLength(11)
  expect(rows(`A\n\n${E}\n\n- x`)).toEqual(['A', '', '- x'])
  expect(rows(`A\n\n${E}\n\n> q`)).toEqual(['A', '', '▎ q'])
  expect(rows(`A\n${E}\n\n- x`)).toEqual(['A', '', '- x'])
  expect(rows(`${E}\n\nB`)).toEqual(['B'])
  expect(rows(`A\n\n${E}`)).toEqual(['A'])
  expect(rows(`- a\n\n${E}\n\n# H`)).toEqual(['- a', '', 'H'])
  // Between two blocks of the same text it is a blank row.
  expect(rows(`A\n\n${E}\n\nB`)).toEqual(['A', '', '', '', 'B'])
  expect(rows(`# H\n\n${E}\n\nB`)).toEqual(['H', '', '', '', 'B'])
  expect(rows(`- a\n\nP\n\n${E}\n\nB`)).toEqual(['- a', '', 'P', '', '', '', 'B'])
  expect(rows(`A\n\n${E}\n\n---\n\nB`)).toEqual(['A', '', '', '', '---', '', 'B'])
  // In a list item it is nothing, the blank rows around it kept; in a quote,
  // trimmed as the reply's text is.
  expect(rows('- a\n  ```bash\n  ```\n\nB')).toEqual(['- a', '', 'B'])
  expect(rows('- a\n\n  ```bash\n  ```\n\n  more\n\nB')).toEqual(['- a', '', '', '  more', '', 'B'])
  expect(rows('> a\n>\n> ```bash\n> ```\n\nB')).toEqual(['▎ a', '', 'B'])
  expect(rows('> a\n>\n> ```bash\n> ```\n>\n> b')).toEqual(['▎ a', '▎', '▎', '▎', '▎ b'])
  // It is still a part, of no rows, so the parts stay the reply's one for one.
  expect(layOut(`- a\n\n${E}\n\n\`\`\`\nx\n\`\`\``, 80).parts).toEqual([
    { kind: 'code', start: 1, end: 0 },
    { kind: 'code', start: 2, end: 2 },
  ])
  expect(renderReply(`- a\n\n${E}\n\nB`)).toBe('- a\n\nB')
})

// A code block's button whole or as its icon; a table's three, one under
// another, or one as its icon.
const ICON = { width: 2, height: 1 }
const SIZES_OF = (kind: 'code' | 'table') => (kind === 'code' ? [{ width: 8, height: 1 }, ICON] : [{ width: 10, height: 3 }, ICON])
const codeParts = (...spans: [number, number][]) => spans.map(([start, end]) => ({ kind: 'code' as const, start, end }))

test('a block button sits past the widest row, else at the right, else as its icon', () => {
  const layout = { rows: ['short', 'a much longer row of code', 'x'.repeat(40)], parts: codeParts([0, 1], [2, 2]) }
  const full = [false, false]
  // Wide: each past its own widest row, its card ending a column after it.
  expect(placeBlocks(layout, full, 80, SIZES_OF)).toEqual([
    { index: 0, kind: 'code', top: 1, rows: ['short', 'a much longer row of code'], right: 38, size: 0, pastWidest: 29 },
    { index: 1, kind: 'code', top: 3, rows: ['x'.repeat(40)], right: 53, size: 0, pastWidest: 44 },
  ])
  // Narrower: the long block's icon alone past it; narrower still, over its end.
  expect(placeBlocks(layout, full, 50, SIZES_OF)[1]).toMatchObject({ right: 47, size: 1, pastWidest: 44 })
  const covering = placeBlocks(layout, full, 45, SIZES_OF)[1]
  expect(covering).toMatchObject({ right: 45, size: 1 })
  expect(placeOn(covering!, 0, 45, SIZES_OF)).toEqual({ at: 42, size: 1, isOver: true })
  // An empty block gets none.
  expect(placeBlocks(layout, [true, true], 80, SIZES_OF)).toEqual([])
})

// Each as the terminal drew it.
test('a tab in code runs to the next multiple of eight from where the code starts', () => {
  const code = 'func worker() {\n\tfor j := range jobs {\n\t\tresults <- j\n\t}\n}'
  const layout = layOut(['```go', code, '```'].join('\n'), 80)
  expect(layout.rows).toEqual(['func worker() {', '        for j := range jobs {', '                results <- j', '        }', '}'])
  expect(placeBlocks(layout, [false], 80, SIZES_OF)).toHaveLength(1)

  const rows = (markdown: string) => layOut(markdown, 80).rows.map(row => row.trimEnd())
  expect(rows('```\nname\tage\nabcdefgh\t22\nab\tc\td\n```')).toEqual(['name    age', 'abcdefgh        22', 'ab      c       d'])
  // Past a quote's bar, and a wide character two columns.
  expect(rows('> ```\n> ab\tc\n> abcdefghij\td\n> ```')).toEqual(['▎ ab      c', '▎ abcdefghij      d'])
  expect(rows('```\n中文\tx\n中文字\ty\n```')).toEqual(['中文    x', '中文字  y'])
})

test('a block as wide as the screen has its button at the right of the row it is drawn on', () => {
  const layout = { rows: ['ab', 'y'.repeat(37)], parts: codeParts([0, 1]) }
  const [block] = placeBlocks(layout, [false], 40, SIZES_OF)
  expect(block).toMatchObject({ right: 40, size: 0 })
  expect(block?.pastWidest).toBeUndefined()
  // Whole where the row leaves room; over the end of a row that leaves none.
  expect(placeOn(block!, 0, 40, SIZES_OF)).toEqual({ at: 31, size: 0, isOver: false })
  expect(placeOn(block!, 1, 40, SIZES_OF)).toEqual({ at: 37, size: 1, isOver: true })
})

test('a block is drawn only as far as it shows on screen', () => {
  const block = { index: 0, kind: 'code' as const, top: 5, rows: ['a', 'b', 'c', 'd'], right: 10, size: 0 }
  expect(onScreenPart(block, { first: 0, last: 100 })).toEqual({ from: 5, lines: ['a', 'b', 'c', 'd'] })
  expect(onScreenPart(block, { first: 7, last: 100 })).toEqual({ from: 7, lines: ['c', 'd'] })
  expect(onScreenPart(block, { first: 0, last: 6 })).toEqual({ from: 5, lines: ['a', 'b'] })
  expect(onScreenPart(block, { first: 9, last: 100 })).toBeUndefined()
  expect(onScreenPart(block, null)).toBeUndefined()
  expect(onScreenPart(block, undefined)).toEqual({ from: 5, lines: ['a', 'b', 'c', 'd'] })
})

// ANSWER on a screen 61 columns wide: its eight rows and the blank row above.
const HOVERED = { ...MESSAGE, viewport: { columns: 61, rows: 40 } }
const onScreen = (of: number) => ({ ...MESSAGE.props, onScreen: { first: 0, last: of - 1, of } })
const blockButton = async (ui: Mounted, key: string) =>
  ((await ui.find({ type: 'Client', key }))?.props.props as RowProps | undefined)?.items[0]?.text
const rowLabels = async (ui: Mounted) =>
  (((await ui.find({ type: 'Client', key: 'row' }))?.props.props as RowProps | undefined)?.items ?? []).map(one => one.text)

test('each code block gets its own button once the engine agrees on the reply\'s height', async ($, on) => {
  engine(on)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  const ui = await $.ui.mount({ ...HOVERED, props: onScreen(9) })
  expect(await rowLabels(ui)).toEqual(['⧉ Reply'])
  expect(await blockButton(ui, 'part-1')).toBe('⧉ copy')

  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'part-1' })
  expect(copied).toEqual(['pwd'])
  expect(await blockButton(ui, 'part-1')).toBe('✓ copied')
  await ui.unmount()
})

test('blocks after an empty one drawn as nothing, and a block naming a file, get their own buttons', async ($, on) => {
  engine(on)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  // `- a`, a blank row, the empty block as nothing; `src/app.ts` on its own
  // row above `x`: five rows, and the blank one above them.
  const text = ['- a', '', '```bash', '```', '', '```ts:src/app.ts', 'x', '```'].join('\n')
  const ui = await $.ui.mount({ ...HOVERED, props: { text, isFirstOfReply: true, onScreen: { first: 0, last: 4, of: 5 } } })
  expect(await rowLabels(ui)).toEqual(['⧉ Reply'])
  expect(await blockButton(ui, 'part-1')).toBe('⧉ copy')
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'part-1' })
  expect(copied).toEqual(['x'])
  await ui.unmount()
})

test('a reply whose height the engine does not agree on keeps its blocks on the row', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...HOVERED, props: onScreen(12) })
  expect(await rowLabels(ui)).toEqual(['⧉ Reply', '⧉ bash 1', '⧉ bash 2', '⧉ ts'])
  expect(await ui.find({ type: 'Client', key: 'part-0' })).toBeUndefined()
  await ui.unmount()
})

test('an empty code block gets no button, on the row or its own, and is not counted', async ($, on) => {
  engine(on)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  const text = ['```sh', 'ls', '```', '', '```sh', '```', '', '```sh', 'pwd', '```'].join('\n')
  const ui = await $.ui.mount({ ...HOVERED, props: { text, isFirstOfReply: true, onScreen: { first: 0, last: 98, of: 99 } } })
  expect(await rowLabels(ui)).toEqual(['⧉ Reply', '⧉ sh 1', '⧉ sh 2'])
  await click(ui, 'copy-code:2')
  expect(copied).toEqual(['pwd'])
  await ui.unmount()
})

test('a hovered block shows its buttons alone, and a press flashes it on its card, its ✓ staying longer', async ($, on) => {
  const clock = engine(on)
  on('ui.copy', () => ({ value: { isCopied: true } }))
  const ui = await $.ui.mount({ ...HOVERED, props: onScreen(9) })
  const props = async (key: string) => (await ui.find({ type: 'Client', key }))?.props.props as RowProps | undefined
  const card = () => ui.find({ type: 'Text', text: 'pwd' })
  // No bar marks the block: its buttons alone.
  expect(await ui.find({ type: 'Box', key: 'bar-part-1' })).toBeUndefined()
  expect(await card()).toBeUndefined()
  expect((await props('part-1'))?.background).toBeUndefined()

  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'part-1' })
  expect(await card()).toBeDefined()
  // Drawn whatever the pointer does, not as a hover reveal; the ✓ on it.
  expect((await ui.find({ type: 'Box', key: 'mark-part-1' }))?.props.display).toBeUndefined()
  // The card the rows' alone (`pwd`, a column each side), the button off it.
  expect((await ui.find({ type: 'Box', key: 'mark-part-1' }))?.props.width).toBe(5)
  expect((await props('part-1'))?.background).toBeUndefined()
  expect((await ui.find({ type: 'Box', key: 'button-part-1' }))?.props.display).toBeUndefined()
  expect(await ui.find({ type: 'Client', key: 'part-1:copied' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'console.log(1)' })).toBeUndefined()

  // The flash goes after 500ms; the ✓ and the button stay their 1.5s.
  await clock.advance(500)
  expect(await card()).toBeUndefined()
  expect(await blockButton(ui, 'part-1')).toBe('✓ copied')
  expect((await ui.find({ type: 'Box', key: 'button-part-1' }))?.props.display).toBeUndefined()
  await clock.advance(1000)
  expect(await blockButton(ui, 'part-1')).toBe('⧉ copy')
  expect((await ui.find({ type: 'Box', key: 'button-part-1' }))?.props.display).toBe('none')
  await ui.unmount()
})

test('a second press within the flash flashes again for its own 500ms', async ($, on) => {
  const clock = engine(on)
  on('ui.copy', () => ({ value: { isCopied: true } }))
  const ui = await $.ui.mount({ ...HOVERED, props: onScreen(9) })
  const card = () => ui.find({ type: 'Box', key: 'mark-part-1' })
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'part-1' })
  await clock.advance(300)
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'part-1' })
  // The first press's timer lands here and must not end the second's flash.
  await clock.advance(300)
  expect(await card()).toBeDefined()
  await clock.advance(200)
  expect(await card()).toBeUndefined()
  await ui.unmount()
})

test('a copied table keeps its other buttons beside the pressed one\'s ✓', async ($, on) => {
  engine(on)
  on('ui.copy', () => ({ value: { isCopied: true } }))
  const ui = await $.ui.mount({ ...HOVERED, props: { text: TABLE_ANSWER, isFirstOfReply: true, onScreen: { first: 0, last: 9, of: 10 } } })
  const shown = async (key: string) => (await ui.find({ type: 'Box', key: `button-${key}` }))?.props.display
  expect(await shown('part-0:1')).toBe('none')
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'part-0:1' })
  expect(await shown('part-0')).toBeUndefined()
  expect(await shown('part-0:1')).toBeUndefined()
  expect(await shown('part-0:2')).toBeUndefined()
  expect(await blockButton(ui, 'part-0:1')).toBe('✓ copied')
  expect(await blockButton(ui, 'part-0')).toBe('⧉ markdown')
  await ui.unmount()
})

test('a copied block whose button covers its row\'s end has the button on its card', async ($, on) => {
  engine(on)
  on('ui.copy', () => ({ value: { isCopied: true } }))
  const text = ['```sh', 'x'.repeat(40), '```'].join('\n')
  const of = layOut(text, 45).rows.length + 1
  const ui = await $.ui.mount({ ...MESSAGE, viewport: { columns: 45, rows: 40 }, props: { text, isFirstOfReply: true, onScreen: { first: 0, last: of - 1, of } } })
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'part-0' })
  expect((await ui.find({ type: 'Box', key: 'mark-part-0' }))?.props.width).toBe(44)
  expect(((await ui.find({ type: 'Client', key: 'part-0' }))?.props.props as RowProps | undefined)?.background).toBe('selectionBg')
  await ui.unmount()
})

test('a copied block whose button sits beside a short row above wider ones has the button on its card', async ($, on) => {
  engine(on)
  on('ui.copy', () => ({ value: { isCopied: true } }))
  const text = ['```sh', 'cd ~/x', 'x'.repeat(36), '```'].join('\n')
  const of = layOut(text, 45).rows.length + 1
  const ui = await $.ui.mount({ ...MESSAGE, viewport: { columns: 45, rows: 40 }, props: { text, isFirstOfReply: true, onScreen: { first: 0, last: of - 1, of } } })
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'part-0' })
  expect((await ui.find({ type: 'Box', key: 'mark-part-0' }))?.props.width).toBe(44)
  expect(((await ui.find({ type: 'Client', key: 'part-0' }))?.props.props as RowProps | undefined)?.background).toBe('selectionBg')
  await ui.unmount()
})

test('always shown, a block\'s buttons need no hover, but one over its row\'s end does', { options: { blockButtons: 'always' } }, async ($, on) => {
  engine(on)
  on('ui.copy', () => ({ value: { isCopied: true } }))
  const shown = async (ui: Mounted, key: string) => (await ui.find({ type: 'Box', key: `button-${key}` }))?.props.display
  const wide = await $.ui.mount({ ...HOVERED, props: onScreen(9) })
  expect(await shown(wide, 'part-1')).toBeUndefined()
  await wide.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'part-1' })
  // The button itself reads ✓; no copy of it beneath.
  expect(await blockButton(wide, 'part-1')).toBe('✓ copied')
  expect(await wide.find({ type: 'Client', key: 'part-1:copied' })).toBeUndefined()
  await wide.unmount()

  const text = ['```sh', 'x'.repeat(40), '```'].join('\n')
  const of = layOut(text, 45).rows.length + 1
  const narrow = await $.ui.mount({ ...MESSAGE, viewport: { columns: 45, rows: 40 }, props: { text, isFirstOfReply: true, onScreen: { first: 0, last: of - 1, of } } })
  expect(await shown(narrow, 'part-0')).toBe('none')
  await narrow.unmount()
})

test('at the end of the answer every block keeps its button on the row', { options: { blockButtons: 'end-of-answer' } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...HOVERED, props: onScreen(9) })
  expect(await rowLabels(ui)).toEqual(['⧉ Reply', '⧉ bash 1', '⧉ bash 2', '⧉ ts'])
  expect(await ui.find({ type: 'Client', key: 'part-0' })).toBeUndefined()
  await ui.unmount()
})

const TABLE_ANSWER = ['Results:', '', '| name | n |', '| --- | --: |', '| a | 1 |', '', '```sh', 'ls', '```'].join('\n')

test('tables and code blocks are laid out in reading order, each by its rows', () => {
  const layout = layOut(TABLE_ANSWER, 61)
  expect(layout.rows).toEqual(['Results:', '', '┌──────┬─────┐', '│ name │  n  │', '├──────┼─────┤', '│ a    │   1 │', '└──────┴─────┘', '', 'ls'])
  expect(layout.parts).toEqual([
    { kind: 'table', start: 2, end: 6 },
    { kind: 'code', start: 8, end: 8 },
  ])
})

// Every row of a reply as the terminal drew it at each width: tables that
// fit, narrowed (cells wrapped, words broken) and drawn as lines, wrapped
// again in the reply's narrower rows; tables in list items and quotes;
// Hebrew, Devanagari, Cyrillic, Vietnamese and Tangut text; lists seven deep
// and counted past 3999, their markers wrapped on a narrow screen; a table's
// rows past 200, in boxes and as lines. A row of
// Devanagari, which tmux draws otherwise, by its consonants.
const asDrawn = (row: string) => (/[\u0900-\u097f]/.test(row) ? row.replace(/[^\u0915-\u0939]/g, '') : row)
for (const [name, fixture] of [['the samples', samples], ['a reply with listed code', tmuxAgents], ['nested tables and scripts', nested], ['deep lists and a long table', deep]] as const) {
  for (const [columns, screen] of Object.entries(fixture.screens)) {
    test(`${name} lay out as the terminal drew them ${columns} columns wide`, () => {
      expect(layOut(fixture.answer, Number(columns)).rows.map(row => asDrawn(row.trimEnd()))).toEqual(screen.map(asDrawn))
    })
  }
}

test('a table too wide for the screen is one part, narrowed or as lines', () => {
  const rowsOf = (columns: number) => {
    const layout = layOut(samples.answer, columns)
    const wide = layout.parts.filter(part => part.kind === 'table')[3]
    return wide === undefined ? [] : layout.rows.slice(wide.start, wide.end + 1).map(row => row.trimEnd())
  }
  expect(rowsOf(80)).toEqual([
    '┌─────────────────────────┬──────────────────────┬───────┬─────────┬──────┐',
    '│          Wide           │       Columns        │ Here  │   And   │ More │',
    '├─────────────────────────┼──────────────────────┼───────┼─────────┼──────┤',
    '│ the quick brown fox     │ 中文內容比較長的一格 │ ✅    │ 👨‍👩‍👧      │ end  │',
    '│ jumps over the lazy dog │                      │ done  │ family  │      │',
    '└─────────────────────────┴──────────────────────┴───────┴─────────┴──────┘',
  ])
  expect(rowsOf(46)).toEqual([
    'Wide: the quick brown fox jumps over the',
    '  lazy dog',
    'Columns: 中文內容比較長的一格',
    'Here: ✅ done',
    'And: 👨‍👩‍👧 family',
    'More: end',
  ])
})

const WIDE_ANSWER = ['| name | note |', '| --- | --- |', '| a | the quick brown fox jumps over the lazy dog |'].join('\n')

test('a reply holding a table too wide for the screen still gives it its own buttons', async ($, on) => {
  engine(on)
  const layout = layOut(WIDE_ANSWER, 40)
  expect(layout.rows.map(row => row.trimEnd())).toEqual([
    '┌──────┬───────────────────────────┐',
    '│ name │           note            │',
    '├──────┼───────────────────────────┤',
    '│ a    │ the quick brown fox jumps │',
    '│      │  over the lazy dog        │',
    '└──────┴───────────────────────────┘',
  ])
  const height = layout.rows.length + 1
  const props = { text: WIDE_ANSWER, isFirstOfReply: true, onScreen: { first: 0, last: height - 1, of: height } }
  const ui = await $.ui.mount({ ...MESSAGE, viewport: { columns: 40, rows: 40 }, props })
  expect(await rowLabels(ui)).toEqual(['⧉ Reply'])
  expect(await ui.find({ type: 'Client', key: 'part-0' })).toBeDefined()
  await ui.unmount()
  // Boxed copies the table whole, as drawn where it fits.
  expect(copyables(WIDE_ANSWER)[0]).toMatchObject({
    rendered: [
      '┌──────┬─────────────────────────────────────────────┐',
      '│ name │                    note                     │',
      '├──────┼─────────────────────────────────────────────┤',
      '│ a    │ the quick brown fox jumps over the lazy dog │',
      '└──────┴─────────────────────────────────────────────┘',
    ].join('\n'),
  })
})

// A table in a list item or a quote is drawn as Markdown, at the left edge
// in a list, never narrowed.
test('a table in a list item or a quote is drawn as Markdown and has its own buttons', async ($, on) => {
  engine(on)
  const text = `- items:\n\n  ${WIDE_ANSWER.replace(/\n/g, '\n  ')}\n\n> | x |\n> |--:|\n> | 10 |\n\n\`\`\`sh\nls\n\`\`\``
  const layout = layOut(text, 60)
  expect(layout.rows.map(row => row.trimEnd())).toEqual([
    '- items:',
    '',
    '| name | note                                        |',
    '|------|---------------------------------------------|',
    '| a    | the quick brown fox jumps over the lazy dog |',
    '',
    '▎ |   x |',
    '▎ |-----|',
    '▎ |  10 |',
    '',
    'ls',
  ])
  expect(layout.parts.map(part => part.kind)).toEqual(['table', 'table', 'code'])
  const height = layout.rows.length + 1
  const props = { text, isFirstOfReply: true, onScreen: { first: 0, last: height - 1, of: height } }
  const ui = await $.ui.mount({ ...MESSAGE, viewport: { columns: 60, rows: 40 }, props })
  expect(await rowLabels(ui)).toEqual(['⧉ Reply'])
  await ui.unmount()
})

test('a table shows its three buttons where they fit, else one as its icon', () => {
  const layout = { rows: Array(5).fill('x'.repeat(30)), parts: [{ kind: 'table' as const, start: 0, end: 4 }] }
  expect(placeBlocks(layout, [false], 80, SIZES_OF)[0]).toMatchObject({ size: 0, pastWidest: 34, right: 45 })
  expect(placeBlocks(layout, [false], 44, SIZES_OF)[0]).toMatchObject({ size: 1, pastWidest: 34, right: 37 })
  // At the screen's right the three need room on each of the rows they take.
  const block = { index: 0, kind: 'table' as const, top: 1, rows: ['ab', 'ab', 'ab', 'x'.repeat(30)], right: 44, size: 0 }
  expect(placeOn(block, 0, 44, SIZES_OF)).toEqual({ at: 33, size: 0, isOver: false })
  expect(placeOn(block, 1, 44, SIZES_OF)).toEqual({ at: 41, size: 1, isOver: true })
})

test('a table\'s own buttons, one under another, copy it as markdown, for a spreadsheet and boxed', async ($, on) => {
  engine(on)
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  const props = { text: TABLE_ANSWER, isFirstOfReply: true }
  const height = layOut(TABLE_ANSWER, 61).rows.length + 1
  const ui = await $.ui.mount({ ...HOVERED, props: { ...props, onScreen: { first: 0, last: height - 1, of: height } } })
  expect(await rowLabels(ui)).toEqual(['⧉ Reply'])
  const names = ['part-0', 'part-0:1', 'part-0:2']
  expect(await Promise.all(names.map(name => blockButton(ui, name)))).toEqual(['⧉ markdown', '⧉ sheet', '⧉ boxed'])

  for (const name of names) await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: name })
  expect(copied).toEqual([
    '| name | n |\n| --- | --: |\n| a | 1 |',
    'name\tn\na\t1',
    '┌──────┬─────┐\n│ name │  n  │\n├──────┼─────┤\n│ a    │   1 │\n└──────┴─────┘',
  ])
  expect(await blockButton(ui, 'part-0:2')).toBe('✓ copied')
  expect(await blockButton(ui, 'part-0')).toBe('⧉ markdown')
  await ui.unmount()
})
