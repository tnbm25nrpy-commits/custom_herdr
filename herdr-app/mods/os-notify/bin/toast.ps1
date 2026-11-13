param([string]$Title = "Herdr", [string]$Body = "", [string]$Terminal = "", [string]$Kind = "done")
$ErrorActionPreference = "Stop"
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$esc = { param($s) [System.Security.SecurityElement]::Escape([string]$s) }
$t = & $esc $Title; $b = & $esc $Body
$safeTerm = if ($Terminal -match '^[A-Za-z0-9_-]{1,64}$') { $Terminal } else { "" }
$launch = & $esc "herdr-notify:focus?t=$safeTerm"
$xml = @"
<toast launch="$launch" activationType="protocol"><visual><binding template="ToastGeneric"><text>$t</text><text>$b</text></binding></visual><audio silent="true"/></toast>
"@
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = New-Object Windows.UI.Notifications.ToastNotification $doc
if ($safeTerm) { $toast.Tag = $safeTerm; $toast.Group = "herdr" }
$n = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Herdr.Notify")
# Setting throws 0x80070490 until the AUMID is first used, so it is checked after Show.
$n.Show($toast)
$setting = try { [string]$n.Setting } catch { "unknown" }
if ($setting -notin @("Enabled", "unknown")) { Write-Error "toast setting: $setting" }
Write-Output "setting=$setting"
