# CloudWatch·SNS와 비용 관측 준비

2026-11-08 KST. 이번 단계는 AWS 기본 관측 코드와 로컬 검증이다. 실제 AWS 생성/유료 조회/SNS 발송은 하지 않았다.
Prometheus·Grafana 설치 및 앱 로그 수집은 다음 별도 단계다. 이 문서의 완성은 전체 모니터링 완료를 뜻하지 않는다.

## 1. 선행 PR 검토와 병합

- FE PR #2: 변경 9개 파일, 앱 소스/의존성 변경 없음, FE 테스트 9개 재통과. main 병합 SHA: `91096b06d722f1c0dc39d56d23ed423dcf2a9a18`.
- Infra PR #6: 변경 14개 파일, 실제 배포 비활성/토큰 분리/사전 확인/실패 처리 검토, 기존 테스트 23개 재통과. main 병합 SHA: `eb95ca26d9e8970fd1db8c6021d36c3d6d570073`.
- FE → Infra 순서로 병합. GitHub checks/status는 0개였으며 로컬 검증과 구분한다. 두 로컬 main에도 반영했다.
- Vercel 실제 계정·CDN 동작과 Jenkins Job은 아직 검증하지 못했다. 기존 문서의 미실행 범위를 유지한다.

## 2. 왜 이 순서인가

먼저 AWS가 기본 제공하는 지표로 데이터 서비스와 API 진입점 상태를 확인한다. 별도 CloudWatch Agent/Container Insights 비용을 이번 단계에 추가하지 않는다.
CloudWatch Alarm이 조건을 평가하고 Amazon SNS가 이메일을 전달한다. SNS는 RabbitMQ 주문 메시지를 처리하는 Amazon MQ와 역할이 다르다.
Prometheus·Grafana는 이후 Pod/Node/컨테이너/JVM/API 지표와 p95/리소스 실험을 담당한다. 서로 다른 수집 범위를 같은 서비스로 간주하지 않는다.

| 단계 | 역할 | 현재 상태 |
|---|---|---|
| CloudWatch 기본 metric/Alarm/Dashboard | RDS·Redis·MQ·ALB·EC2 상태 | Terraform 코드 작성, 실제 수집 전 |
| Amazon SNS | 장애/복구/결측 이메일 | 코드 작성, 실제 주소/구독 승인 전 |
| 기존 CloudWatch Logs | EKS control plane, RDS, Redis, MQ | 기존 코드/3일 보관 절차 유지, 실제 생성 전 |
| 앱 stdout 로그 수집 | API 오류 원인 추적 | 다음 Kubernetes 관측 단계 |
| Prometheus/Grafana | Pod/Node/JVM/API와 실험 결과 | 다음 단계 |
| Cost Explorer | 날짜/서비스별 실제 비용 확인 | 최초 활성화 절차와 조회 코드 작성 |
| Budgets | 계정 월 비용 알림 보조 | 금액 미확정, null 기본으로 생성 안 함 |
| Cost Anomaly Detection | 장기 비용 패턴 이상 탐지 | 요청대로 전부 주석, 생성 안 함 |

## 3. 파일별 역할

- terraform/modules/operations-monitoring: SNS/경보/Dashboard/선택 Budget. 주요 판단 근거를 코드 위 주석에 기록.
- terraform/envs/dev/monitoring.tf: 기존 데이터 모듈의 실제 식별값과 연결. enable_operations_monitoring=false 기본.
- terraform/modules/elasticache/outputs.tf: 단일 member CacheClusterId 출력. 복제 그룹 ID를 경보 dimension으로 잘못 쓰지 않게 함.
- terraform/modules/amazonmq/outputs.tf: Broker 이름 출력. ID/ARN과 구분.
- terraform/envs/dev/cost-anomaly.disabled.tf: monitor/subscription의 설명용 주석만 있음.
- scripts/export-costs.mjs: 로그인 계정 검증 후 날짜/서비스별 Cost Explorer 응답을 로컬 보관. AWS 자원을 변경하지 않음.
- monitoring/cost-settings.example.json: 계정/날짜 입력 예시. 예시값 그대로 실행하면 실패함.
- terraform/envs/dev/tests/monitoring.tftest.hcl, scripts/tests/cost-report.test.mjs: AWS 미접속 모의 검사.

## 4. 경보의 초기 조건

다음 값은 검증 가능한 초기 가설이다. 운영 적정값이나 성능 개선 실측이 아니다. 기본 지표는 60초 집계 3개 중 2개가 위반하면 ALARM이다.

