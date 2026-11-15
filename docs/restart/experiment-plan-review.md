# 배포 전 계획 검토와 배포 후 비교 실험 자료

기준일: 2026-11-14 KST. 이 단계는 **실행 도구·측정 양식·검토 절차**를 준비한다. AWS 계정의 Terraform plan, EKS 배포, Prometheus 시계열, CloudWatch 경보와 성능 개선율은 아직 없다.

## 1. 지금 확인한 Terraform plan 상태

- 로컬 `terraform fmt`, `init -backend=false`, `validate`, mock test 22개는 통과했다. 이는 AWS 계정의 실제 상태를 읽지 않는다.
- 현재 CLI에는 이전 점검에서 STS `InvalidClientTokenId`였던 `default` 프로필만 있다. 이번 셸의 재조회는 STS 엔드포인트 연결 단계에서 실패해 인증 재판정도 못 했다. dev `terraform.tfvars`, 원격 state `backend.hcl`, bootstrap 변수 파일도 없다. 따라서 **실제 plan 파일은 생성되지 않았다**. mock 테스트 결과를 실제 plan으로 부르지 않는다.
- 코드상 최초 생성 후보는 S3 원격 state(별도 bootstrap), VPC/2 AZ subnet/NAT/EIP, ECR, EKS/Node/add-on, RDS, Redis, Amazon MQ, ACM, 상품 이미지 S3와 IAM 역할이다. Jenkins EC2와 CloudWatch/SNS는 기본 `false`, Budget은 null, Cost Anomaly는 전부 주석이다.
- ALB/Target Group은 AWS Load Balancer Controller가 Ingress 적용 뒤 만든다. Argo CD·Prometheus·Grafana·Metrics Server는 Helm/Kubernetes에서 설치하고, Vercel은 별도 배포한다. 이 대상들은 **초기 Terraform plan에 나타나지 않는다**. plan만 보고 전체 배포 비용을 계산하지 않는다.

실제 계정 인증·입력값·원격 state·비용은 [AWS plan 사전 점검](aws-plan-preflight.md)을 먼저 따른다. 민감 값이 준비된 뒤, 저장소 루트에서 다음을 실행한다. `plan`은 생성/삭제를 실행하지 않지만 결과에 민감 값이 들어갈 수 있다.

```powershell
$env:AWS_PROFILE = 'orderpage-lab' # 확정된 실제 프로필명으로 교체, 현재 터미널에만 적용
aws sts get-caller-identity --profile $env:AWS_PROFILE --region ap-northeast-2
terraform -chdir=terraform/envs/dev init -reconfigure -backend-config=backend.hcl
terraform -chdir=terraform/envs/dev plan -input=false -out=foundation.tfplan
node scripts/review-terraform-plan.mjs terraform/envs/dev/foundation.tfplan
```

`backend.hcl`은 dev root 안에 만들어야 한다. 출력 파일 `foundation.tfplan`, `.local/plan-reviews/`는 Git에서 제외한다. 공유/업로드하지 않는다. 검토 도구가 `terraform show -json`을 직접 실행해 원시 JSON을 파일로 저장하지 않는다. plan 생성과 검토 사이에 프로필을 바꾸지 않는다. 같은 계정의 STS 결과와 생성·교체·삭제 수, 모든 비용 유발 자원, IAM/공개 접근, 임시 EC2/Jenkins/관측 활성화값을 검토한다. Plan 요약기는 `resource_changes`의 action·주소·타입만 복사하며 암호/`after` 값은 복사하지 않는다. 삭제 또는 교체가 있으면 종료코드 2로 멈추고 원인을 검토한다. 요약기는 **금액 계산이나 AWS 계정 인증을 대신하지 않는다**. SHA256으로 동일 plan 재검토 파일 덮어쓰기를 막는다.

기존 단가 보관 자료의 12/24/72시간 예시는 각각 $10.58/$19.00/$52.68이며 2026-11-06/08 가격 가정이다. ALB, 데이터 전송, CloudWatch 사용량, Vercel, 세금/할인과 실사용 시간은 실제 `plan`/청구와 별도로 확인한다. [단가 산식](pricing-evidence/estimate.mjs)

## 2. 공통 측정 조건

- 기준·변경 후는 같은 Backend 기능 버전/데이터 크기/Node 수·종류/DB·Redis·MQ 설정/부하 발생기/요청 URL을 쓴다. 바꾸는 항목을 하나만 기록한다.
- 이미지 변경 실험은 두 불변 digest A→B 전환을 미리 준비하고, 매 반복 전에 A로 되돌려 같은 전환을 다시 수행한다. 앱 성능 코드를 수정하지 않는다.
- k6 발생기 CPU와 `dropped_iterations`를 함께 확인한다. 발생기가 목표 RPS를 내지 못했다면 서버 처리량 비교에서 제외한다.
- 시각은 UTC ISO로 기록한다. k6 원본은 HTTP 상태·연결 오류·p95·처리량, Prometheus는 서버/Pod 시계열, CloudWatch는 AWS 경보, 이메일은 사용자 수신 시각을 나타낸다. 측정 구간과 대상을 혼합하지 않는다.
- 각 비교군을 최소 3회 반복한다. 없는 시계열/실패한 실행은 0으로 치환하지 않고 누락·실패로 기록한다. 개선율은 같은 단위의 중앙값으로 계산하고 악화도 그대로 보고한다.
- Prometheus 5분 rate를 쓰므로 계측 시작 후 최소 5분을 기다린다. 짧은 실습은 관측/부하 시작 5분 → 변경/장애 주입 → 회복 관찰 5분 이상으로 계획한다.

