# 把不透明的背景图转为 JPEG（Node 无法直接编码 JPEG，这里用 System.Drawing）
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$dir = Join-Path (Split-Path -Parent $root) 'MaraudersMap\assets\images'
$src = Join-Path $dir 'bg-background-sky.png'
$dst = Join-Path $dir 'bg-background-sky.jpg'
$backup = Join-Path $root 'backup'
if (-not (Test-Path $backup)) { New-Item -ItemType Directory -Path $backup | Out-Null }
if (-not (Test-Path (Join-Path $backup 'bg-background-sky.png'))) {
  Copy-Item $src (Join-Path $backup 'bg-background-sky.png')
}

$img = [System.Drawing.Image]::FromFile($src)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 82)
$img.Save($dst, $codec, $params)
$img.Dispose()

'{0} -> {1}' -f (Get-Item $src).Length, (Get-Item $dst).Length
'PNG {0}KB  JPEG {1}KB' -f [math]::Round((Get-Item $src).Length / 1KB, 1), [math]::Round((Get-Item $dst).Length / 1KB, 1)
