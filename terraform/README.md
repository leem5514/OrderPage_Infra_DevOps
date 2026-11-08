# Terraform

[dev root](envs/dev/README.md)는 VPC/ECR/EKS 기반만 실행한다. [S3 state bootstrap](bootstrap/remote-state/README.md)은 별도 root다.

현재 생성 완료를 뜻하는 폴더는 없다. fmt/validate/mock test와 실제 AWS plan/apply는 구별한다.

- 현재 호출: modules/vpc, modules/ecr, modules/eks.
- 후속 검토용: modules/rds, modules/elasticache, modules/amazonmq, modules/load-balancer-controller-irsa.
- 후속 모듈은 root에서 호출하지 않는다. 옛 MQ 타입/Redis TLS/광범위한 SG 등은 연결 전에 새 계획으로 수정한다.
- 실제 입력/검증/삭제 주의사항은 [기반 구성 기록](../docs/restart/terraform-foundation.md)에 모았다.
