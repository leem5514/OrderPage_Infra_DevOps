# 서비스 인프라 Role: 먼저 plan을 위한 권한부터

> **문서 용도:** 서비스 plan/state 접근 Role과 초기 인증 절차.
> **읽는 기준:** 구현 이유와 당시 검증·설정 순서를 보존한 문서입니다. 본문의 날짜·완료/미완료는 작성 당시 기준이며, 현재 상태는 [통합 점검표](../checks.md), 비용은 [비용·운영 계획](../costs.md)을 우선합니다. [문서 지도](../README.md)

2026-11-27. Infra #19를 병합했다. 상태 저장용 S3는 이미 생성·검증됐으며, 이번에는 **서비스 인프라의 plan을 위한 Role 정책과 로컬 설정 파일을 준비했다. 이후 사용자가 콘솔에서 Role 및 정책 연결을 완료했고, STS 인증과 서비스 backend 초기화를 검증했다.**

## 이번 Role이 필요한 이유

기존 `orderpage-terraform-bootstrap`은 S3 버킷 설정을 관리한다. 서비스 환경의 state 객체 본문을 읽고 쓰는 권한은 직접 부여하지 않았다. 따라서 그 Role을 계속 확장하는 대신 `orderpage-terraform-deploy`를 준비한다.

지금은 먼저 plan을 만들어 생성 대상과 비용을 검토할 단계다. 이 Role의 첫 권한은 **지정 state/잠금 파일 접근 + 인프라 조회**다. VPC/EKS 생성, IAM Role·정책 수정, PassRole은 포함하지 않는다. 실제 apply 권한 설계·연결을 완료했다고 해석하면 안 된다. 계획을 검토한 뒤 같은 배포 Role에 필요한 실행 정책을 별도로 추가할 예정이다.

| 주체 | 용도 | 이번 상태 |
|---|---|---|
| `orderpage-lab` | IAM 사용자 임시 인증 및 사양 조회 | 사용 중 |
| `orderpage-bootstrap` | 상태 버킷 자체의 설정 관리 | 생성·검증 완료 |
| `orderpage-deploy` / `orderpage-terraform-deploy` | 서비스 인프라 plan과 지정 state 접근 | STS 인증·S3 backend 초기화·검토용 plan 완료 |
| EKS 운영 Role | kubectl/Helm 및 클러스터 운영 | 별도 orderpage-eks-operator 생성·STS 확인 완료, 클러스터 접속 전 |

이번 Role을 `eks_admin_principal_arn`에 자동으로 넣지 않았다. Terraform 실행 권한과 Kubernetes 관리자 권한은 각각 검토해야 한다.

## 두 권한 정책을 나눈 이유

| 정책 이름 | 파일 | 허용 범위 |
|---|---|---|
| `OrderPageTerraformStateAccess` | [state-access.template.json](../../../iam/service-plan/state-access.template.json) | 기존 버킷의 지정 state와 잠금 파일 |
| `OrderPageServicePlanRead` | [plan-read.template.json](../../../iam/service-plan/plan-read.template.json) | Terraform 구성과 현재 상태 비교에 필요한 조회 |
| `OrderPageAssumeDeploy` | [operator-assume.template.json](../../../iam/service-plan/operator-assume.template.json) | 사용자 그룹에 연결할 해당 Role 전환 권한 |

Role의 [신뢰 정책](../../../iam/service-plan/trust.template.json)은 같은 계정의 `orderpage-operator`만 지정한다. Role 이름이 deploy여도 현재 연결할 두 정책에는 서버 생성 권한이 없다.

### state 파일과 잠금 파일은 다르게 취급한다

`orderpage/dev/terraform.tfstate`에는 `GetObject`, `PutObject`만 허용한다. `DeleteObject`와 `DeleteObjectVersion`은 명시적으로 거부한다. `.tflock`에는 읽기·쓰기·삭제를 허용해 Terraform이 작업 후 잠금을 해제할 수 있게 한다. 두 객체의 이름은 실제 backend 예시와 일치하는지 테스트한다.

버킷의 삭제, 정책·공개 차단·소유권·버전 관리·암호화·수명 주기 변경은 이 Role에서 거부한다. HTTP 요청도 거부한다. 이 거부는 다른 bootstrap Role이나 관리자까지 제한하는 계정 전체 규칙이 아니다.

**state는 민감한 파일이며, PutObject로 내용을 덮어쓸 수 있다.** 삭제 거부가 손상·유출을 완전히 막는다는 뜻은 아니다. 버전 관리와 접근 대상 제한을 함께 사용하고, state를 읽을 수 있는 Role을 신뢰하지 않는 주체에게 공유하지 않는다. 과거 버전 복구용 추가 권한이나 실제 복구 절차는 이번 작업에서 실행하지 않았다.

