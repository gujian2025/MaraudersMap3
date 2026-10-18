$root = 'd:\MaraudersMap\MaraudersMap'
$ignored = @('scripts\', 'pages\cover\MonAmourFraktur-Broken.woff', 'pages\cover\MonAmourFraktur-Broken.woff2')
$files = Get-ChildItem -Path $root -Recurse -File | Where-Object { $_.FullName -notmatch '\\\.git\\' }
$kept = @(); $skip = @()
foreach ($f in $files) {
  $rel = $f.FullName.Substring($root.Length + 1)
  $isIgnored = $false
  foreach ($ig in $ignored) { if ($rel -like ($ig + '*')) { $isIgnored = $true } }
  if ($isIgnored) { $skip += $rel } else { $kept += $f }
}
Write-Output '===== PACKAGED (top 12) ====='
$kept | Sort-Object Length -Descending | Select-Object -First 12 | ForEach-Object {
  Write-Output ('{0,9:N1} KB  {1}' -f ($_.Length / 1KB), $_.FullName.Substring($root.Length + 1))
}
$sum = ($kept | Measure-Object Length -Sum).Sum
$limit = 2MB
Write-Output ''
Write-Output ('PACKAGED TOTAL : {0:N1} KB  ({1:N2} MB)' -f ($sum / 1KB), ($sum / 1MB))
Write-Output ('LIMIT          : 2048.0 KB  (2.00 MB)')
Write-Output ('REMAINING      : {0:N1} KB' -f (($limit - $sum) / 1KB))
Write-Output ''
Write-Output ('EXCLUDED (' + $skip.Count + ' files):')
$skip | ForEach-Object { Write-Output ('  ' + $_) }