| 경보 | 조건 | dimension/의미 |
|---|---|---|
| RDS CPU | Average > 80% | DBInstanceIdentifier |
| RDS 여유 메모리 | Average < 128 MiB | FreeableMemory, JVM heap과 다름 |
| RDS 여유 저장소 | Minimum < 2 GiB | FreeStorageSpace |
| Redis 메모리 | Average > 80% | CacheClusterId + CacheNodeId=0001 |
| Redis 호스트 CPU | Average > 80% | 2 vCPU 소형 노드의 전체 CPU. 엔진 단일 스레드 병목 전체를 판정하지 못함 |
| MQ 준비 메시지 | Maximum > 100개 | Broker 이름. RabbitMQ 4.x의 Queue/VirtualHost 차원을 사용하지 않음 |
| ALB healthy target | Minimum < 1개 | LoadBalancer + TargetGroup. 최소 1개 정상 기준이며 Pod 2개 유지 보장은 아님 |
| ALB 자체 5xx | 분당 Sum >= 5건 | LoadBalancer, ALB 생성 오류 |
| Target 5xx | 분당 Sum >= 5건 | LoadBalancer + TargetGroup, 앱 응답 오류 |
| Jenkins EC2 | StatusCheckFailed > 0 | 300초 집계 2/2. Jenkins 프로세스 생존 검사는 아님 |

지속 지표는 결측을 정상으로 보지 않고 INSUFFICIENT_DATA로 알린다. 5xx는 오류가 없으면 지표가 없을 수 있어 notBreaching을 사용한다.
5xx 경보의 OK만으로 API 가용성을 입증하지 않는다. HealthyHostCount/실제 HTTP 부하 결과도 함께 확인한다.
2/3 평가가 정확히 2분 내 메일 도착을 보장하지 않는다. 수집/평가/CloudWatch 추가 조회 범위와 SNS/메일 전달 지연을 실측한다.
결측 상태가 계속 유지되면 계속 메일이 오는 구조가 아니다. 상태 전환 알림과 실험 전 Dashboard 확인을 함께 사용한다.

## 5. 실제 실행 순서 — 아직 미실행

1. 운영자 AWS 프로필/서울 리전/대상 계정을 확인한다. 보호된 tfvars에 실제 operations_email을 입력하고 enable_operations_monitoring=true로 설정한다.
2. 기존 foundation와 함께 terraform plan을 확인한다. 최초에는 RDS/Redis/MQ 경보 6개와 SNS topic/subscription 1개, Dashboard 1개. Jenkins 활성화 시 EC2 경보 1개가 추가된다.
3. 생성 목록/비용/종료 시각을 검토한 계획으로 apply한다. 지금 대화에서 apply는 실행하지 않았다.
4. 수신한 SNS 확인 메일의 구독 승인 링크를 사용자가 승인한다. 구독의 PendingConfirmation 해제를 확인한다.
5. 기존 MQ 로그 보관 후처리를 실행한다. [관리형 데이터 절차](managed-data-services.md)를 따른다.
6. 실제 데이터 포인트를 확인한다. 값이 없으면 임계값을 낮추는 대신 dimension/리전/서비스 상태부터 확인한다.
7. Controller/Ingress 배포 후 해당 Ingress의 ALB와 TargetGroup을 조회한다. 기존 서비스가 아닌지 VPC/태그/Ingress DNS/등록 대상까지 대조한다.
8. ALB ARN의 `app/이름/16자리id`, TargetGroup ARN의 `targetgroup/이름/16자리id`를 monitoring_alb에 넣고 2차 plan/apply로 경보 3개를 추가한다. 전체 ARN이나 DNS를 넣지 않는다.
9. terraform output operations_monitoring에서 alb_connected=true와 총 9개(또는 Jenkins 포함 10개) 경보를 확인한다.
10. SNS 전달 확인 → 실제 장애 탐지 → 복구 실험을 분리해 수행한다. 결과 원본은 .local 또는 별도 증거 저장소에 보관한다.

필요한 운영 값은 수신 이메일, 선택 Budget 금액, 실제 생성된 ALB/TG다. 이메일/계정 비용/원본 state를 Git에 올리지 않는다.
ALB를 재생성하면 suffix가 바뀔 수 있어 경보 입력도 갱신해야 한다. Terraform이 Controller 소유 ALB를 중복 생성하거나 가져와 관리하지 않는다.
현재 구현은 단일 Redis 노드에 맞췄다. replica/cluster mode를 추가하면 각 노드 경보 구성을 다시 설계해야 한다.

## 6. 장애 탐지 비교 시나리오

실제 실험은 폐쇄된 실습 환경에서 별도 수행한다. 이번 단계에서는 DB 중지/Pod 삭제/Alarm 강제 변경을 하지 않았다.

