# OrderPage Infra DevOps

Terraform으로 AWS EKS 기반을 구성하고, Jenkins CI / Argo CD CD와 운영 모니터링을 검증하는 실습 프로젝트다. 프론트엔드는 Vercel을 사용한다.

현재: 기반/관리형 데이터/HTTPS·EC2 Jenkins·Argo CD·FE Vercel의 선행 PR을 main에 병합하고 **CloudWatch/SNS·비용 관측 및 Prometheus/Grafana 준비 코드**를 추가했다. 실제 설치·배포는 미실행이며 AWS 리소스는 아직 생성하지 않았다.

- [전체 요구사항·비용·진행 기록](docs/restart/project-process.md)
- [실제 AWS plan 전 계정·인증·비용 점검](docs/restart/aws-plan-preflight.md)
- [Terraform plan 검토 도구와 다섯 비교 실험 자료](docs/restart/experiment-plan-review.md)
- [Prometheus·Grafana·Metrics Server 설정과 수집/정량 실험 절차](docs/restart/prometheus-grafana.md)
- [CloudWatch/SNS·비용 조회·장애 탐지 비교와 적용 순서](docs/restart/cloudwatch-cost-monitoring.md)
- [FE Jenkins 검증·Vercel 정적 배포와 활성화 절차](docs/restart/frontend-vercel.md)
- [EC2 Jenkins·Argo CD 설정과 최초 적용·측정 절차](docs/restart/jenkins-argocd.md)
- [HTTPS·상품 이미지·최초 Kubernetes 배포 준비](docs/restart/https-app-deployment.md)
- [관리형 데이터·접근 권한·로그 보관 및 다음 단계](docs/restart/managed-data-services.md)
- [이번 기반 구성, 정리 내역, 검증과 다음 단계](docs/restart/terraform-foundation.md)
- [Terraform 실행 범위와 입력](terraform/envs/dev/README.md)
- [로컬 종료/Probe 검증](docs/restart/lifecycle-readiness.md)

| 경로 | 역할 / 상태 |
|---|---|
| terraform/envs/dev | VPC/ECR/EKS/OIDC + RDS/Redis/MQ + ACM/서비스별 IRSA/상품 이미지 S3 |
| terraform/bootstrap/remote-state | 별도로 생성할 S3 state 저장소, 아직 미생성 |
| terraform/modules | 기반/데이터/Controller 및 백엔드 업로드 권한 |
| k8s | 기본 고정 Pod 2개/HTTPS/CA. 실제 값은 준비 도구로 생성하고 Secret은 별도 주입 |
| jenkins | Terraform 검증 + BE 테스트/Docker/ECR/배포 PR + FE 테스트/정적 빌드/Vercel pipeline. 서버 실행은 미검증 |
| argocd, gitops | 비HA chart 설정, 제한된 AppProject/Application, 최초 실제 환경 승격 도구 |
| monitoring | CloudWatch/SNS Terraform 모듈, Prometheus/Grafana와 Metrics Server chart 값, 대시보드. 실제 설치 전 |
| benchmarks, load-test | 읽기 부하 시험 도구. AWS 측정 결과 없음 |
| docs/restart | 새 요구사항 이후의 유효한 진행 기록 |

목표 구성에는 RDS MariaDB, ElastiCache Redis, Amazon MQ, ALB/HTTPS, CloudWatch/SNS, Cost Explorer가 포함된다. Cost Anomaly Detection은 전부 주석인 비활성 예제로 유지한다.
