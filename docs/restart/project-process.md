# Terraform 배포·운영 모니터링 프로젝트 진행서

기준일: 2026-11-07 (KST)
현재 단계: 기반/데이터와 ALB HTTPS·서비스별 IRSA·상품 이미지 S3·Kubernetes 설정의 로컬 검증 완료.
AWS 리소스는 아직 생성하지 않았다. 다음은 CI/CD/관측 및 실제 배포 사전 준비다.
인증서 DNS 검증, 실제 계정/Secret/서비스 연결은 아직 미실행이다.

## 1. 확정한 요구사항

- Terraform으로 AWS를 구성한다. Backend는 Spring Boot/EKS, Frontend는 Vue/Vercel이다.
- CI는 Jenkins, Backend CD는 Argo CD, FE는 Jenkins 검증 후 Vercel CLI 배포다.
- Docker로 빌드하고 Backend 이미지는 ECR에 저장한다.
- MariaDB/Redis/RabbitMQ는 RDS/ElastiCache/Amazon MQ 관리형을 사용한다.
- CloudWatch + Amazon SNS로 운영 장애를 알리고 Prometheus + Grafana로 Kubernetes를 관측한다.
- Cost Explorer로 비용을 확인한다. AWS Budgets + SNS도 비용 통제 보조 수단으로 제안한다.
- Cost Anomaly Detection은 코드 설명과 비활성 예제만 남긴다. 실습 배포에는 포함하지 않는다.
- 보유 도메인은 auctionbid.shop이다. SNS 이메일 수신 가능 여부는 확인됐고 주소/구독 승인은 배포 단계에 필요하다.
- 최소 비용이 우선이며 AWS 실제 가동은 측정에 필요한 시간만, 최대 72시간이다. 별도 금액 상한은 아직 사용자 확정 전이다.
- 앱 성능 개선은 금지한다. 실제 오류와 운영을 막는 문제 및 배포 인증/관측 필수 설정만 근거와 함께 최소 수정한다.
- 이전 미커밋 Seed/재고 성능 실험은 이 계획에 포함하지 않는다. 지정 GitHub 소스의 기준 SHA는 다음 앱 점검 단계에 고정한다.
- 단계별 한국어 commit 제목/본문과 검증 결과를 남기고 push한다.

## 2. 권장 최소 실습 구성

서울 ap-northeast-2, Linux On-Demand, 표준 지원 중인 EKS 버전을 사용한다.
아래 사양은 기동/스케줄링 검증 전 후보이며 특정 RPS나 무중단을 보장하는 값이 아니다.

| 리소스 | 후보 | 선택 이유 / 제약 |
|---|---|---|
| EKS | cluster 1개, Managed Node Group | Auto Mode/Fargate를 추가하지 않고 기본 Kubernetes를 학습 |
| Worker | m6i.large 2대, 각 2 vCPU/8 GiB, 서로 다른 AZ | x86 이미지 호환, CPU credit 없는 비교. Spot 중단 변수 제외 |
| Backend | 최초 replicas 2, HPA 실험 2~4 | 실제 requests/allocatable 확인 후 최대치 확정 |
| Argo CD | 비 HA 소형 설치 | 실습용 CD. 단일 장애점이라는 한계 기록 |
| Prometheus/Grafana | EKS 안에 각 1개, Prometheus retention 3일 | 별도 관리형 관측 서비스 비용 제외. Node 자원 점유도 측정 |
| RDS MariaDB | db.t4g.micro 1개, Single-AZ, gp3 20 GB | 기동 최소 후보. 1 GiB 메모리와 CPU credit/DB 병목을 관측 |
| ElastiCache Redis OSS | cache.t4g.micro 1개, replica 없음, cluster mode disabled | 기존 앱의 여러 Redis DB 사용과 호환성 확인. 가용성 실험 범위에서 제외 |
| Amazon MQ RabbitMQ | mq.m7g.medium 1개, SINGLE_INSTANCE | 신규 생성 가능한 평가용. 기본 200 GB 스토리지 별도 계산 |
| ALB | 1개, public subnet 2 AZ, HTTPS | Ingress용. 관리 UI에는 별도 ALB를 만들지 않음 |
| NAT | zonal NAT Gateway 1개 | private Node egress. 타 AZ 전송료와 NAT AZ 장애 한계를 명시 |
| Jenkins | t3.medium 1대, 누적 실행 12시간 가정 | EKS와 빌드 분리. 동시 빌드 1개, JVM/Gradle 메모리 및 CPU credit 관측 |
| k6 | m6i.large 1대, 누적 실행 6시간 가정 | 부하 발생기를 앱 및 Jenkins와 분리, 발생기 CPU도 측정 |
| EBS | 합계 138 GB gp3 가정 | Node 40 + Jenkins 30 + k6 20 + Prometheus 20 + Grafana 8 + 운영/PVC 여유 20 GB |
| S3/ECR | 상품 이미지·State·증거, Backend 이미지 | 소량 사용, 이미지 보존 개수 제한 |

