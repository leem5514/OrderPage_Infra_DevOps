[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('deployment','ci-cd','resources','alerts')][string]$Scenario,
    [Parameter(Mandatory)][ValidateSet('baseline','after')][string]$Variant,
    [Parameter(Mandatory)][ValidateRange(1,5)][int]$RunNumber,
    [Parameter(Mandatory)][string]$BaseUrl,
    [Parameter(Mandatory)][ValidatePattern('^sha256:[a-f0-9]{64}$')][string]$ImageDigest,
    [ValidateRange(1,20)][int]$Rate = 2,
    [ValidatePattern('^([1-9]|[12][0-9]|30)m$')][string]$Duration = '15m',
    [string]$ExpectedHost = 'api-devops.auctionbid.shop',
    [string]$K6Path
)
$ErrorActionPreference = 'Stop'
$uri = [uri]$BaseUrl
if ($uri.Scheme -ne 'https' -or $uri.Host -ne $ExpectedHost -or $uri.UserInfo -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment) {
    throw 'BASE_URL은 승인한 HTTPS API origin과 정확히 일치해야 합니다.'
}
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $K6Path) {
    $installed = Get-Command k6 -ErrorAction SilentlyContinue
    if ($installed) { $K6Path = $installed.Source }
    else {
        $toolsRoot = Join-Path (Resolve-Path (Join-Path $repoRoot '..\..')).Path '.local-tools\k6'
        $portable = Get-ChildItem -LiteralPath $toolsRoot -Recurse -Filter k6.exe -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($portable) { $K6Path = $portable.FullName }
    }
}
if (-not $K6Path -or -not (Test-Path -LiteralPath $K6Path)) { throw 'k6 실행 파일이 필요합니다.' }
$gitCommit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Infra Git commit을 확인할 수 없습니다.' }
$startedAt = (Get-Date).ToUniversalTime().ToString('o')
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$resultsRoot = Join-Path $repoRoot ".local\experiments\$Scenario\$Variant"
New-Item -ItemType Directory -Force -Path $resultsRoot | Out-Null
$resultDir = Join-Path $resultsRoot "run-$RunNumber-$stamp"
New-Item -ItemType Directory -Path $resultDir -ErrorAction Stop | Out-Null
$summaryPath = Join-Path $resultDir 'k6-summary.json'
$rawPath = Join-Path $resultDir 'k6-samples.json'
& $K6Path run --summary-export $summaryPath --out "json=$rawPath" `
    -e "BASE_URL=$($uri.GetLeftPart('Authority'))" -e "SCENARIO_ID=$Scenario" -e "VARIANT=$Variant" `
    -e "K6_RATE=$Rate" -e "K6_DURATION=$Duration" `
    (Join-Path $PSScriptRoot 'scenarios\api-availability.js')
$k6ExitCode = $LASTEXITCODE
@{
    scenario=$Scenario; variant=$Variant; runNumber=$RunNumber; baseUrl=$uri.GetLeftPart('Authority')
    imageDigest=$ImageDigest; infraCommit=$gitCommit; targetRps=$Rate; duration=$Duration
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o'); k6ExitCode=$k6ExitCode
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $resultDir 'metadata.json') -Encoding utf8
Write-Output "k6 원본 경로: $resultDir"
if ($k6ExitCode -ne 0) { throw "k6 실행 실패(exit=$k6ExitCode). 원본 경로를 확인하세요." }