| 비교군 | 관찰 방식 | 동일하게 고정할 것 |
|---|---|---|
| 수동 확인 | 알림을 참조하지 않고 60초 간격으로 상태 확인 | 이미지·부하·장애 종류·지속시간·시간 동기화 |
| CloudWatch + SNS | Alarm과 수신함으로 탐지 | 같은 지표·임계값·반복 횟수, 장애 주입 시점은 관찰자에게 숨김 |

먼저 전달 경로만 시험한다. SNS 직접 publish 또는 별도 시험 Alarm의 상태 변경은 전달 기능 확인이며 실제 장애 탐지 시간에 포함하지 않는다. 운영 경보를 강제로 ALARM으로 만들고 실제 장애 실험으로 기록하지 않는다.

실제 장애 예시는 읽기 부하를 유지한 상태에서 실습 API의 모든 target을 일시적으로 준비 실패 상태로 만들고 복구하는 것이다. 실행 전 GitOps 자동 복구/Argo 설정과 원래 replicas를 기록해 실험이 즉시 덮어써지지 않게 준비한다. DB/Redis 데이터 삭제는 필요 없다.
ALB의 등록 해제 과정에서 HealthyHostCount가 결측이면 INSUFFICIENT_DATA 사건으로 기록한다. 이를 임계값 위반 ALARM 도달로 바꿔 기록하지 않는다.

각 실행에서 아래 UTC 시각과 증거를 기록한다. 최소 3회 반복하며 원본 상태/지표가 정상으로 회복된 후 다음 실행을 시작한다.

- t0: 장애 주입 완료, 실제 HTTP 실패가 시작된 시각도 별도 기록
- t1: 수동 관찰 시각 또는 Alarm History의 ALARM/INSUFFICIENT_DATA 전환 시각
- t2: SNS 이메일 수신 시각(메일 Received 헤더/수신함 증거). SNS 발행 시각과 혼동하지 않음
- t3: 복구 조치 완료
- t4: 정상 HTTP/ready 상태 확인
- t5: Alarm OK 전환 및 복구 이메일 수신 시각 각각 기록

탐지=t1-t0, 알림 전달=t2-t1, 사용자 알림까지=t2-t0, 조치 후 복구=t4-t3, 전체 장애=t4-t0.
수동/자동 각각의 중앙값·최솟값·최댓값과 실패/누락 횟수를 제시한다. 개선율은 `(수동 중앙값-자동 중앙값)/수동 중앙값*100`으로 계산하고 음수도 그대로 기록한다.
알림이 오지 않은 실행은 버리지 않고 실패로 기록한다. 3회 결과로 안정적인 p95를 주장하지 않는다. 관측 코드를 넣어 앱 처리량이 빨라졌다고 주장하지 않는다.

## 7. Cost Explorer 준비와 조회

Cost Explorer 최초 활성화는 Billing 콘솔에서 진행한다. Terraform이 계정 전체 설정을 임의로 변경하지 않는다.
Project 비용 할당 태그를 쓰려면 실제 리소스에 붙은 Project 태그를 Billing의 cost allocation tags에서 활성화한다. 태그 표시/활성화와 비용 반영에는 지연이 있어 3일 실험에서는 태그 결과가 비어 있을 수 있다.
AWS가 지표를 제공하는 CloudWatch와 달리 비용 데이터는 실시간이 아니다. 종료 당일 결과와 종료 후 갱신된 결과를 모두 보관한다.

```powershell
# AWS 로그인은 별도 준비. 예시는 계정/날짜를 반드시 바꾼다.
Copy-Item monitoring/cost-settings.example.json .local/cost-settings.json
node scripts/export-costs.mjs .local/cost-settings.json
```

- accountId: 현재 로그인한 12자리 계정. 조직 관리 계정에서도 LINKED_ACCOUNT 필터로 해당 계정만 조회한다. 다른 멤버 계정은 그 계정 프로필로 실행한다.
- start/end: UTC 날짜, 시작 포함/종료 제외. 최대 7일. KST의 하루와 UTC 하루는 다르므로 가동 시각과 함께 기록한다.
- projectTagValue: 최초에는 null. 활성화 확인 후 orderpage로 설정하면 account 전체와 Project 태그 비용을 따로 조회한다.
- DAILY/SERVICE/UnblendedCost를 사용하며 금액 원본 문자열·Estimated·API 원본 페이지를 보존한다. 빈 결과는 no-data이고 비용 0으로 해석하지 않는다.
- 각 범위 최대 10페이지, 전체 최대 20회 CE 요청. 자동 pagination/재시도를 끄고 API 오류나 상한 초과 시 부분 성공 보고서를 만들지 않는다.
- 보고서는 .local/cost/시각/cost-report.json. API 요청에는 비용이 있으므로 실험 중 하루 1회와 종료 후 정산 확인 정도로 제한한다. 초기 STS 계정 조회는 CE 요청 횟수에 포함하지 않는다.
- 읽기 권한은 sts:GetCallerIdentity 및 ce:GetCostAndUsage 범위가 필요하다. 조회 권한을 앱/Node/Jenkins 역할에 추가하지 않았다.

