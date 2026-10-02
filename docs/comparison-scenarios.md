# DevOps Before/After 비교 시나리오

이 문서는 AWS 배포 전에 비교군, 측정 조건, 지표, 성공 기준을 고정하기 위한 기준 문서다.
실제 측정 전에는 개선 수치를 확정값으로 표현하지 않으며, 아래 성공 기준은 포트폴리오용 목표값이다.

저장소별 보존 태그와 시나리오별 실제 기준점은 [`baseline-register.md`](./baseline-register.md)에서 관리한다.

## 1. 비교 원칙

### 1.1 한 번에 하나만 변경한다

같은 코드, 데이터, 부하, AWS Region, 인스턴스 사양을 유지하고 비교하려는 기능만 변경한다.

```text
Before 측정 -> 기능 하나 변경 -> After 측정 -> 결과 비교
```

HPA와 Redis를 동시에 켠 결과는 어느 기능이 개선을 만들었는지 분리할 수 없으므로 유효한 비교로 사용하지 않는다.

### 1.2 Before의 종류를 구분한다

| 구분 | 의미 | 적용 기술 |
|---|---|---|
| 수동 기준 | 사람이 Console 또는 CLI로 직접 수행 | Terraform, Jenkins, Vercel |
| 기능 OFF 기준 | 동일 환경에서 기능만 비활성화 | HPA, Rolling Update, Alarm |
| 기존 구현 기준 | 단순 구현과 개선 구현을 분리 | Redis, RabbitMQ |
| 운영 방식 기준 | 직접 운영과 관리형 서비스 비교 | RDS, ElastiCache, Amazon MQ |

### 1.3 반복과 증거를 남긴다

- 성능 테스트는 워밍업 후 최소 3회, 권장 5회 실행한다.
- 지연시간은 평균만 사용하지 않고 p50, p95, p99를 기록한다.
- 결과 대표값은 중앙값을 사용하고 최솟값과 최댓값도 남긴다.
- Jenkins 로그, Terraform 로그, k6 결과, Grafana 화면, CloudWatch Alarm 이력을 증거로 보관한다.
- 비용이 다른 실험은 시간당 비용 또는 테스트 1회 비용을 함께 기록한다.

### 1.4 개선율 계산식

```text
낮을수록 좋은 지표 = (Before - After) / Before * 100
높을수록 좋은 지표 = (After - Before) / Before * 100
```

예: 배포시간 20분에서 8분이면 `(20 - 8) / 20 * 100 = 60% 단축`이다.

## 2. 공통 실험 조건

| 항목 | 고정 조건 |
|---|---|
| Region | ap-northeast-2 |
| 애플리케이션 | 동일 Git commit 및 동일 Docker image |
| 테스트 데이터 | 동일 사용자·상품·재고 데이터 seed |
| 테스트 도구 | k6 |
| 부하 단계 | 동시 사용자 100, 300, 500 |
| 실행 시간 | 워밍업 2분, 본 테스트 10분, 정리 3분 |
| 네트워크 | 동일한 부하 발생 위치와 ALB endpoint |
| 관측 도구 | Prometheus, Grafana, CloudWatch, Jenkins 로그 |
| 성공 기준 | HTTP 오류율 1% 미만, Oversell 0건을 기본 안전조건으로 사용 |

## 3. 핵심 비교 시나리오

### S01. Terraform 도입 전/후

| 항목 | Before | After |
|---|---|---|
| 방식 | AWS Console에서 VPC, Subnet, Route Table, ECR을 수동 생성 | 동일 리소스를 Terraform으로 생성 |
| 측정 | 구축시간, 수동 단계 수, 설정 누락 수, 재구축시간 | `plan/apply` 시간, 변경 리소스 수, 재실행 결과 |
| 기대 가치 | 작업자의 기억과 체크리스트에 의존 | 코드 리뷰, 재현성, 변경 사전 확인 |
| 목표 | 구축시간 50% 이상 단축, 설정 누락 0건, 재실행 시 불필요 변경 0건 |

실행 절차:

1. 별도 baseline 이름으로 VPC와 ECR을 Console에서 만들고 시작·종료 시간을 기록한다.
2. 생성 과정의 클릭 수, 수정 횟수, 누락 항목을 기록한다.
3. baseline 리소스를 제거한다.
4. Terraform으로 같은 조건의 리소스를 생성한다.
5. `terraform plan`을 다시 실행해 `No changes` 여부를 확인한다.