## 3. 다섯 비교 실험

| ID | 기준 → 변경 후 | 실행 자료와 고정 조건 | 측정값·원본 |
|---|---|---|---|
| E01 배포 | Recreate → RollingUpdate | 같은 readiness probe, 2 Pod, 동일 A→B 이미지 전환. 배포 전략만 변경 | k6 5xx/연결 오류/최대 연속 장애, p95, rollout 시간, Pod readiness·이벤트 |
| E02 CI/CD | 수동 검증·배포 → Jenkins+Argo CD | 동일 A→B 전환과 검증 항목. 각 반복 전 A로 복구 | 커밋/시작/Healthy 시각, 사람의 작업 시간, 실패·롤백/복구 시간, Jenkins/Argo 기록 |
| E03 Requests | 기본 requests → 실측 기반 requests | 같은 이미지·2 Node·2 Pod·부하. 실측 후 수치만 결정 | Pod/Node CPU·메모리, OOM/Pending, k6 처리량·p95. Node 수가 같으면 EC2 비용 절감 주장 금지 |
| E04 HPA | 고정 2 Pod → HPA 2~4 | Metrics Server 정상, 같은 이미지/부하 단계. 먼저 100 VU로 노드 여유 확인 | k6 p95/5xx/RPS, HPA desired/current/ready Replica와 증설 지연 |
| E05 탐지 | 60초 수동 확인 → CloudWatch Alarm+SNS | 같은 실패 종류/시간/경보 임계값. 직접 SNS 발송은 전달 시험으로 분리 | 장애 시작, Alarm 전환, SNS 이메일 수신, 복구/OK 시각·미수신 횟수 |

E01은 현재 기본 RollingUpdate manifest만 있고 Recreate 변형은 실제 GitOps 환경 승격 뒤 별도 실험 PR/검토가 필요하다. E03의 변경 후 requests는 실측 전 임의 숫자로 만들지 않는다. E04의 저장소 `k8s/benchmarks/hpa`는 **정적 렌더 초안**이므로 실제 ECR digest/Secret/CA가 있는 승격 환경을 대신해 바로 적용하지 않는다. E05는 데이터 삭제 없이 복구 가능한 장애만 사용하고, Argo 자동 동기화가 실험을 덮어쓰는지 먼저 확인한다.

저율 HTTP 지속 부하는 `benchmarks/k6/scenarios/api-availability.js`와 `benchmarks/k6/run-availability.ps1`을 사용한다. 기본 2 RPS/15분, 최대 설정 20 RPS/30분이며 URL은 승인한 HTTPS API 호스트와 일치해야 한다. **실제 EKS 준비 전에는 실행하지 않는다.** k6 요약·줄 단위 원본·metadata는 Git 제외 `.local/experiments`에 남는다. 실패/5xx가 실험 대상이므로 k6의 성공률 threshold로 실행을 조기 실패시키지 않는다.

```powershell
.\benchmarks\k6\run-availability.ps1 -Scenario deployment -Variant baseline -RunNumber 1 `
  -BaseUrl https://api-devops.auctionbid.shop -ImageDigest sha256:<실제64자리digest> -Rate 2
```

HPA 실험은 [기존 k6 시나리오](../../benchmarks/k6/README.md)를 사용하되 실제 Node allocatable·Metrics API를 확인하고 100 VU부터 시작한다. Prometheus는 `monitoring/prometheus/metric-window.example.json`을 `.local`에 복사해 **실제 UTC 측정 구간**으로 바꾼 후 [원본 export 절차](prometheus-grafana.md)를 따른다. CloudWatch/SNS는 [탐지 시각 기록 절차](cloudwatch-cost-monitoring.md)를 따른다. 각 실행의 비교 표와 누락 사유는 [보고서 양식](../../benchmarks/experiment-report.template.md)에 기록한다.

## 4. 계측 시작/종료 체크

1. 실제 프로필의 STS 계정과 kubecontext, k6 목표 호스트, ECR digest, CloudWatch/SNS 구독 승인과 Prometheus Targets UP을 확인한다.
2. 동일 조건의 baseline·after를 번갈아 최소 3회 기록하고 각 실행 후 `.local` 원본을 별도 안전한 위치로 보관한다. Prometheus는 PVC가 없어 Pod 재시작 시 시계열이 유실될 수 있다.
3. CloudWatch 알림 전달 시험과 실제 장애 탐지 시험을 구분한다. 이메일 미수신/결측·k6 dropped iterations를 누락으로 표시한다.
4. 종료 전에 k6/Prometheus/CloudWatch/Jenkins·Argo 로그와 비용 조회 원본을 내보낸다. 그 뒤 GitOps·Ingress·Controller·EKS·데이터·NAT 순서로 정리하고 잔여 과금을 확인한다.