실제 계획 볼륨 118 GB에 운영/PVC 여유 20 GB를 더해 계산했다. Argo CD 저장소용 별도 볼륨은 포함하지 않는다.
Jenkins와 k6의 EBS는 서버를 중지한 시간에도 남아 있으므로 전체 환경 시간만큼 보수적으로 계산한다.
Prometheus는 Node/AZ 장애를 견디는 HA 구성이 아니다. 실험 범위는 앱 배포/HPA/알림이며 데이터 서비스 HA를 주장하지 않는다.
예약 인스턴스/Savings Plans는 계약하지 않고 Free Tier나 보유 크레딧은 비용 절감 계산에 넣지 않는다.

## 3. 새로 확인한 호환성 문제

기존 Infra 변수의 mq.t3.micro는 신규 Amazon MQ 브로커 생성이 불가능하다.
이것은 성능 개선 목적이 아니라 새 배포를 가능하게 하는 필수 구성 변경 대상이다.
공식 문서의 mq.m7g.medium Single instance 기본 디스크는 200 GB다. cluster의 5 GB와 혼동하지 않는다.
엔진/인스턴스 조합은 실제 생성 전 AWS describe-broker-instance-options 등으로 재확인한다.

- https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/rmq-broker-instance-types.html
- https://aws.amazon.com/about-aws/whats-new/2025/07/amazon-mq-supports-graviton3/

## 4. 단가와 72시간 산출

2026-11-06에 AWS 공개 가격표 서울 On-Demand 항목을 조회했다. SKU와 조회시각은 pricing-evidence에 보존한다.
단가 증거: [seoul-2026-11-06.json](pricing-evidence/seoul-2026-11-06.json). 저장소 루트에서 `node docs/restart/pricing-evidence/estimate.mjs`로 계산을 재현한다. 네트워크나 AWS 인증은 필요 없다.
월 단가는 비교 편의를 위해 730시간으로 나누는 근사치이며 실제 월/서비스 청구 규칙과 차이가 날 수 있다.
세금, 환율, 계정 할인, Vercel 유료 플랜은 아래 계산에 포함하지 않았다. 원화 환율은 임의 지정하지 않는다.

| 항목 | 단가 USD | 산식 | 72시간 비용 USD |
|---|---:|---|---:|
| EKS control plane | 0.10/h | 1 x 72 | 7.20 |
| EKS Worker | 0.118/h | 2 x 72 | 16.99 |
| RDS db.t4g.micro | 0.025/h | 1 x 72 | 1.80 |
| ElastiCache cache.t4g.micro | 0.024/h | 1 x 72 | 1.73 |
| MQ mq.m7g.medium | 0.1682/h | 1 x 72 | 12.11 |
| ALB 기본 | 0.0225/h | 1 x 72 | 1.62 |
| NAT 기본 | 0.059/h | 1 x 72 | 4.25 |
| 기본 public IPv4 | 0.005/IP-h | ALB 최소 2 + NAT 1, 72h | 1.08 |
| Jenkins | 0.052/h | 12h | 0.62 |
| k6 | 0.118/h | 6h | 0.71 |
| 임시 EC2 public IPv4 | 0.005/IP-h | Jenkins 12h + k6 6h | 0.09 |
| EBS gp3 | 0.0912/GB-month | 138 x 72/730 | 1.24 |
| RDS gp3 | 0.131/GB-month | 20 x 72/730 | 0.26 |
| MQ RabbitMQ storage | 0.114/GB-month | 200 x 72/730 | 2.25 |
| 합계 (반올림 전 합산) | | | **51.95** |