`ListBucket`은 backend의 HeadBucket/목록·workspace 탐색을 위해 지정 버킷 전체에 허용한다. 따라서 다른 객체의 **이름**을 볼 수는 있지만 본문 읽기·쓰기는 위 두 경로에만 허용한다. 현재 정책은 **default workspace**만 대상으로 하며 별도 workspace 생성·삭제를 지원하지 않는다.

### 인프라 조회 범위

서울 리전의 EC2/EKS/RDS/ElastiCache/MQ/ECR/ACM/SNS/CloudWatch Logs/CloudWatch 조회를 명시적으로 나열했다. 일부 조회는 `Resource=*`여서 같은 계정·서울의 다른 자원 메타데이터도 보일 수 있다. 모든 API가 ARN 제한을 지원하지 않는다는 이유만으로 이 전체 범위가 불가피한 최소 권한이라고 주장하지 않는다. 실제 API 사용 증거가 생기면 더 줄일 수 있다.

EC2 `DescribeInstanceAttribute`는 user-data도 읽을 수 있어 서울의 `Project=orderpage`, `Environment=dev` 태그를 가진 인스턴스로 따로 제한했다. IAM 조회는 코드에서 만드는 다섯 Role, Jenkins instance profile, ALB Controller 정책, 서울 EKS OIDC 공급자로 제한한다. S3 상품 이미지 버킷 설정·프로젝트 대시보드·예산 조회도 별도 ARN으로 제한했다. IAM/S3/Budgets 등 글로벌 자원에 서울 요청 조건을 무조건 붙이지 않았다.

Secrets Manager 값, SSM Parameter 값, ECR 인증 토큰, 애플리케이션 로그 본문, 인증서 개인키를 읽는 API는 넣지 않았다. 메타데이터에 비밀값을 직접 저장해 놓았다면 조회 결과가 민감할 수 있으므로 출력 전체를 공개하지 않는다. 새 정책은 permissions boundary가 아니며, 나중에 다른 정책을 추가하면 명시적 Deny 이외의 권한 범위는 넓어질 수 있다.

## 계정별 파일은 어디에 있나

[prepare-service-plan-iam.mjs](../../../scripts/prepare-service-plan-iam.mjs)가 `.local/iam-service-plan`에 다음 파일 6개를 만든다. 실제 계정 ID는 이 Git 제외 디렉터리에만 치환한다.

```text
state-access.json       → OrderPageTerraformStateAccess
plan-read.json          → OrderPageServicePlanRead
trust.json              → 새 Role의 신뢰 정책
operator-assume.json    → OrderPageAssumeDeploy
profile.example.ini    → 연결 확인 후 로컬 AWS config에 추가할 예시
backend.hcl            → 연결 확인 후 사용할 서비스 환경 backend 설정
```

재현 명령은 Infra 루트의 `node scripts/prepare-service-plan-iam.mjs <12자리_계정_ID>`다. 기존 결과는 덮어쓰지 않는다. 키/토큰을 입력하지 않으며, 생성기는 AWS API 호출·권한 연결·기존 프로필 수정·backend 초기화를 하지 않는다. 기존 bootstrap 파일도 유지한다.

## 콘솔 설정 순서

현재 로그인용 IAM 사용자에게 정책/Role 생성 권한은 없으므로 **IAM 관리 권한이 있는 콘솔 세션**에서 진행한다. 광범위한 관리자 권한을 해당 사용자에게 추가하는 절차는 아니다.

1. **IAM → 정책 → 정책 생성 → JSON**에서 로컬 `state-access.json`을 붙여 넣고 **`OrderPageTerraformStateAccess`**로 생성한다.
2. 같은 경로에서 로컬 `plan-read.json`을 붙여 넣고 **`OrderPageServicePlanRead`**로 생성한다.
3. **IAM → 역할 → 역할 생성 → 사용자 지정 신뢰 정책**에서 로컬 `trust.json`을 붙여 넣는다.
4. 다음 권한 정책 화면에서 **`OrderPageTerraformStateAccess`와 `OrderPageServicePlanRead` 두 개**를 선택한다.
5. 역할 이름을 **`orderpage-terraform-deploy`**로 지정하고 검토 후 생성한다. 세션 최대 시간은 기본 1시간을 유지한다.
6. **IAM → 정책 → 정책 생성 → JSON**에서 로컬 `operator-assume.json`을 붙여 넣고 **`OrderPageAssumeDeploy`**로 생성한다.
7. **IAM → 사용자 그룹 → `SignInLocalDevelopmentAccess` → 권한 → 권한 추가 → 정책 연결**에서 **`OrderPageAssumeDeploy`**를 연결한다. state/조회 정책 두 개는 사용자 그룹이 아닌 새 Role에 연결한다.

