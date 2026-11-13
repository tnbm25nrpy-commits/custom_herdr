# Keeps herdr-app showing a Claude Code session as "working" while background shell tasks or subagents run.
# Registered as an extra Stop hook. Hook mode: spawns a detached watcher. Watcher mode (-Watch): emits OSC 7501.
param(
    [switch]$Watch,
    [int]$ClaudePid = 0,
    [string]$Terminal = '',
    [string]$Pids = '',
    [string]$SubDir = '',
    [long]$HookTicks = 0,
    [switch]$DryRun
)
$ErrorActionPreference = 'SilentlyContinue'

function Get-Procs { @(Get-CimInstance Win32_Process) }

function Get-ClaudePid($procs, [int]$start) {
    $byId = @{}; foreach ($p in $procs) { $byId[[int]$p.ProcessId] = $p }
    $cur = $start; $n = 0
    while ($cur -and $byId.ContainsKey($cur) -and $n -lt 40) {
        $p = $byId[$cur]
        if ($p.Name -ieq 'claude.exe') { return [int]$p.ProcessId }
        $cur = [int]$p.ParentProcessId; $n++
    }
    return 0
}

function Get-Ancestors($procs, [int]$start) {
    $byId = @{}; foreach ($p in $procs) { $byId[[int]$p.ProcessId] = $p }
    $set = @{}; $cur = $start; $n = 0
    while ($cur -and $byId.ContainsKey($cur) -and $n -lt 40) {
        $set[$cur] = $true; $cur = [int]$byId[$cur].ParentProcessId; $n++
    }
    return $set
}

