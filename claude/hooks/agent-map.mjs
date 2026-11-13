#!/usr/bin/env node
// agent-map hook: appends ONE line per Claude Code hook event to the JSONL file the herdr-app "agent-map" mod reads.
//   usage: agent-map.mjs <session|prompt|pre|post|fail|ask|sub_start|sub_stop|stop|compact>
// Contract: schema v2 (v1 fields ts, sid, sub, ev, id, tool, station, label, file, write, bg + path, subid, ev "ask", stations git/build).
// Never blocks or alters a tool call: no stdout, exit 0 always, every error swallowed. No-op without HC_TERMINAL_ID.
// Privacy: no prompt text, no command lines (labels are the command name + subcommand, curl & co. add the host), no file contents, no URLs beyond the host, no search patterns.
//
// The station classification is a port of lot-map's hooks/classify.ts
// (MIT, (c) 2026 Aleksei Volodin, github.com/alexeyw/lot-map; licence text in LICENSE-lot-map.txt).
// Ported: command-name parsing, wrappers, network list, PowerShell names. Left out: model, memory-server and option handling.
// Differences: station "web" is called "network" here; Remove-Item and friends count as file commands.
import { readFileSync, appendFileSync, mkdirSync, statSync, writeFileSync, renameSync, existsSync, readdirSync, unlinkSync, openSync, readSync, closeSync } from 'node:fs';
import { join, posix } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------- classification (port of classify.ts)

const slashes = (p) => p.replace(/\\/g, '/');
const lastTwo = (p) => slashes(p).split('/').filter(Boolean).slice(-2).join('/');
const str = (v) => (typeof v === 'string' ? v : '');

const HOST = /^(?:[\p{L}\p{N}.-]+|\[[0-9a-f:.]+\])(?::\d+)?$/iu;