Terraform은 애플리케이션 성능이 아니라 인프라 구축과 변경 관리의 개선을 증명한다.

### S02. Terraform Local State와 S3 Remote State

| 항목 | Before | After |
|---|---|---|
| State 위치 | 작업자 PC의 `terraform.tfstate` | Versioning과 Lockfile을 적용한 S3 Backend |
| 장애 주입 | 로컬 state 복사본을 다른 디렉터리에서 실행 | 동일 S3 Backend를 두 실행 주체가 사용 |
| 측정 | state 불일치, 중복 생성 위험, 복구시간 | 동시 실행 차단, 이전 버전 복구시간 |
| 목표 | 동시 Apply 1건 차단 확인, state 복구 절차 10분 이내 |

State에는 민감정보가 포함될 수 있으므로 Git에는 저장하지 않는다.

### S03. 수동 배포와 Jenkins Pipeline

| 항목 | Before | After |
|---|---|---|
| 방식 | 개발자가 test, build, Docker, ECR, kubectl 명령을 순서대로 실행 | Git 변경 후 Jenkinsfile이 동일 단계를 자동 실행 |
| 측정 | 전체 배포시간, 개발자 직접 작업시간, 명령 수, 실패 단계 | Pipeline 시간, 대기시간, 자동 실패 차단, 재실행시간 |
| 기대 가치 | 사람마다 다른 절차 | Pipeline as Code와 반복 가능한 배포 |
| 목표 | 개발자 직접 작업시간 70% 이상 감소, 테스트 누락 0건, 실패 단계 식별 1분 이내 |

동일한 Docker image tag 정책을 사용하고, 수동 배포 5회와 Jenkins 배포 5회를 비교한다.

### S04. 로컬 이미지와 ECR 이미지 관리

| 항목 | Before | After |
|---|---|---|
| 방식 | 로컬 Docker image와 `latest` 태그 중심 | ECR에 Jenkins Build Number 또는 Git SHA 태그 저장 |
| 측정 | 배포 버전 추적시간, 이전 이미지 확인시간, 취약점 확인시간 | Tag 추적, Scan 결과, Rollback 대상 확인시간 |
| 목표 | 실행 중인 image와 Git commit 연결 2분 이내, 미태그 이미지 정리 정책 확인 |

ECR Scan은 취약점을 자동 수정하는 기능이 아니라 발견과 배포 판단을 위한 근거다.

### S05. 고정 Pod와 HPA

| 항목 | Before | After |
|---|---|---|
| Replica | Pod 2개 고정 | CPU 70% 또는 Memory 80%, Pod 2~5개 |
| 측정 | TPS, p95, p99, 오류율, CPU, Memory | 동일 지표와 Scale-out/Ready/Scale-in 시간 |
| 기대 가치 | 트래픽 증가 시 용량 고정 | 부하에 따라 처리 용량 자동 확장 |
| 목표 | 500명 구간 오류율 감소, p95 악화 방지, Scale-out 2분 이내 |

필수 선행조건:

- Metrics Server 설치
- Deployment의 CPU/Memory requests 설정
- `fixed-replica`와 `hpa-enabled` Kustomize overlay 분리
- 동일한 k6 시나리오 사용

### S06. Recreate 방식과 Rolling Update

| 항목 | Before | After |
|---|---|---|
| 배포 전략 | 기존 Pod를 먼저 종료하거나 Replica 1개 교체 | Replica 2개, `maxUnavailable: 0`, `maxSurge: 1` |
| 측정 | 배포 중 5xx 수, 가용 Pod 수, 배포시간 | 동일 지표와 Rollout 완료시간 |
| 장애 주입 | 새 버전의 readiness를 30초 지연 | 동일 조건에서 Rolling Update 수행 |
| 목표 | After 배포 중 5xx 0건, 사용 가능한 Pod 최소 1개 유지 |

### S07. Probe 미사용과 Readiness/Liveness Probe

| 항목 | Before | After |
|---|---|---|
| 방식 | 컨테이너 실행 상태만 확인 | Actuator Health 기반 readiness/liveness 검사 |
| 장애 주입 | 시작 지연, Health 실패, 프로세스 응답 정지 | 같은 장애를 반복 |
| 측정 | 비정상 Pod로 전달된 요청 수, 감지시간, 복구시간 | Target 제외시간, 자동 재시작시간 |
| 목표 | 준비되지 않은 Pod 트래픽 0건, 비정상 컨테이너 자동 복구 확인 |

### S08. ALB Instance Target과 IP Target

