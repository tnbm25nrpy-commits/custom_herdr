import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Copied, Format } from '../types'
import { renderReply } from './render'
import { GAP, labelOf, layoutRow, numbered, placeNotice, widthOfItem } from './fit'
import type { RowItem, RowPress } from './row'
import type { Action } from './fit'
import { copyables } from './blocks'
import type { Copyable } from './blocks'
import { clean } from './clean'
import { onScreenPart, placeBlocks, placeOn } from './place'
import type { Block, SizesOf } from './place'
import { isFinalAnswer, knownVerdict } from './transcript'
import { widthOf } from './width'
import { layOut } from './wrap'
import type { Layout } from './wrap'

const DONE_MS = 1500
// How long a press lights its block's rows, a flash as a yank's in an editor,
// in the colour a selection takes: a key of the theme, though not one typed.
const FLASH_MS = 500
const SELECTION = 'selectionBg'
const ROW_RIGHT = 2
// Room the turn's closing line takes at the row's left
// (`✻ Cogitated for 12m 34s · done Tuesday 5:30 PM`), and a gap after it.
const CLOSING_LINE = 48
// Why a copy failed, and what to do, for each reason the engine gives; told
// in a toast, so it is seen wherever the button was. A terminal that
// drops an OSC 52 write says nothing, so that failure reads as a copy.
const FAILURES: Record<'no-surface' | 'no-clipboard' | 'refused', string> = {
  'no-clipboard':
    'no clipboard reachable. Over SSH, allow OSC 52 in your terminal (and set-clipboard on in tmux); very long text may exceed its limit',
  'no-surface': 'this session has no screen attached',
  refused: 'another plugin blocked it',
}
const FAILURE_MS = 8000

// How much was copied: a code block in lines, a table in rows (its header
// one of them), the reply in characters.
const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
const linesOf = (text: string) => count(text.split('\n').length, 'line')
const hintFor = (other: Format) => ` · click again for ${other}`
// The transcript's closing row may land a moment after the turn's end.
const SETTLE_MS = 500
const STANDARD_ICON = '⧉'
const ICONS: Record<string, string> = {
  standard: STANDARD_ICON,
  'nerd-font': '\u{F018F}', // nf-md-content_copy
}

// Which action last copied, and for one with two formats which it took and
// which the next press takes: its icon reads ✓ a moment, its label kept so
// the row keeps its width and nothing moves.
const copied = atom({ plugin: 'copy-buttons', key: 'copied' } as const, null as Copied | null)

// The stamp of the copy whose block still flashes: its card shows while this
// is the last copy's, a moment of the ✓'s.
const flashed = atom({ plugin: 'copy-buttons', key: 'flashed' } as const, null as number | null)

// A reply's verdict never changes once its turn has ended: read it once.
const finals = new Map<string, boolean>()

// Whether this session was told the buttons need fullscreen; the session's
// state, so a reload of the mod does not tell it again. `telling` covers the
// draws made before that write lands.
const toldFullscreen = atom({ plugin: 'copy-buttons', key: 'toldFullscreen' } as const, false)
let telling = false
// Short enough for the main screen's notification bar, which cuts it at its width.
const FULLSCREEN_HINT = 'copy buttons need fullscreen: add "tui": "fullscreen" to ~/.claude/settings.json, restart'
const HINT_MS = 10000

// The page each paged row shows, by the reply's requestId.
const pages = atom({ plugin: 'copy-buttons', key: 'pages' } as const, {} as Record<string, number>)

// What a press puts on the clipboard, and for an action with two formats the
// one taken and the other.
type Copy = { id: string; text: string; format?: Format; other?: Format }

