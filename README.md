# OrderPage Infra DevOps

Terraform으로 AWS EKS 기반을 구성하고, Jenkins CI / Argo CD CD와 운영 모니터링을 검증하는 실습 프로젝트다. 프론트엔드는 Vercel을 사용한다.

현재: 애플리케이션 로컬 검증, **VPC·EKS·ECR + 관리형 데이터 서비스 코드 검증 완료**. AWS 리소스는 아직 생성하지 않았다.

- [전체 요구사항·비용·진행 기록](docs/restart/project-process.md)
- [관리형 데이터·접근 권한·로그 보관 및 다음 단계](docs/restart/managed-data-services.md)
- [이번 기반 구성, 정리 내역, 검증과 다음 단계](docs/restart/terraform-foundation.md)
- [Terraform 실행 범위와 입력](terraform/envs/dev/README.md)
- [로컬 종료/Probe 검증](docs/restart/lifecycle-readiness.md)

| 경로 | 역할 / 상태 |
|---|---|
| terraform/envs/dev | 현재 실행 root: VPC/ECR/EKS/OIDC + RDS/Redis/MQ |
| terraform/bootstrap/remote-state | 별도로 생성할 S3 state 저장소, 아직 미생성 |
| terraform/modules | 기반/데이터 모듈, 서비스별 IRSA Role은 후속 작업 |
| k8s | 기존 배포 초안. Probe 수정은 반영했으나 이미지·Secret·HPA 등 새 설계 전환 필요 |
| jenkins | 자격증명 없는 Terraform 검증 pipeline. 앱 CI와 Argo CD 연결은 후속 작업 |
| monitoring | CloudWatch/SNS, Prometheus/Grafana 구현 예정 |
| benchmarks, load-test | 읽기 부하 시험 도구. AWS 측정 결과 없음 |
| docs/restart | 새 요구사항 이후의 유효한 진행 기록 |

목표 구성에는 RDS MariaDB, ElastiCache Redis, Amazon MQ, ALB/HTTPS, CloudWatch/SNS, Cost Explorer가 포함된다. Cost Anomaly Detection은 비활성 예제만 유지할 예정이다.
