# Installs the herdr customizations from this repo on this PC (repo -> live).
# Prereqs: herdr-app installed and started once (creates ~/.config/herdr-app), Claude Code, Node.js, Git for Windows.
#   powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 [-DryRun] [-NoClaude] [-NoTools] [-Notifications]
# Existing files that differ are backed up next to the original as <file>.bak-install-<timestamp>.
param(
    [switch]$DryRun,
    [switch]$NoClaude,       # skip ~/.claude parts (Show skill, hooks, worker scripts, agents, quota-bar)
    [switch]$NoTools,        # skip ~/theme-tools and ~/omarchy-tools
    [switch]$Notifications,  # also run mods/os-notify/bin/setup.ps1 (writes 2 HKCU registry keys for native toasts)
    [string]$HomeDir = $HOME # install into another home (testing); paths inside files are rewritten to it
)
$TargetHome = [IO.Path]::GetFullPath($HomeDir).TrimEnd([char]92)
$ErrorActionPreference = 'Stop'
$Repo = $PSScriptRoot
. (Join-Path $Repo 'manifest.ps1')
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Test-Path (Join-Path $TargetHome '.config\herdr-app'))) {
    Write-Warning "~/.config/herdr-app does not exist. Install herdr-app and start it once first."
    exit 1
}

$areas = @('herdr-app')
if (-not $NoClaude) { $areas += 'claude' }
if (-not $NoTools)  { $areas += 'home' }

$changed = 0
foreach ($area in $areas) {
    $src = Join-Path $Repo $area
    $live = $Roots[$area]
    foreach ($rel in (Get-TrackedFiles $src $area)) {
        $dst = Join-Path $live $rel
        if ($DryRun) { Write-Host "install  $area\$rel"; continue }
        $tmp = "$dst.herdr-install-tmp"
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
        $null = Copy-WithHome (Join-Path $src $rel) $tmp $CanonicalHome $TargetHome
        $same = (Test-Path -LiteralPath $dst) -and
            ([Convert]::ToBase64String([IO.File]::ReadAllBytes($tmp)) -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes($dst)))
        if ($same) { Remove-Item -LiteralPath $tmp -Force; continue }
        if (Test-Path -LiteralPath $dst) { Copy-Item -LiteralPath $dst "$dst.bak-install-$stamp" -Force }
        Move-Item -LiteralPath $tmp $dst -Force
        $changed++
        Write-Host "installed  $area\$rel"
    }
}
Write-Host "$changed file(s) installed/updated."
if ($DryRun) { exit 0 }

if (-not $NoClaude) {
    $settings = Join-Path $TargetHome '.claude\settings.json'
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        & node (Join-Path $Repo 'tools\merge-claude-settings.mjs') (Join-Path $Repo 'claude-settings.herdr.json') $settings $TargetHome
    } else {
        Write-Warning "node not found: merge claude-settings.herdr.json into $settings by hand (see README)."
    }
    $md = Join-Path $TargetHome '.claude\CLAUDE.md'
    $snippet = [IO.File]::ReadAllText((Join-Path $Repo 'claude-CLAUDE.herdr.md'))
    $cur = if (Test-Path $md) { [IO.File]::ReadAllText($md) } else { "# Global defaults (all projects)`r`n`r`n" }
    if ($cur -notmatch 'herdr-setup' -and $cur -notmatch 'show-image\.ps1') {
        [IO.File]::WriteAllText($md, $cur.TrimEnd() + "`r`n`r`n" + $snippet, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "appended herdr rules to $md"
    }
}

if ($Notifications) {
    Write-Host "running os-notify setup (HKCU registry keys for native Windows toasts)..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $HOME '.config\herdr-app\mods\os-notify\bin\setup.ps1')
}

if ($TargetHome -ne $HOME) { Write-Host "test install into $TargetHome done (layout switch skipped)."; exit 0 }

# Activate the custom layout in the running app (herdr-app hot-reloads mods/layouts).
$app = Join-Path $env:LOCALAPPDATA 'Programs\herdr-app\herdr-app.exe'
if (Test-Path $app) {
    & { $ErrorActionPreference = 'Continue'; & $app do 'layout.switch:main-dynamic-tabs' 2>$null | Out-Null }
    Write-Host "asked herdr-app to switch to layout main-dynamic-tabs (if it was running)."
}
Write-Host "Done. If the layout did not switch: Ctrl+Shift+L in herdr-app -> main-dynamic-tabs."
