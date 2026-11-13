#!/usr/bin/env node
// Makes agents running inside herdr-app use the Show panel (~/.claude/skills/show-image).
//   post: PostToolUse. When the agent reads an image file or takes a screenshot, add a reminder to its context.
//   stop: Stop. If this turn produced/viewed images and none was sent with show-image.ps1, block the stop once
//         and tell the agent to show them. stop_hook_active prevents loops.
// Does nothing outside herdr-app (HC_TERMINAL_ID unset). Never fails the tool call: always exits 0 on errors.
import { readFileSync } from 'node:fs';

const mode = process.argv[2];
const IMG = /\.(png|jpe?g|gif|webp|bmp)$/i;
const IMG_IN_TEXT = /[A-Za-z]:[\\/][^\s"'<>|]+?\.(?:png|jpe?g|gif|webp|bmp)\b|(?:~|\.{0,2})\/[^\s"'<>|]+?\.(?:png|jpe?g|gif|webp|bmp)\b/gi;
const SKIP = /[\\/]show[\\/](inbox|tmp)[\\/]|\.marked\.png$|[\\/]image-cache[\\/]/i;
const SHOT_CMD = /screenshot|herdr-app(\.exe)?\s+shot\b|\bshot\s+\S+\.png/i;
const SHOW_CMD = /show-image\.ps1|show-add\.ps1/i;
const CMD = `powershell -NoProfile -File "$HOME\\.claude\\scripts\\show-image.ps1" "<abs path>" -Title "<what it shows>"`;

const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };

function stdin() {
  try { return JSON.parse(readFileSync(0, 'utf8').replace(/^﻿/, '') || '{}'); } catch { return {}; }
}

// Images a tool call touched: [paths], plus whether it was a screenshot without a known path.
function imagesOf(name, input) {
  const paths = [];
  let shot = false;
  if (!input || typeof input !== 'object') return { paths, shot };
  if (name === 'Read' && typeof input.file_path === 'string' && IMG.test(input.file_path)) paths.push(input.file_path);
  if (/screenshot/i.test(name) && !/claude-in-chrome|computer-use|Claude_Browser/i.test(name)) {
    shot = true;
    for (const k of ['filename', 'path', 'file_path']) if (typeof input[k] === 'string') paths.push(input[k]);
  }
  const cmd = typeof input.command === 'string' ? input.command : '';
  if (cmd && SHOT_CMD.test(cmd) && !SHOW_CMD.test(cmd)) {
    shot = true;
    for (const m of cmd.match(IMG_IN_TEXT) ?? []) paths.push(m);
  }
  return { paths: paths.filter((p) => !SKIP.test(p)), shot };
}

function isShowCall(name, input) {
  return typeof input?.command === 'string' && SHOW_CMD.test(input.command);
}

if (!process.env.HC_TERMINAL_ID) process.exit(0);
const ev = stdin();

if (mode === 'post') {
  const { paths, shot } = imagesOf(ev.tool_name ?? '', ev.tool_input);
  if (!paths.length && !shot) process.exit(0);
  const what = paths.length ? paths.join(', ') : 'the screenshot';
  out({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `herdr Show panel: the user cannot see images you Read or capture. If ${what} is something the user should look at (UI result, before/after, chart, design, bug), show it now with: ${CMD} . Skip only for images that are pure internal scratch work.`,
    },
  });
}

if (mode === 'stop') {
  if (ev.stop_hook_active || !ev.transcript_path) process.exit(0);
  let lines;
  try { lines = readFileSync(ev.transcript_path, 'utf8').split('\n'); } catch { process.exit(0); }
  // Walk back to the last real user prompt (not a tool_result), collecting this turn's tool calls.
  const calls = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let e; try { e = JSON.parse(lines[i]); } catch { continue; }
    const c = e?.message?.content;
    if (e.type === 'user' && !e.isMeta && !e.isSidechain) {
      const isToolResult = Array.isArray(c) && c.some((b) => b?.type === 'tool_result');
      if (!isToolResult) break;
    }
    if (e.type === 'assistant' && Array.isArray(c)) for (const b of c) if (b?.type === 'tool_use') calls.push(b);
  }
  if (calls.some((b) => isShowCall(b.name, b.input))) process.exit(0);
  const paths = new Set(); let shot = false;
  for (const b of calls) { const r = imagesOf(b.name, b.input); r.paths.forEach((p) => paths.add(p)); shot ||= r.shot; }
  if (!paths.size && !shot) process.exit(0);
  const list = paths.size ? [...paths].slice(0, 6).join('\n  ') : '(a screenshot: save it to a file first)';
  out({
    decision: 'block',
    reason: `You looked at or produced images this turn but the user never saw them (they only see what lands in the herdr Show panel):\n  ${list}\nSend the ones that matter to the user with: ${CMD}\n(one call per image, newest last, short useful title). If none of them is relevant for the user, say so in one line and stop.`,
  });
}
process.exit(0);
