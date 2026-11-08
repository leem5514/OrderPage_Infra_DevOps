$ErrorActionPreference = 'Stop'
$savedNativeExitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
foreach ($name in @('aws','helm','kubectl')) {
    if (Test-Path "Function:\$name") { throw '기존 mock 함수를 덮어쓰지 않습니다.' }
}
$directory = Join-Path $PSScriptRoot "../../.local/deploy/installer-test-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $directory -Force | Out-Null
@{
    accountId='123456789012';region='ap-northeast-2';clusterName='orderpage-dev';chartVersion='3.6.2'
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'environment.json') -Encoding utf8
$global:OrderPageInstallTest = $null
function global:aws {
    $global:LASTEXITCODE = 0
    switch ($args[1]) {
        'get-caller-identity' {
            if ($global:OrderPageInstallTest.Mode -eq 'aws-error') { $global:LASTEXITCODE = 1; return }
            if ($global:OrderPageInstallTest.Mode -eq 'wrong-account') { return '999999999999' }
            return '123456789012'
        }
        'describe-cluster' {
            if ($global:OrderPageInstallTest.Mode -eq 'wrong-cluster') { return 'arn:aws:eks:ap-northeast-2:123456789012:cluster/other' }
            return 'arn:aws:eks:ap-northeast-2:123456789012:cluster/orderpage-dev'
        }
        'update-kubeconfig' { $global:OrderPageInstallTest.KubeconfigWrites++; return }
        default { throw '예상하지 않은 AWS 호출.' }
    }
}
function global:helm {
    $global:OrderPageInstallTest.Installs++
    $global:LASTEXITCODE = if ($global:OrderPageInstallTest.Mode -eq 'helm-error') { 1 } else { 0 }
}
function global:kubectl {
    $global:OrderPageInstallTest.Rollouts++
    $global:LASTEXITCODE = 0
}
try {
    foreach ($case in @(
        @{Mode='ok';Error=$false;Writes=1;Installs=1;Rollouts=1},
        @{Mode='wrong-account';Error=$true;Writes=0;Installs=0;Rollouts=0},
        @{Mode='wrong-cluster';Error=$true;Writes=0;Installs=0;Rollouts=0},
        @{Mode='aws-error';Error=$true;Writes=0;Installs=0;Rollouts=0},
        @{Mode='helm-error';Error=$true;Writes=1;Installs=1;Rollouts=0}
    )) {
        $global:OrderPageInstallTest = @{Mode=$case.Mode;KubeconfigWrites=0;Installs=0;Rollouts=0}
        $failed=$false
        try { $null = & (Join-Path $PSScriptRoot '../install-aws-load-balancer-controller.ps1') -PreparedDirectory $directory -ExpectedAccountId '123456789012' -Profile 'mock-only' }
        catch { $failed=$true }
        $state=$global:OrderPageInstallTest
        if ($failed -ne $case.Error -or $state.KubeconfigWrites -ne $case.Writes -or $state.Installs -ne $case.Installs -or $state.Rollouts -ne $case.Rollouts) {
            throw "실패: $($case.Mode)"
        }
        Write-Output "PASS $($case.Mode)"
    }
    Write-Output 'Controller 설치 스크립트 5개 통과. 실제 AWS/Helm/kubectl 호출 없음.'
} finally {
    foreach ($name in @('aws','helm','kubectl')) { Remove-Item "Function:\$name" }
    Remove-Variable OrderPageInstallTest -Scope Global
    $global:LASTEXITCODE = $savedNativeExitCode
}