ALB IP는 확장으로 늘어날 수 있다. Jenkins/k6는 public subnet에서 아웃바운드 통신을 하고 인바운드는 열지 않으며 SSM으로 관리하는 후보다.
Jenkins webhook을 public UI 노출 없이 받기 어렵다면 짧은 SCM polling을 쓰고 그 대기시간을 CI/CD 측정에 포함한다.

### 변동비와 여유분

- ALB: 사용 LCU-hour당 0.008 USD. NAT: 처리 GB당 0.059 USD. AZ 간/인터넷 전송료는 별도다.
- CloudWatch 로그 수집/보관, metric/alarm/dashboard, SNS, S3, ECR, Cost Explorer API 호출은 사용량에 따라 별도다.
- Jenkins/RDS CPU surplus credits, 추가 snapshot/backup, 잔존 리소스도 별도다.
- 소량 트래픽 기준 **변동비·예비비 10~20 USD**를 잡으면 72시간 예산안은 **약 62~72 USD, 세금 별도**다.
- 이 여유분은 사용량 단가 합산 견적이 아니라 계획용 예비비다. 대량 로그/높은 RPS에는 범위를 초과할 수 있다.
- 로그 1 GB, NAT 처리 5 GB, 인터넷 응답 5 GB 이내를 초기 실험 사용량 목표로 두고 실제 수집량을 감시한다. 강제 과금 상한은 아니다.
- 단순 카탈로그 API처럼 요청당 로그가 많은 경로는 실제 로그량을 먼저 확인한다. 동일한 운영 로그 설정을 비교군 모두에 적용한다.
- Vercel은 사용 가능 플랜/계정 사용량을 확인한 후 별도 비용으로 기록한다. AWS Cost Explorer에 나타나지 않는다.

| AWS 환경 유지시간 | 기본/저장소/임시 EC2 합계 | 변동비 예비분 포함 계획 범위 |
|---|---:|---:|
| 12h | 9.84 | 15~25 USD |
| 24h | 18.26 | 25~35 USD |
| 48h | 35.11 | 45~55 USD |
| 72h | 51.95 | 62~72 USD |

모든 행은 Jenkins 12h/k6 6h와 동일한 부하 실험 횟수를 가정한다. 실제 켜진 시간이 달라지면 다시 계산한다.

## 5. 비용을 줄이는 선택과 절충

권장: 준비 완료 후 약 24시간 안에 측정을 끝내고 삭제한다. 72시간은 사용 목표가 아니라 상한이다.
EKS Node를 중지/0개로 해도 control plane 요금은 남는다. 서비스별 중지 기능에 의존하지 말고 종료 시 삭제한다.

| 선택 | 72h 차이 | 판단 |
|---|---:|---|
| Worker 2대를 t3.medium으로 교체 | EC2만 약 9.50 절감 | CPU credit/throttling과 8 GiB 총 메모리 제약. 관측/Argo/앱을 함께 올린 성능 실험에는 비권장 |
| Worker 1대만 사용 | EC2만 약 8.50 절감 | 배포 surge/HPA 여유와 장애 분리 감소. 단순 기동에는 가능하나 이번 측정 기준에서는 2대 유지 |
| public Worker, NAT 제거 | 약 3.89 절감, 처리량 비용 별도 | 네트워크 경계 변경 필요. private Worker 기준 유지, 대안만 기록 |
| Interface Endpoint 여러 개 추가 | 서비스/AZ별 고정비 증가 가능 | 이번에는 NAT 1개와 무료 S3 gateway endpoint를 기준으로 검토 |
| Jenkins를 EKS와 같이 실행 | 별도 EC2 시간 절감 | 빌드가 앱 측정에 간섭하므로 분리 유지 |

