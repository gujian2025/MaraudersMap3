$scripts = 'd:\MaraudersMap\MaraudersMap\scripts'
Get-ChildItem -Path $scripts -Filter 'tmp-*.ps1' -File | ForEach-Object {
  Remove-Item -Force $_.FullName
  Write-Output ('removed ' + $_.Name)
}
Write-Output ''
Write-Output '===== scripts/ NOW ====='
Get-ChildItem -Path $scripts -File | ForEach-Object { Write-Output ('  ' + $_.Name) }
