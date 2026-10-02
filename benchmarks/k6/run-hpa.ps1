[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('fixed', 'hpa')]
    [string]$Variant,

    [Parameter(Mandatory = $true)]
    [ValidateSet(100, 300, 500)]
    [int]$Users,

    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 5)]
    [int]$RunNumber,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$BaseUrl,

    [string]$Warmup = '2m',
    [string]$Duration = '10m',
    [string]$Cooldown = '3m',
    [string]$ImageTag = 'unknown',
    [string]$K6Path,
    [switch]$SkipClusterSnapshot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$workspaceRoot = Split-Path -Parent $repoRoot
$scenarioPath = Join-Path $PSScriptRoot 'scenarios\hpa-product-list.js'
$variantName = if ($Variant -eq 'fixed') { 'before-fixed' } else { 'after-hpa' }
$date = Get-Date -Format 'yyyy-MM-dd'
$resultDir = Join-Path $repoRoot "benchmarks\results\S05\$date\$variantName\users-$Users\run-$RunNumber"

if ([string]::IsNullOrWhiteSpace($K6Path)) {
    $installedK6 = Get-Command k6 -ErrorAction SilentlyContinue
    if ($installedK6) {
        $K6Path = $installedK6.Source
    } else {
        $portableK6 = Get-ChildItem -LiteralPath (Join-Path $workspaceRoot '.local-tools\k6') -Filter 'k6.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($portableK6) {
            $K6Path = $portableK6.FullName
        }
    }
}

if ([string]::IsNullOrWhiteSpace($K6Path) -or -not (Test-Path -LiteralPath $K6Path)) {
    throw 'k6 executable was not found. Install k6 or pass -K6Path.'
}

New-Item -ItemType Directory -Force -Path $resultDir | Out-Null

$gitCommit = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to resolve the Infra repository Git commit.'
}

$metadata = [ordered]@{
    scenario_id   = 'S05'
    variant       = $variantName
    users         = $Users
    run_number    = $RunNumber
    base_url      = $BaseUrl.TrimEnd('/')
    git_commit    = $gitCommit
    image_tag     = $ImageTag
    aws_region    = 'ap-northeast-2'
    warmup        = $Warmup
    duration      = $Duration
    cooldown      = $Cooldown
    started_at    = (Get-Date).ToString('o')
    k6_version    = (& $K6Path version | Select-Object -First 1)
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $resultDir 'metadata.json') -Encoding utf8

if (-not $SkipClusterSnapshot) {
    $clusterSnapshot = & kubectl get deployment,hpa,pods -n orderpage -o wide 2>&1
    $clusterSnapshot | Set-Content -LiteralPath (Join-Path $resultDir 'cluster-before.txt') -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to capture Kubernetes state. Use -SkipClusterSnapshot only for local script checks.'
    }

    $hpa = & kubectl get hpa orderpage-backend -n orderpage --ignore-not-found -o name
    if ($Variant -eq 'fixed' -and $hpa) {
        throw 'fixed variant requires the orderpage-backend HPA to be absent.'
    }
    if ($Variant -eq 'hpa' -and -not $hpa) {
        throw 'hpa variant requires the orderpage-backend HPA to exist.'
    }
}

$summaryPath = Join-Path $resultDir 'summary.json'
& $K6Path run `
    --summary-export $summaryPath `
    --summary-time-unit ms `
    --tag "scenario_id=S05" `
    --tag "variant=$variantName" `
    --tag "run_number=$RunNumber" `
    -e "BASE_URL=$($BaseUrl.TrimEnd('/'))" `
    -e "K6_VARIANT=$variantName" `
    -e "K6_USERS=$Users" `
    -e "K6_WARMUP=$Warmup" `
    -e "K6_DURATION=$Duration" `
    -e "K6_COOLDOWN=$Cooldown" `
    -e "GIT_COMMIT=$gitCommit" `
    -e "IMAGE_TAG=$ImageTag" `
    $scenarioPath

if ($LASTEXITCODE -ne 0) {
    throw "k6 test failed. Review the result directory: $resultDir"
}

if (-not $SkipClusterSnapshot) {
    & kubectl get deployment,hpa,pods -n orderpage -o wide 2>&1 | Set-Content -LiteralPath (Join-Path $resultDir 'cluster-after.txt') -Encoding utf8
}

Write-Host "k6 result: $resultDir"
