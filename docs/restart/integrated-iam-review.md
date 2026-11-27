# 서비스 배포 권한 통합 검토

2026-11-27 기준, 서비스 생성에 필요한 IAM 후보를 모두 한 묶음으로 검토했다. **정책 준비와 로컬 검사는 완료했지만, AWS 연결·실효 권한 검증·서비스 apply는 완료하지 않았다.** 배포 주소는 사용자 확인에 따라 `api-devops.auctionbid.shop`을 유지한다.

## 지금 바뀐 것

PR #28의 데이터 서비스 권한을 병합하고 S3·ECR·ACM·CloudWatch·Logs·SNS·Budgets·Cost Explorer 권한을 추가했다. 기존 state/read·IAM·EKS·네트워크·데이터 정책까지 포함하면 원본은 22개다. 이들을 그대로 각각 연결하지 않고 **204개 Statement를 보존한 13개 정책**으로 재배치했다.

Action 목록과 Resource 목록을 합쳐 파일 수를 줄이지 않는다. 예를 들어 A 버킷 읽기와 B 버킷 삭제를 합치면 A 버킷 삭제까지 허용할 수 있기 때문이다. 생성기는 문장 본문을 그대로 유지하고 Sid만 다시 부여한다. 원본 위치와 해시를 manifest에 남기며, 파일당 6,144자를 넘으면 실패한다. 현재 최대 크기는 정확히 6,144자다. 수동으로 내용을 추가하지 말고 생성기 수정 후 다시 검토해야 한다.