| 항목 | Before | After |
|---|---|---|
| 경로 | ALB -> Worker Node NodePort -> Service -> Pod | ALB -> Pod IP |
| 설정 | `target-type: instance` | `target-type: ip` |
| 측정 | p95, p99, 오류율, Target Health 반영시간, 네트워크 단계 | 동일 지표 |
| 목표 | 불필요한 네트워크 단계 제거, Pod 상태와 Target Health 일치 확인 |

API Gateway, NGINX Ingress, ALB는 동일 기능의 단순 성능 대결로 취급하지 않는다.

| 선택지 | 주 사용 목적 | 이번 프로젝트 판단 |
|---|---|---|
| AWS API Gateway | API Key, 사용량 제한, JWT Authorizer, Lambda/API 관리 | 현재 단일 EKS API에는 추가 복잡도가 큼 |
| ALB Ingress | EKS HTTP/HTTPS, Host/Path routing, ACM 연동 | 현재 선택 |
| NLB | TCP/UDP와 L4 트래픽 | 현재 Spring HTTP API의 우선 선택 아님 |
| NGINX Ingress | 클라우드 독립적인 Proxy 제어 | Ingress NGINX 유지보수 종료로 신규 도입 제외 |
| Kubernetes Gateway API | Ingress 이후의 표준화된 라우팅 모델 | 후속 포트폴리오 개선 후보 |

### S09. CloudWatch 사용 전/후

| 항목 | Before | After |
|---|---|---|
| 관측 | `kubectl logs`, AWS Console 개별 서비스 확인 | CloudWatch Logs, Metrics, Dashboard, Alarm |
| 장애 주입 | API 5xx, EKS CPU 상승, RDS Slow Query, Redis CPU, MQ Queue 증가 | 같은 장애를 각각 3회 발생 |
| 측정 | 장애 탐지시간 MTTD, 원인 구간 식별시간 MTTI, 알림 전달시간 | 동일 지표 |
| 기대 가치 | 사용자가 알려준 뒤 조사 | 임계치 초과를 자동 탐지하고 로그를 중앙 조회 |
| 목표 | 장애 탐지 5분 이내, 원인 서비스 식별 10분 이내, 미탐지 0건 |

CloudWatch가 애플리케이션을 직접 빠르게 만들지는 않는다. 장애를 더 빨리 발견하고 원인을 좁히는 시간이 개선 대상이다.

필수 Alarm 후보:

- ALB `HTTPCode_Target_5XX_Count`, `TargetResponseTime`, `UnHealthyHostCount`
- EKS Node/Pod CPU와 Memory
- RDS `CPUUtilization`, `DatabaseConnections`, `FreeStorageSpace`
- ElastiCache `CPUUtilization`, `CurrConnections`, Eviction 관련 지표
- Amazon MQ `MessageCount`, Consumer 수, Connection 수

### S10. Prometheus/Grafana 사용 전/후

| 항목 | Before | After |
|---|---|---|
| 관측 | Actuator endpoint와 로그를 필요할 때 수동 조회 | Prometheus 수집과 Grafana Dashboard |
| 측정 | p95 확인시간, JVM/Pod/API 상관관계 분석시간, Dashboard 준비시간 | 동일 장애의 분석시간 |
| 목표 | API p95와 오류율을 1개 Dashboard에서 확인, 원인 분석 10분 이내 |

CloudWatch와 Prometheus/Grafana는 대체 관계가 아니라 관측 범위가 다르다.

```text
CloudWatch       -> AWS 관리형 서비스, ALB, RDS, Redis, Amazon MQ, AWS 로그
Prometheus       -> Spring/Micrometer, Pod, Kubernetes, 애플리케이션 시계열
Grafana          -> 두 데이터의 시각화와 Before/After 비교 화면
```

### S11. RDB 동기 재고 차감과 Redis Lua 원자 차감

| 항목 | Before | After |
|---|---|---|
| 재고 기준 | RDB Row Lock으로 요청마다 동기 차감 | Redis Lua의 검증과 차감을 단일 원자 연산으로 실행 |
| 측정 | 주문 TPS, p95/p99, DB Lock 대기, Deadlock, Oversell | 동일 지표와 Redis command latency |
| 안전조건 | Oversell 0건, 주문 실패 시 재고 복구 | Oversell 0건, Redis/RDB 최종 재고 일치 |
| 목표 | 정합성을 유지하면서 고부하 p95 감소 또는 TPS 증가 |

