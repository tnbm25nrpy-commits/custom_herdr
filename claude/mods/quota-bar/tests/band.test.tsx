import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-05T12:00:00Z')
const HOUR = 3600000

const usage = {
  startedAt: NOW - HOUR,
  context: {
    tokens: 118000,
    window: 1000000,
    percent: 12,
    breakdown: {
      categories: [
        { name: 'System prompt', tokens: 8000, color: 'a', isDeferred: false, kind: 'used' },
        { name: 'Messages', tokens: 110000, color: 'b', isDeferred: false, kind: 'used' },
        { name: 'Deferred tools', tokens: 20000, color: 'c', isDeferred: true, kind: 'deferred' },
        { name: 'Free space', tokens: 842000, color: 'd', isDeferred: false, kind: 'free' },
        { name: 'Autocompact buffer', tokens: 40000, color: 'e', isDeferred: false, kind: 'buffer' },
      ],
      totalTokens: 118000,
      maxTokens: 1000000,
      rawMaxTokens: 1000000,
      percentage: 12,
    },
  },
  rateLimits: [
    // 20% used with 4h left of 5h: 4h elapsed of... 1h elapsed -> projects 100%+ => runs out
    { kind: 'five_hour', percentUsed: 40, resetsAt: new Date(NOW + 4 * HOUR).toISOString() },
    // 30% after 3 of 7 days: projects ~70% => on track
    { kind: 'seven_day', percentUsed: 30, resetsAt: new Date(NOW + 4 * 24 * HOUR).toISOString() },
  ],
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`row draws under the prompt on ${surface}`, async ($, on) => {
    mock.clock(on, { now: NOW })
    on('session.usage', async () => ({ value: usage as never }))
    on('session.measure', async (_$, e) => ({ changed: e.changed }))
    on('ui.status', async () => ({ value: undefined }))
    on('session.model', async () => ({ value: 'claude-opus-5-5' }))

    await $.session.measure({
      context: usage.context as never,
      rateLimits: usage.rateLimits,
      changed: ['rateLimits'],
    })

    const ui = await $.ui.mount({
      plugin: 'quota-bar',
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
      viewport: { columns: 100, rows: 40 },
    })

    expect(await ui.find({ type: 'Text', text: /^12%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Opus 5\.5$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^40%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^30%$/ })).toBeDefined()
    await ui.unmount()
  })
}
