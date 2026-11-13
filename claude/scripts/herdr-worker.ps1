<#
herdr-worker.ps1 - run a Claude agent definition as its own herdr pane instead of an in-process subagent,
so each worker shows up in the herdr agent list (working / blocked / idle).

Used by: ~/.claude/skills/delegate/SKILL.md (global default), Webapps\.claude\skills\orchestrate\SKILL.md, Archive\CLAUDE.md. Windows PowerShell 5.1 compatible, ASCII only.

Two hosts:
  herdr-app (HC_TERMINAL_ID set, hc in PATH): `hc run --bg` starts the worker as a sub-agent of the calling
    terminal -> listed under the orchestrator in herdr-app's agents list; -Pane also gives it a pane
    (terminal.keep). Waits with `hc wait`, ends it with `hc kill` + `hc rm`.
  herdr TUI (HERDR_ENV=1, legacy): `herdr agent start` in a new split pane, closed afterwards.

Flow: start `claude --agent <Agent> "<prompt>"` -> worker reads TaskFile, writes ReportFile as its last
step -> this script waits for ReportFile + idle -> ends the worker (unless -KeepPane).
Run it in the background (Bash/PowerShell tool run_in_background) and read ReportFile when it exits.

Exit codes:
  0 report written (worker ended unless -KeepPane or it did not go idle); the exit line carries the
    report header as [STATUS=.. | VERDICT=.. | ...] or [header=missing]
  2 bad arguments
  3 neither inside herdr-app nor the herdr TUI -> caller falls back to the Agent tool
  4 could not start the worker
  5 worker exited without writing the report
  6 timeout (worker left running for inspection)
#>
param(
    [Parameter(Mandatory = $true)][string]$Name,        # herdr agent name, [a-z][a-z0-9_-]{0,31}, unique among live agents
    [Parameter(Mandatory = $true)][string]$Agent,       # agent definition in .claude/agents, e.g. impl-medium, reviewer, bauer
    [Parameter(Mandatory = $true)][string]$TaskFile,    # full task prompt, written by the orchestrator
    [Parameter(Mandatory = $true)][string]$ReportFile,  # must not exist yet; worker writes it last
    [string]$Cwd = (Get-Location).Path,
    [ValidateSet('right', 'down')][string]$Split = 'right',
    [int]$TimeoutMin = 90,
    [string]$PermissionMode = '',                       # passed to claude --permission-mode when set
    [switch]$KeepPane,                                  # don't end the worker after its report (pane/terminal stays)
    [switch]$Pane                                       # herdr-app only: also give the worker a visible pane ($Split side); default = agents list only
)

$ErrorActionPreference = 'Stop'

function Out-Result([int]$code, [string]$msg) {
    Write-Output "HERDR-WORKER $Name exit=$code $msg"
    exit $code
}

function Get-FirstMatch([string]$text, [string]$pattern) {
    $m = [regex]::Match($text, $pattern)
    if ($m.Success) { return $m.Groups[1].Value }
    return ''
}

# Run herdr without PS 5.1 turning stderr lines into terminating errors. Sets $script:HerdrCode.
function Invoke-Herdr([string[]]$hargs) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $lines = & herdr @hargs 2>&1 | ForEach-Object { "$_" }
        $script:HerdrCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev }
    return ($lines -join "`n")
}

function Get-AgentStatus {
    $out = Invoke-Herdr @('agent', 'get', $Name)
    if ($script:HerdrCode -ne 0) { return '' }
    $s = Get-FirstMatch $out '"(?:status|state)"\s*:\s*"(\w+)"'
    if ($s -eq '') { $s = 'unknown' }
    return $s
}