Private Node/NAT 1개는 AZ 전체 장애 복원성을 보장하지 않는다. 데이터 서비스도 Single instance이며 실습용 최소 구성이다.
RDS/Redis가 병목이면 먼저 그 사실을 결과로 기록하고, 사양 변경 후 실험은 별도 실험으로 구분한다.

## 6. 도메인과 운영 관측

- 기존 auctionbid.shop DNS 레코드를 읽기 확인한 뒤 미사용 이름을 고른다.
- 제안 이름: devops.auctionbid.shop -> Vercel, api-devops.auctionbid.shop -> ALB.
- 기존 apex/서비스 레코드를 덮어쓰지 않는다. DNS 제공자는 유지하며 Route 53 신규 zone 비용은 기준 견적에서 제외한다.
- ACM은 ALB와 같은 서울 리전의 일반 비수출 공개 인증서. DNS 검증 레코드는 확인 후 추가한다.
- FE 정적 자산은 Vercel CDN, API는 브라우저에서 서울 ALB로 직접 호출한다. API proxy를 추가하지 않는다.
- CloudWatch는 우선 ALB UnHealthyHostCount, ALB/Target 5xx, RDS CPU/메모리 등 최소 신호를 사용한다.
- CloudWatch Alarm -> Amazon SNS 운영 Topic -> 이메일. Budget 알림은 별도 Topic으로 구분한다.
- SNS 이메일 구독 승인 후 실제 시험 메일 수신까지 검증한다. SNS publish 시각과 수신 시각은 별도 기록한다.
- CloudWatch 로그는 필요한 앱/감사 로그만, 보관 3일. Prometheus retention 3일, 증거는 삭제 전에 외부로 내보낸다.
- Container Insights 전체/고빈도 custom metrics는 기본 활성화하지 않는다. Pod 지표는 Prometheus로 수집한다.
- Budget 제안 금액은 75 USD, 실제 비용 25/50/75 USD에서 알림. 이 금액은 사용자 승인된 과금 상한이 아니며 예산안이다.
- Cost Explorer/Budgets 지연 때문에 실시간 비용 차단은 불가하다. 최초 생성 시 종료 예정시각을 기록하고 실제 삭제를 확인한다.

## 7. 가동 전부터 삭제까지 순서

### AWS 생성 전

1. 원격 기준 BE/FE를 깨끗하게 읽고 build/기동/의존성/보안 운영 오류를 점검한다.
2. Terraform 새 구성, Jenkins/Argo 역할 분리, Vercel 설정, 관측 manifest, 읽기 중심 k6와 결과 기록을 준비한다.
3. 수동 배포 절차와 자동 배포 절차가 같은 이미지/명령을 쓰게 한다. 앱 알고리즘 변경 없이 실험한다.
4. 요청 자원/Node allocatable 예산, 지원 EKS/DB/Redis/MQ 버전, Terraform/Helm 버전을 확인·고정한다.
5. AWS 계정/권한, SNS 이메일, DNS 권한, 비용안과 Terraform plan을 확인한다. State/Budget 등 먼저 생성하는 자원도 추적한다.

### 권장 24시간 집중 운영 (최대 72시간)