function Get-BgShells($procs, [int]$claude, $exclude) {
    $out = @()
    foreach ($p in $procs) {
        if ([int]$p.ParentProcessId -ne $claude) { continue }
        if ($exclude.ContainsKey([int]$p.ProcessId)) { continue }
        $cl = [string]$p.CommandLine
        $n = [string]$p.Name
        if (($n -ieq 'bash.exe' -and $cl.Contains('shell-snapshots')) -or
            (($n -ieq 'cmd.exe' -or $n -ieq 'powershell.exe') -and ($cl.Contains('CLAUDE_CODE_SHELL_LAUNCHER_SCRIPT') -or $cl.Contains('\tasks\')))) {
            $out += $p
        }
    }
    return $out
}

# The eval body is quoted twice: bash single quotes ('"'"' or '\'' for a literal '),
# then Windows argv quoting (\" for ", \\ before a quote for \). Undo the outer layer first.
function ConvertFrom-ShellQuoting([string]$s) {
    $s = [regex]::Replace($s, '(\\+)"', { param($m) ('\' * [math]::Floor($m.Groups[1].Length / 2)) + '"' })
    $s = $s.Replace("'`"'`"'", "'").Replace("'\''", "'")
    return $s
}

function Get-WaitMsg($shells) {
    $m = 'background task'
    if ($shells.Count -gt 0) {
        $p = $shells[0]
        if ($p.Name -ieq 'bash.exe') {
            $cl = [string]$p.CommandLine
            $r = [regex]::Match($cl, "eval '(.*?)' < /dev/null")
            if (-not $r.Success) { $r = [regex]::Match($cl, "eval '(.*)'") }
            if ($r.Success -and $r.Groups[1].Value.Trim()) { $m = ((ConvertFrom-ShellQuoting $r.Groups[1].Value) -replace '\s+', ' ').Trim() }
        }
    }
    $m = 'waiting: ' + $m
    if ($m.Length -gt 80) { $m = $m.Substring(0, 77) + '...' }
    return $m
}

function Initialize-Native {
    if ('HerdrWait.Native' -as [type]) { return }
    Add-Type -Namespace HerdrWait -Name Native -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint pid);
[DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool WriteFile(IntPtr h, byte[] buf, uint n, out uint written, IntPtr ov);
[DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
'@
}

function Send-Status([int]$claude, [string]$state, [string]$msg) {
    Initialize-Native
    $esc = [char]27
    $s = "$esc]7501;state=$state" + ':app=claude-code'
    if ($msg) { $s += ':msg=' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($msg)) }
    $s += "$esc\"
    $bytes = [Text.Encoding]::ASCII.GetBytes($s)
    [void][HerdrWait.Native]::FreeConsole()
    try {
        if ([HerdrWait.Native]::AttachConsole([uint32]$claude)) {
            $h = [HerdrWait.Native]::CreateFileW('CONOUT$', [uint32]3221225472, [uint32]3, [IntPtr]::Zero, [uint32]3, [uint32]0, [IntPtr]::Zero)
            if ($h -ne [IntPtr]::Zero -and $h.ToInt64() -ne -1) {
                $w = [uint32]0
                [void][HerdrWait.Native]::WriteFile($h, $bytes, [uint32]$bytes.Length, [ref]$w, [IntPtr]::Zero)
                [void][HerdrWait.Native]::CloseHandle($h)
            }
        }
    } finally { [void][HerdrWait.Native]::FreeConsole() }
}

function Find-Status($o, [int]$depth = 0) {
    if ($null -eq $o -or $depth -gt 6) { return $null }
    if ($o -is [System.Management.Automation.PSCustomObject]) {
        if ($o.PSObject.Properties['status'] -and $o.status -and $o.status.PSObject.Properties['state']) { return $o.status }
        foreach ($pr in $o.PSObject.Properties) {
            $r = Find-Status $pr.Value ($depth + 1); if ($r) { return $r }
        }
    } elseif ($o -is [System.Collections.IEnumerable] -and $o -isnot [string]) {
        foreach ($i in $o) { $r = Find-Status $i ($depth + 1); if ($r) { return $r } }
    }
    return $null
}

function Get-HcStatus([string]$term) {
    try {
        $hc = (Get-Command hc -CommandType Application | Select-Object -First 1).Source
        if (-not $hc) { return $null }
        $psi = New-Object Diagnostics.ProcessStartInfo
        $psi.FileName = $hc
        $psi.Arguments = "get $term --json"
        $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
        $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
        $p = [Diagnostics.Process]::Start($psi)
        $rd = $p.StandardOutput.ReadToEndAsync()
        if (-not $p.WaitForExit(5000)) { try { $p.Kill() } catch {}; return $null }
        $txt = $rd.Result
        return Find-Status ($txt | ConvertFrom-Json)
    } catch { return $null }
}

function Test-Alive([int]$id) { [bool](Get-Process -Id $id -ErrorAction SilentlyContinue) }

# Running background subagents of this session: <transcript dir>\<session id>\subagents\agent-*.meta.json.
# Newer Claude Code writes "finished":true into the meta when the agent ends; older ones never do, so an
# unfinished meta only counts if its transcript changed since this claude.exe started and within $StaleMin.
$StaleMin = 15
function Get-SubDir([string]$transcript, [string]$session) {
    if (-not $transcript -or -not $session) { return '' }
    return (Join-Path (Join-Path (Split-Path -Parent $transcript) $session) 'subagents')
}

function Get-RunningSubagents([string]$subDir, [datetime]$since, [datetime]$hook = (Get-Date)) {
    $out = @()
    if (-not $subDir -or -not (Test-Path -LiteralPath $subDir)) { return $out }
    $cut = (Get-Date).AddMinutes(-$StaleMin)
    $woke = (Get-Date).AddSeconds(-30); if ($hook.AddSeconds(2) -gt $woke) { $woke = $hook.AddSeconds(2) }
    foreach ($m in @(Get-ChildItem -LiteralPath $subDir -Filter '*.meta.json' -File)) {
        try {
            $j = Get-Content -LiteralPath $m.FullName -Raw | ConvertFrom-Json
            $t = $m.LastWriteTime
            $tr = Join-Path $subDir ($m.Name -replace '\.meta\.json$', '.jsonl')
            if (Test-Path -LiteralPath $tr) { $tt = (Get-Item -LiteralPath $tr).LastWriteTime; if ($tt -gt $t) { $t = $tt } }
            if ($t -lt $since) { continue }
            # "finished" is set at hand-back even if the agent still has background work and wakes up again
            # later; its shells are caught as claude.exe children, a woken agent by a transcript written < 30 s ago
            # and after the Stop hook fired (meta + transcript of a plain hand-back share one mtime).
            if ($j.PSObject.Properties['finished'] -and $j.finished) { if ($t -le $woke) { continue } }
            elseif ($t -lt $cut) { continue }
            $d = [string]$j.description; if (-not $d) { $d = [string]$j.agentType }
            $out += $d
        } catch {}
    }
    return $out
}

function Get-ClaudeStart([int]$id) {
    try { return (Get-Process -Id $id -ErrorAction Stop).StartTime } catch { return (Get-Date).AddDays(-1) }
}

# Remove locks left by dead claude.exe processes or older than the 6 h cap.
function Clear-StaleLocks([string]$dir) {
    foreach ($f in @(Get-ChildItem -LiteralPath $dir -Filter '*.lock' -File)) {
        $id = 0; [void][int]::TryParse($f.BaseName, [ref]$id)
        $p = if ($id) { Get-Process -Id $id -ErrorAction SilentlyContinue } else { $null }
        if (-not $p -or $p.ProcessName -ne 'claude' -or $f.LastWriteTime -lt (Get-Date).AddHours(-7)) {
            Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-BusyMsg([int]$claude, [string]$subDir, [datetime]$since, [datetime]$hook = (Get-Date)) {
    $sub = @(Get-RunningSubagents $subDir $since $hook)
    if ($sub.Count -gt 0) {
        $m = 'waiting: subagent ' + $sub[0]
        if ($sub.Count -gt 1) { $m += " (+$($sub.Count - 1))" }
        if ($m.Length -gt 80) { $m = $m.Substring(0, 77) + '...' }
        return $m
    }
    $procs = Get-Procs
    $sh = @(Get-BgShells $procs $claude (Get-Ancestors $procs $PID))
    if ($sh.Count -gt 0) { return (Get-WaitMsg $sh) }
    return ''
}

try {
    if ($DryRun) {
        $procs = Get-Procs
        $cp = $ClaudePid; if (-not $cp) { $cp = Get-ClaudePid $procs $PID }
        $sh = @(Get-BgShells $procs $cp (Get-Ancestors $procs $PID))
        "claude pid: $cp"
        foreach ($p in $sh) { "shell: $($p.ProcessId) $($p.Name)" }
        foreach ($d in @(Get-RunningSubagents $SubDir (Get-ClaudeStart $cp))) { "subagent: $d" }
        "msg: " + (Get-BusyMsg $cp $SubDir (Get-ClaudeStart $cp))
        return
    }

    $dir = Join-Path $env:TEMP 'herdr-wait-state'

    if (-not $Watch) {
        if (-not $env:HC_TERMINAL_ID) { exit 0 }
        $in = ''
        try { $in = [Console]::In.ReadToEnd() } catch {}
        $sub = ''
        try { $j = $in | ConvertFrom-Json; $sub = Get-SubDir ([string]$j.transcript_path) ([string]$j.session_id) } catch {}
        if (Test-Path -LiteralPath $dir) { Clear-StaleLocks $dir }
        $procs = Get-Procs
        $cp = Get-ClaudePid $procs $PID
        if (-not $cp) { exit 0 }
        $msg = Get-BusyMsg $cp $sub (Get-ClaudeStart $cp)
        if (-not $msg) { exit 0 }
        $args2 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Watch', '-ClaudePid', $cp, '-Terminal', $env:HC_TERMINAL_ID, '-HookTicks', (Get-Date).Ticks)
        if ($sub) { $args2 += @('-SubDir', "`"$sub`"") }
        [void](Start-Process powershell -ArgumentList $args2 -WindowStyle Hidden)
        exit 0
    }

    # ---- watcher ----
    # Re-checks background shells and subagents every 3 s, so work started after the turn ended still counts.
    # Leaves nothing behind: its lock is removed on every exit path, and it only resets a status it set itself.
    if (-not $ClaudePid -or -not $Terminal) { exit 0 }
    [void](New-Item -ItemType Directory -Force -Path $dir)
    $lock = Join-Path $dir "$ClaudePid.lock"
    $token = [guid]::NewGuid().ToString()
    Set-Content -Path $lock -Value $token -Encoding ASCII
    $mine = { ((Get-Content -Path $lock -ErrorAction SilentlyContinue) -join '').Trim() -eq $token }
    $since = Get-ClaudeStart $ClaudePid
    $hookT = if ($HookTicks) { [datetime]$HookTicks } else { Get-Date }
    $busy = { Get-BusyMsg $ClaudePid $SubDir $since $hookT }
    try {
        Start-Sleep -Milliseconds 1500
        if (-not (& $mine)) { return }
        $msg = & $busy
        if (-not $msg) { return }
        # Only replace a plain idle: never hide a blocked prompt or a new turn.
        $st0 = Get-HcStatus $Terminal
        if (-not $st0 -or ($st0.state -ne 'idle' -and $st0.state -ne 'done')) { return }
        Send-Status $ClaudePid 'working' $msg
        $start = Get-Date
        $quiet = 0
        while ($true) {
            Start-Sleep -Seconds 3
            if (-not (& $mine)) { break }
            if (-not (Test-Alive $ClaudePid)) { break }
            $now = & $busy
            if (((Get-Date) - $start).TotalHours -ge 6) { $now = '' }
            # Check right before any send, so a blocked prompt or new turn is never overwritten.
            $st = Get-HcStatus $Terminal
            if ($st -and ($st.msg -ne $msg -or $st.state -ne 'working')) { break }   # Claude took over
            if ($now) {
                $quiet = 0
                if ($now -ne $msg) { Send-Status $ClaudePid 'working' $now; $msg = $now }
                continue
            }
            # Two quiet rounds in a row before going idle, so a gap between tasks does not flicker.
            $quiet++
            if ($quiet -lt 2) { continue }
            $st = Get-HcStatus $Terminal
            if ($st -and $st.msg -eq $msg -and $st.state -eq 'working' -and (Test-Alive $ClaudePid)) { Send-Status $ClaudePid 'idle' '' }
            break
        }
    } finally {
        if (& $mine) { Remove-Item -Path $lock -Force -ErrorAction SilentlyContinue }
    }
} catch { }
exit 0