# First header block of the report (KEY: value lines, see the agent definitions), as "K=v | K=v".
# Skips a leading title, blank and code-fence lines; stops at the first other line after the header started.
function Get-ReportHeader {
    $keys = '^(STATUS|VERDICT|COMMIT|TESTS|FILES|RISKS|BLOCKING|NOTES|DEPLOYED|RUN|UNPLACED)$'
    $pairs = @()
    $lines = @()
    try { $lines = @(Get-Content -LiteralPath $ReportFile -TotalCount 25 -Encoding UTF8 -ErrorAction Stop) } catch { return 'header=unreadable' }
    foreach ($l in $lines) {
        $s = $l.Trim()
        if ($s -eq '' -or $s.StartsWith('```') -or $s.StartsWith('#')) { if ($pairs.Count -gt 0 -and $s -ne '') { break }; continue }
        $m = [regex]::Match($s, '^[-*`_\s]*([A-Za-z_]+)[*`_]*\s*:[*`_]*\s*(.*?)[*`_\s]*$')
        if ($m.Success -and $m.Groups[1].Value.ToUpper() -match $keys) {
            $v = $m.Groups[2].Value
            if ($v.Length -gt 100) { $v = $v.Substring(0, 100) + '...' }
            $pairs += ($m.Groups[1].Value.ToUpper() + '=' + $v)
        } elseif ($pairs.Count -gt 0) { break }
    }
    if ($pairs.Count -eq 0) { return 'header=missing' }
    return ($pairs -join ' | ')
}

# --- checks ---
# herdr-app (herdr-core, hc) sets HC_TERMINAL_ID; the herdr TUI sets HERDR_ENV=1.
$mode = ''
if ($env:HC_TERMINAL_ID -and (Get-Command hc -ErrorAction SilentlyContinue)) { $mode = 'app' }
elseif ($env:HERDR_ENV -eq '1') { $mode = 'tui' }
if ($mode -eq '') { Out-Result 3 'not inside herdr-app or herdr; use the Agent tool instead' }
if ($Name -cnotmatch '^[a-z][a-z0-9_-]{0,31}$') { Out-Result 2 'name must match [a-z][a-z0-9_-]{0,31}' }
if ($Agent -notmatch '^[A-Za-z0-9_-]+$') { Out-Result 2 'invalid agent name' }
if ($mode -eq 'tui' -and -not (Get-Command herdr -ErrorAction SilentlyContinue)) { Out-Result 4 'herdr not in PATH' }

$TaskFile = [IO.Path]::GetFullPath($TaskFile)
$ReportFile = [IO.Path]::GetFullPath($ReportFile)
$Cwd = [IO.Path]::GetFullPath($Cwd)
foreach ($p in @($TaskFile, $ReportFile, $Cwd)) {
    if ($p -match '["%&|<>^]') { Out-Result 2 "path contains a shell metacharacter: $p" }
}
if (-not (Test-Path -LiteralPath $TaskFile -PathType Leaf)) { Out-Result 2 "task file missing: $TaskFile" }
if (Test-Path -LiteralPath $ReportFile) { Out-Result 2 "report file already exists, pick a new path: $ReportFile" }
if (-not (Test-Path -LiteralPath $Cwd -PathType Container)) { Out-Result 2 "cwd missing: $Cwd" }
$reportDir = Split-Path -Parent $ReportFile
if (-not (Test-Path -LiteralPath $reportDir)) { New-Item -ItemType Directory -Force -Path $reportDir | Out-Null }

# Pre-accept the folder trust dialog for $Cwd (new worktrees are unknown paths), else the worker stalls on it.
# Project MCP servers are pre-approved via enabledMcpjsonServers in ~/.claude/settings.json.
if (Get-Command node -ErrorAction SilentlyContinue) {
    & { $ErrorActionPreference = 'Continue'; node (Join-Path $PSScriptRoot 'trust-dir.mjs') $Cwd 2>&1 | Out-Null }
}

# Prompt stays free of quotes and shell metacharacters; the real task lives in the file.
$prompt = "You run as a herdr worker pane for an orchestrator session. Read your task in $TaskFile and carry it out. " +
          "As your very last step write your complete final report to $ReportFile, starting with the header lines your agent definition prescribes - the orchestrator waits for that file. " +
          "After writing it, stop and wait."

$claudeArgs = @('--agent', $Agent)
if ($PermissionMode -ne '') { $claudeArgs += @('--permission-mode', $PermissionMode) }
$claudeArgs += $prompt

