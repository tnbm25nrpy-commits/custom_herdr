# What this repo tracks. Dot-sourced by export.ps1 and install.ps1.
# Paths are relative to the live roots below and to the repo folders herdr-app/ and claude/.

$CanonicalHome = 'C:\Users\me'   # home dir as stored in the repo; install.ps1 rewrites it to the target $HOME

# $TargetHome: set by install.ps1 -HomeDir (for testing into a scratch folder); defaults to the real home.
if (-not $TargetHome) { $TargetHome = $HOME }
$Roots = @{
    'herdr-app' = Join-Path $TargetHome '.config\herdr-app'
    'claude'    = Join-Path $TargetHome '.claude'
    'home'      = $TargetHome
}

# Folders are mirrored (export removes files that are gone locally). Files are copied one by one.
$Tracked = @{
    'herdr-app' = @{
        Dirs  = @(
            'mods\ci-watch', 'mods\my-agents', 'mods\my-changes', 'mods\my-chrome', 'mods\my-files',
            'mods\my-pane', 'mods\my-spaces', 'mods\no-toast', 'mods\os-notify', 'mods\ring', 'mods\show',
            'mods\space-dedupe', 'mods\tabs-dynamic', 'mods\theme-switch', 'mods\todo', 'mods\agent-map',
            'themes', 'backgrounds'
        )
        Files = @('layouts\main-dynamic-tabs.json', 'keys.json', 'programs.json', 'settings.json')
    }
    'claude' = @{
        Dirs  = @('skills\show-image', 'skills\delegate', 'mods\quota-bar')
        Files = @(
            'scripts\show-image.ps1', 'scripts\kitty-show.ps1', 'scripts\herdr-worker.ps1',
            'scripts\trust-dir.mjs', 'scripts\sec-scan.sh',
            'hooks\show-enforce.mjs', 'hooks\herdr-wait-state.ps1',
            'hooks\agent-map.mjs', 'hooks\agent-map.test.mjs', 'hooks\LICENSE-lot-map.txt',
            'agents\explore-low.md', 'agents\explore-medium.md', 'agents\explore-high.md',
            'agents\impl-low.md', 'agents\impl-medium.md', 'agents\impl-high.md',
            'agents\reviewer.md', 'agents\reviewer-security.md'
        )
    }
    # wallpaper / theme generator tools (only needed to rebuild themes or wallpapers)
    'home' = @{
        Dirs  = @('theme-tools', 'omarchy-tools')
        Files = @()
    }
}

# Never tracked: backups, generated type files, editor/runtime junk.
$ExcludeFiles = @('*.bak', '*.bak-*', '*.bak.*', '*.d.ts', '*.orig', '*.tmp', '*.pyc', 'Thumbs.db', 'desktop.ini')
$ExcludeDirs  = @('node_modules', '.state', 'inbox', 'tmp', '__pycache__')

# Files whose text may contain the home path (rewritten on export/install).
$TextExt = @('.js', '.mjs', '.ts', '.tsx', '.json', '.ps1', '.psm1', '.sh', '.md', '.py', '.txt', '.svg')

function Test-Excluded([string]$rel) {
    $name = Split-Path $rel -Leaf
    foreach ($p in $ExcludeFiles) { if ($name -like $p) { return $true } }
    foreach ($d in ($rel -split '[\\/]' | Select-Object -SkipLast 1)) { if ($ExcludeDirs -contains $d) { return $true } }
    return $false
}

function Get-TrackedFiles([string]$base, [string]$area) {
    # Returns relative paths (backslashes) of tracked files that exist under $base.
    $spec = $Tracked[$area]
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($d in $spec.Dirs) {
        $abs = Join-Path $base $d
        if (-not (Test-Path -LiteralPath $abs -PathType Container)) { continue }
        Get-ChildItem -LiteralPath $abs -Recurse -File -Force | ForEach-Object {
            $rel = $_.FullName.Substring($base.TrimEnd('\').Length + 1)
            if (-not (Test-Excluded $rel)) { $out.Add($rel) }
        }
    }
    foreach ($f in $spec.Files) {
        if (Test-Path -LiteralPath (Join-Path $base $f) -PathType Leaf) { $out.Add($f) }
    }
    return $out
}

# Rewrites one home path to another in all common spellings (C:\x, C:\\x, C:/x).
function Convert-HomePath([string]$text, [string]$from, [string]$to) {
    if ($from -eq $to) { return $text }
    $fromB = $from.TrimEnd('\'); $toB = $to.TrimEnd('\')
    $pairs = @(
        @(($fromB -replace '\\', '\\'), ($toB -replace '\\', '\\')),  # JSON-escaped  C:\\Users\\x
        @($fromB, $toB),                                                # Windows       C:\Users\x
        @(($fromB -replace '\\', '/'), ($toB -replace '\\', '/'))       # forward       C:/Users/x
    )
    foreach ($p in $pairs) {
        # only whole path segments: next char must be a separator, quote or end
        $rx = [regex]::Escape($p[0]) + '(?=[\\/"''`\s]|$)'
        $text = [regex]::Replace($text, $rx, $p[1].Replace('$', '$$'), 'IgnoreCase')
    }
    return $text
}

# Copies $src to $dst, rewriting the home path in text files. Keeps BOM / line endings / bytes otherwise.
# Returns $true if $dst changed.
function Copy-WithHome([string]$src, [string]$dst, [string]$from, [string]$to) {
    $bytes = [IO.File]::ReadAllBytes($src)
    if ($TextExt -contains [IO.Path]::GetExtension($src).ToLower() -and $from -ne $to) {
        $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
        $enc = New-Object System.Text.UTF8Encoding($hasBom)
        $text = [Text.Encoding]::UTF8.GetString($bytes, ($(if ($hasBom) { 3 } else { 0 })), $bytes.Length - ($(if ($hasBom) { 3 } else { 0 })))
        $new = Convert-HomePath $text $from $to
        if ($new -ne $text) {
            $pre = $enc.GetPreamble()
            $body = $enc.GetBytes($new)
            $bytes = New-Object byte[] ($pre.Length + $body.Length)
            [Array]::Copy($pre, $bytes, $pre.Length); [Array]::Copy($body, 0, $bytes, $pre.Length, $body.Length)
        }
    }
    if (Test-Path -LiteralPath $dst -PathType Leaf) {
        $old = [IO.File]::ReadAllBytes($dst)
        if ($old.Length -eq $bytes.Length -and [Convert]::ToBase64String($old) -eq [Convert]::ToBase64String($bytes)) { return $false }
    }
    $dir = Split-Path $dst -Parent
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [IO.File]::WriteAllBytes($dst, $bytes)
    return $true
}
