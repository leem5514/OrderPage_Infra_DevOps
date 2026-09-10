# AWS Load Balancer Controller

Kubernetes Ingress를 AWS Application Load Balancer로 변환하는 Controller입니다.

## Why

- `k8s/base/ingress.yaml`을 실제 ALB로 만들기 위해 필요합니다.
- Pod에 AWS access key를 넣지 않고 IRSA로 최소 권한을 부여합니다.
- Ingress manifest, subnet tag, security group, target group health check를 한 흐름으로 설명할 수 있습니다.

## Install Flow

1. EKS cluster 생성 후 kubeconfig를 연결합니다.

```powershell
aws eks update-kubeconfig --region ap-northeast-2 --name orderpage-dev
```

2. EKS OIDC provider를 연결합니다.

```powershell
eksctl utils associate-iam-oidc-provider --region ap-northeast-2 --cluster orderpage-dev --approve
```

3. AWS Load Balancer Controller IAM policy를 생성합니다.

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v3.5.0/docs/install/iam_policy.json" -OutFile ".\iam_policy.json"
aws iam create-policy --policy-name AWSLoadBalancerControllerIAMPolicy --policy-document file://iam_policy.json
```

또는 레포의 스크립트를 사용할 수 있습니다.

```powershell
.\scripts\create-aws-load-balancer-controller-policy.ps1
```

4. Terraform 변수에 OIDC provider ARN과 policy ARN을 넣고 IRSA Role을 생성합니다.

```hcl
enable_aws_load_balancer_controller_irsa = true
eks_oidc_provider_arn                   = "arn:aws:iam::<account-id>:oidc-provider/oidc.eks.ap-northeast-2.amazonaws.com/id/<oidc-id>"
aws_load_balancer_controller_policy_arn = "arn:aws:iam::<account-id>:policy/AWSLoadBalancerControllerIAMPolicy"
```

5. `serviceaccount.yaml`의 `eks.amazonaws.com/role-arn` 값을 Terraform output으로 교체한 뒤 적용합니다.

```powershell
kubectl apply -f .\k8s\controllers\aws-load-balancer-controller\serviceaccount.yaml
```

렌더링만 먼저 확인할 수도 있습니다.

```powershell
kubectl kustomize .\k8s\controllers\aws-load-balancer-controller
```

6. Helm chart로 Controller를 설치합니다.

```powershell
helm repo add eks https://aws.github.io/eks-charts
helm repo update
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller `
  -n kube-system `
  -f .\k8s\controllers\aws-load-balancer-controller\values.dev.yaml
```

7. 설치 상태를 확인합니다.

```powershell
kubectl get deployment aws-load-balancer-controller -n kube-system
kubectl get ingress -n orderpage
```

또는 5~7단계는 레포의 설치 스크립트로 실행할 수 있습니다.

```powershell
.\scripts\install-aws-load-balancer-controller.ps1
```

## Replace Before Apply

- `serviceaccount.yaml`의 IAM role ARN
- `values.dev.yaml`의 `vpcId`
- 실제 도메인 사용 시 `k8s/overlays/dev/patch-ingress.yaml`의 host
