# Draw an image in the current terminal using the Kitty graphics protocol.
# Works in herdr-app terminals (and Kitty/Ghostty/WezTerm-with-new-ConPTY).
param([Parameter(Mandatory)][string]$Path, [int]$Cols = 0)
$full = (Resolve-Path -LiteralPath $Path).Path
if ([IO.Path]::GetExtension($full).ToLower() -ne '.png') {
  # Kitty f=100 needs PNG: convert anything else via ffmpeg
  $tmp = Join-Path $env:TEMP ("kitty-show-" + [guid]::NewGuid().ToString('N') + ".png")
  ffmpeg -hide_banner -loglevel error -y -i $full -frames:v 1 $tmp
  if (-not (Test-Path $tmp)) { Write-Error "could not convert $full to PNG"; exit 1 }
  $full = $tmp
}
if ($Cols -le 0) { $Cols = [Math]::Max(10, $Host.UI.RawUI.WindowSize.Width - 2) }
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($full))
$esc = [char]27
$out = [Console]::OpenStandardOutput()
$enc = [Text.Encoding]::ASCII
for ($i = 0; $i -lt $b64.Length; $i += 4096) {
  $chunk = $b64.Substring($i, [Math]::Min(4096, $b64.Length - $i))
  $more = if ($i + 4096 -lt $b64.Length) { 1 } else { 0 }
  $hdr = if ($i -eq 0) { "f=100,a=T,q=2,c=$Cols,m=$more" } else { "m=$more" }
  $bytes = $enc.GetBytes("${esc}_G${hdr};${chunk}${esc}\")
  $out.Write($bytes, 0, $bytes.Length)
}
$out.Flush()
Write-Host ""
if ($tmp) { Remove-Item $tmp -ErrorAction SilentlyContinue }