// Only the host: a login, a password, a path or a query never reach a label.
function hostOf(url) {
  const [, scheme = '', rest = ''] = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(.*)$/is.exec(url) ?? [];
  const end = rest.search(/[/?#]/);
  const first = end < 0 ? rest : rest.slice(0, end);
  const beyond = end < 0 ? '' : rest.slice(end);
  let host = first.split('@').pop() ?? '';
  if (!first.startsWith('[') && !first.includes('@') && first.includes(':') && beyond.includes('@')) {
    host = /:\d+$/.test(first) ? '' : (rest.slice(rest.lastIndexOf('@') + 1).split(/[/?#]/)[0] ?? '');
  }
  return HOST.test(host) ? host.slice(0, 40) : scheme;
}

// A label as it may be shown: no control characters, no direction marks.
function clean(label, max = 120) {
  const text = String(label).replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const isMemoryPath = (p) => /\/\.claude\/projects\/[^/]+\/memory\//.test(slashes(p));

const FILE_WORDS = new Set(['cat', 'head', 'tail', 'sed', 'grep', 'rg', 'find', 'ls', 'wc', 'cp', 'mv', 'mkdir', 'touch', 'diff', 'cmp', 'sort', 'uniq', 'cut', 'tr', 'awk', 'tee', 'stat', 'file', 'du', 'tree', 'ln', 'basename', 'dirname', 'realpath', 'jq', 'rm', 'rmdir']);
const NEUTRAL_WORDS = new Set(['echo', 'printf', 'cd', 'export', 'true', 'set', 'pwd', 'sleep', 'which', 'test', '[']);
const NET_WORDS = new Set(['curl', 'wget', 'gh', 'ssh', 'scp', 'sftp', 'ftp', 'rsync', 'nc', 'ncat', 'telnet', 'ping', 'dig', 'nslookup']);
const NET_SUBCOMMANDS = new Map(Object.entries({
  git: ['push', 'pull', 'fetch', 'clone', 'ls-remote'],
  npm: ['install', 'i', 'ci', 'add', 'update', 'publish', 'view', 'audit'],
  pnpm: ['install', 'i', 'add', 'update', 'publish', 'dlx'],
  yarn: ['install', 'add', 'upgrade', 'publish', 'dlx'],
  bun: ['install', 'add', 'update', 'publish'],
  pip: ['install', 'download'],
  pip3: ['install', 'download'],
  pipx: ['install', 'upgrade', 'upgrade-all', 'run'],
  uv: ['add', 'sync', 'lock', 'publish', 'tool install'],
  poetry: ['install', 'add', 'update', 'lock', 'publish'],
  docker: ['pull', 'push', 'login'],
  'docker compose': ['pull', 'push'],
  brew: ['install', 'update', 'upgrade', 'fetch'],
  cargo: ['install', 'fetch', 'publish', 'update'],
  go: ['get', 'install', 'mod download'],
  apt: ['install', 'update', 'upgrade', 'full-upgrade', 'dist-upgrade'],
  'apt-get': ['install', 'update', 'upgrade', 'dist-upgrade'],
}).map(([k, v]) => [k, new Set(v)]));
const PY_MODULES = new Set(['pip', 'uv', 'pipx', 'poetry']);

const WRAPPERS = new Map(Object.entries({
  sudo: { takes: ['-u', '-g', '-p', '-h', '-C', '-D', '-R', '-T', '-U', '-r', '-t'] },
  doas: { takes: ['-u', '-C'] },
  env: { takes: ['-u', '-C'] },
  time: {},
  timeout: { takes: ['-s', '-k'], skip: 1 },
  nohup: {},
  nice: { takes: ['-n'] },
  ionice: { takes: ['-c', '-n'] },
  stdbuf: { takes: ['-i', '-o', '-e'] },
  caffeinate: { takes: ['-t', '-w'] },
  command: { asks: ['-v', '-V'] },
  exec: { takes: ['-a'] },
  xargs: { takes: ['-n', '-I', '-P', '-L', '-d', '-E', '-s', '-a', '-J', '-R'] },
}));
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
const GIT_TAKES = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
const DOCKER_TAKES = new Set(['-c', '--context', '-H', '--host', '--config', '-l', '--log-level', '-f', '--file', '-p', '--project-name', '--profile', '--env-file', '--project-directory']);

const pastFlags = (words, takes) => {
  let i = 0;
  while (i < words.length && (words[i] ?? '').startsWith('-')) i += takes.has(words[i] ?? '') ? 2 : 1;
  return words.slice(i);
};
const RUNNERS = new Set(['python', 'python3', 'bash', 'sh', 'zsh', 'node']);

const PS_FILE_WORDS = new Set(['get-content', 'gc', 'type', 'set-content', 'add-content', 'out-file', 'get-childitem', 'gci', 'dir', 'get-item', 'gi', 'select-string', 'sls', 'copy-item', 'cpi', 'copy', 'move-item', 'mi', 'move', 'rename-item', 'rni', 'ren', 'new-item', 'ni', 'md', 'test-path', 'resolve-path', 'get-filehash',
  'remove-item', 'ri', 'del', 'erase', 'rd']); // last row: not in lot-map, deleting files is a file action
const PS_NEUTRAL_WORDS = new Set(['write-host', 'write-output', 'set-location', 'sl', 'get-location', 'gl', 'start-sleep', 'select-object', 'select', 'where-object', 'where', '?', 'foreach-object', 'foreach', '%', 'sort-object', 'measure-object', 'measure', 'format-table', 'ft', 'format-list', 'fl', 'out-string', 'out-null']);
const PS_NET_WORDS = new Set(['invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'test-connection', 'test-netconnection', 'resolve-dnsname', 'start-bitstransfer']);

// Commands that change files (for the `write` flag of shell calls that map to Files).
const WRITE_WORDS = new Set(['cp', 'mv', 'rm', 'rmdir', 'mkdir', 'touch', 'tee', 'ln']);
const PS_WRITE_WORDS = new Set(['set-content', 'add-content', 'out-file', 'copy-item', 'cpi', 'copy', 'move-item', 'mi', 'move', 'rename-item', 'rni', 'ren', 'new-item', 'ni', 'md', 'remove-item', 'ri', 'del', 'erase', 'rd']);

// Same-length copy of a shell line with the inside of quotes blanked ('x'), so separators and redirects inside a quoted
// string (a commit message, a pattern) are not taken as syntax. With `subst`, `$(` and backticks inside double quotes stay.
function maskQuotes(s, subst = false, ps = false) {
  let out = '', q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!q) { if (c === '"' || c === "'") q = c; out += c; continue; }
    if (c === q) { q = ''; out += c; continue; }
    if (q === '"' && !ps && c === '\\' && s[i + 1] === '"') { out += 'xx'; i++; continue; }
    if (subst && q === '"' && (c === '`' || (c === '$' && s[i + 1] === '('))) { out += c; continue; }
    out += 'x';
  }
  return out;
}

// A heredoc's body is text, not commands: drop it (and its closing line) before the line is analysed.
function dropHeredocBodies(command) {
  if (!command.includes('<<')) return command;
  const out = [];
  let end = null;
  for (const line of command.split('\n')) {
    if (end !== null) { if (line.trim() === end) end = null; continue; }
    out.push(line);
    const m = /<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(line);
    if (m && !/<<</.test(line)) end = m[2] ?? null;
  }
  return out.join('\n');
}

// The words of each command in a shell line, leading assignments taken off. Quotes stay: a quoted word is an argument.
function segments(command, deep = false, ps = false) {
  const masked = maskQuotes(command, deep, ps);
  const sep = deep ? /&&|\|\||;|\||\n|\$\(|`|\(|\)/g : /&&|\|\||;|\||\n/g;
  const parts = [];
  let last = 0, m;
  while ((m = sep.exec(masked)) !== null) { parts.push(command.slice(last, m.index)); last = m.index + m[0].length; }
  parts.push(command.slice(last));
  return parts
    .map((part) => part.match(/(?:[^\s"']|"[^"]*"?|'[^']*'?)+/g) ?? [])
    .map((words) => {
      let i = 0;
      while (i < words.length && ASSIGNMENT.test(words[i] ?? '')) i++;
      return words.slice(i);
    })
    .filter((words) => words.length > 0);
}

// A command's own name: no quotes, no folder. Windows programs lose .exe/.cmd/.bat and their capitals.
const base = (word = '') => {
  const name = slashes(word.replace(/["']/g, '')).split('/').pop() ?? word;
  return /\.(?:exe|cmd|bat)$/i.test(name) ? name.replace(/\.(?:exe|cmd|bat)$/i, '').toLowerCase() : name;
};

// Paths. `cleanPath`: forward slashes, Git-Bash /c/x -> C:/x, original case. `file` (the matching key) is its lowercase.
const isDrivePath = (s) => /^[A-Za-z]:\//.test(s);
function cleanPath(p) {
  let s = slashes(p.replace(/^["']+|["']+$/g, ''));
  const git = /^\/([a-zA-Z])\/(.*)$/.exec(s);
  if (git) s = `${(git[1] ?? '').toUpperCase()}:/${git[2] ?? ''}`;
  return s;
}
// Absolute, normalised, original case; relative paths are resolved against `dir` (null: unknown -> null).
function toAbs(p, dir) {
  const s = cleanPath(p);
  let abs;
  if (isDrivePath(s) || s.startsWith('/')) abs = s;
  else if (dir) abs = `${dir}/${s}`;
  else return null;
  const n = posix.normalize(abs);
  return n.length > 1 && n.endsWith('/') && !/^[A-Za-z]:\/$/.test(n) ? n.slice(0, -1) : n;
}
const normPath = (p) => cleanPath(p).toLowerCase();
const PATTERN_CMDS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'sed', 'awk', 'jq', 'select-string', 'sls']);
const PATTERN_FLAGS = /^(?:-e|-f|--regexp|--expression|--file|-pattern)$/i;
const VALUE_FLAGS = new Set(['-m', '-A', '-B', '-C', '-g', '-t', '-T', '--glob', '--type', '--max-count', '--include', '--exclude', '--context', '--after-context', '--before-context']);
// PowerShell parameters whose value is text, not a path.
const PS_VALUE_FLAGS = new Set(['-value', '-encoding', '-filter', '-include', '-exclude', '-itemtype', '-stream', '-delimiter', '-first', '-last', '-tail', '-head', '-totalcount', '-width', '-depth']);
function operands(head, args) {
  if (!PATTERN_CMDS.has(head)) return args;
  const out = [];
  let patternSeen = false; // the pattern/script/filter operand has been passed (or given by -e/-f/-Pattern)
  for (let i = 0; i < args.length; i++) {
    const w = args[i] ?? '';
    if (/^-pattern:/i.test(w)) { patternSeen = true; continue; }
    if (/^-(?:literal)?path$/i.test(w)) { if (args[i + 1] !== undefined) out.push(args[i + 1]); i++; continue; } // Select-String -Path x
    if (PATTERN_FLAGS.test(w)) { patternSeen = true; i++; continue; }
    if (VALUE_FLAGS.has(w)) { i++; continue; }
    if (w.startsWith('-')) continue;
    if (!patternSeen) { patternSeen = true; continue; }
    out.push(w);
  }
  return out;
}
// Commands that take patterns or expressions (and find's -name/-path/-regex): their flag tables are heuristic, so an
// operand counts only if it exists on disk; a pattern that merely looks like a path is never stored.
const STRICT_CMDS = new Set([...PATTERN_CMDS, 'find']);
const exists = (p) => { try { return existsSync(p); } catch { return false; } };

// The one distinct path among the operands of file commands (cmds: [head, args, writes]) and the redirect targets.
// Absolute drive paths count as they are; a /-path or a relative path only if it exists (a relative one that is written
// also counts when it looks like a file name). Relative paths need `dir`. Returns { file, path } or null.
function obviousPath(cmds, targets, dir) {
  const found = new Map();
  const add = (abs) => { if (abs && abs.length > 1 && !/[*?<>|]/.test(abs)) found.set(abs.toLowerCase(), found.get(abs.toLowerCase()) ?? abs); };
  for (const [head, args, writes] of cmds) {
    const ops = operands(head, args);
    for (let i = 0; i < ops.length; i++) {
      const w = ops[i] ?? '';
      if (w.startsWith('-')) { if (PS_VALUE_FLAGS.has(w.toLowerCase())) i++; continue; }
      const bare = w.replace(/^["']+|["']+$/g, '');
      if (!bare || /[$`%{}]|^~/.test(bare)) continue;
      const s = cleanPath(w);
      const abs = toAbs(w, dir);
      if (abs === null) continue;
      if (isDrivePath(s)) { if (STRICT_CMDS.has(head) && !exists(abs)) continue; }
      else if (s.startsWith('/')) { if (!exists(abs)) continue; }
      else if (!exists(abs) && !(writes && !STRICT_CMDS.has(head) && /[./]/.test(bare) && !/^[\d.]+$/.test(bare) && !/\s/.test(bare))) continue;
      add(abs);
    }
  }
  for (const t of targets) { const abs = toAbs(t, dir); if (abs !== null && !/[$`%{}]|^~/.test(t)) add(abs); }
  if (found.size !== 1) return null;
  const path = [...found.values()][0] ?? '';
  return { file: path.toLowerCase(), path };
}

// Redirect targets of > >> 2> &> (not /dev/null, $null, NUL, &1/&2). `any` is true when a real target exists, resolved or not.
function redirects(command, ps) {
  const m = maskQuotes(command, false, ps);
  const out = [];
  for (let i = 0; i < m.length; i++) {
    if (m[i] !== '>') continue;
    if (m[i - 1] === '-' || m[i - 1] === '=') continue;
    let j = i + 1;
    if (m[j] === '>') j++;
    if (m[j] === '&' || m[j] === '|') { i = j; continue; }
    while (m[j] === ' ' || m[j] === '\t') j++;
    let end, target;
    if (m[j] === '"' || m[j] === "'") { end = m.indexOf(m[j] ?? '', j + 1); if (end < 0) end = m.length; target = command.slice(j + 1, end); end++; }
    else { end = j; while (end < m.length && !/[\s;|&<>()]/.test(m[end] ?? '')) end++; target = command.slice(j, end); }
    i = Math.max(end - 1, i);
    const t = target.trim();
    if (!t || /^\$null$/i.test(t) || /^nul(?::|\.\w+)?$/i.test(t) || t.startsWith('/dev/') || t.startsWith('&')) continue;
    out.push(t);
  }
  return out;
}

// ---- stations of shell lines: network > build > git > files/memory > shell

const SUB_TOOLS = new Set(['git', 'npm', 'pnpm', 'yarn', 'bun', 'cargo', 'go', 'dotnet', 'docker', 'gh', 'pip', 'pip3', 'pipx', 'uv', 'poetry', 'brew', 'apt', 'apt-get', 'kubectl', 'systemctl', 'winget', 'choco', 'scoop', 'deno', 'composer', 'rustup']);
const JS_PMS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const JS_BUILD_SUBS = new Set(['test', 'run', 'run-script', 'build']);
const NPX_TOOLS = new Set(['vitest', 'jest', 'tsc', 'eslint', 'playwright']);
const BUILD_WORDS = new Set(['pytest', 'py.test', 'make', 'cmake', 'mvn', 'mvnw', 'gradle', 'gradlew', 'tsc', 'eslint', 'ruff', 'mypy', 'invoke-pester']);
const BUILD_SUBS = new Map(Object.entries({ cargo: ['build', 'test', 'check', 'clippy'], go: ['build', 'test', 'vet'], dotnet: ['build', 'test'] }).map(([k, v]) => [k, new Set(v)]));
const SAFE_WORD = /^[\w.:-]+$/;
const unq = (w = '') => w.replace(/^["']+|["']+$/g, '');
const firstArg = (words) => words.find((w) => !w.startsWith('-')) ?? '';

// A host from the arguments of curl & co: a URL, or a bare host that is not the value of a flag.
function urlHost(args) {
  for (let i = 0; i < args.length; i++) {
    const w = unq(args[i]);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(w)) return hostOf(w);
    const prev = args[i - 1] ?? '';
    if (!prev.startsWith('-') && !w.startsWith('-') && /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|[\w-]+(?:\.[\w-]+)*\.[a-z]{2,})(?::\d+)?(?:[/?#]|$)/i.test(w)) return hostOf(w);
  }
  return '';
}

function classifyShell(rawCommand, description, powershell = false, cwd = '') {
  const command = dropHeredocBodies(rawCommand);
  const name = (word) => (powershell ? base(word).toLowerCase() : base(word));
  const own = (words) => {
    if (!powershell) return words;
    let i = 0;
    if (/^\$[\w:]+$/.test(words[0] ?? '') && words[1] === '=') i = 2;
    if (words[i] === '&' || words[i] === '.') i++;
    return words.slice(i);
  };
  const unwrapped = (words) => {
    let rest = words;
    for (let depth = 0; depth < 6; depth++) {
      const wrapper = WRAPPERS.get(name(rest[0]));
      if (wrapper === undefined) break;
      if (wrapper.asks?.some((flag) => rest[1] === flag) === true) break;
      rest = pastFlags(rest.slice(1), new Set(wrapper.takes ?? []));
      let i = 0;
      while (i < rest.length && ASSIGNMENT.test(rest[i] ?? '')) i++;
      rest = rest.slice(i + (wrapper.skip ?? 0));
    }
    return rest;
  };
  const commands = (words) => {
    const outer = unwrapped(words);
    const all = [outer];
    if (name(outer[0]) === 'find') {
      outer.forEach((word, i) => {
        if (!/^-(?:exec|execdir|ok|okdir)$/.test(word)) return;
        const tail = outer.slice(i + 1);
        const end = tail.findIndex((w) => w === ';' || w === '\\;' || w === '\\' || w === '+');
        all.push(unwrapped(end < 0 ? tail : tail.slice(0, end)));
      });
    }
    return all.filter((c) => c.length > 0);
  };
  // Command name plus subcommand only (never further arguments).
  const describe = (words) => {
    const head = name(words[0]);
    let rest = words.slice(1);
    if (head === 'git') rest = pastFlags(rest, GIT_TAKES);
    if (head === 'docker') rest = pastFlags(rest, DOCKER_TAKES);
    const label = base(words[0] ?? '');
    if (!SUB_TOOLS.has(head)) return label;
    const sub = unq(rest[0]);
    if (!sub || sub.startsWith('-') || !SAFE_WORD.test(sub)) return label;
    let out = `${label} ${sub}`;
    const third = unq(rest[1]);
    if (((JS_PMS.has(head) && (sub === 'run' || sub === 'run-script')) || (head === 'docker' && sub === 'compose')) && third && !third.startsWith('-') && SAFE_WORD.test(third)) out += ` ${third}`;
    return out;
  };
  const netHit = (words) => {
    let head = name(words[0]);
    let rest = words.slice(1);
    const label = base(words[0] ?? '');
    if (NET_WORDS.has(head) || (powershell && PS_NET_WORDS.has(head))) {
      if (head === 'gh') return describe(words);
      if (['curl', 'wget', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm'].includes(head)) { const host = urlHost(rest); return host ? `${label} ${host}` : label; }
      return label;
    }
    if (/^(?:python[\d.]*|py)$/.test(head) && rest[0] === '-m' && PY_MODULES.has(rest[1] ?? '')) [head, rest] = [rest[1] ?? '', rest.slice(2)];
    if (head === 'uv' && rest[0] === 'pip') [head, rest] = ['pip', rest.slice(1)];
    if (head === 'git') rest = pastFlags(rest, GIT_TAKES);
    if (head === 'docker') {
      rest = pastFlags(rest, DOCKER_TAKES);
      if (rest[0] === 'compose') [head, rest] = ['docker compose', pastFlags(rest.slice(1), DOCKER_TAKES)];
    }
    if (head === 'npx') return rest.some((w) => w === '-y' || w === '--yes') ? 'npx' : null;
    const subs = NET_SUBCOMMANDS.get(head);
    if (subs === undefined) return null;
    if (subs.has(rest[0] ?? '')) return `${head} ${rest[0]}`;
    if (subs.has(`${rest[0] ?? ''} ${rest[1] ?? ''}`)) return `${head} ${rest[0]}`;
    return null;
  };
  const buildHit = (words) => {
    const head = name(words[0]).toLowerCase();
    const rest = words.slice(1);
    const label = base(words[0] ?? '');
    if (JS_PMS.has(head)) return JS_BUILD_SUBS.has(unq(rest[0])) ? describe(words) : null;
    if (head === 'npx' || head === 'pnpx' || head === 'bunx') return NPX_TOOLS.has(unq(firstArg(rest))) ? `${label} ${unq(firstArg(rest))}` : null;
    if (head === 'node') return rest.slice(0, 2).includes('--test') ? 'node --test' : null;
    if (/^(?:python[\d.]*|py)$/.test(head)) return rest[0] === '-m' && ['pytest', 'unittest'].includes(rest[1] ?? '') ? `${label} -m ${rest[1]}` : null;
    const subs = BUILD_SUBS.get(head);
    if (subs !== undefined) return subs.has(unq(rest[0])) ? `${label} ${unq(rest[0])}` : null;
    return BUILD_WORDS.has(head) ? label : null;
  };
  const gitHit = (words) => (name(words[0]) === 'git' ? describe(words) : null);

  const lines = segments(command, false, powershell).map(own).filter((words) => words.length > 0);
  const all = segments(command, true, powershell).map(own).flatMap(commands);
  const firstHit = (fn) => { for (const words of all) { const hit = fn(words); if (hit) return hit; } return null; };
  const isNeutral = (head) => NEUTRAL_WORDS.has(head) || (powershell && PS_NEUTRAL_WORDS.has(head));
  const isFile = (head) => FILE_WORDS.has(head) || (powershell && PS_FILE_WORDS.has(head));
  const real = lines.flatMap(commands).filter((words) => !isNeutral(name(words[0])));
  const desc = description.trim();

  let station, hit;
  if ((hit = firstHit(netHit)) !== null) station = 'network';
  else if ((hit = firstHit(buildHit)) !== null) station = 'build';
  else if ((hit = firstHit(gitHit)) !== null) station = 'git';
  else if (real.length > 0 && real.every((words) => isFile(name(words[0])))) { station = isMemoryPath(command) ? 'memory' : 'files'; hit = describe(real[0] ?? []); }
  else { station = 'shell'; hit = real.length > 0 ? describe(real[0] ?? []) : base(lines[0]?.[0] ?? 'shell'); }

  // Paths: relative ones resolve against the hook's cwd, following leading `cd <dir>` lines.
  let dir = cwd ? toAbs(cwd, null) : null;
  for (const words of lines) {
    if (!['cd', 'chdir', 'pushd', 'set-location', 'sl'].includes(name(words[0]))) break;
    const target = words.slice(1).find((w) => !w.startsWith('-') && !/^\/d$/i.test(w));
    dir = target !== undefined && !/[$`%{}]|^["']?~/.test(target) ? toAbs(target, dir) : null;
  }
  const targets = redirects(command, powershell);
  const writeHead = (words) => {
    const head = name(words[0]);
    return WRITE_WORDS.has(head) || (powershell && PS_WRITE_WORDS.has(head))
      || (head === 'sed' && words.some((w) => /^-[A-Za-z]*i|^--in-place/.test(w)))
      || (head === 'find' && words.includes('-delete'));
  };
  const write = targets.length > 0 || real.some(writeHead);
  const found = obviousPath(real.filter((words) => isFile(name(words[0]))).map((words) => [name(words[0]), words.slice(1), writeHead(words)]), targets, dir);
  return { station, label: desc || hit, file: found?.file ?? null, path: found?.path ?? null, write };
}

const mcpName = (n) => n.replace(/_+/g, ' ');

function classify(tool, input, cwd = '') {
  const none = { file: null, path: null, write: false };
  switch (tool) {
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit': {
      const given = str(input.file_path) || str(input.notebook_path);
      const path = given ? (toAbs(given, cwd ? toAbs(cwd, null) : null) ?? cleanPath(given)) : null;
      return { station: isMemoryPath(given) ? 'memory' : 'files', label: lastTwo(given) || tool, file: path ? path.toLowerCase() : null, path, write: tool !== 'Read' };
    }
    case 'Grep': case 'Glob': return { station: 'files', label: tool, ...none };
    case 'Bash': return classifyShell(str(input.command), str(input.description), false, cwd);
    case 'PowerShell': return classifyShell(str(input.command), str(input.description), true, cwd);
    case 'WebFetch': return { station: 'network', label: hostOf(str(input.url)) || 'WebFetch', ...none };
    case 'WebSearch': return { station: 'network', label: 'WebSearch', ...none };
    case 'Artifact': return { station: 'network', label: 'Artifact', ...none };
    case 'Agent': case 'Task': return { station: 'agents', label: str(input.description) || 'subagent', ...none };
    case 'Monitor': return { station: 'shell', label: str(input.description) || tool, ...none };
    case 'Workflow': return { station: 'agents', label: 'Workflow', ...none };
    case 'SendMessage': case 'TaskStop': return { station: 'agents', label: tool, ...none };
    case 'Skill': return { station: 'skills', label: str(input.skill) || 'Skill', ...none };
    case 'ToolSearch': return { station: 'skills', label: 'ToolSearch', ...none };
    case 'AskUserQuestion': return { station: 'you', label: 'AskUserQuestion', ...none };
    case 'SendUserFile': return { station: 'you', label: 'SendUserFile', ...none };
  }
  const mcp = /^mcp__([^_].*?)__(.+)$/.exec(tool);
  if (mcp === null) {
    if (/^(?:SubagentHandback|SendMessage|TaskStop)$|^(?:Task|Team|Agent|Subagent)/.test(tool)) return { station: 'agents', label: tool, ...none };
    if (/^(?:ScheduleWakeup|RemoteTrigger|PushNotification)$|^Cron/.test(tool)) return { station: 'you', label: tool, ...none };
    return { station: 'skills', label: tool, ...none };
  }
  const [, server = '', name = ''] = mcp;
  if (/browser/i.test(tool) || server === 'claude-in-chrome' || /^computer[-_]use$/i.test(server) || /^computer_/.test(name)) {
    const url = str(input.url);
    return { station: 'browser', label: url && /^[a-z]+:/i.test(url) ? hostOf(url) : mcpName(name), ...none };
  }
  return { station: 'network', label: `${server}: ${mcpName(name)}`, ...none };
}

// ---------------------------------------------------------------- hook entry

const MODES = new Set(['session', 'prompt', 'pre', 'post', 'fail', 'sub_start', 'sub_stop', 'stop', 'compact', 'ask']);

// The subagent's id in the tool_response of an Agent/Task call: a field, or "agentId: x" in its text.
function agentIdOf(resp, depth = 0) {
  if (typeof resp === 'string') return /\bagent_?Id["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{1,64})/i.exec(resp)?.[1] ?? '';
  if (!resp || typeof resp !== 'object' || depth > 3) return '';
  for (const v of [resp.agentId, resp.agent_id]) if (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)) return v;
  const items = Array.isArray(resp) ? resp : [...(Array.isArray(resp.content) ? resp.content : [resp.content]), resp.text, resp.result, resp.output];
  for (const item of items) {
    const id = agentIdOf(typeof item === 'string' ? item : item && typeof item === 'object' ? (typeof item.text === 'string' ? item.text : item) : '', depth + 1);
    if (id) return id;
  }
  return '';
}

function isFailure(resp) {
  if (!resp || typeof resp !== 'object') return false;
  if (resp.is_error === true || resp.isError === true) return true;
  if (typeof resp.error === 'string' && resp.error) return true;
  if (resp.blocked === true) return true;
  return false;
}

export function buildLine(mode, input, now = Date.now()) {
  if (!MODES.has(mode) || !input || typeof input !== 'object') return null;
  const sid = str(input.session_id);
  const agent = str(input.agent_id);
  const line = { ts: now, sid, sub: agent || null, ev: mode };
  switch (mode) {
    case 'session': {
      line.cwd = str(input.cwd);
      const model = str(input.model);
      if (model) line.model = model;
      line.sub = null;
      break;
    }
    case 'sub_start':
      line.sub = agent || null;
      line.label = clean(str(input.description) || str(input.agent_type) || 'subagent');
      break;
    case 'sub_stop': {
      line.sub = agent || null;
      const type = str(input.agent_type);
      if (type) line.label = clean(type);
      break;
    }
    case 'pre': case 'post': case 'fail': case 'ask': {
      const tool = str(input.tool_name);
      if (!tool) return null;
      const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
      const c = classify(tool, ti, str(input.cwd));
      if (mode === 'post' && isFailure(input.tool_response)) line.ev = 'fail';
      line.id = str(input.tool_use_id);
      line.tool = tool;
      line.station = c.station;
      line.label = clean(c.label);
      line.file = c.file;
      if (c.file && c.path) line.path = c.path;
      line.write = c.write;
      if (mode !== 'ask') line.bg = ti.run_in_background === true || tool === 'Monitor' || tool === 'Workflow';
      if (line.ev === 'post' && (tool === 'Agent' || tool === 'Task')) { const subid = agentIdOf(input.tool_response); if (subid) line.subid = subid; }
      break;
    }
    default:
      break;
  }
  return line;
}

// How full the context is: the prompt size of the session's last main-thread reply, read from the transcript's tail
// (only token counts, no text). Returns { ctx, ctxMax } or null. ctxMax: the auto-compact window, else 200k.
export function contextOf(transcript, env = process.env) {
  if (typeof transcript !== 'string' || !/\.jsonl$/i.test(transcript)) return null;
  let fd;
  try {
    fd = openSync(transcript, 'r');
    const size = statSync(transcript).size, len = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const s = lines[i];
      if (s.includes('"compact_boundary"') || s.includes('"isCompactSummary":true')) return null; // no reply since compaction
      if (!s.includes('"assistant"') || !s.includes('"usage"')) continue;
      let j; try { j = JSON.parse(s); } catch { continue; }
      if (j.type !== 'assistant' || j.isSidechain || !j.message?.usage) continue;
      const u = j.message.usage, n = (x) => (Number.isFinite(x) ? x : 0);
      const ctx = n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens);
      if (!ctx) continue;
      const auto = Number(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
      return { ctx, ctxMax: auto > 0 ? auto : 200000 };
    }
  } catch { /* swallowed */ } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* swallowed */ } }
  return null;
}
const CTX_MODES = new Set(['prompt', 'post', 'fail', 'stop']);

const termFile = () => {
  const t = String(process.env.HC_TERMINAL_ID ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return t ? join(process.env.AGENT_MAP_DIR || join(homedir(), '.config', 'herdr-app', 'data', 'agent-map'), `${t}.jsonl`) : '';
};

function trim(file) {
  try {
    if (statSync(file).size < 40000) return; // 600 lines are never smaller than this
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= 600) return;
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, lines.slice(-400).join('\n') + '\n');
    renameSync(tmp, file);
  } catch { /* swallowed */ }
}

