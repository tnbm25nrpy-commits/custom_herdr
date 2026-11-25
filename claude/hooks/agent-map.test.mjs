// node C:/Users/me/.claude/hooks/agent-map.test.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, utimesSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLine, contextOf } from './agent-map.mjs';
const REAL = fileURLToPath(import.meta.url).split(String.fromCharCode(92)).join('/');   // an existing file
const REAL_LC = REAL.toLowerCase();

const slashesOf = (p) => p.replace(/\\/g, '/');
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : (fail++, console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`));
};
const pre = (tool, ti, extra = {}) => buildLine('pre', { session_id: 's1', tool_name: tool, tool_use_id: 't1', tool_input: ti, ...extra }, 1);
const st = (tool, ti) => { const l = pre(tool, ti); return [l.station, l.label, l.file, l.write]; };

// --- station rules
eq('Read', st('Read', { file_path: 'C:\\Users\\me\\Desktop\\a\\b.txt' }), ['files', 'a/b.txt', 'C:/Users/me/desktop/a/b.txt', false]);
eq('Write', st('Write', { file_path: 'C:/x/y/z.md' }), ['files', 'y/z.md', 'c:/x/y/z.md', true]);
eq('Edit', st('Edit', { file_path: 'C:/x/y/z.md' })[3], true);
eq('NotebookEdit', st('NotebookEdit', { notebook_path: 'C:/x/n.ipynb' }), ['files', 'x/n.ipynb', 'c:/x/n.ipynb', true]);
eq('Grep', st('Grep', { pattern: 'secret' }), ['files', 'Grep', null, false]);
eq('Glob', st('Glob', { pattern: '*' })[0], 'files');
eq('memory read', st('Read', { file_path: 'C:\\Users\\me\\.claude\\projects\\C--x\\memory\\MEMORY.md' })[0], 'memory');
eq('memory edit', st('Edit', { file_path: 'C:/Users/me/.claude/projects/p/memory/a.md' })[0], 'memory');
eq('claude file not memory', st('Read', { file_path: 'C:/Users/me/.claude/settings.json' })[0], 'files');
eq('bash cat', st('Bash', { command: 'cat C:/a/b.txt' }), ['files', 'cat', 'c:/a/b.txt', false]);
eq('bash grep pipe', st('Bash', { command: 'grep -r foo src | sort | uniq' })[0], 'files');
eq('bash rm', st('Bash', { command: 'rm -rf /c/tmp/x' }), ['files', 'rm', 'c:/tmp/x', true]);
eq('bash sed -i', st('Bash', { command: 'sed -i s/a/b/ /tmp/f' })[3], true);
eq('bash sed read', st('Bash', { command: 'sed -n 1,5p /tmp/f' })[3], false);
eq('bash find -delete', st('Bash', { command: 'find . -name x -delete' })[3], true);
eq('bash echo+cat', st('Bash', { command: 'echo hi; cat /tmp/f' })[0], 'files');
eq('bash echo only', st('Bash', { command: 'echo hi' })[0], 'shell');
eq('bash desc label', st('Bash', { command: 'npm test', description: 'Run tests' }), ['build', 'Run tests', null, false]);
eq('bash label never command line', pre('Bash', { command: 'make secret-target --token=abc' }).label, 'make');
eq('bash mixed', st('Bash', { command: 'cat a.txt && npm test' })[0], 'build');
eq('curl', st('Bash', { command: 'curl -s https://example.com/x?token=1' })[0], 'network');
eq('curl.exe upper', st('Bash', { command: 'CURL.EXE https://x.y' })[0], 'network');
eq('curl full path quoted', st('Bash', { command: '"C:\\Program Files\\Git\\mingw64\\bin\\curl.exe" -s x' })[0], 'network');
eq('gh', st('Bash', { command: 'gh pr list' })[0], 'network');
eq('git push', st('Bash', { command: 'git push origin main' })[0], 'network');
eq('git -C fetch', st('Bash', { command: 'git -C /tmp/r fetch' })[0], 'network');
eq('git status', st('Bash', { command: 'git status' }), ['git', 'git status', null, false]);
eq('npm install', st('Bash', { command: 'npm install foo' })[0], 'network');
eq('npm test', st('Bash', { command: 'npm test' }), ['build', 'npm test', null, false]);
eq('docker pull', st('Bash', { command: 'docker pull x' })[0], 'network');
eq('docker compose pull', st('Bash', { command: 'docker compose pull' })[0], 'network');
eq('npx -y', st('Bash', { command: 'npx -y foo' })[0], 'network');
eq('npx plain', st('Bash', { command: 'npx foo' })[0], 'shell');
eq('sudo curl', st('Bash', { command: 'sudo -u bob curl x' })[0], 'network');
eq('env timeout curl', st('Bash', { command: 'env A=1 timeout 5 curl x' })[0], 'network');
eq('nohup xargs', st('Bash', { command: 'nohup xargs -n1 wget < f' })[0], 'network');
eq('$(curl)', st('Bash', { command: 'echo $(curl -s x)' })[0], 'network');
eq('find -exec curl', st('Bash', { command: 'find . -exec curl {} ;' })[0], 'network');
eq('python -m pip install', st('Bash', { command: 'python -m pip install x' })[0], 'network');
eq('ps iwr', st('PowerShell', { command: 'Invoke-WebRequest https://a.b' })[0], 'network');
eq('ps get-content', st('PowerShell', { command: 'Get-Content C:\\a\\b.txt' }), ['files', 'Get-Content', 'c:/a/b.txt', false]);
eq('ps select-string pipe', st('PowerShell', { command: 'Get-Content x | Select-String foo' })[0], 'files');
eq('ps set-content write', st('PowerShell', { command: 'Set-Content -Path C:\\a.txt -Value hi' })[3], true);
eq('ps remove-item', st('PowerShell', { command: 'Remove-Item C:\\a.txt' })[3], true);
eq('ps assign', st('PowerShell', { command: '$x = Get-Content C:\\a.txt' })[0], 'files');
eq('ps & call', st('PowerShell', { command: '& "C:\\Windows\\System32\\curl.exe" x' })[0], 'network');
eq('ps other', st('PowerShell', { command: 'Get-Process' })[0], 'shell');
eq('webfetch', st('WebFetch', { url: 'https://user:pw@docs.example.com:8080/a/b?q=1' }), ['network', 'docs.example.com:8080', null, false]);
eq('websearch', st('WebSearch', { query: 'my secret' }), ['network', 'WebSearch', null, false]);
eq('mcp other', st('mcp__claude_ai_Claude_Docs__read', {})[0], 'network');
eq('mcp chrome', st('mcp__claude-in-chrome__navigate', { url: 'https://a.b/c?d' }), ['browser', 'a.b', null, false]);
eq('mcp chrome no url', st('mcp__claude-in-chrome__computer', {}), ['browser', 'computer', null, false]);
eq('mcp Browser', st('mcp__Claude_Browser__click', {})[0], 'browser');
eq('mcp remote Browser', st('mcp__remote-devices__Claude_Browser__click', {})[0], 'browser');
eq('computer use', st('mcp__computer-use__screenshot', {})[0], 'browser');
eq('computer use remote', st('mcp__remote-devices__computer_click', {})[0], 'browser');
eq('Agent', st('Agent', { description: 'Explore code', prompt: 'long secret prompt' }), ['agents', 'Explore code', null, false]);
eq('Task', st('Task', {})[0], 'agents');
eq('Workflow', pre('Workflow', {}).bg, true);
eq('SendMessage', st('SendMessage', {})[0], 'agents');
eq('Skill', st('Skill', { skill: 'delegate' }), ['skills', 'delegate', null, false]);
eq('ToolSearch', st('ToolSearch', { query: 'x' })[0], 'skills');
eq('AskUserQuestion', st('AskUserQuestion', {})[0], 'you');
eq('Monitor', pre('Monitor', { description: 'watch' }).bg, true);
eq('unknown tool', st('Whatever', {}), ['skills', 'Whatever', null, false]);
eq('bg bash', pre('Bash', { command: 'sleep 9', run_in_background: true }).bg, true);
eq('fg bash', pre('Bash', { command: 'ls' }).bg, false);
// --- privacy: search patterns are never a file; only the file command's own words count
const bf = (tool, command) => pre(tool, { command }).file;
eq('grep pattern /-word', bf('Bash', "grep -rn '/api/secret-token' src"), null);
eq('sed script /-word', bf('Bash', "sed -n '/password=hunter2/p' notes.txt"), null);
eq('ps Select-String -Pattern', bf('PowerShell', "Select-String -Pattern '/internal/path' -Path x.txt"), null);
eq('grep -e pattern', bf('Bash', `grep -e '/a/b' -e /c/d ${REAL}`), REAL_LC);
eq('grep pattern then path', bf('Bash', `grep -n '/a/b' ${REAL}`), REAL_LC);
eq('grep -A value', bf('Bash', `grep -A 3 foo ${REAL}`), REAL_LC);
eq('rg pattern drive-like', bf('Bash', "rg 'C:/secret' src"), null);
eq('ps sls pattern', bf('PowerShell', `sls '/x/y' ${REAL}`), REAL_LC);
// Pattern commands only keep operands that exist on disk (review 2): patterns that look like paths never leak.
eq('sls -Path then path-like pattern', bf('PowerShell', "Select-String -Path x.txt 'C:/secret/thing'"), null);
eq('grep unknown value flag', bf('Bash', "grep --exclude-dir node_modules 'C:/secret' f.txt"), null);
eq('find -path pattern', bf('Bash', "find . -path '/c/secret/dir'"), null);
eq('sls -Path real file', bf('PowerShell', `Select-String -Path ${REAL} -Pattern foo`), REAL_LC);
eq('/-path must exist', bf('Bash', 'cat /no/such/thing/xyz'), null);
eq('existing /-path accepted', bf('Bash', `cat ${slashesOf(tmpdir())}`), slashesOf(tmpdir()).toLowerCase());
eq('cd arg not collected', bf('Bash', 'cd C:/x/mods/agent-map; cat -n main.js | sed -n 1,5p'), null);
eq('cd arg not collected 2', bf('Bash', 'cd C:/x/mods/agent-map && cat C:/x/main.js'), 'c:/x/main.js');
eq('ps Set-Location not collected', bf('PowerShell', 'Set-Location C:\\x\\y; Get-Content a.txt'), null);
eq('case-insensitive path', [bf('Bash', 'cat C:\\Users\\me\\X.txt'), bf('Bash', 'cat C:/Users/me/x.txt')], ['C:/Users/me/x.txt', 'C:/Users/me/x.txt']);
eq('two paths -> null', buildLine('pre', { session_id: 's', tool_name: 'Bash', tool_use_id: 'x', tool_input: { command: 'cp C:/a/b C:/c/d' } }, 1).file, null);

// --- event shapes
eq('pre fields', pre('Read', { file_path: 'C:/a/b.c' }, { agent_id: 'ag1' }),
  { ts: 1, sid: 's1', sub: 'ag1', ev: 'pre', id: 't1', tool: 'Read', station: 'files', label: 'a/b.c', file: 'c:/a/b.c', path: 'C:/a/b.c', write: false, bg: false });
eq('post ok', buildLine('post', { session_id: 's', tool_name: 'Bash', tool_use_id: 'x', tool_input: { command: 'ls' }, tool_response: { stdout: 'a' } }, 1).ev, 'post');
eq('post is_error -> fail', buildLine('post', { session_id: 's', tool_name: 'Bash', tool_use_id: 'x', tool_input: { command: 'ls' }, tool_response: { is_error: true } }, 1).ev, 'fail');
eq('post error str -> fail', buildLine('post', { session_id: 's', tool_name: 'Bash', tool_use_id: 'x', tool_input: {}, tool_response: { error: 'boom' } }, 1).ev, 'fail');
eq('fail', buildLine('fail', { session_id: 's', tool_name: 'Bash', tool_use_id: 'x', tool_input: { command: 'ls' }, error: 'x' }, 1).ev, 'fail');
eq('session', buildLine('session', { session_id: 's', cwd: 'C:\\p', model: 'claude-opus-5' }, 1), { ts: 1, sid: 's', sub: null, ev: 'session', cwd: 'C:\\p', model: 'claude-opus-5' });
eq('prompt no text', buildLine('prompt', { session_id: 's', prompt: 'TOP SECRET' }, 1), { ts: 1, sid: 's', sub: null, ev: 'prompt' });
eq('sub_start', buildLine('sub_start', { session_id: 's', agent_id: 'a9', agent_type: 'Explore' }, 1), { ts: 1, sid: 's', sub: 'a9', ev: 'sub_start', label: 'Explore' });
eq('sub_stop', buildLine('sub_stop', { session_id: 's', agent_id: 'a9' }, 1), { ts: 1, sid: 's', sub: 'a9', ev: 'sub_stop' });
eq('stop', buildLine('stop', { session_id: 's' }, 1), { ts: 1, sid: 's', sub: null, ev: 'stop' });
eq('compact', buildLine('compact', { session_id: 's', trigger: 'auto' }, 1), { ts: 1, sid: 's', sub: null, ev: 'compact' });
eq('label control chars + cap', pre('Bash', { command: 'x', description: 'a\u202eb\n' + 'z'.repeat(200) }).label.length, 120);
eq('privacy: no secrets in line', JSON.stringify(pre('Bash', { command: 'curl -H "Authorization: abc123SECRET" https://h.io/p?k=v' })).includes('SECRET'), false);

// --- schema v2
const CWD = slashesOf(tmpdir());                                   // an existing directory
const at = (tool, ti, extra = {}) => pre(tool, ti, extra);
const sh = (command, extra = {}) => { const l = pre('Bash', { command }, { cwd: CWD, ...extra }); return [l.station, l.label, l.file ?? null, l.path ?? null, l.write]; };
// 1. path keeps the case, file stays lowercase
eq('v2 path case', [pre('Read', { file_path: 'C:\\Users\\me\\Notes.TXT' }).file, pre('Read', { file_path: 'C:\\Users\\me\\Notes.TXT' }).path], ['C:/Users/me/notes.txt', 'C:/Users/me/Notes.TXT']);
eq('v2 path git-bash drive', [pre('Bash', { command: 'cat /c/Users/me/X.txt' }).file, pre('Bash', { command: 'cat /c/Users/me/X.txt' }).path], ['C:/Users/me/x.txt', 'C:/Users/me/X.txt']);
eq('v2 no file -> no path key', 'path' in pre('Bash', { command: 'ls' }), false);
eq('v2 ps path', pre('PowerShell', { command: 'Get-Content C:\\A\\B.txt' }).path, 'C:/A/B.txt');
// 2. git and build stations, precedence network > build > git > files > shell
eq('git diff', sh('git diff HEAD~1')[0], 'git');
eq('git -C commit', sh('git -C /tmp/r commit -m "x"')[0], 'git');
eq('git rev-parse | grep', sh('git rev-parse HEAD | grep a')[0], 'git');
eq('git push stays network', sh('git push origin main').slice(0, 2), ['network', 'git push']);
eq('git add && git push', sh('git add . && git push')[0], 'network');
eq('git commit message with && curl', sh('git commit -m "fix && curl x"').slice(0, 2), ['git', 'git commit']);
eq('git commit heredoc message', sh("git commit -m \"$(cat <<'EOF'\nfoo; npm install bar\nEOF\n)\"").slice(0, 2), ['git', 'git commit']);
eq('build + git -> build', sh('git status && npm test')[0], 'build');
eq('network + build -> network', sh('npm test && curl https://a.b')[0], 'network');
eq('build + file -> build', sh('cat a.txt && pytest')[0], 'build');
for (const [cmd, label] of [['npm run build', 'npm run build'], ['pnpm test', 'pnpm test'], ['yarn build', 'yarn build'], ['bun run lint', 'bun run lint'], ['npx vitest run', 'npx vitest'], ['npx tsc --noEmit', 'npx tsc'],
  ['npx eslint .', 'npx eslint'], ['npx playwright test', 'npx playwright'], ['node --test a.mjs', 'node --test'], ['pytest -q', 'pytest'], ['python -m pytest tests', 'python -m pytest'],
  ['python3 -m unittest', 'python3 -m unittest'], ['cargo build --release', 'cargo build'], ['cargo clippy', 'cargo clippy'], ['go test ./...', 'go test'], ['go vet ./...', 'go vet'], ['make all', 'make'],
  ['cmake --build .', 'cmake'], ['dotnet test', 'dotnet test'], ['mvn package', 'mvn'], ['gradle build', 'gradle'], ['tsc -p .', 'tsc'], ['eslint src', 'eslint'], ['ruff check .', 'ruff'], ['mypy src', 'mypy'], ['sudo -u x make', 'make']]) {
  eq(`build: ${cmd}`, sh(cmd).slice(0, 2), ['build', label]);
}
eq('build: Invoke-Pester (ps)', [pre('PowerShell', { command: 'Invoke-Pester -Path x' }).station, pre('PowerShell', { command: 'Invoke-Pester -Path x' }).label], ['build', 'Invoke-Pester']);
eq('npm view is network', sh('npm view foo')[0], 'network');
eq('npm start is shell', sh('npm start').slice(0, 2), ['shell', 'npm start']);
eq('npx plain stays shell', sh('npx foo')[0], 'shell');
// 3. labels: command + subcommand only
eq('label git push', sh('git push --force origin main')[1], 'git push');
eq('label curl host', sh('curl -s -H "Authorization: SECRET1" https://api.example.com:8443/x?token=abc')[1], 'curl api.example.com:8443');
eq('label curl bare host', sh('curl -o out.txt example.com/path')[1], 'curl example.com');
eq('label curl no url', sh('curl --version')[1], 'curl');
eq('label wget', sh('wget https://u:p@h.io/f')[1], 'wget h.io');
eq('label ssh', sh('ssh user@host ls')[1], 'ssh');
eq('label gh', sh('gh pr list --author me')[1], 'gh pr');
eq('label cat', sh('cat a.txt')[1], 'cat');
eq('label after cd', sh('cd /tmp && python gen.py --key=SECRET2')[1], 'python');
eq('label skips neutral', sh('echo start; ls -la')[1], 'ls');
eq('label echo only', sh('echo hi')[1], 'echo');
eq('label pip install', sh('python -m pip install requests')[1], 'pip install');
eq('label docker compose', sh('docker compose pull web')[1], 'docker compose pull');
eq('label description wins', sh('git push', { })[1], 'git push');
eq('label desc (build)', pre('Bash', { command: 'make', description: 'Compile it' }).label, 'Compile it');
eq('label never leaks args', JSON.stringify([sh('git commit -m "SECRETMSG"'), sh('npm run build -- --token=SECRET3'), sh('pytest tests/secret_dir -k SECRET4')]).includes('SECRET'), false);
// 4. file/write on any station; relative paths resolve against cwd and a leading cd; redirects
eq('redirect on shell', sh(`python gen.py > ${CWD}/Out.txt`), ['shell', 'python', `${CWD}/out.txt`.toLowerCase(), `${CWD}/Out.txt`, true]);
eq('redirect >> and 2>', sh(`npm test >> ${CWD}/log.txt 2> /dev/null`).slice(2), [`${CWD}/log.txt`.toLowerCase(), `${CWD}/log.txt`, true]);
eq('redirect &>', sh(`make &> ${CWD}/b.log`).slice(2, 4), [`${CWD}/b.log`.toLowerCase(), `${CWD}/b.log`]);
eq('redirect relative to cwd', sh('python gen.py > out.txt')[3], `${CWD}/out.txt`);
eq('redirect quoted target', sh('echo hi > "out file.txt"')[3], `${CWD}/out file.txt`);
eq('redirect /dev/null only', sh('npm test > /dev/null 2>&1').slice(2), [null, null, false]);
eq('redirect $null / NUL / &1', [sh('ls 2> $null')[4], sh('ls > NUL')[4], sh('ls 2>&1')[4]], [false, false, false]);
eq('redirect in quotes ignored', sh('echo "a > b"').slice(2), [null, null, false]);
eq('redirect in heredoc body ignored', sh("cat <<'EOF'\na > b\nEOF").slice(2), [null, null, false]);
eq('two redirect targets -> no file, write', sh('x > a.txt 2> b.txt').slice(2), [null, null, true]);
eq('ps redirect', [pre('PowerShell', { command: 'Get-Process > C:\\Out\\p.txt' }, { cwd: CWD }).path, pre('PowerShell', { command: 'Get-Process > C:\\Out\\p.txt' }).write], ['C:/Out/p.txt', true]);
const probe = REAL.split('/').pop();                                // test file: exists in its own dir
const probeDir = REAL.slice(0, REAL.lastIndexOf('/'));
eq('relative operand resolves against cwd', sh(`cat ${probe}`, { cwd: probeDir }).slice(2), [REAL_LC, REAL, false]);
eq('relative operand after cd', sh(`cd ${probeDir} && cat ${probe}`, { cwd: 'C:/nowhere' }).slice(2, 4), [REAL_LC, REAL]);
eq('relative operand after cd ; ps', [pre('PowerShell', { command: `Set-Location ${probeDir.replace(/\//g, '\\')}; Get-Content ${probe}` }, { cwd: 'C:/nowhere' }).path], [REAL]);
eq('relative cd ..', sh(`cd .. && cat ${probe}`, { cwd: `${probeDir}/x` }).slice(2, 4), [REAL_LC, REAL]);
eq('relative cd ../other -> missing', sh(`cd ../other && cat ${probe}`, { cwd: `${probeDir}/x` }).slice(2, 4), [null, null]);
eq('relative operand missing -> null', sh('cat no-such-file-xyz.txt').slice(2), [null, null, false]);
eq('relative without cwd -> null', pre('Bash', { command: `cat ${probe}` }).file, null);
eq('cd to variable -> unknown', sh(`cd $X && cat ${probe}`, { cwd: probeDir })[2], null);
eq('relative write target counts', sh('cp src.js copy.js').slice(2), [null, null, true]);
eq('relative write one target', sh('touch new.txt')[3], `${CWD}/new.txt`);
eq('head -n 5 file: number not a path', sh(`head -n 5 ${probe}`, { cwd: probeDir })[3], REAL);
eq('ps -Value text not a path', pre('PowerShell', { command: 'Set-Content -Path out.txt -Value some.text' }, { cwd: CWD }).path, `${CWD}/out.txt`);
eq('grep pattern with real cwd', sh(`grep -rn secret.token ${probe}`, { cwd: probeDir })[3], REAL);
eq('Read relative path with cwd', pre('Read', { file_path: probe }, { cwd: probeDir }).path, REAL);
eq('git + redirect', sh('git diff > p.patch').slice(0, 2).concat(sh('git diff > p.patch')[4]), ['git', 'git diff', true]);
// 5. ask
eq('ask line', buildLine('ask', { session_id: 's', tool_name: 'Bash', tool_input: { command: 'rm -rf /c/tmp/Q' }, cwd: CWD }, 1),
  { ts: 1, sid: 's', sub: null, ev: 'ask', id: '', tool: 'Bash', station: 'files', label: 'rm', file: 'c:/tmp/q', path: 'C:/tmp/Q', write: true });
eq('ask with id + agent', buildLine('ask', { session_id: 's', agent_id: 'a1', tool_use_id: 'tu9', tool_name: 'Edit', tool_input: { file_path: 'C:/x/Y.md' } }, 1),
  { ts: 1, sid: 's', sub: 'a1', ev: 'ask', id: 'tu9', tool: 'Edit', station: 'files', label: 'x/Y.md', file: 'c:/x/y.md', path: 'C:/x/Y.md', write: true });
eq('ask without tool -> no line', buildLine('ask', { session_id: 's' }, 1), null);
eq('ask: no prompt/permission text', JSON.stringify(buildLine('ask', { session_id: 's', tool_name: 'Bash', tool_input: { command: 'ls' }, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'SECRET5' }] }] }, 1)).includes('SECRET5'), false);
// 6. subid on Agent post, label on sub_stop
const agentPost = (resp, tool = 'Agent') => buildLine('post', { session_id: 's', tool_name: tool, tool_use_id: 'tu', tool_input: { description: 'Plan it' }, tool_response: resp }, 1);
eq('subid field agentId', agentPost({ agentId: 'a25597ebbc7e5717a', status: 'async_launched' }).subid, 'a25597ebbc7e5717a');
eq('subid field agent_id', agentPost({ agent_id: 'a1b2' }, 'Task').subid, 'a1b2');
eq('subid in content text', agentPost({ content: [{ type: 'text', text: 'Async agent launched.\nagentId: a70228b0d7f233352 (for resuming)' }] }).subid, 'a70228b0d7f233352');
eq('subid in string response', agentPost('done\nagentId: abc123').subid, 'abc123');
eq('subid absent', 'subid' in agentPost({ content: [{ type: 'text', text: 'no id here' }] }), false);
eq('subid only on post', 'subid' in buildLine('pre', { session_id: 's', tool_name: 'Agent', tool_use_id: 'tu', tool_input: {}, tool_response: { agentId: 'zz' } }, 1), false);
eq('subid not on other tools', 'subid' in buildLine('post', { session_id: 's', tool_name: 'Bash', tool_use_id: 'tu', tool_input: { command: 'ls' }, tool_response: { agentId: 'zz' } }, 1), false);
eq('subid label stays', agentPost({ agentId: 'q1' }).label, 'Plan it');
eq('subid refuses odd ids', 'subid' in agentPost({ agentId: 'a b;c' }), false);
eq('sub_stop label = agent_type', buildLine('sub_stop', { session_id: 's', agent_id: 'a9', agent_type: 'planner' }, 1), { ts: 1, sid: 's', sub: 'a9', ev: 'sub_stop', label: 'planner' });
eq('sub_start fallback', buildLine('sub_start', { session_id: 's', agent_id: 'a9' }, 1).label, 'subagent');
// 7. unknown tools
for (const t of ['SubagentHandback', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TeamCreate', 'TeamDelete', 'AgentFoo', 'SubagentThing', 'SendMessage', 'TaskStop']) eq(`agents: ${t}`, st(t, {}), ['agents', t, null, false]);
for (const t of ['ScheduleWakeup', 'CronCreate', 'CronDelete', 'CronList', 'RemoteTrigger', 'PushNotification']) eq(`you: ${t}`, st(t, {}), ['you', t, null, false]);
for (const t of ['EnterPlanMode', 'ExitPlanMode', 'DesignSync', 'EnterWorktree', 'Brand New Tool']) eq(`skills: ${t}`, st(t, {}), ['skills', t, null, false]);
eq('mcp unchanged', st('mcp__claude_ai_Higgsfield_AI__authenticate', {}), ['network', 'claude_ai_Higgsfield_AI: authenticate', null, false]);
eq('Monitor stays shell', st('Monitor', { description: 'watch' })[0], 'shell');

// --- process level (real spawn)
const script = fileURLToPath(new URL('./agent-map.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'agent-map-test-'));
const run = (mode, input, env = {}) => spawnSync('node', [script, mode], { input: typeof input === 'string' ? input : JSON.stringify(input), env: { ...process.env, AGENT_MAP_DIR: join(dir, 'd'), ...env }, encoding: 'utf8' });
try {
  let r = run('pre', { session_id: 's', tool_name: 'Read', tool_use_id: 'a', tool_input: { file_path: 'C:/a/b' } }, { HC_TERMINAL_ID: 'a/b:c d' });
  eq('exit 0', r.status, 0); eq('stdout empty', r.stdout, '');
  const f = join(dir, 'd', 'a_b_c_d.jsonl');
  eq('file name sanitised + dir created', existsSync(f), true);
  eq('one line', readFileSync(f, 'utf8').split('\n').filter(Boolean).length, 1);
  // PermissionRequest payload through the real process: ask line, no stdout, exit 0
  r = run('ask', { session_id: 's', transcript_path: 'x.jsonl', cwd: 'C:/proj', permission_mode: 'default', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'git push origin main', description: '' }, permission_suggestions: [{ type: 'addRules' }] }, { HC_TERMINAL_ID: 'ask1' });
  const askLine = JSON.parse(readFileSync(join(dir, 'd', 'ask1.jsonl'), 'utf8').trim());
  eq('process ask: exit 0, no stdout', [r.status, r.stdout], [0, '']);
  eq('process ask: line', [askLine.ev, askLine.tool, askLine.station, askLine.label, askLine.file, askLine.write, askLine.id], ['ask', 'Bash', 'network', 'git push', null, false, '']);
  const noEnv = { ...process.env }; delete noEnv.HC_TERMINAL_ID;
  r = spawnSync('node', [script, 'pre'], { input: '{}', env: { ...noEnv, AGENT_MAP_DIR: join(dir, 'e') }, encoding: 'utf8' });
  eq('no HC_TERMINAL_ID: exit 0', r.status, 0); eq('no HC_TERMINAL_ID: no dir', existsSync(join(dir, 'e')), false);
  r = run('pre', 'not json', { HC_TERMINAL_ID: 'a/b:c d' });
  eq('bad json exit 0', r.status, 0); eq('bad json no line', readFileSync(f, 'utf8').split('\n').filter(Boolean).length, 1);
  r = run('bogus', { session_id: 's' }, { HC_TERMINAL_ID: 'a/b:c d' });
  eq('bad mode exit 0', r.status, 0);
  // trim: 601 lines -> 400 kept
  writeFileSync(f, Array.from({ length: 600 }, (_, i) => JSON.stringify({ ts: i, sid: 's'.repeat(36), sub: null, ev: 'stop' })).join('\n') + '\n');
  run('stop', { session_id: 's' }, { HC_TERMINAL_ID: 'a/b:c d' });
  const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
  eq('trim to 400', lines.length, 400); eq('trim keeps newest', JSON.parse(lines[399]).ev, 'stop');
  eq('trim leaves no tmp', existsSync(f + '.tmp'), false);
  // parallel appends
  const procs = Array.from({ length: 12 }, (_, i) => new Promise((res) => {
    import('node:child_process').then(({ spawn }) => {
      const p = spawn('node', [script, 'pre'], { env: { ...process.env, AGENT_MAP_DIR: join(dir, 'p'), HC_TERMINAL_ID: 'par' } });
      p.on('close', res); p.stdin.end(JSON.stringify({ session_id: 's', tool_name: 'Bash', tool_use_id: 'p' + i, tool_input: { command: 'ls' } }));
    });
  }));
  await Promise.all(procs);
  const par = readFileSync(join(dir, 'p', 'par.jsonl'), 'utf8').split('\n').filter(Boolean);
  eq('parallel: 12 intact lines', par.map((l) => JSON.parse(l).id).sort().join(), Array.from({ length: 12 }, (_, i) => 'p' + i).sort().join());
  // pruning: mode session only, old *.jsonl (24 h) and *.tmp (1 h), never its own file
  const pd = join(dir, 'prune'); mkdirSync(pd);
  const old = (n, hours) => { const q = join(pd, n); writeFileSync(q, 'x'); const t = new Date(Date.now() - hours * 3600e3); utimesSync(q, t, t); return q; };
  const fOld = old('t1.jsonl', 25), fNew = old('t2.jsonl', 23), tOld = old('t3.jsonl.9.tmp', 2), tNew = old('t4.jsonl.9.tmp', 0.5), fSelf = old('me.jsonl', 30), fOther = old('keep.txt', 100);
  const pr = (mode) => spawnSync('node', [script, mode], { input: JSON.stringify({ session_id: 's', tool_name: 'Read', tool_use_id: 'a', tool_input: { file_path: 'C:/a' } }), env: { ...process.env, AGENT_MAP_DIR: pd, HC_TERMINAL_ID: 'me' }, encoding: 'utf8' });
  pr('pre');
  eq('prune: not on pre', [fOld, tOld].map(existsSync), [true, true]);
  eq('prune: exit 0', pr('session').status, 0);
  eq('prune: old jsonl + old tmp gone', [fOld, tOld].map(existsSync), [false, false]);
  eq('prune: fresh files, own file, other names stay', [fNew, tNew, fSelf, fOther].map(existsSync), [true, true, true, true]);
  // context: last main-thread reply's prompt tokens, sidechain and text-only lines skipped
  const tp = join(dir, 'tr.jsonl');
  const A = (u, side) => JSON.stringify({ type: 'assistant', isSidechain: !!side, message: { usage: u, content: [{ type: 'text', text: 'hi' }] } });
  writeFileSync(tp, [A({ input_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 20 }), A({ input_tokens: 9, cache_read_input_tokens: 99999 }, true), JSON.stringify({ type: 'user', message: { content: 'usage' } }), '{"broken'].join(String.fromCharCode(10)) + String.fromCharCode(10));
  eq('ctx: main thread', contextOf(tp, {}), { ctx: 1025, ctxMax: 200000 });
  eq('ctx: auto-compact window', contextOf(tp, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '400000' }).ctxMax, 400000);
  eq('ctx: missing file', contextOf(join(dir, 'nope.jsonl'), {}), null);
  eq('ctx: not a jsonl', contextOf(REAL, {}), null);
  const tp2 = join(dir, 'tr2.jsonl');
  writeFileSync(tp2, [A({ input_tokens: 5, cache_read_input_tokens: 300000 }), JSON.stringify({ type: 'system', subtype: 'compact_boundary' })].join(String.fromCharCode(10)));
  eq('ctx: nothing since compaction', contextOf(tp2, {}), null);
  const cl = spawnSync('node', [script, 'stop'], { input: JSON.stringify({ session_id: 's', transcript_path: tp }), env: { ...process.env, AGENT_MAP_DIR: join(dir, 'c'), HC_TERMINAL_ID: 'cx', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '' }, encoding: 'utf8' });
  const cline = JSON.parse(readFileSync(join(dir, 'c', 'cx.jsonl'), 'utf8').trim());
  eq('ctx: on stop line', [cl.status, cline.ctx, cline.ctxMax], [0, 1025, 200000]);
} finally { rmSync(dir, { recursive: true, force: true }); }

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
