param(
    [string]$ClusterName = "orderpage-dev",
    [string]$Region = "ap-northeast-2",
    [string]$ValuesPath = "k8s/controllers/aws-load-balancer-controller/values.dev.yaml",
    [string]$ServiceAccountPath = "k8s/controllers/aws-load-balancer-controller/serviceaccount.yaml"
)

$ErrorActionPreference = "Stop"

Write-Host "1. kubeconfig update"
aws eks update-kubeconfig --region $Region --name $ClusterName

Write-Host "2. apply AWS Load Balancer Controller ServiceAccount"
kubectl apply -f $ServiceAccountPath

Write-Host "3. add/update EKS Helm repository"
helm repo add eks https://aws.github.io/eks-charts --force-update
helm repo update

Write-Host "4. install or upgrade AWS Load Balancer Controller"
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller `
  -n kube-system `
  -f $ValuesPath

Write-Host "5. verify controller deployment"
kubectl rollout status deployment/aws-load-balancer-controller -n kube-system --timeout=180s
kubectl get deployment aws-load-balancer-controller -n kube-system