1. T+0~4h: State/Budget/SNS, VPC/ECR, EKS/데이터 서비스를 생성한다. 생성 대기시간도 비용에 포함한다.
2. T+4~8h: ALB Controller, HTTPS, 앱, Argo CD, CloudWatch/Prometheus/Grafana를 연결한다. FE는 Jenkins 검증 후 Vercel로 배포한다.
3. T+8~18h: 수동/자동 배포, Recreate/RollingUpdate, requests, 고정/HPA, 장애 탐지 실험을 각각 통제된 조건으로 수행한다.
4. T+18~22h: 실패 실험 재확인, Git rollback, 로그/지표/이미지 digest/타임스탬프/대시보드와 원시 결과를 내보낸다.
5. T+22~24h: 종료 절차를 실행하고 잔존 자원 목록을 확인한다. 장애 시 예비 시간을 사용하되 72h 전에 종료한다.
6. 삭제 후 Cost Explorer 데이터 갱신을 기다려 비용을 정산한다. 비용 조회를 위해 EKS를 계속 켜두지 않는다.

### 종료 순서

1. Jenkins 예약/자동 작업 및 Argo 자동 재생성을 멈추고 결과를 저장한다. 순서는 GitOps 소유권에 맞게 수행한다.
2. 앱/Ingress를 정리하고 Controller가 ALB/Target Group을 제거했는지 확인한다. Controller/EKS를 먼저 삭제하지 않는다.
3. PVC/PV 정책을 확인하고 필요한 데이터만 보존한다. CSI가 필요한 볼륨 정리를 끝낸 뒤 Node를 제거한다.
4. 이번 실습에서 생성한 RDS/Redis/MQ와 snapshot 보존 결정을 확인하고 제거한다. MQ의 ENI를 수동 강제 삭제하지 않는다.
5. Terraform 의존성 순서로 EKS Node/cluster, 임시 EC2, NAT/EIP, SG/VPC 등을 제거한다.
6. 보유 도메인의 이번 실험 레코드만 정리한다. ECR/S3/로그/Budget/State는 보존/삭제 대상을 따로 기록한다.
7. AWS 리소스 목록과 Terraform state를 함께 확인한다. destroy 성공만으로 모든 잔존 비용이 없다고 단정하지 않는다.

## 8. 실험의 범위와 검증 기준

- 고정 이미지와 데이터, 동일 부하/Node/로그 설정, 최소 3회 반복으로 비교한다.
- 무중단 배포: HTTP 5xx 외 timeout/연결 오류/최대 연속 장애시간, SSE 재연결을 포함한다.
- requests 변경은 앱 성능 코드 변경이 아니다. Node 수가 같으면 requests 감소만으로 EC2 비용 절감을 주장하지 않는다.
- HPA는 Node 자동 증설과 구분한다. 2~4 Pod를 수용하는지 관측 도구 포함 자원 예약량으로 확인한다.
- 리소스 조정 전후에는 원래 부하 조건을 반복하며 이미지, DB Pool, 스레드 수를 바꾸지 않는다.
- 장애 발생/CloudWatch Alarm/SNS 수신/정상화 시각을 기록한다. 강제 Alarm 상태 변경은 전달 테스트에만 사용한다.
- Jenkins vs Actions, Vercel vs S3+CloudFront 비교는 이번 3일 필수 일정에서 제외하고 추가 요청 시 별도로 설계한다.

## 9. 이번 단계 수행 기록

- 사용자 결정: 최소 비용, 최대 3일, 관리형 데이터 서비스와 Jenkins -> Vercel 동의, auctionbid.shop, SNS 수신 가능.
- 읽기 확인: 기존 Infra mq.t3.micro 기본값, AWS 신규 생성 제한, 공식 서울 가격표의 사용량/단가.
- 결과: 24h 계획 25~35 USD, 72h 계획 62~72 USD (세금/계정 외 비용 제외). 실제 실측이나 청구 결과가 아니다.
- 검증: 공개 가격표 조건/SKU 추출, 단가 x 수량 x 시간 계산, 문서 diff 검사.
- 이번 단계에서 수행하지 않은 것: AWS 계정 리소스 생성/삭제, DNS 변경, 앱 코드 변경.
- 다음 단계: BE/FE의 운영 가능성 점검 및 실제 배포 차단 문제 목록 작성. 그 결과로 IaC 사양을 최종 확정한다.
- Git 브랜치: codex/restart-cost-plan. 커밋 제목: 새 요구사항 기반 최소 운영 비용과 수행 계획 정리.

