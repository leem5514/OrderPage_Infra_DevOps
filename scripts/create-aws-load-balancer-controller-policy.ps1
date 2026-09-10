param(
    [string]$PolicyName = "AWSLoadBalancerControllerIAMPolicy",
    [string]$ControllerVersion = "v3.5.0",
    [string]$PolicyPath = "iam_policy.json"
)

$ErrorActionPreference = "Stop"

$policyUrl = "https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/$ControllerVersion/docs/install/iam_policy.json"

Write-Host "1. download official AWS Load Balancer Controller IAM policy"
Invoke-WebRequest -Uri $policyUrl -OutFile $PolicyPath

Write-Host "2. create IAM policy"
aws iam create-policy `
  --policy-name $PolicyName `
  --policy-document "file://$PolicyPath"

Write-Host "3. use the returned Policy.Arn as aws_load_balancer_controller_policy_arn"
