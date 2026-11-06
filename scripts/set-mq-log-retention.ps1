# 생성된 MQ 일반 로그 그룹의 보관 정책만 수정한다. Broker/로그 그룹을 만들거나 삭제하지 않는다.
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^b-[0-9a-f-]{36}$')]
    [string]$BrokerId,
    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9]{12}$')]
    [string]$ExpectedAccountId,
    [string]$Profile,
    [ValidateSet('ap-northeast-2')]
    [string]$Region = 'ap-northeast-2'
)
$ErrorActionPreference = 'Stop'
$awsOptions = @('--region', $Region, '--no-cli-pager')
if ($Profile) { $awsOptions += @('--profile', $Profile) }

function Invoke-AwsText {
    param([string[]]$CommandArguments)
    $result = & aws @CommandArguments @awsOptions
    if ($LASTEXITCODE -ne 0) { throw "AWS CLI 실패 (exit=$LASTEXITCODE). 다음 단계는 실행하지 않습니다." }
    return ($result -join [Environment]::NewLine)
}
$account = (Invoke-AwsText @('sts', 'get-caller-identity', '--query', 'Account', '--output', 'text')).Trim()
if ($account -ne $ExpectedAccountId) { throw '예상 AWS 계정과 다릅니다. 변경을 중단합니다.' }

$brokerJson = Invoke-AwsText @('mq', 'describe-broker', '--broker-id', $BrokerId, '--query', '{Arn:BrokerArn,Logs:Logs}', '--output', 'json')
$broker = $brokerJson | ConvertFrom-Json
if ($broker.Arn -notlike "arn:aws:mq:${Region}:${ExpectedAccountId}:broker:*:${BrokerId}") {
    throw 'Broker ARN의 계정/리전/ID가 요청과 다릅니다.'
}
$logGroup = $broker.Logs.GeneralLogGroup
if (-not $broker.Logs.General -or $logGroup -ne "/aws/amazonmq/broker/$BrokerId/general") {
    throw 'MQ 일반 로그 그룹이 아직 준비되지 않았거나 예상 경로와 다릅니다. 그룹을 임의로 만들지 않습니다.'
}
if (-not $PSCmdlet.ShouldProcess("$ExpectedAccountId / $logGroup", 'CloudWatch 로그 보관을 3일로 설정')) {
    return
}
$null = Invoke-AwsText @('logs', 'put-retention-policy', '--log-group-name', $logGroup, '--retention-in-days', '3')
$groupsJson = Invoke-AwsText @('logs', 'describe-log-groups', '--log-group-name-prefix', $logGroup, '--output', 'json')
$groups = $groupsJson | ConvertFrom-Json
$exact = @($groups.logGroups | Where-Object { $_.logGroupName -eq $logGroup })
if ($exact.Count -ne 1 -or $exact[0].retentionInDays -ne 3) {
    throw '변경 후 실제 로그 보관 정책 확인에 실패했습니다.'
}
[pscustomobject]@{
    AccountId = $account
    BrokerId = $BrokerId
    LogGroup = $logGroup
    RetentionInDays = 3
    # 이 그룹은 MQ 서비스가 만든 자원이며 Terraform destroy가 삭제하지 않는다.
    ManagedByTerraform = $false
}
