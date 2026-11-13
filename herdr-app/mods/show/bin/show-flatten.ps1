# Burns annotations into an image. Called by the Show mod's editor.
# Usage: show-flatten.ps1 -In <image> -Shapes <shapes.json> -Out <png>
# Shapes are in image pixels:
#   {type:"pen",     color, width, points:[[x,y],...]}
#   {type:"arrow"|"rect"|"ellipse", color, width, from:[x,y], to:[x,y]}
#   {type:"text",    color, size, at:[x,y], text}
#   {type:"badge",   color, size, at:[x,y], n}
param([Parameter(Mandatory)][string]$In, [Parameter(Mandatory)][string]$Shapes, [Parameter(Mandatory)][string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = $In
if ([IO.Path]::GetExtension($In).ToLower() -eq '.webp') {
  $src = Join-Path $env:TEMP ("show-flat-" + [guid]::NewGuid().ToString('N') + ".png")
  & ffmpeg -hide_banner -loglevel error -y -i $In $src
}
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
$orig = [Drawing.Image]::FromFile($src)
$bmp = New-Object Drawing.Bitmap $orig.Width, $orig.Height, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$g.DrawImage($orig, 0, 0, $orig.Width, $orig.Height)
$orig.Dispose()

function Col([string]$hex) { [Drawing.ColorTranslator]::FromHtml($hex) }
function MkPen($s) {
  $p = New-Object Drawing.Pen (Col $s.color), ([float]$s.width)
  $p.StartCap = 'Round'; $p.EndCap = 'Round'; $p.LineJoin = 'Round'; $p
}

$list = Get-Content -Raw -LiteralPath $Shapes | ConvertFrom-Json
foreach ($s in $list) {
  switch ($s.type) {
    'pen' {
      $pts = [Drawing.PointF[]]@($s.points | ForEach-Object { New-Object Drawing.PointF ([float]$_[0]), ([float]$_[1]) })
      if ($pts.Count -ge 2) { $p = MkPen $s; $g.DrawLines($p, $pts); $p.Dispose() }
    }
    'arrow' {
      $p = MkPen $s
      $x1 = [float]$s.from[0]; $y1 = [float]$s.from[1]; $x2 = [float]$s.to[0]; $y2 = [float]$s.to[1]
      $g.DrawLine($p, $x1, $y1, $x2, $y2)
      $ang = [Math]::Atan2($y2 - $y1, $x2 - $x1); $len = [Math]::Max(12, [float]$s.width * 4)
      foreach ($d in 0.5, -0.5) {
        $g.DrawLine($p, $x2, $y2, [float]($x2 - $len * [Math]::Cos($ang + $d)), [float]($y2 - $len * [Math]::Sin($ang + $d)))
      }
      $p.Dispose()
    }
    { $_ -in 'rect', 'ellipse' } {
      $p = MkPen $s
      $x = [Math]::Min([float]$s.from[0], [float]$s.to[0]); $y = [Math]::Min([float]$s.from[1], [float]$s.to[1])
      $w = [Math]::Abs([float]$s.to[0] - [float]$s.from[0]); $h = [Math]::Abs([float]$s.to[1] - [float]$s.from[1])
      if ($s.type -eq 'rect') { $g.DrawRectangle($p, [float]$x, [float]$y, [float]$w, [float]$h) } else { $g.DrawEllipse($p, [float]$x, [float]$y, [float]$w, [float]$h) }
      $p.Dispose()
    }
    'text' {
      $f = New-Object Drawing.Font 'Segoe UI Semibold', ([float]$s.size), ([Drawing.GraphicsUnit]::Pixel)
      $b = New-Object Drawing.SolidBrush (Col $s.color)
      $g.DrawString([string]$s.text, $f, $b, [float]$s.at[0], [float]$s.at[1])
      $f.Dispose(); $b.Dispose()
    }
    'badge' {
      $r = [float]$s.size / 2
      $b = New-Object Drawing.SolidBrush (Col $s.color)
      $g.FillEllipse($b, [float]($s.at[0] - $r), [float]($s.at[1] - $r), [float]($r * 2), [float]($r * 2))
      $f = New-Object Drawing.Font 'Segoe UI', ([float]($r * 1.1)), ([Drawing.FontStyle]::Bold), ([Drawing.GraphicsUnit]::Pixel)
      $fmt = New-Object Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
      $rect = New-Object Drawing.RectangleF ([float]($s.at[0] - $r)), ([float]($s.at[1] - $r)), ([float]($r * 2)), ([float]($r * 2))
      $g.DrawString([string]$s.n, $f, [Drawing.Brushes]::White, $rect, $fmt)
      $f.Dispose(); $b.Dispose()
    }
  }
}
$g.Dispose()
$bmp.Save($Out, [Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
if ($src -ne $In) { Remove-Item $src -ErrorAction SilentlyContinue }
Write-Output $Out
