# Copies image files into a card's image dir (used for files dropped on the board). Prints the new names, one per line.
#   powershell -NoProfile -ExecutionPolicy Bypass -File todo-copy.ps1 -Dir <absolute images dir> <file> [<file> ...]
# Non-image files and unreadable paths are skipped; nothing usable -> no output, exit 0.
param([Parameter(Mandatory = $true)][string]$Dir, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Paths)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'todo-lib.ps1')
$names = @()
try {
  $has = @($Paths | Where-Object { $_ -and ($script:ImgExt -contains [System.IO.Path]::GetExtension($_).ToLowerInvariant()) })
  if ($has.Count) { Initialize-ImageDir $Dir; $names = Copy-ImageFiles $has $Dir }
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
foreach ($n in $names) { [Console]::Out.WriteLine($n) }
exit 0
