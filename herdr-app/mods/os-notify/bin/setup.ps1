# Idempotent, HKCU only.
$ErrorActionPreference = "Stop"
$mod = Split-Path -Parent $PSScriptRoot
$png = Join-Path $mod "herdr.png"
Add-Type -AssemblyName System.Drawing
$exe = "C:\Users\me\AppData\Local\Programs\herdr-app\herdr-app.exe"
$ico = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
$bmp = $ico.ToBitmap(); $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
$k = "HKCU:\Software\Classes\AppUserModelId\Herdr.Notify"
New-Item -Path $k -Force | Out-Null
Set-ItemProperty $k -Name DisplayName -Value "Herdr"
Set-ItemProperty $k -Name IconUri -Value $png
Set-ItemProperty $k -Name ShowInSettings -Value 1 -Type DWord
$p = "HKCU:\Software\Classes\herdr-notify"
New-Item -Path "$p\shell\open\command" -Force | Out-Null
Set-ItemProperty $p -Name "(default)" -Value "URL:Herdr Notify"
Set-ItemProperty $p -Name "URL Protocol" -Value ""
$act = Join-Path $PSScriptRoot "activate.ps1"
$cmd = 'conhost.exe --headless powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $act + '" "%1"'
Set-ItemProperty "$p\shell\open\command" -Name "(default)" -Value $cmd
"ok"
