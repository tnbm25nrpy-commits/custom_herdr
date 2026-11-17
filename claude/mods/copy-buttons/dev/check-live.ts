// Checks the plugin against a transcript Claude Code has just written: a
// session of its own, this plugin loaded, asks Haiku for a tool call and an
// answer with a code block. Reply on the turn's closing line shows the
// plugin read the new transcript's rows as it should; then
// dev/check-transcripts.ts checks the scan against each of them. The one
// check that talks to the model: needs CLAUDE_CODE_OAUTH_TOKEN (from
// `claude setup-token`, a subscription's), and costs one short turn.
//
//   CLAUDE_CODE_OAUTH_TOKEN=... bun dev/check-live.ts

import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { VERSION, withHome } from './screens'

if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  console.log('✘ needs CLAUDE_CODE_OAUTH_TOKEN: a token from `claude setup-token`')
  process.exit(1)
}

const PROMPT = 'Run `echo copy-buttons` with the Bash tool. Then answer in one sentence, followed by a bash code block holding that command.'
// The turn's closing line once the answer is in, with no limit on how the
// model words it.
const CLOSING = /^✻ \S+ for /m

const failed = await withHome(async home => {
  const pane = home.open({
    columns: 100,
    height: 50,
    plugin: { icon: 'standard', replyFormat: 'markdown', blockButtons: 'hover' },
    pass: ['CLAUDE_CODE_OAUTH_TOKEN'],
    args: ['--model', 'haiku', '--allowedTools', 'Bash(echo:*)'],
  })
  await pane.waitFor('the prompt box', screen => (screen.includes('❯') ? true : undefined))
  pane.type(PROMPT)
  await Bun.sleep(500)
  pane.keys('Enter')

  await pane.waitFor('the turn\'s closing line (the model answering)', screen => (CLOSING.test(screen) ? true : undefined))
  const reply = await pane
    .waitFor('Reply on the closing line', screen => {
      const lines = screen.split('\n')
      const closing = lines.findLastIndex(line => CLOSING.test(line))
      return lines[closing]?.includes('⧉ Reply') ? true : undefined
    })
    .catch(() => false)
  if (!reply) {
    console.log(`✘ the plugin did not put Reply on the closing line of a turn Claude Code ${VERSION} wrote\n\nThe screen:\n${pane.screen()}`)
    return true
  }
  console.log(`✔ the plugin puts Reply on the closing line of a turn Claude Code ${VERSION} wrote`)
  pane.close()

  const transcripts = readdirSync(home.projects).filter(name => name.endsWith('.jsonl'))
  if (transcripts.length !== 1) {
    console.log(`✘ expected one transcript, found ${transcripts.length} in ${home.projects}`)
    return true
  }
  const check = Bun.spawnSync(['bun', join(import.meta.dir, 'check-transcripts.ts'), join(home.projects, transcripts[0]!)], { stdout: 'inherit', stderr: 'inherit' })
  return check.exitCode !== 0
})
process.exit(failed ? 1 : 0)
