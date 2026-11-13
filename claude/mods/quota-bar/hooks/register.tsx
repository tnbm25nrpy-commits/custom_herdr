import { atom, read, update } from 'claude-code'
import type { Register, RenderChildren } from 'claude-code'

import type { QuotaStats } from '../types'

// One row under the prompt, in the hint line's place beside Claude Code's own mode pill:
// context, model, 5h / week quota. Nothing is drawn above the prompt.

const MUTED = '#8a7f99'
const MODEL = '#e6dcff'
const SEP = '  ·  '
// Cells left of the row: the footer's indent plus Claude Code's pill ("⏵⏵ auto mode on · " is 18;
// manual/plan/edits differ by a few), so the row centers under the prompt and stays put per mode.
const LEFT = 20

const stats = atom({ plugin: 'quota-bar', key: 'stats' } as const, null)
const model = atom({ plugin: 'quota-bar', key: 'model' } as const, null)
const isOff = atom({ plugin: 'quota-bar', key: 'isOff' } as const, false)

// Context quality falls off well before the window is full; auto-compact fires near 85-90%.
const CONTEXT_STEPS: [number, string][] = [
  [30, '#3ddc84'],
  [45, '#9be564'],
  [60, '#ffc21a'],
  [72, '#ff8a1a'],
  [85, '#ff3d2e'],
  [101, '#c4001a'],
]
const contextColor = (p: number) => (CONTEXT_STEPS.find(([max]) => p < max) ?? CONTEXT_STEPS[5]!)[1]
const quotaColor = (p: number) => (p < 60 ? '#3ddc84' : p < 80 ? '#ffc21a' : '#ff3d2e')

// "claude-opus-5-5" -> "Opus 5.5"; anything else passes through without the "claude-" prefix.
const prettyModel = (raw: string) => {
  const m = /^(?:claude-)?(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{6,})?(.*)$/i.exec(raw.trim())
  if (!m) return raw.replace(/^claude-/i, '')
  const name = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase()
  const version = m[3] ? `${m[2]}.${m[3]}` : m[2]
  return `${name} ${version}${m[4] ?? ''}`
}

// Rate limits come from this session's last API response headers, so an idle session shows an old
// figure while other sessions burn quota. Every session merges its reading into $.store (shared
// across sessions) and shows the freshest: later window (resetsAt) wins, same window -> higher %
// (usage only grows within a window). A timer re-reads the store so idle sessions catch up.
type Reading = { percentUsed: number; resetsAt?: string }
const SHARED_KEY = 'rateLimits'
const POLL_MS = 30000
let poll: { cancel: () => void } | undefined

const newer = (a: Reading | undefined, b: Reading | undefined): Reading | undefined => {
  if (!a) return b
  if (!b) return a
  const ta = a.resetsAt ? Date.parse(a.resetsAt) : 0
  const tb = b.resetsAt ? Date.parse(b.resetsAt) : 0
  // Same window when reset times are within a minute (the header value can jitter).
  if (Math.abs(ta - tb) > 60000) return ta > tb ? a : b
  return a.percentUsed >= b.percentUsed ? a : b
}

const mergeShared = async ($: any, own: { kind: string; percentUsed: number; resetsAt?: string }[]) => {
  let shared: Record<string, Reading> = {}
  try {
    const v = await $.store.get(SHARED_KEY)
    if (v && typeof v === 'object') shared = v as Record<string, Reading>
  } catch {
    // store unavailable: own reading only
  }
  const out: Record<string, Reading> = {}
  let changed = false
  const now = Date.now()
  for (const kind of ['five_hour', 'seven_day']) {
    const mine = own.find(x => x.kind === kind)
    const mineR = mine ? { percentUsed: mine.percentUsed, resetsAt: mine.resetsAt } : undefined
    let theirs = shared[kind]
    // A window that has already reset says nothing about the current one.
    if (theirs?.resetsAt && Date.parse(theirs.resetsAt) < now) theirs = undefined
    const best = newer(mineR, theirs)
    if (best) out[kind] = best
    if (best && best !== theirs) changed = true
  }
  if (changed) {
    try {
      await $.store.set(SHARED_KEY, { ...shared, ...out })
    } catch {
      // keep going with the local merge
    }
  }
  return out
}

const refresh = async ($: any) => {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const breakdown = usage.context?.breakdown
    const percent: number | undefined = breakdown ? breakdown.percentage : usage.context?.percent
    const merged = await mergeShared($, usage.rateLimits ?? [])
    const next: QuotaStats = {
      context: percent ?? null,
      fiveHour: merged.five_hour?.percentUsed ?? null,
      week: merged.seven_day?.percentUsed ?? null,
    }
    await update($, stats, () => next)
  } catch {
    // keep the last reading
  }
  try {
    const m = prettyModel(await $.session.model())
    await update($, model, () => m)
  } catch {
    // keep the last model
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'quota', description: 'Toggle the context and usage row' })
    await refresh($)
    // Idle sessions pick up readings other sessions stored.
    poll?.cancel()
    poll = $.clock.every(POLL_MS, () => {
      void refresh($)
    })
    return next(e)
  })

  // /compact and auto-compact run no turn, so turn.complete never redraws the context figure.
  // Re-measure once compaction resolved, and again shortly after in case the new messages land late.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    $.clock.after(1500, () => {
      void refresh($)
    })
    return result
  })

  on('session.measure', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('command.run', { command: 'quota' }, async $ => {
    const hidden = !(await read($, isOff))
    await update($, isOff, () => hidden)
    if (!hidden) await refresh($)
    return { text: hidden ? 'Quota row hidden.' : 'Quota row shown.' }
  })

  // Replaces the hint text ("? for shortcuts", "esc to interrupt"); the engine keeps its mode pill
  // at the start of the line. /quota off gives the engine's line back.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (await read($, isOff)) return next(e)
    const s = await read($, stats)
    const name = await read($, model)
    if (!s && !name) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const groups: { text: string; node: RenderChildren[] }[] = []

    if (s?.context != null) {
      const t = `context ${Math.round(s.context)}% used`
      groups.push({ text: t, node: [<Text color={contextColor(s.context)}>{t}</Text>] })
    }
    if (name) groups.push({ text: name, node: [<Text color={MODEL}>{name}</Text>] })
    const quota: RenderChildren[] = []
    let quotaText = ''
    if (s?.fiveHour != null) {
      const v = `${Math.round(s.fiveHour)}%`
      quota.push(<Text color={MUTED}>5h: </Text>, <Text color={quotaColor(s.fiveHour)}>{v}</Text>)
      quotaText += `5h: ${v}`
    }
    if (s?.week != null) {
      const v = `${Math.round(s.week)}%`
      if (quota.length) {
        quota.push(<Text color={MUTED}>{'  '}</Text>)
        quotaText += '  '
      }
      quota.push(<Text color={MUTED}>week: </Text>, <Text color={quotaColor(s.week)}>{v}</Text>)
      quotaText += `week: ${v}`
    }
    if (quota.length) groups.push({ text: quotaText, node: quota })

    const width = groups.reduce((n, g) => n + g.text.length, 0) + SEP.length * (groups.length - 1)
    const columns = e.viewport?.columns ?? 0
    const pad = Math.max(0, Math.floor((columns - width) / 2) - LEFT)

    return (
      <Box flexDirection="row">
        <Text wrap="truncate-end">
          {' '.repeat(pad)}
          {groups.flatMap((g, k) => (k === 0 ? g.node : [<Text color={MUTED}>{SEP}</Text>, ...g.node]))}
        </Text>
      </Box>
    )
  })
}
