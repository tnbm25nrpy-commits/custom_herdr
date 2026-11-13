# Adds an image to the herdr-app "Show" panel inbox and reveals the panel.
# Usage: show-add.ps1 <path> [-Title ".."] [-Group ".."] [-Terminal t6] [-MarkedFrom <id>] [-NoReveal]
# -Group names the panel section the image goes into (a marked copy inherits its original's group).
# Writes <inbox>\<id>__<name> plus a sidecar <inbox>\<id>.json (the panel only reads sidecars,
# so the image is always complete before it appears).
param(
  [Parameter(Mandatory)][string]$Path,
  [string]$Title = "",
  [string]$Terminal = $env:HC_TERMINAL_ID,
  [string]$MarkedFrom = "",
  [string]$Group = "",
  [switch]$NoReveal
)
$ErrorActionPreference = 'Stop'
$app = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME ".config\herdr-app" }
$inbox = Join-Path $app "show\inbox"
New-Item -ItemType Directory -Force $inbox | Out-Null

$src = (Resolve-Path -LiteralPath $Path).Path
$name = Split-Path $src -Leaf
$ext = [IO.Path]::GetExtension($src).ToLower()
$id = (Get-Date -Format "yyyyMMdd-HHmmss-fff") + "-" + (Get-Random -Maximum 9999).ToString("0000")
$safe = ($name -replace '[^\w\.\-]', '_')

# GPUI loads png/jpg/gif/webp/bmp; anything else becomes PNG via ffmpeg
if ($ext -in '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp') {
  $destName = "${id}__$safe"
  Copy-Item -LiteralPath $src (Join-Path $inbox $destName)
} else {
  $destName = "${id}__" + [IO.Path]::GetFileNameWithoutExtension($safe) + ".png"
  & ffmpeg -hide_banner -loglevel error -y -i $src -frames:v 1 (Join-Path $inbox $destName)
  if (-not (Test-Path (Join-Path $inbox $destName))) { throw "could not convert $src" }
}
$dest = Join-Path $inbox $destName

# Pixel size (System.Drawing can't read webp: fall back to ffprobe)
$w = 0; $h = 0
try {
  Add-Type -AssemblyName System.Drawing
  $img = [Drawing.Image]::FromFile($dest); $w = $img.Width; $h = $img.Height; $img.Dispose()
} catch {
  $wh = & ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 $dest
  if ($wh -match '^(\d+),(\d+)') { $w = [int]$Matches[1]; $h = [int]$Matches[2] }
}

# Which herdr tab/space the sending agent lives in (labels the panel's tab sections)
# Herdr worker panes / subagents (hc "parent" set, no herdr.tab label) close when done, so the
# image is attributed to the owning session: walk the parent chain up to the tabbed terminal.
$tab = $null; $space = $null; $sender = $Terminal
if ($Terminal) {
  $cur = $Terminal
  for ($i = 0; $i -lt 8 -and $cur; $i++) {
    try { $info = (& hc get $cur --json 2>$null | Out-String | ConvertFrom-Json) } catch { break }
    if (-not $info.address) { break }
    $Terminal = $info.address
    $tab = $info.labels.'herdr.tab'; $space = $info.labels.'herdr.space'
    if ($tab -or -not $info.parent) { break }
    $cur = $info.parent
  }
}

$Group = $Group.Trim()
if (-not $Group -and $MarkedFrom) {
  $orig = Join-Path $inbox "$MarkedFrom.json"
  if (Test-Path -LiteralPath $orig) {
    try { $g = (Get-Content -LiteralPath $orig -Raw -Encoding UTF8 | ConvertFrom-Json).group; if ($g) { $Group = "$g" } } catch { }
  }
}

$meta = [ordered]@{
  id = $id; file = "show/inbox/$destName"; abs = $dest; name = $name
  title = $(if ($Title) { $Title } else { $name })
  time = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  w = $w; h = $h; terminal = $Terminal; sender = $sender; tab = $tab; space = $space
  source = $src; marked_from = $(if ($MarkedFrom) { $MarkedFrom } else { $null })
  group = $(if ($Group) { $Group } else { $null })
}
$json = $meta | ConvertTo-Json -Compress
$tmp = Join-Path $inbox "$id.json.tmp"
[IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding $false))
Move-Item -LiteralPath $tmp (Join-Path $inbox "$id.json") -Force

if (-not $NoReveal) {
  & herdr-app do layout.select --stack panel-body --child show *> $null
  & herdr-app do layout.show --id panel *> $null
}
Write-Output $json
