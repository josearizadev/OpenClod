# Iconos de Bitácora a partir del logo fuente (build/logo-fuente.png, PNG cuadrado grande con transparencia).
# Uso: powershell -ExecutionPolicy Bypass -File scripts/generar-icono.ps1
# build/: icon.png (512, instalador y macOS) e icon.ico (7 tamaños, Windows).
# resources/: icon.png (ventana en desarrollo, Linux y «Acerca de») y tray.png / tray@2x.png (bandeja).
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$src = [System.Drawing.Image]::FromFile("$root\build\logo-fuente.png")

function Render([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  # El lado mayor manda; si la fuente no es exactamente cuadrada, se centra.
  $scale = $size / [Math]::Max($src.Width, $src.Height)
  $w = $src.Width * $scale; $h = $src.Height * $scale
  $attrs = New-Object System.Drawing.Imaging.ImageAttributes
  $attrs.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $dest = New-Object System.Drawing.Rectangle ([int](($size - $w) / 2)), ([int](($size - $h) / 2)), ([int]$w), ([int]$h)
  $g.DrawImage($src, $dest, 0, 0, $src.Width, $src.Height, [System.Drawing.GraphicsUnit]::Pixel, $attrs)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return ,$ms.ToArray()
}

function Ico([int[]]$sizes) {
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $ms
  $blobs = $sizes | ForEach-Object { ,(Render $_) }
  $bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $bw.Write([byte]$s); $bw.Write([byte]$s); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([uint16]1); $bw.Write([uint16]32)
    $bw.Write([uint32]$blobs[$i].Length); $bw.Write([uint32]$offset)
    $offset += $blobs[$i].Length
  }
  foreach ($b in $blobs) { $bw.Write($b) }
  $bw.Flush()
  return ,$ms.ToArray()
}

$big = Render 512
[System.IO.File]::WriteAllBytes("$root\build\icon.png", $big)
[System.IO.File]::WriteAllBytes("$root\build\icon.ico", (Ico @(256, 128, 64, 48, 32, 24, 16)))
[System.IO.File]::WriteAllBytes("$root\resources\icon.png", $big)
[System.IO.File]::WriteAllBytes("$root\resources\tray.png", (Render 16))
[System.IO.File]::WriteAllBytes("$root\resources\tray@2x.png", (Render 32))
$src.Dispose()
