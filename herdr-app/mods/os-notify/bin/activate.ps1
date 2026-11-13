# UNTRUSTED input: herdr-notify:focus?t=<terminal>. Only a strict id is accepted.
param([string]$Uri = "")
$ErrorActionPreference = "SilentlyContinue"
if ($Uri -notmatch '^herdr-notify:(//)?focus\?(?:[^#]*&)?t=([A-Za-z0-9_-]{1,64})(?:&[^#]*)?/?$') { exit 0 }
$t = $Matches[2]
if ($t -notmatch '^[A-Za-z0-9_-]{1,64}$') { exit 0 }
$cli = (Get-Command herdr-app -ErrorAction SilentlyContinue).Source
if (-not $cli) { $cli = "C:\Users\me\AppData\Local\Programs\herdr-app\herdr-app.exe" }
# $t is validated: no quotes/spaces/metacharacters possible.
Start-Process -FilePath $cli -ArgumentList @("do", "agent.focus", "--terminal", $t) -WindowStyle Hidden -Wait
Add-Type -Namespace W -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
'@
$p = Get-Process herdr-app | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) {
  $h = $p.MainWindowHandle
  if ([W.U]::IsIconic($h)) { [void][W.U]::ShowWindow($h, 9) }
  [void][W.U]::SetForegroundWindow($h)
}
