[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PreparedDirectory,
    [Parameter(Mandatory)][ValidatePattern('^[0-9]{12}$')][string]$ExpectedAccountId,
    [Parameter(Mandatory)][string]$Profile
)
$ErrorActionPreference = 'Stop'
# kubeconfig의 exec는 나중에 aws eks get-token을 다시 실행한다. 이때 기존 환경 키가
# kubeconfig에 기록된 AWS_PROFILE보다 우선하면 다른 계정으로 인증될 수 있으므로 중단한다.
$credentialOverrides = @('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN') |
    Where-Object { -not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($_, 'Process')) }
if ($credentialOverrides.Count -gt 0) {
    throw '현재 셸의 AWS 자격증명 환경 변수가 지정한 프로필보다 우선할 수 있습니다. 별도 셸에서 프로필 인증을 확인한 뒤 다시 실행하세요.'
}
$dir = (Resolve-Path -LiteralPath $PreparedDirectory).Path
$metadata = Get-Content -LiteralPath (Join-Path $dir 'environment.json') -Raw | ConvertFrom-Json
if ($metadata.accountId -ne $ExpectedAccountId -or $metadata.region -ne 'ap-northeast-2' -or $metadata.chartVersion -ne '3.6.2') {
    throw '준비 파일의 계정/리전/chart 버전이 기대값과 다릅니다.'
}
$awsOptions = @('--profile', $Profile, '--region', 'ap-northeast-2', '--no-cli-pager')
$actualAccount = & aws sts get-caller-identity --query Account --output text @awsOptions
if ($LASTEXITCODE -ne 0 -or $actualAccount.Trim() -ne $ExpectedAccountId) { throw 'AWS 계정 확인 실패. 설치하지 않습니다.' }
$clusterArn = & aws eks describe-cluster --name $metadata.clusterName --query cluster.arn --output text @awsOptions
if ($LASTEXITCODE -ne 0 -or $clusterArn.Trim() -ne "arn:aws:eks:ap-northeast-2:${ExpectedAccountId}:cluster/$($metadata.clusterName)") {
    throw 'EKS 대상 확인 실패.'
}
# 전역 kubeconfig/context를 덮어쓰지 않는다.
$kubeconfig = Join-Path $dir 'kubeconfig'
& aws eks update-kubeconfig --name $metadata.clusterName --kubeconfig $kubeconfig @awsOptions
if ($LASTEXITCODE -ne 0) { throw 'kubeconfig 생성 실패.' }
& helm upgrade --install aws-load-balancer-controller aws-load-balancer-controller --repo https://aws.github.io/eks-charts --version 3.6.2 --namespace kube-system --kubeconfig $kubeconfig --values (Join-Path $dir 'controller-values.yaml') --wait --timeout 5m
if ($LASTEXITCODE -ne 0) { throw 'Controller 설치 실패. 상태를 확인한 뒤 복구하세요.' }
& kubectl --kubeconfig $kubeconfig rollout status deployment/aws-load-balancer-controller -n kube-system --timeout=180s
if ($LASTEXITCODE -ne 0) { throw 'Controller readiness 확인 실패.' }
Write-Output 'Controller 준비 완료. 인증서/Secret/TargetGroupBinding 확인 후 앱 배포를 진행하세요.'
