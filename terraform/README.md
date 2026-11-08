# Terraform

[dev root](envs/dev/README.md)는 VPC/ECR/EKS/OIDC와 RDS/Redis/MQ를 연결한다. [S3 state bootstrap](bootstrap/remote-state/README.md)은 별도 root다.

현재 생성 완료를 뜻하는 폴더는 없다. fmt/validate/mock test와 실제 AWS plan/apply는 구별한다.

- 현재 호출: modules/vpc, modules/ecr, modules/eks, modules/rds, modules/elasticache, modules/amazonmq.
- 후속 연결: modules/load-balancer-controller-irsa. OIDC 공급자는 준비했지만 서비스별 Role과 Controller 설치는 아직이다.
- 실제 입력/검증/삭제 주의사항: [기반 기록](../docs/restart/terraform-foundation.md), [관리형 데이터 기록](../docs/restart/managed-data-services.md).