## 10. 공식 근거

- EKS 표준지원/연장지원: https://aws.amazon.com/eks/pricing/
- Public IPv4 및 NAT: https://aws.amazon.com/vpc/pricing/
- MQ 타입/디스크: https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/rmq-broker-instance-types.html
- EC2 서울 가격표: https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-2/index.json
- RDS 서울 가격표: https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ap-northeast-2/index.json
- Redis 서울 가격표: https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonElastiCache/current/ap-northeast-2/index.json
- MQ 서울 가격표: https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonMQ/current/ap-northeast-2/index.json
- ALB 서울 가격표: https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ap-northeast-2/index.json
- CloudWatch 사용량 과금: https://aws.amazon.com/cloudwatch/pricing/
- Cost Explorer 갱신: https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html
- Vercel 리전: https://vercel.com/docs/regions

## 11. 2단계 — 애플리케이션 배포 준비 점검

2026-11-06: GitHub main 기준의 깨끗한 BE/FE checkout에서 점검했다. 기존 로컬 미커밋 변경은 보존했다.

- BE 기준: 15de89623b441bd97921e42a80f6028572407f1b. 기존 14개 테스트/빌드 통과 후 보안 결함 재현 및 최소 수정, 최종 20개 테스트/bootJar 통과.
- FE 기준: a1218dcbe0f58e07b5c4f5bc87ac8a85052a17a4. 빌드/lint 통과, 인증 갱신 반복 오류 수정 후 회귀 테스트 5개 추가 통과.
- BE/FE 작업 브랜치: codex/deployment-readiness. 본 Infra 문서 브랜치: codex/restart-cost-plan.
- 상세 내용: [배포 가능성 점검과 다음 작업](application-readiness.md).
- 최초에는 Docker 엔진이 꺼져 있었지만, 사용자 기동 후 Java 11/Linux Docker 빌드와 로컬 통합 확인 13개까지 완료했다. AWS 생성/DNS 변경/Vercel 배포는 하지 않았다.
- 다음 단계: 아래 점검서의 조건을 반영한 IaC·배포 설정을 작성하고 정적 검증한다. 비용 발생 전 Terraform plan과 생성 대상을 확인한다.

### Docker 추가 검증

