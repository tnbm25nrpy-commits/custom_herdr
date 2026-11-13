# Opens a file picker (multi-select, images) and copies the chosen files into a card's image dir.
# Prints the new file names, one per line; cancel -> no output, exit 0.
#   powershell -NoProfile -STA -ExecutionPolicy Bypass -File todo-pick.ps1 -Dir <absolute images dir>
param([Parameter(Mandatory = $true)][string]$Dir)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'todo-lib.ps1')
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$names = @()
try {
  $owner = New-Object Windows.Forms.Form
  $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.StartPosition = 'CenterScreen'; $owner.Opacity = 0
  $owner.Size = New-Object System.Drawing.Size(1, 1)
  $owner.Show(); $owner.Activate()
  $dlg = New-Object Windows.Forms.OpenFileDialog
  $dlg.Title = 'Add photos to the card'
  $dlg.Multiselect = $true
  $dlg.CheckFileExists = $true
  $dlg.Filter = 'Images (*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp)|*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp|All files (*.*)|*.*'
  $res = $dlg.ShowDialog($owner)
  $owner.Close()
  if ($res -eq [Windows.Forms.DialogResult]::OK -and $dlg.FileNames.Count) {
    Initialize-ImageDir $Dir
    $names = Copy-ImageFiles @($dlg.FileNames) $Dir
  }
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
foreach ($n in $names) { [Console]::Out.WriteLine($n) }
exit 0
