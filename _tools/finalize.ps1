$img = 'd:\MaraudersMap\MaraudersMap\assets\images'
$backup = 'd:\MaraudersMap\_original-assets'
New-Item -ItemType Directory -Force -Path $backup | Out-Null

# 1) 背景图用压缩后的版本覆盖原文件
Move-Item -Force (Join-Path $img 'bg-page-star.jpg.tmp') (Join-Path $img 'bg-page-star.jpg')

# 2) 旧的大图移到项目外的备份目录（不再打进小程序包）
foreach ($n in @('parchment.jpg', 'inkbox.png', 'quill.png', 'table.png')) {
  $p = Join-Path $img $n
  if (Test-Path $p) { Move-Item -Force $p (Join-Path $backup $n) }
}

# 3) 清掉试压缩临时目录
$tmp = 'd:\MaraudersMap\MaraudersMap\.tmp-compress'
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }

Write-Output '===== assets/images NOW ====='
Get-ChildItem -Path $img -File | ForEach-Object {
  Write-Output ('{0,10:N1} KB  {1}' -f ($_.Length / 1KB), $_.Name)
}
Write-Output ''
Write-Output ('BACKUP -> ' + $backup)
Get-ChildItem -Path $backup -File | ForEach-Object {
  Write-Output ('{0,10:N1} KB  {1}' -f ($_.Length / 1KB), $_.Name)
}