백엔드에 `RDB_SYNC`와 `REDIS_ASYNC` 실행 모드를 추가한 뒤 동일 EKS 환경에서 비교한다.

### S12. 동기 RDB 반영과 RabbitMQ 비동기 반영

| 항목 | Before | After |
|---|---|---|
| 방식 | 주문 요청 안에서 RDB 재고 반영 완료 | 주문 응답과 RDB 재고 반영을 Queue로 분리 |
| 측정 | 주문 p95/p99, TPS, 오류율 | 동일 지표와 Queue Lag, 처리 지연, DLQ 수 |
| 안전조건 | 주문과 재고 일치 | Queue 최종 소진, RDB 최종 일치, 유실 0건 |
| 목표 | 주문 응답시간 감소, 메시지 유실 0건, 테스트 종료 후 Queue 정상 소진 |

추가 비교군은 Consumer `1 -> 3 -> 10`이다. Consumer 수가 많아도 같은 상품의 RDB Row Lock 때문에 처리량이 선형으로 증가하지 않을 수 있으므로 Queue 처리량과 DB Lock을 같이 본다.

### S13. 직접 운영과 AWS 관리형 데이터 서비스

Raw 성능은 서로 다른 하드웨어 때문에 공정하지 않을 수 있다. 이 시나리오는 운영시간과 복구능력을 비교한다.

| 서비스 | Before | After | 핵심 지표 |
|---|---|---|---|
| MariaDB | Docker/EC2 직접 운영 | RDS MariaDB | 설치시간, 백업 성공, Restore RTO, 패치 작업 |
| Redis | Docker/EKS 직접 운영 | ElastiCache | 설치시간, Snapshot, 장애 복구, 운영 Pod 수 |
| RabbitMQ | Docker/EKS 직접 운영 | Amazon MQ | Broker 설치, TLS, 패치, 로그 구성, 장애 대응시간 |

목표는 관리 작업 단계와 복구시간 감소다. 관리형 서비스가 항상 더 낮은 API latency를 제공한다고 주장하지 않는다.

### S14. RDS Backup 사용 전/후

| 항목 | Before | After |
|---|---|---|
| 방식 | 별도 백업 없이 DB 운영 | 7일 자동 백업과 복구 절차 |
| 장애 주입 | 테스트 데이터 삭제 | 지정 시점 또는 Snapshot으로 복원 |
| 측정 | 복구 가능 여부, RPO, RTO, 수동 단계 수 | 동일 지표 |
| 목표 | 복원 성공, RPO/RTO 실측값 문서화, 복구 체크리스트 완성 |

### S15. Public 배치와 Private Subnet 분리

보안 구조는 응답속도보다 공격 표면으로 평가한다.

| 항목 | Before | After |
|---|---|---|
| 배치 | DB/Redis/MQ가 Public 접근 가능 | EKS Node, RDS, Redis, MQ를 Private Subnet에 배치 |
| 측정 | Public endpoint 수, `0.0.0.0/0` Ingress 규칙 수, 외부 Port 접근 결과 | 동일 점검 |
| 목표 | ALB 이외 Public endpoint 0개, 데이터 서비스 외부 직접 접근 차단 |

### S16. Secret 수동 관리와 중앙 Secret 관리

| 항목 | Before | After |
|---|---|---|
| 방식 | Kubernetes YAML placeholder 또는 수동 Secret 생성 | AWS Secrets Manager와 External Secrets 연동 |
| 측정 | Git 노출 가능 값 수, Secret 교체시간, 재배포 필요 여부, 접근 감사 가능 여부 | 동일 지표 |
| 목표 | 실제 Secret Git 저장 0건, 교체 절차 10분 이내, 접근 권한 최소화 |

현재는 placeholder만 있으므로 이 시나리오는 아직 구현되지 않았다.

### S17. 프론트 수동 배포와 Vercel Git 배포

| 항목 | Before | After |
|---|---|---|
| 방식 | 로컬 Build 후 정적 파일 수동 업로드 | Git Push/PR 기반 Preview와 Production 배포 |
| 측정 | 배포시간, 개발자 직접 작업시간, Preview 준비시간, Rollback 시간 | 동일 지표 |
| 목표 | PR Preview 자동 생성, 수동 작업시간 70% 감소, 이전 버전 복구 2분 이내 |

S3/CloudFront를 실제로 배포하지 않으면 Vercel과의 직접 성능 비교 결과를 주장하지 않는다. 대신 운영 절차와 선택 근거를 비교한다.

