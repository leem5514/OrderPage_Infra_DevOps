# AWS Load Balancer Controller

Chart 3.6.2 / app v3.6.2를 사용한다. 공식 chart를 로컬 Helm template으로 검증했다.
Terraform이 IAM 정책/IRSA를 관리하고 Helm이 Controller 및 ServiceAccount를 관리한다.
values.dev.yaml의 placeholder는 prepare-deployment가 Terraform output으로 바꾼다.

region/vpcId를 지정하므로 Node IMDS 정보 조회에 의존하지 않는다.
Ingress/Pod readiness gate만 사용하고 Service mutator, WAF/Shield 및 ALB/NLB Gateway 기능은 끈다.
CRD는 최초 Helm 설치에서 포함되지만 향후 업그레이드 시 Helm이 기존 CRD를 자동 갱신한다고 가정하면 안 된다.

scripts/install-aws-load-balancer-controller.ps1은 계정/cluster 확인 뒤 별도 kubeconfig와 고정 chart로 설치한다.
실제 설치는 아직 실행하지 않았다. [준비와 설치 절차](../../../docs/restart/https-app-deployment.md)