async function copy($: EngineInterface, what: Copy, surface: RenderSurface) {
  const { id, text, format, other } = what
  const result = await $.ui.copy({ text, surface })
  if (!result.isCopied) {
    $.ui.toast(`✗ couldn't copy: ${FAILURES[result.reason]}`, { timeoutMs: FAILURE_MS })
    return
  }

  const stamp = await $.clock.now()
  await update($, copied, () => ({ id, format, other, stamp }))
  await update($, flashed, () => stamp)
  $.clock.after(FLASH_MS, () => {
    void update($, flashed, last => (last === stamp ? null : last))
  })
  $.clock.after(DONE_MS, () => {
    void update($, copied, last => (last?.stamp === stamp ? null : last))
  })
}

// A press as the person meant it, read at the moment it lands: the first
// format, or, while the action's last copy still shows ✓, the next one in
// turn (a block, with one format, copies again).
// Resolves to the text it put on the clipboard.
async function pressAction(
  $: EngineInterface,
  requestId: string,
  action: Action,
  surface: RenderSurface,
): Promise<string> {
  const id = `${requestId}:${action.key}`
  const done = await read($, copied)
  const formats = action.formats ?? []
  const at = Math.max(0, done?.id === id && done.other !== undefined ? formats.findIndex(f => f.format === done.other) : 0)
  const chosen = formats[at]
  const other = formats.length > 1 ? formats[(at + 1) % formats.length]?.format : undefined
  const text = chosen === undefined ? action.text : chosen.text()
  await copy($, { id, text, format: chosen?.format, other }, surface)
  return text
}

// An empty code block, which has nothing to copy: it gets no button.
const isEmpty = (part: Copyable) => part.kind === 'code' && part.code === ''

// A final answer's code blocks and tables with their names, read once per
// text: a redraw (a scroll moving the viewport's edge across it) reuses them.
type Parts = { parts: Copyable[]; names: string[]; labels: string[] }
const partsByReply = new Map<string, { text: string } & Parts>()

function partsOf(requestId: string, text: string): Parts {
  const known = partsByReply.get(requestId)
  if (known?.text === text) return known
  // Code blocks and tables in reading order: a block named by the file it
  // names, else its language; a table `table`; numbered where names repeat,
  // an empty block not counted.
  const parts = copyables(text)
  const nameOf = (part: Copyable) => (part.kind === 'table' ? 'table' : (part.file ?? (part.language || 'code')))
  const names = parts.map(nameOf)
  const counted = numbered(parts.filter(part => !isEmpty(part)).map(nameOf))
  let next = 0
  const labels = parts.map(part => (isEmpty(part) ? '' : (counted[next++] ?? '')))
  const found = { text, parts, names, labels }
  partsByReply.set(requestId, found)
  return found
}

// A final answer's rows at a width, laid out once per text and width.
const layouts = new Map<string, { text: string; columns: number; layout: Layout }>()

function layoutOf(requestId: string, text: string, columns: number): Layout {
  const known = layouts.get(requestId)
  if (known?.text === text && known.columns === columns) return known.layout
  const layout = layOut(text, columns)
  layouts.set(requestId, { text, columns, layout })
  return layout
}

// Whether a reply's laid-out height was the engine's at a width, by
// `<requestId>:<columns>`: the engine says so only once it has drawn it.
const agreed = new Map<string, boolean>()

// A code block's own button reads `copy`; a table's three, one under
// another, read the format each copies: `markdown` as Claude wrote it,
// `sheet` as rows a spreadsheet pastes, `boxed` with its borders as drawn.
// Each reads `copied` for the moment after a copy.
const BLOCK_LABEL = 'copy'
const TABLE_LABELS = ['markdown', 'sheet', 'boxed'] as const
const BLOCK_DONE = 'copied'

// A table's own buttons press actions of their own, one format each.
const tableKey = (label: string, n: number) => `copy-table-${label}:${n}`

// The buttons a part shows in one of its sizes (`SizesOf`), each on a row of
// its own, by the action it presses and the label it reads at rest (none:
// its icon alone, which for a table copies its markdown).
function buttonsOf(kind: Block['kind'], size: number, n: number): { key: string; label?: string }[] {
  if (kind === 'code') return [{ key: `copy-code:${n}`, ...(size === 0 ? { label: BLOCK_LABEL } : {}) }]
  if (size === 0) return TABLE_LABELS.map(label => ({ key: tableKey(label, n), label }))
  return [{ key: tableKey('markdown', n) }]
}

