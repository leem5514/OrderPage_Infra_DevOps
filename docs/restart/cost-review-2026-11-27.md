# 짧게 열고 측정하는 실습의 비용

2026-11-27 KST에 AWS 공개 가격표를 다시 조회했다. 아래 금액은 **서울 On-Demand 기본 요금에 대한 계산**이며 총 청구액이나 지출 상한이 아니다. 계정의 무료 사용량·크레딧·할인은 적용하지 않았다. 세금과 환율도 제외했다.

## 지금 구성으로 얼마나 드나

| 가동 시간 | 현재 Terraform 기반만 | 후속 ALB·관측까지 기본 항목 | 예시 사용량까지 더하면 |
|---|---:|---:|---:|
| 12시간 | $9.41 | **$9.80** | $10.95 |
| 24시간 | $18.81 | **$19.60** | $20.85 |
| 48시간 | $37.62 | **$39.20** | $40.64 |
| 72시간 | $56.44 | **$58.81** | $60.44 |

예시 사용량은 **전체 기간 합계 NAT 처리 5GB, CloudWatch 로그 수집 1GB, ALB 평균 1 LCU**다. 실측 예측이 아니라 계산 방법을 보여 주는 가정이다. 로그나 부하가 증가하면 금액도 증가한다. 인터넷/교차 AZ 전송, S3/ECR 저장·요청, SNS, 과금되는 관측 API, 로그 보관·쿼리, RDS 초과 CPU credit·백업, Vercel은 여전히 별도다.

기반 열에는 현재 plan의 경보 7개와 dashboard 1개를 포함한다. 후속 ALB 열은 Controller가 나중에 만드는 ALB 1개, ALB의 2 AZ IPv4 최소 2개, 후속 ALB 경보 3개를 추가한다. ALB 확장으로 주소 수가 늘면 추정값을 갱신해야 한다. 서비스 생성/정리 시간과 삭제 후 잔존 자원은 표의 가동 시간 밖에서 추가될 수 있다.

## 단가와 수량을 어떻게 잡았나

| 항목 | 수량 | 단가 또는 산식 |
|---|---:|---|
| EKS 표준 지원 | 1 | $0.10/시간 |
| m6i.large | worker 2 + Jenkins 1 | 각 $0.118/시간; Jenkins도 전체 기간 가동 |
| RDS MariaDB db.t4g.micro | 1 | $0.025/시간 |
| Redis cache.t4g.micro | 1 | $0.024/시간 |
| MQ mq.m7g.medium single | 1 | $0.1682/시간 |
| NAT Gateway | 1 | $0.059/시간 + $0.059/처리 GB |
| ALB | 후속 1 | $0.0225/시간 + $0.008/LCU-시간 |
| 공인 IPv4 | 기반 1, ALB 포함 최소 3 | 주소당 $0.005/시간 |
| EBS gp3 | worker 40 + Jenkins 30GiB | $0.0912/GB-월 |
| RDS gp3 | 20GiB | $0.131/GB-월 |
| MQ 저장소 | 200GB | $0.114/GB-월 |
| 일반 CloudWatch 경보 | 기반 7, 후속 포함 10 | $0.10/경보 지표-월 |
| CloudWatch dashboard | 1 | $3/월 |
| CloudWatch 로그 수집 | 사용량 | $0.76/GB |

월 단가는 비교 편의를 위해 730시간으로 나눴다. 실제 청구는 월 길이·서비스별 최소 과금/반올림·생성/삭제 시각에 따라 달라진다. 위 단가는 [조회 시각·SKU·단위가 포함된 공개 근거](pricing-evidence/seoul-2026-11-27.json)에 저장했다. 무료 단가, Reserved capacity, Outposts, extended support, Regional NAT를 현재 구성과 섞지 않았다.

MQ 200GB는 [M7g single instance 기본 디스크 표](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/rmq-broker-instance-types.html)를 사용했다. configurable storage 기능이 있다는 이유로 현재 provider/구성에서 검증하지 않은 작은 저장소 가격을 적용하지 않았다. [CloudWatch 요금](https://aws.amazon.com/cloudwatch/pricing/)의 무료 dashboard/경보 할당도 다른 계정 사용량을 모르므로 차감하지 않았다.

## 최소 비용을 위해 바꾸는 것은 우선 가동 시간

필수 기술을 유지하면서 **12시간 내 생성·배포·측정·정리**를 첫 목표로 삼는 방식을 제안했다. 기본 항목만 비교하면 72시간 대비 12시간은 약 $49.01, 83.3% 적다. 이는 실제 성능 개선이나 청구 절감 실적이 아니라 동일 구성의 시간 비례 계산이다. 준비가 미완료된 상태에서 먼저 인프라를 켜 두면 이 장점이 사라진다.

worker 2대는 비교 실험 조건을 위해 유지한다. 검증 없이 작은 노드로 바꿔 Pod 부족/메모리 실패를 만들거나, 요구한 managed MQ를 제거하지 않는다. Jenkins 정지 시간을 가정해 비용을 낮추지 않았으며, 별도 부하 발생 EC2·외부 Grafana/Argo CD용 Load Balancer도 추가하지 않았다. EKS 내부 관리 UI는 기존 제한된 접근 방식을 유지한다.

Budget은 계정 전체 월 누적 알림이고 자동 중지가 아니다. 기존 계정 지출이 있으면 실습 시작 전에도 임계값에 도달할 수 있다. **초기 가동 목표와 알림 금액은 사용자 확인 중**이며 실제 tfvars의 Budget 금액은 아직 null이다. 실제 시작/종료 시각도 배포 직전에 정한다. 비용 알림이 늦게 도착할 수 있으므로 3일 상한과 직접 종료 점검을 대신할 수 없다.

## 재계산과 남은 검증

```powershell
node scripts/estimate-lab-costs.mjs
```

계산기는 저장된 17개 단가로 foundation/후속 앱/사용량 예시를 분리한다. 빠진 SKU, 중복 SKU, 단위 오류와 72시간 초과 입력은 거부한다. AWS API나 apply는 호출하지 않는다. 수량은 현재 설계에 고정되어 있으므로 node 수·타입·Jenkins 설정·MQ 저장소를 바꾸면 모델도 함께 수정한다.

현재 근거는 첫 서비스 plan과 같은 구성이다. 이후 Budget·권한 경계 등으로 plan이 달라지면 새로운 생성 목록과 비용을 검토해야 한다. Cost Explorer에서 실제 비용을 조회한 결과는 아직 없으며, 이번 가격표 조회는 계정별 청구 내역 조회와 다르다.
