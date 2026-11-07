# ALB Controller 전용 IRSA

공식 v3.6.2 IAM 정책을 vendor에 보관하고 Terraform이 policy/role/attachment를 만든다.
kube-system/aws-load-balancer-controller와 audience sts.amazonaws.com만 assume할 수 있다.
OIDC 공급자는 EKS 모듈에서 받으며 eksctl이나 별도 수동 IAM 생성 스크립트를 사용하지 않는다.
Helm chart 3.6.2가 ServiceAccount를 생성하고 해당 Role ARN을 annotation으로 넣는다.

원본 정책/해시는 [vendor 기록](vendor/README.md), 최초 설치 순서는 [배포 준비 기록](../../../docs/restart/https-app-deployment.md)을 참고한다.
