# Shared by todo-paste.ps1 and todo-pick.ps1 (dot-sourced). Copies image files into a card's image dir.
$script:ImgExt = @('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp')
$script:MaxImages = 20
$script:MaxBytes = 50MB

function New-ImageName([string]$ext) {
  $ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $rand = -join ((1..5) | ForEach-Object { 'abcdefghijklmnopqrstuvwxyz0123456789'[(Get-Random -Maximum 36)] })
  return "$ms-$rand$ext"
}

function Initialize-ImageDir([string]$dir) {
  if (-not [System.IO.Path]::IsPathRooted($dir)) { throw "Dir must be absolute" }
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}

# Copies image-extension files; returns the new names (lower-case extension, <timestamp>-<rand>.<ext>).
function Copy-ImageFiles([string[]]$paths, [string]$dir) {
  $names = @()
  foreach ($p in $paths) {
    if ($names.Count -ge $script:MaxImages) { break }
    try {
      if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { continue }
      $ext = [System.IO.Path]::GetExtension($p).ToLowerInvariant()
      if ($script:ImgExt -notcontains $ext) { continue }
      if ((Get-Item -LiteralPath $p).Length -gt $script:MaxBytes) { continue }
      $name = New-ImageName $ext
      Copy-Item -LiteralPath $p -Destination (Join-Path $dir $name) -Force
      $names += $name
    } catch { }
  }
  return $names
}
