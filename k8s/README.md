# Kubernetes 배포 설정

기본은 고정 Pod 2개, RollingUpdate, 분리된 Probe, HTTPS ALB다.
실제 Secret과 계정별 이미지/endpoint가 없는 base를 그대로 apply하지 않는다.

- base: Namespace/ServiceAccount/Deployment/ClusterIP Service/Ingress 및 설정·RDS CA ConfigMap generator.
- overlays/dev: base 정적 렌더 확인용. 실제 입력은 scripts/prepare-deployment.mjs로 검증한다.
- benchmarks/hpa: 고정 2개와 CPU HPA 2~4 비교 초안. metrics-server/자원 예산 검증 후 사용한다.
- controllers/aws-load-balancer-controller: 고정 Helm chart의 값 템플릿.
- backend-secret.env.example: 키 목록만 제공. 실행 manifest에 포함하지 않는다.

[실제 입력 준비·최초 배포 순서·검증 한계](../docs/restart/https-app-deployment.md)
