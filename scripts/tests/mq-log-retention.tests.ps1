# 외부 테스트 프레임워크/실제 AWS 인증 없이 CLI 경계와 계정 가드를 검증한다.
$ErrorActionPreference = 'Stop'
if (Test-Path Function:\aws) { throw '기존 aws 함수를 덮어쓰지 않습니다. 새 PowerShell 세션에서 실행하세요.' }
$target = Join-Path $PSScriptRoot '..\set-mq-log-retention.ps1'
$brokerId = 'b-00000000-0000-0000-0000-000000000001'
$accountId = '123456789012'
$groupName = "/aws/amazonmq/broker/$brokerId/general"
$global:OrderPageMqTestState = $null
function global:aws {
    $request = @($args)
    $state = $global:OrderPageMqTestState
    $state.Calls.Add(($request -join ' '))
    $global:LASTEXITCODE = 0
    switch ($request[0] + ':' + $request[1]) {
        'sts:get-caller-identity' { return $state.Account }
        'mq:describe-broker' {
            if ($state.Mode -eq 'cli-error') { $global:LASTEXITCODE = 1; return }
            $logName = if ($state.Mode -eq 'missing-log') { $null } else { $state.LogGroup }
            $arnAccount = if ($state.Mode -eq 'wrong-broker-account') { '999999999999' } else { $state.Account }
            return (@{
                Arn = "arn:aws:mq:ap-northeast-2:${arnAccount}:broker:test:$($state.BrokerId)"
                Logs = @{ General = $true; GeneralLogGroup = $logName }
            } | ConvertTo-Json -Depth 5 -Compress)
        }
        'logs:put-retention-policy' { $state.Writes++; return }
        'logs:describe-log-groups' {
            $days = if ($state.Mode -eq 'verify-error') { 7 } else { 3 }
            return (@{ logGroups = @(@{ logGroupName = $state.LogGroup; retentionInDays = $days }) } | ConvertTo-Json -Depth 5 -Compress)
        }
        default { throw "모의 AWS 호출 목록에 없는 요청: $($request -join ' ')" }
    }
}
try {
    $cases = @(
        @{ Name = '정상 변경과 3일 보관 재확인'; Mode = 'ok'; Error = $false; Writes = 1 },
        @{ Name = 'WhatIf는 변경 안 함'; Mode = 'what-if'; Error = $false; Writes = 0 },
        @{ Name = '계정 불일치 차단'; Mode = 'wrong-account'; Error = $true; Writes = 0 },
        @{ Name = 'Broker 계정 불일치 차단'; Mode = 'wrong-broker-account'; Error = $true; Writes = 0 },
        @{ Name = '미생성 로그 그룹 차단'; Mode = 'missing-log'; Error = $true; Writes = 0 },
        @{ Name = 'AWS CLI 실패 후 중단'; Mode = 'cli-error'; Error = $true; Writes = 0 },
        @{ Name = '변경 후 실제 정책 검증'; Mode = 'verify-error'; Error = $true; Writes = 1 }
    )
    foreach ($case in $cases) {
        $global:OrderPageMqTestState = @{
            Mode = $case.Mode
            Account = if ($case.Mode -eq 'wrong-account') { '999999999999' } else { $accountId }
            BrokerId = $brokerId
            LogGroup = $groupName
            Writes = 0
            Calls = [Collections.Generic.List[string]]::new()
        }
        $failed = $false
        try {
            $result = & $target -BrokerId $brokerId -ExpectedAccountId $accountId -Profile 'mock-only' -WhatIf:($case.Mode -eq 'what-if') -Confirm:$false
            if ($case.Mode -eq 'ok' -and ($result.RetentionInDays -ne 3 -or $result.ManagedByTerraform)) {
                throw '결과 객체가 실제 검증 결과와 다릅니다.'
            }
        } catch { $failed = $true }
        if ($failed -ne $case.Error -or $global:OrderPageMqTestState.Writes -ne $case.Writes) {
            throw "실패: $($case.Name), error=$failed, writes=$($global:OrderPageMqTestState.Writes)"
        }
        Write-Output "PASS $($case.Name)"
    }
    Write-Output 'MQ 로그 보관 스크립트: 7개 통과, 실제 AWS 호출 없음.'
} finally {
    Remove-Item Function:\aws
    Remove-Variable -Name OrderPageMqTestState -Scope Global
}