# ===== herdr-app: the worker is an hc sub-agent of the calling terminal =====
# It shows under the orchestrator in herdr-app's agents list (working / blocked / idle); -Pane also
# gives it a visible pane. Status comes from `hc wait` / `hc get` (OSC 7501 reported by Claude Code).
if ($mode -eq 'app') {
    function Invoke-Hc([string[]]$hargs) {
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $lines = & hc @hargs 2>&1 | ForEach-Object { "$_" }
            $script:HcCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $prev }
        return ($lines -join "`n")
    }
    function ConvertFrom-HcJson([string]$text) {
        try { return ($text | ConvertFrom-Json) } catch { return $null }
    }
    function Test-Report { return ((Test-Path -LiteralPath $ReportFile) -and (Get-Item -LiteralPath $ReportFile).Length -gt 0) }
    # hc get: state = live|finished; status = null or {app, msg, state = working|blocked|idle|done}
    function Get-HcState {
        $g = ConvertFrom-HcJson (Invoke-Hc @('get', $term, '--json'))
        if (-not $g -or $g.error) { return @{ live = $false; status = ''; exit = '' } }
        $s = ''
        if ($g.status) { if ($g.status -is [string]) { $s = $g.status } else { $s = [string]$g.status.state } }
        return @{ live = ($g.state -eq 'live'); status = $s; exit = [string]$g.exit_code }
    }

    $runArgs = @('run', '--bg', '--json', '--no-notify', '--name', $Name, '--cwd', $Cwd,
                 '--label', "herdr-worker=$Agent", '--', 'claude') + $claudeArgs
    $runOut = Invoke-Hc $runArgs
    $run = ConvertFrom-HcJson $runOut
    if ($script:HcCode -ne 0 -or -not $run -or -not $run.address) { Out-Result 4 "hc run failed: $runOut" }
    $term = [string]$run.address

    $shown = 'agents list'
    if ($Pane) {
        # herdr-app learns about the new core terminal a moment later ("no running terminal"): retry briefly
        $keepOk = $false
        for ($i = 0; $i -lt 15 -and -not $keepOk; $i++) {
            $keepOut = & { $ErrorActionPreference = 'Continue'; herdr-app do terminal.keep --terminal $term --place $Split 2>&1 | ForEach-Object { "$_" } }
            $keepText = ($keepOut -join ' ')
            if ($LASTEXITCODE -eq 0 -and $keepText -notmatch '"error"') { $keepOk = $true } else { Start-Sleep -Milliseconds 700 }
        }
        if ($keepOk) { $shown = "pane ($Split)" } else { $shown = "agents list (pane failed: $keepText)" }
    }
    Write-Output "HERDR-WORKER $Name started agent=$Agent terminal=$term shown=$shown report=$ReportFile"

    # --- wait for the report ---
    # hc wait returns when the turn ends (ended=true, reason=status: the process is still alive), when the
    # worker blocks or exits, or after --timeout. Liveness therefore always comes from hc get.
    $deadline = (Get-Date).AddMinutes($TimeoutMin)
    $lastStatus = ''
    $idleSince = $null
    while (-not (Test-Report)) {
        if ((Get-Date) -gt $deadline) { Out-Result 6 "timeout after $TimeoutMin min, last status=$lastStatus, terminal left running=$term" }
        $t0 = Get-Date
        Invoke-Hc @('wait', $term, '--json', '--timeout', '60') | Out-Null
        if (Test-Report) { break }
        $st = Get-HcState
        if (-not $st.live) { Out-Result 5 "worker exited without report (exit_code=$($st.exit)); terminal=$term, inspect with: hc read $term --lines 120" }
        $status = $st.status
        if ($status -eq '') { $status = 'starting' }
        if ($status -ne $lastStatus) { Write-Output "HERDR-WORKER $Name status=$status"; $lastStatus = $status }
        # finished its turn but wrote no report: give the file system a moment, then report instead of hanging
        if ($status -eq 'idle' -or $status -eq 'done') {
            if (-not $idleSince) { $idleSince = Get-Date }
            elseif (((Get-Date) - $idleSince).TotalSeconds -gt 90) { Out-Result 5 "worker idle without report; terminal left running=$term, inspect with: hc read $term --lines 120" }
        } else { $idleSince = $null }
        # not working (startup, blocked on the user, idle): wait returns at once, so don't spin
        if (((Get-Date) - $t0).TotalSeconds -lt 3) { Start-Sleep -Seconds 5 }
    }

    # --- report written: let the turn settle, then end the worker ---
    $idle = $false
    $settle = (Get-Date).AddMinutes(2)
    while ((Get-Date) -lt $settle) {
        $st = Get-HcState
        if (-not $st.live -or $st.status -eq 'idle' -or $st.status -eq 'done') { $idle = $true; break }
        Invoke-Hc @('wait', $term, '--json', '--timeout', '30') | Out-Null
    }

    $hdr = "[" + (Get-ReportHeader) + "]"
    if ($KeepPane) { Out-Result 0 "$hdr report=$ReportFile terminal kept=$term" }
    if (-not $idle) { Out-Result 0 "$hdr report=$ReportFile worker not idle after report, terminal left running=$term" }
    Invoke-Hc @('kill', $term, '--json') | Out-Null
    Invoke-Hc @('rm', $term, '--json') | Out-Null
    Out-Result 0 "$hdr report=$ReportFile terminal ended=$term"
}