Project 태그 결과는 태그가 연결된 부분 비용이다. Controller 생성 ALB, EKS Node EC2/EBS 등은 태그 전파를 별도로 확인해야 한다. 태그로 못 잡힌 비용과 NAT/공유 비용을 누락한 채 프로젝트 총액으로 발표하지 않는다.
계정 전체 조회는 기존 서비스 비용까지 포함한다. 실습 전 같은 기간의 사용 패턴과 리소스 가동 시간/공개 단가로 대조하며 증가분을 모두 프로젝트 비용으로 단정하지 않는다.
Vercel 요금은 별도로 기록한다. 무료 크레딧/세금/환불/할인 때문에 UnblendedCost와 최종 청구액이 다를 수 있으므로 Billing 청구와도 대조한다.

## 8. 선택 Budget과 비활성 Anomaly

monthly_budget_usd는 null 기본이다. 실제 금액을 정한 뒤 입력하면 계정 전체 월 누적 ACTUAL 비용의 80%/100% 초과를 SNS로 알린다.
3일 프로젝트만의 비용 상한이 아니며 기존 계정 사용료가 포함된다. 청구 데이터 지연 때문에 금액을 넘기기 전에 알림을 보장하지 못한다. 자동 리소스 중지/삭제/Budget Action은 구성하지 않았다.
Cost Anomaly는 전부 주석이다. 장기 사용으로 전환할 때 계정의 기존 SERVICE monitor 중복 여부와 학습/탐지 조건을 다시 검토한다.

## 9. 비용과 검증 한계

실제 비용은 기본 metric 제공 범위 외 경보 수, Dashboard, SNS 메시지, 기존 로그 수집·보관, CE 요청에 따라 달라진다. 새 Container Insights/custom metric/상시 비용 수집 스케줄러는 추가하지 않았다.
CloudWatch 경보와 SNS가 있다고 자동 비용 상한이 생기지는 않는다. 최대 72시간 운영 후 기존 종료 절차로 자원을 제거하고 잔존 비용을 확인한다.

검증 결과:

- Terraform 1.16.2 / AWS provider 5.100.0: fmt, validate 통과. 전체 mock 테스트 22개 통과(기존 16개 + 관측 모듈 5개 + root 활성화 연결 1개).
- Node 22.23.4: Infra npm test 총 30개 통과(기존 23개 + 비용 조회/비활성 Anomaly 검사 7개).
- 문서 로컬 링크와 git diff 검사 통과. 새 계정/금액/메일 같은 실제 개인정보는 커밋하지 않음.
- Windows 샌드박스의 provider 통신 제한은 제한 밖의 로컬 mock 실행으로 확인했다. 파일 필터가 0개를 선택한 실행은 성공 집계에서 제외하고 전체 테스트를 실행했다.

재현 명령(저장소 루트):

```powershell
terraform fmt -check -recursive terraform
terraform -chdir=terraform/envs/dev init -backend=false -input=false -lockfile=readonly
terraform -chdir=terraform/envs/dev validate
terraform -chdir=terraform/envs/dev test
node --test scripts/tests/cost-report.test.mjs
```

전체 npm test에는 기존 Kubernetes/Helm 렌더가 포함된다. KUBECTL/HELM과 LBC_CHART/ARGO_CHART의 고정 로컬 chart 경로를 설정하는 방법은 [CI/CD 검증 문서](jenkins-argocd.md)를 따른다.
Terraform mock은 실제 서비스 지표 차원/수신 권한/메일 전달/임계값 적합성의 실증이 아니다.
AWS 인증 계정, SNS 승인, real datapoint, 실제 장애 시간, Cost Explorer 청구 결과는 아직 미검증이다.

## 10. 공식 근거

- [CloudWatch Alarm → SNS 및 권한](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Notify_Users_Alarm_Changes.html)
- [ALB 지표와 차원](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-cloudwatch-metrics.html)
- [Redis 노드 지표 차원](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/CloudWatchMetrics.html)
- [Amazon MQ RabbitMQ 지표](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/rabbitmq-logging-monitoring.html)
- [Cost Explorer 활성화·갱신](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-enable.html), [비용 태그 활성화](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/activating-tags.html)
- [Cost Explorer API 요금](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/), [Budget SNS 권한](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-sns-policy.html)