MFA 등록과 신뢰 정책의 MFA 조건 강제는 구분한다. 현재 임시 로그인 경로에서 MFA 조건 키 전달은 검증하지 않았으므로 임의 조건으로 로그인 경로를 바꾸지 않았다. Console JSON 오류는 확인해야 하며, 요약 경고를 없애려고 Action/Resource를 넓히지 않는다.

## 연결 후 수행할 순서

1. IAM 사용자 인증을 source로 하는 새 `orderpage-deploy` 프로필만 추가하고 STS에서 실제 계정/Role을 확인한다.
2. `terraform/envs/dev`의 기존 backend/state 유무를 확인한다. bootstrap state를 이동하지 않는다. 검토한 backend 설정으로 서비스 환경을 초기화한다.
3. 프로젝트명 `orderpage`, 환경 `dev`에 맞춰 실제 변수·운영자 IP·EKS 운영 Role·서비스 버전·비밀값을 보호된 로컬 파일로 준비한다. 이 정책은 다른 프로젝트명에 맞춰 자동 확장되지 않는다.
4. 서비스 환경 plan을 저장해 자원 수·공개 접근·비용·삭제 순서를 검토한다.
5. 그 결과에 맞춰 실제 생성/수정/삭제와 PassRole/IAM 위임 정책을 설계한다. IAM 쓰기 권한을 부여할 때는 역할 이름 제한만으로 권한 상승이 막힌다고 가정하지 않고 permissions boundary 등 추가 제한을 검토한다.

서비스 환경 init과 validate 및 [첫 실제 plan](../checks.md#plans)을 완료했다. apply와 state 복구·잠금 충돌 시험은 미실행이다. STS와 backend 초기화 성공만으로 모든 조회·쓰기 권한이 검증됐다고 표현하지 않는다. S3 backend 요청도 사용량 과금 대상이므로 테스트를 불필요하게 반복하지 않는다.

## 검증 근거

- 새 회귀 검사 8개와 기존 bootstrap 검사 6개, 총 **14개 통과**.
- 공식 AWS 서비스 참조 14종에서 고유 Action 107개(정책 내 반복 포함 112개), ARN 유형과 서비스 조건 키를 대조했다. plan 조회 Action 94개는 공식 주석에서도 쓰기/권한 관리/태그 변경으로 분류되지 않는다.
- managed policy 최대 6,144자 기준으로 state 정책 1,689자, 조회 정책 4,326자다. 실제 계정 값으로 생성한 파일도 같은 제한을 검사한다.
- [공식 참조 URL·해시와 검증 요약](../security-evidence/service-plan-iam-validation-2026-11-27.json)을 남겼다. 정책 테스트는 IAM 평가 엔진이나 실제 AWS 권한 시뮬레이션을 대신하지 않는다.

근거: [Terraform S3 backend 상태·잠금 권한](https://developer.hashicorp.com/terraform/language/backend/s3), [AWS 서비스 권한 참조](https://docs.aws.amazon.com/service-authorization/latest/reference/service-reference.html), [IAM 권한 경계](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html), [IAM PassRole 조건](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html).

## 실제 연결 검증 — 2026-11-27

사용자의 정책 연결 완료 안내 후 기존 AWS 프로필을 유지하고 `orderpage-deploy`를 추가했다. STS에서 예상 계정 및 `orderpage-terraform-deploy` 역할이 일치했다. 계정 번호·ARN 원문·자격증명은 공개 기록에 넣지 않았다.

Git 제외 대상인 서비스 `backend.hcl`을 생성하고 이 프로필로 `terraform init -input=false -backend-config=backend.hcl`을 완료했다. 기존 서비스 backend 메타데이터와 로컬 state가 없는 상태에서 초기화했으며 bootstrap state는 이동하지 않았다. `terraform validate`도 성공했다. 최초 PowerShell 인자 전달 오류는 인자를 명시적으로 인용해 해결했고, 샌드박스 provider 응답 오류는 일반 실행 환경의 재검증으로 해결했다.

이후 [실제 서비스 입력값과 검토용 plan](../checks.md#plans)을 준비했다. 인프라 생성 apply, 잠금 충돌 및 복구 시험은 수행하지 않았다. 초기화 성공은 state 쓰기/삭제 및 모든 서비스 API의 권한 검증을 의미하지 않는다.