# ===== herdr TUI (legacy) =====
# --- start: the herdr CLI changed between versions, support both ---
$help = Invoke-Herdr @('agent')
$paneId = ''
if ($help -match '--kind') {
    # newer CLI: create the pane first, then start the agent kind in it
    $splitOut = Invoke-Herdr @('pane', 'split', '--current', '--direction', $Split, '--cwd', $Cwd, '--no-focus')
    if ($script:HerdrCode -ne 0) { Out-Result 4 "pane split failed: $splitOut" }
    $paneId = Get-FirstMatch $splitOut '"pane_id"\s*:\s*"([^"]+)"'
    if ($paneId -eq '') { Out-Result 4 "no pane_id in split response: $splitOut" }
    $argv = @('agent', 'start', $Name, '--kind', 'claude', '--pane', $paneId, '--timeout', '60000', '--') + $claudeArgs
    $startOut = Invoke-Herdr $argv
    # agent_not_ready = blocked during startup (e.g. trust prompt); the user answers it in the pane
    if ($script:HerdrCode -ne 0 -and $startOut -notmatch 'agent_not_ready') {
        Invoke-Herdr @('pane', 'close', $paneId) | Out-Null
        Out-Result 4 "agent start failed: $startOut"
    }
} else {
    # older CLI: agent start creates the split itself
    $argv = @('agent', 'start', $Name, '--cwd', $Cwd, '--split', $Split, '--no-focus', '--', 'claude') + $claudeArgs
    $startOut = Invoke-Herdr $argv
    if ($script:HerdrCode -ne 0) { Out-Result 4 "agent start failed: $startOut" }
    $paneId = Get-FirstMatch $startOut '"pane_id"\s*:\s*"([^"]+)"'
}
Write-Output "HERDR-WORKER $Name started agent=$Agent pane=$paneId report=$ReportFile"

# --- wait for the report ---
$deadline = (Get-Date).AddMinutes($TimeoutMin)
$missing = 0
$lastStatus = ''
while ($true) {
    if ((Test-Path -LiteralPath $ReportFile) -and (Get-Item -LiteralPath $ReportFile).Length -gt 0) { break }
    $status = Get-AgentStatus
    if ($status -eq '') {
        $missing++
        if ($missing -ge 3) { Out-Result 5 "worker gone without report; pane=$paneId" }
    } else {
        $missing = 0
        if ($status -ne $lastStatus) { Write-Output "HERDR-WORKER $Name status=$status"; $lastStatus = $status }
    }
    if ((Get-Date) -gt $deadline) { Out-Result 6 "timeout after $TimeoutMin min, last status=$lastStatus, pane left open=$paneId" }
    Start-Sleep -Seconds 5
}

# --- report written: let the turn settle, then close the pane ---
$idle = $false
$settle = (Get-Date).AddMinutes(2)
while ((Get-Date) -lt $settle) {
    $status = Get-AgentStatus
    if ($status -eq 'idle' -or $status -eq 'done' -or $status -eq '') { $idle = $true; break }
    Start-Sleep -Seconds 3
}

$hdr = "[" + (Get-ReportHeader) + "]"
if ($KeepPane) { Out-Result 0 "$hdr report=$ReportFile pane kept=$paneId" }
if (-not $idle) { Out-Result 0 "$hdr report=$ReportFile worker not idle after report, pane left open=$paneId" }
if ($paneId -ne '') {
    Invoke-Herdr @('pane', 'close', $paneId) | Out-Null
    Out-Result 0 "$hdr report=$ReportFile pane closed=$paneId"
}
Out-Result 0 "$hdr report=$ReportFile pane id unknown, close it by hand"
