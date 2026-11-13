# Show an image to the user in herdr-app's "Show" panel (right side, next to the session).
# The user can mark it up there and send it back into this agent's prompt as [Image #n].
# Usage: show-image.ps1 <path> [-Title "what this shows"] [-Group "topic"]
# -Group: short section name in the panel; reuse the exact same string for related images.
# The panel is the herdr-app mod ~/.config/herdr-app/mods/show (see Desktop\herdr\HERDR-NOTES.md).
param([Parameter(Mandatory)][string]$Path, [string]$Title = "", [string]$Group = "")
$ErrorActionPreference = 'Stop'
$app = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME ".config\herdr-app" }
$add = Join-Path $app "mods\show\bin\show-add.ps1"
if (-not (Test-Path $add)) { Write-Error "Show panel mod not installed ($add)"; exit 1 }
if (-not $env:HC_TERMINAL_ID) { Write-Error "not inside a herdr-app terminal: tell the user the path instead: $Path"; exit 1 }
$json = & $add -Path $Path -Title $Title -Group $Group -Terminal $env:HC_TERMINAL_ID
$item = $json | ConvertFrom-Json
Write-Output "shown in herdr Show panel: $($item.name) ($($item.w)x$($item.h))"
