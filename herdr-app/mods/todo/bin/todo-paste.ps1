# Pastes the clipboard's image into a card's image dir. Prints the new file names, one per line.
#   powershell -NoProfile -STA -ExecutionPolicy Bypass -File todo-paste.ps1 -Dir <absolute images dir>
# Clipboard with copied image files (Explorer) -> files are copied in; with a bitmap (screenshot) -> saved as PNG.
# Nothing usable (text only, empty, other files) -> no output, exit 0.
param([Parameter(Mandatory = $true)][string]$Dir)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'todo-lib.ps1')
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$names = @()
try {
  if ([Windows.Forms.Clipboard]::ContainsFileDropList()) {
    $paths = @([Windows.Forms.Clipboard]::GetFileDropList() | ForEach-Object { [string]$_ })
    $has = $paths | Where-Object { $script:ImgExt -contains [System.IO.Path]::GetExtension($_).ToLowerInvariant() }
    if ($has) { Initialize-ImageDir $Dir; $names = Copy-ImageFiles $paths $Dir }
  }
  if (-not $names.Count -and [Windows.Forms.Clipboard]::ContainsImage()) {
    $img = [Windows.Forms.Clipboard]::GetImage()
    if ($img) {
      Initialize-ImageDir $Dir
      $name = New-ImageName '.png'
      try { $img.Save((Join-Path $Dir $name), [System.Drawing.Imaging.ImageFormat]::Png) } finally { $img.Dispose() }
      $names = @($name)
    }
  }
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
foreach ($n in $names) { [Console]::Out.WriteLine($n) }
exit 0