AWS의 현재 관리형 정책 연결 기본 한도는 Role당 20개, 최대 25개다. 13개는 이 기본 한도 안에 있지만, **실제 계정 한도 조회는 AccessDenied여서 아직 확인하지 못했다.** 원본 22개와 통합 13개를 함께 연결하면 안 된다. [AWS 한도 안내](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html), [2026년 기본 한도 변경](https://aws.amazon.com/about-aws/whats-new/2026/08/aws-iam-quota-increase/).

## 누가 어떤 권한을 쓰는가

| 주체 | 책임 | 통합 검토의 결론 |
|---|---|---|
| IAM 사용자·로그인 그룹 | 임시 로그인과 지정 Role AssumeRole | 서비스 쓰기를 사람에게 직접 연결하지 않는다 |
| bootstrap Role | Terraform 상태 버킷 초기 구성 | 서비스 배포 역할과 분리, 기존 역할을 유지 |
| Terraform deploy Role | state 접근, 서비스 생성·갱신·삭제, 제한된 workload IAM 위임 | 새 통합 정책 13개의 대상. 현재 AWS에는 후보를 연결하지 않음 |
| EKS operator Role | 지정 클러스터 조회와 Kubernetes 운영 | Terraform IAM 권한과 분리. EKS access entry가 생성돼야 실제 Kubernetes 접근 가능 |
| workload Role 5개 | EKS cluster/node, ALB controller, Jenkins, 백엔드 이미지 업로드 | 기존 boundary 5개와 정확히 짝지음. boundary 생성·수정은 deploy Role이 못 함 |
| 별도 감사 정책 | 정책 검증·한도·지정 Role/정책 조회·deploy Role 시뮬레이션 | 사람이 관리자에게 연결을 요청할 검토 후보. 쓰기·연결 권한 없음 |
| 별도 정리·접속 정책 | 테스트 이미지/객체 정리, 특정 Jenkins 접속 | 기본 통합 정책에 넣지 않음. 정리 결정 또는 실제 instance ID 확인 후 별도 검토 |

기존 source 생성기는 사용하지 않는 코드가 아니다. 통합 생성기가 이들을 불러 원본 권한을 만들고, 기존 테스트는 각 서비스의 경계 조건을 검증한다. 따라서 중복 정책을 AWS에 연결하지는 않되 소스·테스트는 유지했다. 기존 단계 문서의 ‘남은 서비스 권한’은 당시 기록이며, 현재 상태는 이 문서를 기준으로 본다.

## 이번에 추가한 서비스 범위

| 서비스 | 허용 범위 | IAM만으로 고정하지 못하는 부분 |
|---|---|---|
| S3 | 전용 상품 이미지 버킷 생성·설정·삭제. 상태 버킷 권한은 기존 보호 유지 | bucket policy 본문, 공개 설정, 암호화 알고리즘을 변경 API 권한만으로 모두 제한할 수 없음 |
| ECR | `orderpage-backend` 저장소와 lifecycle 설정 | immutable·스캔·보관 수와 강제 삭제 플래그는 plan/요청 검토 필요 |
| ACM | 확정 API 도메인 하나, DNS 검증, 소유 태그. exportable 인증서 생성 거부 | 인증서 요청은 Resource=* 필요. 생성 후 ARN은 AWS가 결정 |
| SNS | 운영 topic 하나, 지정 이메일 구독 | topic policy 본문은 별도 검토. 구독 확인 메일 승인은 수신자가 직접 수행 |
| CloudWatch | 지정 알람 10개 이름 범위(현재 7개, ALB 이후 3개), 대시보드 하나 | 임계값·주기·metric dimensions·알림 목적지 전체는 plan 및 실제 동작 확인 필요 |
| Logs | 프로젝트 로그 그룹 5개와 MQ 로그 보존 설정, Redis 로그 전달 | 보존 일수의 상한은 IAM으로 고정하지 못함. MQ 로그는 서비스가 만드는 이름 범위를 사용 |
| Budgets | 계정 월 예산 하나의 생성·변경·삭제·통지 관리 | `ModifyBudget`은 여러 API를 포괄함. 예산 금액은 아직 미정이고 자동 중지 기능도 아님 |
| Cost Explorer | us-east-1의 `GetCostAndUsage` 조회 | 조회 자체가 과금될 수 있음. 필터가 IAM 보안 경계는 아니며 이번에는 조회하지 않음 |
| Cost Anomaly | 생성·수정·삭제 거부 | Terraform 코드는 계속 주석 상태. 단기 실험에서 탐지 성능을 주장하지 않음 |

CloudWatch Logs의 로그 그룹 일반 API는 `:*`가 있는 ARN을, TagResource/UntagResource는 없는 ARN을 쓴다. S3 버킷은 provider 5.100.0이 생성 후 태깅하므로 CreateBucket에 요청 태그를 강제하지 않는다. SNS 구독 관리 API는 subscription ARN 대신 topic ARN으로 권한을 판단한다. Budgets의 API 이름 CreateBudget/UpdateBudget/DeleteBudget은 IAM Action 이름이 아니므로 `budgets:ModifyBudget`을 사용한다. [Logs ARN](https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_LogGroup.html), [SNS 권한](https://docs.aws.amazon.com/service-authorization/latest/reference/list_sns.html), [Budgets 권한](https://docs.aws.amazon.com/service-authorization/latest/reference/list_awsbudgetservice.html).

## 위험과 보완을 구분해서 읽기

**가장 큰 추가 범위는 서울 리전의 로그 전달 설정이다.** ElastiCache 로그 전달에 필요한 Create/Get/Update/DeleteLogDelivery 및 PutResourcePolicy 등은 Resource=*를 요구한다. PrincipalAccount·RequestedRegion으로 계정과 서울을 제한했지만 다른 서울 로그 전달/리소스 정책에도 영향을 줄 수 있다. 특정 log-group ARN으로 바꿔도 작동하는 것처럼 문서화하지 않았다. 공유 리소스 정책의 DeleteResourcePolicy 권한은 주지 않았고, 서비스 연결 Role도 삭제하지 않는다. [ElastiCache 로그 전달](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Log_Delivery.html), [로그 목적지 권한](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/AWS-logs-infrastructure-CWL.html).

같은 계정의 지정 이름만 허용하는 것은 그 이름이 다른 프로젝트의 자원이 아님을 증명하지 않는다. 태그 기반 권한도 소유권 증명이나 과금 상한이 아니다. RDS/Redis 부분 갱신, MQ 생성 이름·타입, S3/SNS 정책 본문, workload Role의 trust/inline policy 본문, ALB controller의 태그 기반 범위에는 기존 단계에서 기록한 제약이 남는다. boundary는 workload 권한 상한이며, 잘못된 trust policy를 자동으로 올바르게 만들지 않는다.

또한 기본 통합 정책에 `s3:DeleteObject`(상품 이미지), `ecr:BatchDeleteImage`를 넣지 않았지만, 이것만으로 모든 데이터 삭제를 막는 것은 아니다. 배포 Role은 해당 ECR의 DeleteRepository/PutLifecyclePolicy와 상품 버킷 정책 변경 권한을 가진다. 현재 Terraform의 `force_delete=false`, `force_destroy=false` 및 검토 절차를 함께 지켜야 한다. 상태 파일 DeleteObject는 별도의 명시적 Deny로 보호하고, lock 파일 삭제는 계속 허용한다.

## 검증 결과와 미검증 범위

| 검사 | 결과 |
|---|---|
| 전체 Node 테스트 | 141개 통과. 기존 125개 + 신규 16개 |
| 통합 전후 문장 동일성 | 원본 204개 문장 모두 보존, 새 Action/Resource 조합 생성 없음 |
| 공식 서비스 참조의 Action 존재 | 서로 다른 Action 표현 311개 검사. 미등록 0개, wildcard 2개는 Deny에만 사용 |
| Allow Action/조건 키 대조 | 842개 조합에서 미지원 키 0개. 실제 요청 context 제공 여부를 증명하는 검사는 아님 |
| 저장 plan 전체 분류 | managed 자원 74개, 미분류 0개 |
| 설정 검사 | EKS 16 + 네트워크 18 + 데이터 22 + 나머지 15 = 71개 통과 |
| 기존 plan IAM/EKS 요청을 통합 정책으로 재평가 | 22개 자원, 86개 요청 허용. OIDC 1개 자원은 미연결 단계에서 의도적으로 보류 |
| 계산 전 정책·알림 목적지 | 24개 항목을 보류. unknown을 통과로 계산하지 않음 |
| STS | 지정 deploy Role·계정 일치 확인 |
| AWS IAM 한도/ValidatePolicy | 현재 deploy Role에서 둘 다 AccessDenied. 완료로 표시하지 않음 |
| AWS 리소스 생성·정리·SNS 수신 | 미실행 |

[검증 증거](security-evidence/integrated-iam-2026-11-27.json)는 비밀번호·계정·이메일·원문 plan을 포함하지 않는다. 로컬 평가기는 일부 IAM 연산자를 지원하는 테스트 도구이며 SCP, permissions boundary의 실제 연결, 세션 정책, resource policy, 서비스가 제공하는 context를 모두 재현하지 않는다. AWS Policy Simulator도 실제 서비스 생성 성공을 완전히 보장하지 않으므로 마지막에는 제한된 실제 실행 확인이 필요하다.

## 실제 적용 순서

1. 이 PR을 검토한다. 현재 공개 코드는 템플릿/생성기/검사기이고 실제 계정·이메일이 들어간 후보는 `.local/iam-integrated-deploy-review`에만 있다.
2. 관리 권한이 있는 사람이 별도 감사 정책을 검토해 운영자 쪽에 연결하거나 관리 세션으로 검증한다. 필요한 API는 ValidatePolicy, GetAccountSummary 및 지정 Role/정책 조회·SimulatePrincipalPolicy다. **deploy Role에 감사 정책을 붙여 self-protection Deny를 우회하려 하지 않는다.** IAM 사용자 권한은 AssumeRole 이후 세션에 합쳐지지 않는다.
3. 관리자 컨텍스트에서 현재 연결 정책/inline 정책/trust/boundary, 실제 연결 한도, 통합 13개 정책의 AWS 검증 결과를 확인한다. 이 과정은 서비스 apply와 분리한다. 이번 요청에서 AWS 정책 생성/연결은 수행하지 않았다.
4. 예산 금액과 종료 시각을 정하고 최신 plan을 갱신한다. 현재 저장 plan은 Budget이 없고 오래될 수 있다. 이번 검증 결과를 새 plan 승인으로 재사용하지 않는다.
5. 기존 state/read 연결을 통합 정책으로 교체하는 변경안을 검토한다. 이전 두 정책과 통합 정책을 일시적으로 함께 연결할 여유가 있는지 실제 quota를 확인한다. 구 정책 목록·버전을 보관하고, 신규 연결 후 state/read 검증이 끝나기 전 기존 정책을 먼저 떼지 않는다. 원본 서비스 후보 22개를 추가 연결하지 않는다.
6. 최초 EKS 단계의 최신 plan과 비용을 확인해 실행한다. OIDC 미연결 정책은 OIDC 쓰기를 거부하므로 처음부터 전체 apply를 하지 않는다.
7. ACTIVE EKS의 실제 issuer를 조회해 bound 통합 정책을 다시 생성·검증한다. 파일 재배치가 생길 수 있으므로 변경된 파일 전체를 비교하고 관리자 컨텍스트에서 새 버전을 적용한다. 이후 전체 plan을 다시 검토한다.
8. 나머지 인프라·Kubernetes·Jenkins·Vercel 연결을 진행한다. 인증서 DNS 검증과 API DNS, SNS 메일 확인, 실제 ALB ARN 이후 알람 설정은 이 단계에서 완료한다.
9. 수치 실험 후 앱/ALB → 데이터·EC2/EKS 순서로 정리하고, 잔여 EBS/EIP/NAT/MQ 로그·로그 전달·인증서·ECR/S3 내용과 비용을 확인한다. 공유 SLR/리소스 정책을 무조건 삭제하지 않는다.

관리자도 검토용 파일을 곧바로 일괄 연결하지 않는다. `REVIEW_ONLY_DO_NOT_ATTACH`, `readyForApply=false`는 아직 원격 검증과 예산·최신 plan 확인이 남았다는 의미다.

## 생성기와 별도 운영 정책

저장소 루트의 Git 제외 `terraform/envs/dev/terraform.tfvars.json`을 입력으로 사용한다. 이메일이나 키를 명령 인자에 넣지 않는다.

```powershell
# 로컬 후보 생성. 기존 폴더를 덮어쓰지 않으며 AWS 호출 없음.
node scripts/prepare-integrated-deploy-permissions.mjs

# EKS가 생성된 뒤에만: STS와 ACTIVE 클러스터를 조회하고 별도 bound 폴더에 생성.
node scripts/prepare-integrated-deploy-permissions.mjs --bind-existing-eks
```

`prepare-operator-review-permissions.mjs`에는 기본 배포 정책에 들어가지 않는 세 생성 함수가 있다.

- `renderAuditPermissions(accountId)`: 별도 감사용 조회·검증 후보. 실제 JSON은 `.local/iam-operator-review/OrderPageIamAuditRead.json`에 준비했다. AWS 콘솔에서 정책을 만들 경우 JSON 전체를 사용하며, 연결 대상은 관리자 검토를 거친 운영자/감사 주체다.
- `renderArtifactCleanupPermissions(accountId)`: 검토한 ECR 이미지와 상품 객체 삭제 후보. `.local/iam-operator-review/OrderPageArtifactCleanup.json`은 정리 전 내용 보존을 결정할 때까지 연결하지 않는다. state와 객체 버전 삭제 권한은 없다.
- `renderJenkinsTunnelPermissions(accountId, instanceId)`: 생성된 Jenkins의 ID·태그를 확인한 뒤 사용할 터널 후보. AWS 제공 port-forwarding 문서와 본인이 시작한 해당 인스턴스 세션 종료만 허용한다. 8080은 실행 인자이며 이 IAM 정책이 포트 번호를 고정하는 것은 아니다. 기본 셸·임의 명령·원격 호스트 포워딩 문서는 허용하지 않는다. 실제 SSM 연결은 미검증이며 초기 Jenkins 비밀번호를 읽을 SSM 셸 권한/계정 기본 Session 문서도 별도 검토해야 한다.

이 별도 정책들은 생성 함수가 준비됐다는 뜻이며 배포 Role의 13개 정책 수에 포함되지 않는다. Jenkins EC2의 SSM agent 권한과 사람의 StartSession 권한은 다르다. [Session Manager 권한 예시](https://docs.aws.amazon.com/systems-manager/latest/userguide/getting-started-restrict-access-examples.html).

Terraform HCL·Spring·Vue·배포 활성화 설정은 이번에 변경하지 않았다. 실제 AWS 자원을 만들거나 Cost Explorer 조회를 실행하지 않았고, 신규 유료 서비스도 추가하지 않았다.