// A button as its icon alone: a space after it, which an icon drawn wider
// than its column (a Nerd Font's, often) spills into.
const compactOf = (glyph: string) => `${glyph} `

// What each drawn row's clicks reach, by the reply's requestId: its actions
// by key, and its page turn. Kept from the row's last draw.
const rows = new Map<string, { actions: Map<string, Action>; turnPage: (by: number) => Promise<unknown> }>()

export const register: Register = (on, options) => {
  const icon = ICONS[String(options.icon)] ?? STANDARD_ICON
  // A button's room: its icon and the widest of the labels it can read, or
  // its icon alone. A code block's sizes are its button whole or as its icon;
  // a table's its three buttons, one under another, or one as its icon.
  const wholeOf = (labels: readonly string[]) => 2 + Math.max(...[...labels, BLOCK_DONE].map(widthOf))
  const compact = { width: Math.max(widthOf(compactOf(icon)), widthOf(compactOf('✓'))), height: 1 }
  const codeSizes = [{ width: wholeOf([BLOCK_LABEL]), height: 1 }, compact]
  const tableSizes = [{ width: wholeOf(TABLE_LABELS), height: TABLE_LABELS.length }, compact]
  const sizesOf: SizesOf = kind => (kind === 'code' ? codeSizes : tableSizes)
  // The reply's first press copies this format; a press while it reads ✓
  // copies the other. A table's presses take its markdown, then rows for a
  // spreadsheet, then it as rendered, in turn.
  const replyFormats: Format[] = options.replyFormat === 'rendered' ? ['rendered', 'markdown'] : ['markdown', 'rendered']
  // When a block's buttons show: while the pointer is over it, or always (a
  // button over a row's end still only then, so the row's text shows); or,
  // for a terminal that reports no pointer motion, on the closing line's row
  // with the reply's.
  const blockButtons =
    options.blockButtons === 'always' || options.blockButtons === 'end-of-answer' ? options.blockButtons : 'hover'

  // A reply drawn while its turn ran is asked again once the turn has ended.
  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    if (e.agentId === undefined) {
      $.ui.invalidate('ui.render')
      $.clock.after(SETTLE_MS, () => $.ui.invalidate('ui.render'))
    }

    return ended
  })

  // A click on the row, posted by its module: the press of the action under it.
  on('ui.message', { component: 'AssistantMessage' }, async ($, e) => {
    const row = rows.get(e.requestId)
    const key = (e.data as Partial<RowPress> | null)?.key
    if (row === undefined || typeof key !== 'string') return {}
    if (key === 'page-more' || key === 'page-back') {
      await row.turnPage(key === 'page-more' ? 1 : -1)
      return {}
    }
    const action = row.actions.get(key)
    if (action !== undefined) await pressAction($, e.requestId, action, e.surface)
    return {}
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // Summaries are not the real text; other surfaces have their own copy controls.
    if (e.props.isSummary || e.surface !== 'terminal') return next(e)
    // Off fullscreen the terminal reports no clicks: a row nobody can press is
    // left out, and the session is told once how to turn fullscreen on (after
    // the draw: a write made while drawing is not kept).
    if (e.viewport?.isFullscreen === false) {
      if (!telling && !(await read($, toldFullscreen))) {
        telling = true
        $.clock.after(0, () => {
          $.ui.toast(FULLSCREEN_HINT, { timeoutMs: HINT_MS })
          void update($, toldFullscreen, () => true)
        })
      }
      return next(e)
    }

    // Only a turn's final answer carries the row, not the notes between tool
    // calls: the session's own transcript says which, for any reply in it.
    // The reply is never held for that: one the transcript has not said of
    // yet (a long session just opened, a turn just ended) draws as it is, and
    // draws again with its row once the transcript has been read.
    const isFinal = finals.get(e.requestId) ?? knownVerdict(e.requestId)
    if (isFinal === undefined) {
      void isFinalAnswer($, e.requestId).then(verdict => {
        if (verdict === undefined) return
        finals.set(e.requestId, verdict)
        if (verdict) $.ui.invalidate('ui.render')
      })
      return next(e)
    }
    finals.set(e.requestId, isFinal)
    if (!isFinal) return next(e)

    // Every label, flashed row and copy below is made from this text, so none
    // holds a control character the reply was written with.
    const text = clean(e.props.text)

    const { Box, Text, Client } = $.ui.resolve(e)
    const { parts, names, labels } = partsOf(e.requestId, text)
    const done = await read($, copied)
    const isFlashing = done !== null && (await read($, flashed)) === done.stamp
    const page = (await read($, pages))[e.requestId] ?? 0
    const drawn = await next(e)

    // The reply and each table have two formats, a press while one reads ✓
    // taking the other; the reply's rendered text is laid out when pressed.
    const replyText = (format: Format) => (format === 'rendered' ? renderReply(text) : text)
    const all: Action[] = [
      {
        key: 'copy-reply',
        label: 'Reply',
        text,
        isReply: true,
        formats: replyFormats.map(format => ({ format, text: () => replyText(format) })),
        size: copiedText => count([...copiedText].length, 'char'),
      },
      ...parts.flatMap((part, i): Action[] => {
        if (isEmpty(part)) return []
        // Keys count code blocks and tables apart, so a block's key is the same
        // whatever tables the reply holds.
        const n = parts.slice(0, i).filter(other => other.kind === part.kind).length
        const base = { label: labels[i] ?? part.kind, isReply: false, name: names[i] }
        if (part.kind === 'table') {
          return [
            {
              ...base,
              key: `copy-table:${n}`,
              text: part.markdown,
              formats: [
                { format: 'markdown', text: () => part.markdown },
                { format: 'spreadsheet', text: () => part.tsv },
                { format: 'rendered', text: () => part.rendered },
              ],
              size: () => count(part.rows, 'row'),
            },
          ]
        }
        return [{ ...base, key: `copy-code:${n}`, text: part.code, isFile: part.file !== undefined, size: linesOf }]
      }),
    ]
    // Each code block and table gets buttons of its own, shown while the
    // pointer is over it, and is left off the closing line's row; but only
    // while the reply's laid-out height is the engine's (its rows and the
    // blank one above them) and its parts are the layout's one for one, so
    // no button lands on a wrong row. Else every part stays on the row.
    const columns = e.viewport?.columns ?? Infinity
    let blocks: Block[] = []
    let height = 0
    if (blockButtons !== 'end-of-answer' && Number.isFinite(columns)) {
      const layout = layoutOf(e.requestId, text, columns)
      height = layout.rows.length + 1
      const at = `${e.requestId}:${columns}`
      const of = e.props.onScreen?.of
      if (of !== undefined) agreed.set(at, of === height)
      const isSame = layout.parts.map(span => span.kind).join() === parts.map(part => part.kind).join()
      if (agreed.get(at) === true && isSame) {
        blocks = placeBlocks(layout, parts.map(isEmpty), columns, sizesOf)
      }
    }
    // A part's number among those of its kind, as the actions' keys count.
    const nthOf = (index: number) => parts.slice(0, index).filter(other => other.kind === parts[index]?.kind).length
    const rowKeyOf = (block: Block) => `copy-${block.kind}:${nthOf(block.index)}`
    const onRow = all.filter(action => !blocks.some(block => rowKeyOf(block) === action.key))
    // A table's own buttons copy it one way each: as Claude wrote it, as rows
    // for a spreadsheet, or with its borders.
    const tableActions = parts.flatMap((part, i): Action[] => {
      if (part.kind !== 'table') return []
      const as = (label: string, text: string, size: (copied: string) => string): Action => ({
        key: tableKey(label, nthOf(i)),
        label,
        text,
        isReply: false,
        size,
      })
      const rowCount = () => count(part.rows, 'row')
      return [as('markdown', part.markdown, rowCount), as('sheet', part.tsv, rowCount), as('boxed', part.rendered, linesOf)]
    })

    // Whole labels beside the closing line's own text if they fit; else on the
    // blank row above it, which has the reply's indent of room to spare, whole,
    // then cut short, then paged.
    const { isAbove, items } = layoutRow(onRow, columns - ROW_RIGHT - CLOSING_LINE, columns - ROW_RIGHT - 2, page)
    const turnPage = (by: number) =>
      update($, pages, old => ({ ...old, [e.requestId]: Math.max(0, (old[e.requestId] ?? 0) + by) }))
    rows.set(e.requestId, { actions: new Map([...all, ...tableActions].map(action => [action.key, action])), turnPage })

    // Columns from the row's right end to each item's: the widths of the
    // items after it and the gaps between them.
    const widths = items.map(widthOfItem)
    // The row as its module draws it: each item's text, columns and tone.
    let column = 0
    const rowItems: RowItem[] = items.map((item, i) => {
      const isDone = item.kind === 'action' && done?.id === `${e.requestId}:${item.action.key}`
      const text = item.kind === 'action' ? `${isDone ? '✓' : icon} ${item.action.label}` : labelOf(item)
      const from = column
      column += (widths[i] ?? 0) + GAP
      const key = item.kind === 'action' ? item.action.key : `page-${item.kind}`
      return { key, text, from, to: from + (widths[i] ?? 0), tone: item.kind !== 'action' ? 'page' : isDone ? 'done' : 'idle' }
    })
    const row = { items: rowItems, gap: GAP }
    const rowWidth = Math.max(0, column - GAP)
    const rightOf = items.map((_, i) => widths.slice(i + 1).reduce((sum, w) => sum + w + GAP, 0))
    const doneAt = items.findIndex(item => item.kind === 'action' && done?.id === `${e.requestId}:${item.action.key}`)
    // By the pressed action, which already reads ✓: for a block how many
    // lines it took; for the reply or a table the format it took and what
    // another press takes. It shows in the row the actions leave free: the
    // blank one above them, or, with them there, the closing line's past its
    // own text. A notice too long to start over its action ends at the
    // screen's edge; one too long for its row drops what another press takes,
    // then shows not at all, the ✓ telling the copy alone.
    const pressed = items[doneAt]
    const pressedAction = pressed?.kind === 'action' ? pressed.action : undefined
    const label =
      done?.format === undefined
        ? `copied ${(pressedAction?.size ?? linesOf)(pressedAction?.text ?? '')}`
        : `copied as ${done.format}`
    const hint = done?.other === undefined ? '' : hintFor(done.other)
    const notice =
      doneAt < 0
        ? undefined
        : placeNotice(
            [widthOf(label + hint), widthOf(label)],
            ROW_RIGHT + (rightOf[doneAt] ?? 0) + (widths[doneAt] ?? 0),
            isAbove ? CLOSING_LINE : 0,
            columns,
          )
    const noticeHint = notice?.choice === 0 ? hint : ''

    // Each block a hover scope over its rows, from the reply's left edge to
    // its buttons' end, drawn under the reply. While the pointer is in one,
    // its buttons show over the reply, and nothing else, so the block never
    // reads as a button itself; the engine shows them with no hook run. Where
    // they sit tells which block they copy, and a press flashes the block's
    // rows, redrawn as drawn, on a card in the theme's selection
    // colour, pointer or not, so it is told what the press took, as a
    // selection would show it; its buttons stay as long as the ✓ shows.
    // The card ends a column past the widest row, the buttons beside it off
    // it; buttons within the rows' width (over a row's end, or beside a short
    // row above wider ones) on it, the card as wide as they reach, so it
    // shows no hole. A Box placed past the rows the viewport shows is held at
    // its edge, over other rows, so a block is drawn only as far as it shows,
    // its button on its first row there.
    const scopeOf = (block: Block) => `${e.requestId}:part-${block.index}`
    const shown = blocks.flatMap(block => {
      const part = onScreenPart(block, e.props.onScreen)
      return part === undefined ? [] : [{ block, ...part }]
    })
    const scopes = shown.map(({ block, from, lines }) => (
      <Box key={`scope-${block.index}`} position="absolute" top={from} left={0} width={block.right} height={lines.length} hover={{ scope: scopeOf(block) }} />
    ))
    const marks = shown.flatMap(({ block, from, lines }) => {
      const key = `part-${block.index}`
      const reveal = { display: 'none', hover: { scope: scopeOf(block), display: 'flex' } } as const
      const { at, size, isOver } = placeOn(block, from - block.top, columns, sizesOf)
      // Each button on a row of its own, as many as the rows on screen hold;
      // a space before one that covers a row's end.
      const buttons = buttonsOf(block.kind, size, nthOf(block.index)).slice(0, lines.length)
      const name = (i: number) => (i === 0 ? key : `${key}:${i}`)
      const drawnButtons = buttons.map(({ key: action, label }, i) => {
        const isDone = done?.id === `${e.requestId}:${action}`
        const read = label === undefined ? compactOf(isDone ? '✓' : icon) : isDone ? `✓ ${BLOCK_DONE}` : `${icon} ${label}`
        const text = isOver ? ` ${read}` : read
        const width = widthOf(text)
        const item: RowItem = { key: action, text, from: 0, to: width, tone: isDone ? 'done' : 'idle' }
        return { name: name(i), top: from - height + i, item, width, isDone }
      })
      const isCopied = drawnButtons.some(button => button.isDone)
      const isFlashed = isCopied && isFlashing
      const isPinned = isCopied || (blockButtons === 'always' && !isOver)
      // The card's rows end a column past the widest; buttons from there on
      // are beside it.
      const widest = Math.max(...block.rows.map(row => 2 + widthOf(row.trimEnd())))
      const isBeside = at > widest
      const onCard = isFlashed && !isBeside ? { background: SELECTION } : {}
      return [
        ...(isFlashed
          ? [
              <Box key={`mark-${key}`} position="absolute" top={from - height} left={1} width={isBeside ? widest : block.right - 1} height={lines.length} flexDirection="column" paddingLeft={1} backgroundColor={SELECTION}>
                {lines.map((line, i) => <Text key={String(i)} wrap="truncate-end">{line === '' ? ' ' : line}</Text>)}
              </Box>,
            ]
          : []),
        ...drawnButtons.map(({ name, top, item, width }) => (
          <Box key={`button-${name}`} position="absolute" top={top} left={at} {...(isPinned ? {} : reveal)}>
            <Client key={name} module="./row.ts" props={{ items: [item], gap: GAP, ...onCard }} width={width} height={1} />
          </Box>
        )),
      ]
    })

    // The engine draws the reply as it always does. The actions take no row of
    // their own: they sit at the right end of the turn's closing line
    // (`✻ Cooked for …`), which the engine draws two rows below the reply,
    // and `copied 5 lines` shows in the blank row above the one just pressed, its
    // first letter over that action's ✓ (in the closing line's, under it, where
    // the actions take the blank row). The blocks' scopes sit before the
    // reply, their marks after it.
    return (
      <Box flexDirection="column">
        {scopes.length > 0 && (
          <Box height={0} width="100%" position="relative">
            {scopes}
          </Box>
        )}
        {drawn}
        <Box height={0} width="100%" position="relative">
          {marks}
          {notice !== undefined && (
            <Box position="absolute" top={isAbove ? 1 : 0} right={notice.right} width={widthOf(label + noticeHint)} flexShrink={0}>
              <Text color="success">{label}</Text>
              {noticeHint !== '' && <Text dimColor>{noticeHint}</Text>}
            </Box>
          )}
          <Box position="absolute" top={isAbove ? 0 : 1} right={ROW_RIGHT} flexDirection="row">
            <Client key="row" module="./row.ts" props={row} width={rowWidth} height={1} />
          </Box>
        </Box>
      </Box>
    )
  })
}