// Once per Claude session: remove the files of long-dead terminals (ids get reused) and orphaned trim temp files.
function prune(file, now = Date.now()) {
  try {
    const dir = join(file, '..');
    for (const name of readdirSync(dir)) {
      try {
        const path = join(dir, name);
        if (path === file) continue;
        const age = now - statSync(path).mtimeMs;
        if ((name.endsWith('.jsonl') && age > 24 * 3600e3) || (name.endsWith('.tmp') && age > 3600e3)) unlinkSync(path);
      } catch { /* swallowed */ }
    }
  } catch { /* swallowed */ }
}

function main() {
  const file = termFile();
  if (!file) return;
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8').replace(/^﻿/, '') || '{}'); } catch { return; }
  const line = buildLine(process.argv[2], input);
  if (!line) return;
  if (CTX_MODES.has(process.argv[2]) && !line.sub) { const c = contextOf(input.transcript_path); if (c) Object.assign(line, c); }
  mkdirSync(join(file, '..'), { recursive: true });
  appendFileSync(file, JSON.stringify(line) + '\n');
  trim(file);
  if (process.argv[2] === 'session') prune(file);
}

if (process.argv[1] && /agent-map\.mjs$/i.test(process.argv[1].replace(/\\/g, '/'))) {
  try { main(); } catch { /* swallowed */ }
  process.exit(0);
}