- 앱 코드 39bd52c 기준으로 새 이미지를 빌드했다. 기존 바탕화면 이미지는 2026-07-30 생성된 별도 이미지였다.
- 검증용 orderpage-readiness 프로젝트/DB 볼륨과 loopback 18080을 사용했다. 기존 데이터는 보존했다.
- 헬스체크, 가입/로그인, 권한 차단, refresh, CORS, SSE 최초 연결, 주문 Redis→RabbitMQ→MariaDB 반영을 확인했다.
- 검증 후 새 컨테이너는 중지하고 기존 order-be-deploy 네 컨테이너를 다시 실행했다.
- 기능 smoke는 통과했지만 compose stop에서 SIGTERM 뒤 SIGKILL/137이 발생했다(OOMKilled=false). 종료 유예시간과 SSE/Spring 종료 처리는 롤링 배포 전에 재검증한다.
- [빌드 환경·13개 결과·재현 명령·한계](https://github.com/leem5514/OrderPage_BE_DevOps/blob/codex/deployment-readiness/docs/container-verification.md)

## 12. 3단계 — 종료 처리와 Probe 분리 완료

이전 강제 종료 관측 후 graceful shutdown/SSE 정리/종료 예산을 수정하고 실제 검증했다.

- DB 중지: liveness 200 / readiness 503. 복구 후 readiness 200, 앱 재시작 없음.
- SSE 활성/유휴 종료: 각각 1.502초 / 1.171초, SIGKILL 없이 SIGTERM 종료(143).
- BE 테스트 22개, 기존 기능 smoke 13개, Java 11 Docker 빌드, Kustomize dev 렌더 성공.
- startup/readiness/liveness 경로, Pod 종료 60초와 preStop 5초, ALB readiness 경로를 manifest에 반영.
- 이 결과는 로컬 검증이며 AWS/EKS 롤링 배포 완료나 개선율 산정은 아니다.
- [상세 변경과 다음 조건](lifecycle-readiness.md)

## 13. 4단계 — 기반 Terraform 검증 및 폐기 코드 정리

- BE/FE/Infra PR #1 병합 후 main에서 codex/terraform-foundation 작업.
- dev root를 VPC/ECR/EKS로 한정하고 데이터/Controller는 후속 검토 대상으로 분리.
- 서울 2 AZ/private Node, NAT 1개/S3 Gateway, EKS 1.35 STANDARD, AL2023 m6i.large 2대, /32 API 접근, 명시적 운영자 Role, 암호화 gp3/IMDSv2/3일 로그 반영.
- 폐기한 재고 비교/직접 kubectl Jenkins 배포/빈 prod·IAM 템플릿/중복 옛 문서 등 13개 파일 삭제.
- 현재 사용하지 않는 root 입력·출력, AL2, 개방 기본값, autoscaler 전제 desired_size 무시 설정 제거.
- Terraform validate 및 mock plan 6개 통과. 실제 AWS plan/apply는 아직 실행하지 않음.
- [파일별 역할·삭제 근거·한계·다음 입력](terraform-foundation.md)

## 14. 5단계 — 관리형 데이터 서비스와 접근 경계 연결

- PR #2의 기반 커밋에서 codex/managed-data-services로 분리해 작성. PR #2 미병합 상태에서 후속 PR은 기반 브랜치를 대상으로 작성한다.
- RDS MariaDB 10.11.x/db.t4g.micro, Redis 7.1/cache.t4g.micro, MQ RabbitMQ 4.2/mq.m7g.medium을 private subnet에 연결.
- VPC 전체 CIDR 허용을 없애고 EKS SG에서 각 서비스 포트만 허용. RDS TLS, Redis TLS/AUTH, MQ AMQPS.
- 실제 patch/인증값 필수 입력, 로그 3일/짧은 백업/실습 종료 정책, OIDC 공급자 추가.
- 사용하지 않는 HA/TLS OFF/성능 튜닝 configuration과 Redis reader endpoint 등 제거.
- Terraform validate 및 mock 12개, AWS 없이 MQ 로그 후처리 스크립트 테스트 7개 통과.
- 현재는 코드 검증이다. 관리형 서비스 실제 생성/TLS 접속/SNS 알림은 아직 수행하지 않았다.
- [상세 절차·변수·실제 검증 체크·다음 사전 결정](managed-data-services.md)

## 15. 6단계 — HTTPS·서비스별 권한·Kubernetes 준비

- 사용자 선택: 상품 이미지 전용 S3 버킷의 HTTPS 읽기만 공개, 백엔드 IRSA에 업로드 권한 부여.
- ACM은 서울 API 하위 도메인 인증서 요청만 구성. DNS 제공자/기존 레코드는 자동 변경하지 않음.
- Controller 정책/chart v3.6.2 고정, 정확한 ServiceAccount/STS 신뢰. 별도 수동 IAM/SA 생성 코드 제거.
- 기본 Pod 2개/HTTPS/ALB readiness gate/CA ConfigMap 연결, 가짜 Secret과 중복 튜닝 override 제거.
- 실제 Terraform 출력과 digest로 배포 파일 생성. 다른 계정·미완성 값·비밀 입력 거부.
- Terraform mock 15개, Kubernetes/Helm/Secret 검증 7개, 설치 스크립트 모의 테스트 5개 통과.
- BE/FE 코드 변경 및 AWS 리소스 생성은 하지 않음. SSE heartbeat/재연결, 실제 관측/CI/CD는 후속 작업.
- [파일 역할·최초 적용 순서·정리 내역·검증 한계](https-app-deployment.md)
