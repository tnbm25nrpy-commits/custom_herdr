# Marks a todo card's agent state. Called by the agent as its very last step.
#   todo-status.ps1 -Card <id> -State <done|blocked|in_progress> [-Summary <text>]
# Merges into <appHome>/data/todo/status/<id>.json (the todo mod reads it and moves the card).
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Card,
  [Parameter(Mandatory = $true)][ValidateSet('done', 'blocked', 'in_progress')][string]$State,
  [string]$Summary = ''
)
$ErrorActionPreference = 'Stop'
if ($Card -notmatch '^[\w-]{1,64}$') { [Console]::Error.WriteLine("invalid card id '$Card'"); exit 2 }
$home_ = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $env:USERPROFILE '.config\herdr-app' }
$dir = Join-Path $home_ 'data\todo\status'
if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$file = Join-Path $dir "$Card.json"

$st = @{}
if (Test-Path -LiteralPath $file) {
  try {
    $old = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    foreach ($p in $old.PSObject.Properties) { $st[$p.Name] = $p.Value }
  } catch { $st = @{} }
}
$now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$st['card'] = $Card
$st['state'] = $State
if ($Summary.Length -gt 2000) { $Summary = $Summary.Substring(0, 2000) }
if ($Summary -ne '' -or -not $st.ContainsKey('summary')) { $st['summary'] = $Summary }
$st['updated'] = $now
if ($State -eq 'done') { $st['finished'] = $now }
if (-not $st['terminal'] -and $env:HC_TERMINAL_ID) { $st['terminal'] = $env:HC_TERMINAL_ID }

$json = $st | ConvertTo-Json -Depth 4
$tmp = "$file.tmp$PID"
[System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
Move-Item -LiteralPath $tmp -Destination $file -Force
Write-Output "todo card $Card -> $State"
