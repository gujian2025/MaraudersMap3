# Estimate main/sub package sizes according to packOptions.ignore
$root = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Definition) '..\MaraudersMap'
$root = [System.IO.Path]::GetFullPath($root)

$ignored = @('scripts\', 'pages\cover\MonAmourFraktur-Broken.woff', 'pages\cover\MonAmourFraktur-Broken.woff2', 'README.md', '.eslintrc.js')

function Get-Size($dir) {
  $sum = 0
  Get-ChildItem -Path $dir -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1)
    $skip = $false
    foreach ($p in $ignored) { if ($rel.StartsWith($p, [StringComparison]::OrdinalIgnoreCase)) { $skip = $true } }
    if (-not $skip) { $sum += $_.Length }
  }
  return $sum
}

$total = Get-Size $root
$memo = Get-Size (Join-Path $root 'packageMemo')
$main = $total - $memo

'ALL (packed)      : {0,8:N1} KB' -f ($total / 1KB)
'MAIN PACKAGE      : {0,8:N1} KB  (limit 2048 KB)' -f ($main / 1KB)
'SUB packageMemo   : {0,8:N1} KB' -f ($memo / 1KB)
if ($main -lt 2097152) { 'RESULT: main package OK' } else { 'RESULT: main package STILL TOO LARGE' }
