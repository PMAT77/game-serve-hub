$Base = 'http://127.0.0.1:9527'
$InstanceId = '3b7440ed-aa9d-46f0-b96b-0e4f2174604d'
$ErrorActionPreference = 'Stop'

$login = Invoke-RestMethod -Uri "$Base/app/account/login" -Method POST -ContentType 'application/json' -Body '{"account":"superman","password":"123456"}' -TimeoutSec 30
$token = $login.data.token
$headers = @{ token = $token; 'Content-Type' = 'application/json' }

Write-Host "Patch DB -> stopped for $InstanceId"
Push-Location (Join-Path $PSScriptRoot '..')
pnpm exec tsx scripts/patch-instance-status.ts stopped $InstanceId
Pop-Location

$start = Invoke-RestMethod -Uri "$Base/app/instance/start" -Method POST -Headers $headers -Body (@{ id = $InstanceId } | ConvertTo-Json) -TimeoutSec 120
Write-Host "Start status:" $start.status
if ($start.error) { Write-Host "Start error:" $start.error }

Push-Location (Join-Path $PSScriptRoot '..')
$rowJson = pnpm exec tsx scripts/patch-instance-status.ts read $InstanceId 2>&1 | Select-Object -Last 1
Pop-Location
Write-Host "DB after start:" $rowJson

if ($start.status -eq 1 -and $rowJson -match 'running') {
  Write-Host 'PASS #4'
  exit 0
}
Write-Host 'FAIL #4'
exit 1
