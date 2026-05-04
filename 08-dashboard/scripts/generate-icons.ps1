# Generate PWA icons (192 + 512) for DevNeural Hub.
# Pure System.Drawing so no external deps. Dark panel + violet halo +
# inner brand circle + DN wordmark, masked to the inner safe zone so
# `purpose: "any maskable"` rendering doesn't crop the content.

[CmdletBinding()]
param(
    [string]$OutDir = 'c:/dev/Projects/DevNeural/08-dashboard/public/icons'
)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}

function New-Icon {
    param([int]$Size, [string]$Path)

    $bmp = [System.Drawing.Bitmap]::new($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Dark panel background.
    $bg = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 10, 12, 16))
    $g.FillRectangle($bg, 0, 0, $Size, $Size)

    $cx = $Size / 2.0
    $cy = $Size / 2.0
    $center = [System.Drawing.PointF]::new($cx, $cy)

    # Violet halo behind the brand mark.
    $haloR = $Size * 0.42
    $haloPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $haloPath.AddEllipse(($cx - $haloR), ($cy - $haloR), ($haloR * 2), ($haloR * 2))
    $halo = [System.Drawing.Drawing2D.PathGradientBrush]::new($haloPath)
    $halo.CenterPoint = $center
    $halo.CenterColor = [System.Drawing.Color]::FromArgb(160, 168, 116, 240)
    $halo.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 168, 116, 240))
    $g.FillEllipse($halo, ($cx - $haloR), ($cy - $haloR), ($haloR * 2), ($haloR * 2))

    # Inner brand circle.
    $innerR = $Size * 0.28
    $innerPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $innerPath.AddEllipse(($cx - $innerR), ($cy - $innerR), ($innerR * 2), ($innerR * 2))
    $innerBrush = [System.Drawing.Drawing2D.PathGradientBrush]::new($innerPath)
    $innerBrush.CenterPoint = $center
    $innerBrush.CenterColor = [System.Drawing.Color]::FromArgb(255, 198, 152, 255)
    $innerBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(255, 120, 80, 220))
    $g.FillEllipse($innerBrush, ($cx - $innerR), ($cy - $innerR), ($innerR * 2), ($innerR * 2))

    # Soft white ring.
    $penWidth = [single]($Size * 0.012)
    $ringPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(220, 230, 210, 255), $penWidth)
    $g.DrawEllipse($ringPen, ($cx - $innerR), ($cy - $innerR), ($innerR * 2), ($innerR * 2))

    # DN wordmark, contrasting on the violet circle.
    $fontSize = [single]($Size * 0.22)
    $font = [System.Drawing.Font]::new('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 14, 16, 24))
    $sf = [System.Drawing.StringFormat]::new()
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = [System.Drawing.RectangleF]::new(0, 0, $Size, $Size)
    $g.DrawString('DN', $font, $textBrush, $rect, $sf)

    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose()
    $bmp.Dispose()
    $bg.Dispose()
    $halo.Dispose()
    $innerBrush.Dispose()
    $ringPen.Dispose()
    $font.Dispose()
    $textBrush.Dispose()
    $sf.Dispose()
    $haloPath.Dispose()
    $innerPath.Dispose()
}

$out192 = Join-Path $OutDir 'icon-192.png'
$out512 = Join-Path $OutDir 'icon-512.png'

New-Icon -Size 192 -Path $out192
New-Icon -Size 512 -Path $out512

Write-Host "Wrote $out192"
Write-Host "Wrote $out512"
