# Baseline Register

이 문서는 DevOps Before/After 실험에서 어떤 Git 기준점과 실행 구성을 사용할지 기록한다.
Git의 오래된 commit을 무조건 Before로 사용하지 않고, 비교하려는 변수만 다른 구성을 Baseline으로 사용한다.

## 1. 보존 태그

| Repository | Tag | 기준 Commit | 의미 | 성능 비교 사용 여부 |
|---|---|---|---|---|
| Backend | `source-baseline-v1` | `805975b` | DevOps 안정화 작업 전 최초 이관 상태 | 코드 변화 확인용. Redis/RabbitMQ 성능 Baseline으로 직접 사용하지 않음 |
| Frontend | `source-baseline-v1` | `a1218dc` | Vercel 연결을 시작한 최초 이관 상태 | 프론트 원본 보존용 |
| Infra | `pre-aws-deploy-v1` | 이 문서를 포함한 Commit | Terraform Apply 전 설계·Manifest·비교 계획 상태 | AWS 실제 리소스 생성 전 증거 |

## 2. 시나리오별 실제 Baseline

| Scenario | Before 기준 | After 기준 | 추가 구현 필요 |
|---|---|---|---|
| Terraform | AWS Console 수동 VPC/ECR 생성 기록 | 현재 Terraform module | 수동 실행 기록표 |
| Jenkins | 현재 Backend commit을 수동 명령으로 배포 | 같은 commit을 Jenkins로 배포 | Jenkins 실제 실행환경 |
| ECR | 로컬 image와 수동 tag | 같은 Dockerfile의 ECR Git SHA/Build Number tag | ECR 실제 Push |
| HPA | 같은 image, Pod 2개 고정 | 같은 image, HPA 2~5개 | OFF/ON overlay와 Metrics Server 구성 완료, 실제 EKS 검증 필요 |
| Rolling Update | 같은 image, Recreate 또는 Replica 1개 | 같은 image, RollingUpdate와 Replica 2개 | 비교 overlay |
| Probe | 같은 image, Probe 제거 | 같은 image, readiness/liveness 활성 | 비교 overlay |
| ALB | Instance Target overlay | IP Target overlay | 비교 overlay |
| CloudWatch | Alarm/Dashboard 없이 장애 주입 | Alarm/Dashboard 활성 후 같은 장애 | Dashboard, Alarm, 장애 스크립트 |
| Prometheus/Grafana | 로그와 Actuator 수동 조회 | Dashboard에서 같은 장애 분석 | Prometheus/Grafana 설치 |
| Redis | `RDB_SYNC` 실행 모드 | `REDIS_ASYNC` 실행 모드 | Backend feature mode |
| RabbitMQ | RDB 동기 반영 모드 | RabbitMQ 비동기 반영 모드 | Backend feature mode |
| Managed Service | Docker/EC2 직접 운영 절차 | RDS/ElastiCache/Amazon MQ | 운영 Runbook과 복구 실험 |
| Vercel | 현재 Frontend commit 수동 Build/배포 | 같은 commit의 Vercel Git 배포 | Vercel 프로젝트 연결과 시간 기록 |

## 3. Baseline으로 인정하지 않는 비교

- 서로 다른 애플리케이션 commit과 서로 다른 인프라 사양을 동시에 비교한 결과
- Local PC와 EKS의 Raw API latency를 직접 비교한 결과
- 테스트 데이터 수와 사용자 수가 다른 결과
- HPA, Redis, RabbitMQ를 동시에 켠 뒤 특정 기술의 개선이라고 주장한 결과
- 단 한 번 실행한 최솟값
- AWS 관리형 서비스가 직접 운영형보다 무조건 빠르다는 주장
- 예상 수치나 샘플 수치를 실제 측정값으로 기록한 결과

## 4. 실험 식별 규칙

각 실험 결과는 다음 정보를 반드시 포함한다.

```text
scenario_id: S05
variant: before-fixed | after-hpa
git_commit: <full-sha>
container_image: <ecr-uri>:<immutable-tag>
started_at: <ISO-8601>
aws_region: ap-northeast-2
test_data_version: <seed-version>
load_profile: users-100 | users-300 | users-500
run_number: 1..5
```

결과 디렉터리는 다음 규칙을 사용한다.

```text
benchmarks/results/<scenario-id>/<yyyy-mm-dd>/<before|after>/run-<n>/
```

Raw 결과는 수정하지 않고, 요약값은 `docs/performance-report.md`에 기록한다.

## 5. 다음 Baseline 구현 순서

1. k6 공통 부하 프로필과 결과 디렉터리를 만든다.
2. Backend에 `RDB_SYNC`와 `REDIS_ASYNC` 실행 모드를 추가한다.
3. CloudWatch Dashboard/Alarm과 장애 주입 시나리오를 만든다.
4. AWS Apply 전에 수동 Terraform/Jenkins Before 실행 절차를 확정한다.