### S18. 모니터링 없는 장애 대응과 Alert 기반 대응

| 항목 | Before | After |
|---|---|---|
| 방식 | 사용자의 오류 신고 이후 로그 조사 | 사전 정의한 Alert가 Slack/Email 등으로 전달 |
| 장애 | 5xx 급증, Pod CrashLoop, MQ 적체, DB 연결 포화 | 같은 장애 반복 |
| 측정 | MTTD, MTTA, MTTI, MTTR | 동일 지표 |
| 목표 | 모든 주입 장애 탐지, MTTD 5분 이내, 복구 Runbook 연결 |

## 4. 우선순위

### P0. AWS Apply 전 완료

- 비교 시나리오와 성공 기준 확정
- 비용 Budget/Alarm 설정
- 기존 Git commit 또는 tag로 baseline 보존
- 실제 Secret을 Git에 저장하지 않는 절차 확정

### P1. 첫 번째 포트폴리오 결과

- S01 Terraform 수동/자동 구축
- S03 Jenkins 수동/자동 배포
- S05 HPA OFF/ON
- S09 CloudWatch OFF/ON
- S11/S12 Redis와 RabbitMQ 처리 구조

### P2. 운영 완성도

- S06/S07 Rolling Update와 Probe
- S08 ALB Target 방식
- S10 Prometheus/Grafana
- S13/S14 관리형 서비스와 복구
- S16 Secrets Manager
- S17 Vercel
- S18 Alert와 장애 대응

## 5. 현재 구현 상태

| 시나리오 | After 코드 | Before 구성 | 실측 결과 |
|---|---:|---:|---:|
| Terraform | 완료 | 수동 실험 필요 | 없음 |
| Remote State | 완료 | Local State 실험 필요 | 없음 |
| Jenkins | Jenkinsfile 완료 | 수동 배포 기록 필요 | 없음 |
| ECR | 완료 | 로컬 이미지 기록 필요 | 없음 |
| HPA | Manifest와 Metrics Server 구성 완료 | Fixed/HPA overlay 완료 | 실제 EKS 실측 없음 |
| Rolling Update/Probe | Manifest 완료 | OFF overlay 필요 | 없음 |
| ALB IP Target | Manifest 완료 | Instance overlay 선택 | 없음 |
| CloudWatch | 로그 Export 일부 완료 | Dashboard/Alarm 필요 | 없음 |
| Prometheus | Actuator endpoint 완료 | Server/Grafana 필요 | 없음 |
| Redis/RabbitMQ | After 로직 존재 | Baseline 실행 모드 필요 | 없음 |
| RDS/ElastiCache/Amazon MQ | Terraform 완료 | 직접 운영 비교 필요 | 없음 |
| Secret 관리 | Placeholder만 존재 | Secrets Manager 미구현 | 없음 |
| Vercel | 기본 설정 완료 | 수동 배포 기록 필요 | 없음 |

## 6. 배포 시작 조건

다음 조건을 만족한 뒤 AWS 리소스 배포를 시작한다.

- P1 실험의 Before와 After 정의가 확정되어 있다.
- 실험마다 변경하는 변수가 하나뿐이다.
- k6 데이터 seed와 결과 저장 위치가 정해져 있다.
- HPA 실험에 필요한 Metrics Server 계획이 있다.
- CloudWatch Dashboard/Alarm 대상 지표가 정해져 있다.
- AWS 비용 Budget과 리소스 종료 절차가 준비되어 있다.
- Terraform `plan`을 검토하고 생성 리소스와 예상 비용을 설명할 수 있다.

## 7. 공식 참고자료

- [Terraform workflow와 Plan](https://developer.hashicorp.com/terraform/tutorials/cli/plan)
- [Terraform State](https://developer.hashicorp.com/terraform/language/state)
- [Jenkins Pipeline](https://www.jenkins.io/doc/book/pipeline/)
- [Kubernetes HPA](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)
- [Amazon EKS ALB Ingress](https://docs.aws.amazon.com/eks/latest/userguide/alb-ingress.html)
- [Amazon CloudWatch](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/)
- [Amazon RDS Automated Backup](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)
- [Amazon ElastiCache Monitoring](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/MonitoringECMetrics.html)
- [Amazon MQ RabbitMQ Metrics](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/rabbitmq-logging-monitoring.html)
- [Vercel Git Deployment](https://vercel.com/docs/git)
- [Vercel Rollback](https://vercel.com/docs/instant-rollback)
