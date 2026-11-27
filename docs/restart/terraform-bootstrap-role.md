# 첫 배포 권한: Terraform 상태 버킷부터 분리하기

2026-11-27. **사용자의 정책·Role 연결과 실행 승인 후 실제 AssumeRole, plan, bootstrap apply 및 조회 검증을 완료했다.** [실제 적용 결과](bootstrap-apply-2026-11-27.md)를 확인한다. 아래 콘솔 순서는 설정을 재현하기 위한 기록이다.

현재 `orderpage-operator`는 임시 로그인과 서울 서비스 사양 조회가 가능하다. 다음 작업은 전체 서비스를 한꺼번에 만드는 것이 아니라, Terraform 장부를 보관할 S3 버킷을 먼저 준비하는 것이다. 따라서 이번 권한도 그 버킷 하나에 맞춘다.

## 왜 Role을 두 단계로 나누는가

| 단계 | 실행 주체 | 대상 | 현재 상태 |
|---|---|---|---|
| 사전 조사 | IAM 사용자 / `orderpage-lab` | EKS·RDS·Redis·MQ·EC2 버전과 사양 조회 | 실제 조회 성공 |
| 상태 저장소 준비 | `orderpage-terraform-bootstrap` Role | 지정한 S3 버킷 하나와 설정 | 적용·AWS 조회 완료, 후속 plan 변경 없음 |
| 서비스 인프라 | 별도 배포 Role | VPC·EKS·ECR·RDS·Redis·MQ·Jenkins·모니터링 등 | [plan 조회·state 권한](service-plan-role.md) 준비, 생성 권한은 후속 검토 |
| 서비스 운영 | 지정한 EKS 운영 Role과 서비스별 IAM Role | kubectl/Helm, Controller, 앱 이미지 업로드 등 | 배포 Role과의 분리 여부 및 최종 ARN 확정 필요 |

현재 코드의 `terraform/bootstrap/remote-state`는 S3 관련 resource 블록 7개만 만든다. 반면 `terraform/envs/dev`는 EKS/EC2 서비스 Role, IRSA OIDC 공급자, 정책 연결과 `PassRole`까지 필요하다. 이 권한을 처음부터 사용자에게 붙이지 않고, 바로 다음 단계에 필요한 S3 권한을 먼저 검증한다.

**이번 Role로 VPC/EKS를 배포할 수는 없다.** 전체 배포 Role 작업을 완료했다고 해석하면 안 된다. 배포 Role은 프로젝트 Role 이름 제한, PassRole 대상·서비스 제한, 필요 시 permissions boundary까지 검토해야 한다. 임의 정책을 작성할 수 있는 IAM 권한을 프로젝트 이름 제한만으로 안전하다고 간주하지 않는다.

## 파일별 역할

| 파일 | AWS에 연결할 위치 | 의미 |
|---|---|---|
| [permissions.template.json](../../iam/bootstrap/permissions.template.json) | 새 Role의 권한 정책 | 어느 버킷에 어떤 작업을 할 수 있는가 |
| [trust.template.json](../../iam/bootstrap/trust.template.json) | 새 Role의 신뢰 정책 | 누가 이 Role을 사용할 수 있는가 |
| [operator-assume.template.json](../../iam/bootstrap/operator-assume.template.json) | 기존 사용자 그룹의 권한 정책 | 사용자가 어느 Role로 전환할 수 있는가 |
| [prepare-bootstrap-iam.mjs](../../scripts/prepare-bootstrap-iam.mjs) | 로컬에서만 실행 | 실제 계정 ID를 넣은 JSON과 프로필 예시 생성 |

템플릿의 `{{ACCOUNT_ID}}`를 추적 중인 파일에서 직접 수정하지 않는다. Infra 저장소 루트에서 다음을 실행하면 `.local/iam-bootstrap`에 계정별 JSON 3개와 프로필 예시 1개가 생성된다. 이 디렉터리는 Git에서 제외된다.

```powershell
node scripts/prepare-bootstrap-iam.mjs <본인_12자리_계정_ID>
```

계정 ID는 AWS 계정 식별자이며 Access Key나 비밀번호가 아니다. 이 도구는 AWS API를 호출하거나 사용자 권한을 변경하지 않는다. 기존 출력 폴더가 있으면 덮어쓰지 않고 중단한다. 실제 AWS 프로필 파일도 자동 수정하지 않는다. 2026-11-27에는 STS에서 의도한 IAM 사용자임을 다시 확인한 후 로컬 파일을 생성했다. 계정 ID와 ARN은 문서에 복사하지 않았다.

## 권한 범위와 한계

- 버킷 이름은 `orderpage-devops-tfstate-<계정_ID>-ap-northeast-2` 하나로 고정한다. 다른 이름을 쓰려면 정책과 bootstrap 변수를 함께 다시 검토한다.
- 생성 요청은 `s3:LocationConstraint = ap-northeast-2`일 때만 허용한다. 기존 버킷 설정 조회·수정은 `s3:ResourceAccount`로 본인 계정 소유를 확인한다.
- Terraform이 기존 상태를 읽는 데 필요한 버킷 조회, 태그, 공개 차단, 소유권, 버전 관리, 암호화, 수명 주기, 버킷 정책 및 빈 버킷 삭제를 허용한다.
- `Allow`에는 Action/Resource 와일드카드가 없다. `Deny`의 `s3:*`는 지정 버킷과 객체의 HTTP 요청을 거부하는 용도다.
- IAM 수정, PassRole, EC2/EKS 생성, S3 객체 본문 읽기·쓰기·삭제는 직접 부여하지 않는다. `ListBucket`으로 객체 이름은 조회할 수 있다.
- **버킷 정책·공개 차단·수명 주기를 수정하는 권한은 민감하다.** 설정 변경을 통해 접근 범위나 데이터 보존에 영향을 줄 수 있으므로, 이 Role을 신뢰하지 않는 사람에게 공유하지 않는다. 객체 API가 없다는 이유로 유출·삭제 가능성이 완전히 차단된다고 주장하지 않는다.
- 이 정책은 별도의 permissions boundary가 아니다. 관리자가 다른 정책을 연결하면 권한이 늘어날 수 있다. 버킷 정책, SCP 및 다른 Deny도 최종 권한에 영향을 준다.
- MFA 등록과 Role 신뢰 정책의 MFA 강제는 다르다. 현재 `aws login` 세션의 MFA 조건 키 전달을 검증하지 않았으므로, 동작을 보장하지 못하는 MFA 조건을 임의로 넣지 않았다. 이번 신뢰 정책은 특정 IAM 사용자만 지정한다.

bootstrap 자체의 state는 **로컬 파일**이다. 이 초기 state를 잃지 않도록 Git 외부의 보호된 위치에 백업한다. 이후 서비스 인프라 state와 `.tflock`에 대한 객체 권한은 별도 배포 Role에 부여할 예정이다. 이번 Role을 서비스 환경의 S3 backend 인증에 사용하면 객체 접근이 거부되는 것이 정상이다.

## 콘솔에서 해야 할 순서

현재 IAM 사용자의 조회 권한으로는 정책/Role을 만들 수 없다. **IAM 정책과 Role을 관리할 수 있는 관리자 콘솔 세션**에서 다음 작업을 한다. 별도 관리자가 없다면 루트는 이 초기 설정에만 사용하고 CLI는 계속 IAM 사용자로 인증한다.

### 1. S3 전용 권한 정책 만들기

1. **IAM → 왼쪽 메뉴 `정책` → `정책 생성`**을 누른다.
2. 정책 편집기 오른쪽에서 **`JSON`**을 선택한다.
3. 로컬 `.local/iam-bootstrap/permissions.json` 내용을 붙여 넣는다. 템플릿 원본을 붙여 넣지 않는다.
4. **`다음`**에서 정책 이름을 **`OrderPageStateBootstrap`**으로 입력한다.
5. 콘솔 정책 검증 결과를 확인하고 **`정책 생성`**을 누른다. 오류가 있으면 넓은 관리형 정책으로 대체하지 않고 원인을 확인한다.

`명시적 거부 / aws:SecureTransport = false`는 의도한 HTTP 차단이다. “일부 작업이 권한을 제공하지 않음” 안내는 [콘솔 요약 분석과 비밀정보 재검사](secret-audit-2026-11-27.md)를 참고한다. Allow 27개는 리소스·조건 지원을 대조했으며, Deny의 `s3:*` 중 버킷에 적용되지 않는 작업이 안내 원인으로 추정된다. 안내를 없애려고 Deny를 제거하거나 Resource를 넓히지 않는다.

### 2. 사용자가 전환할 Role 만들기

1. **IAM → 왼쪽 메뉴 `역할` → `역할 생성`**으로 이동한다.
2. 신뢰할 수 있는 엔터티 유형에서 **`사용자 지정 신뢰 정책`**을 선택한다.
3. `.local/iam-bootstrap/trust.json` 내용을 붙여 넣는다. 지정된 IAM 사용자가 이 계정에 존재해야 한다.
4. **`다음`**의 권한 정책 검색에서 **`OrderPageStateBootstrap`**만 선택한다.
5. Role 이름은 **`orderpage-terraform-bootstrap`**으로 지정하고 생성한다.
6. 상세 화면에서 연결된 권한 정책과 신뢰 관계가 위 두 파일과 일치하는지 확인한다. 최대 세션 기간은 기본 1시간을 유지한다.

### 3. 기존 사용자에게 이 Role 사용 권한 연결

1. **IAM → 정책 → 정책 생성 → JSON**에서 `.local/iam-bootstrap/operator-assume.json`을 붙여 넣는다.
2. 정책 이름 **`OrderPageAssumeBootstrap`**으로 생성한다.
3. **IAM → 사용자 그룹 → `SignInLocalDevelopmentAccess` → 권한 → 권한 추가 → 정책 연결**로 이동한다.
4. **`OrderPageAssumeBootstrap`**을 선택해 연결한다. 기존 로그인·조회 정책은 유지한다.
5. 이 그룹에 본인의 `orderpage-operator`만 있는지 확인한다. Role의 신뢰 정책도 해당 사용자만 지정되어 있다.

### 4. IAM 로그인으로 돌아온 뒤 CLI 연결 확인

관리자 설정이 끝나면 IAM 사용자 세션으로 돌아온다. 로컬 AWS config에 `.local/iam-bootstrap/profile.example.ini`의 새 프로필 블록을 추가한다. 기존 `default`, `orderpage-login`, `orderpage-lab`은 덮어쓰지 않는다.

```ini
[profile orderpage-bootstrap]
region = ap-northeast-2
role_arn = arn:aws:iam::<본인_계정_ID>:role/orderpage-terraform-bootstrap
source_profile = orderpage-lab
role_session_name = orderpage-bootstrap
duration_seconds = 3600
```

CLI의 `sts get-caller-identity --profile orderpage-bootstrap`로 새 assumed-role인지 확인한다. 원본 출력에는 계정 ID/ARN이 있으므로 공개 문서에 붙이지 않는다. 원본 IAM 로그인 세션이 만료됐다면 `orderpage-login`으로 다시 로그인한다. `default`의 오래된 키로 우회하지 않는다.

그다음 **bootstrap 변수 준비 → bootstrap plan 저장·검토 → 승인한 plan만 apply → 별도 배포 Role과 서비스 환경 plan** 순서로 진행한다. 실제 apply 전에는 예상 비용·운영 종료 시각·삭제 순서를 확인한다. 이 문서의 정책 생성은 S3 버킷을 생성하는 작업이 아니다.

## 무엇을 검증했나

2026-11-27 로컬 검사 결과:

- 생성기/정책 회귀 검사 6개 통과: 사용자·Role 제한, 단일 버킷/서울 생성 조건, HTTP 거부, 잘못된 입력 거부, 임시 인증 연결, 출력 파일 덮어쓰기 방지.
- 허용한 S3 Action 27개를 AWS 공식 서비스 참조 JSON과 대조했다. 관리형 정책 크기 제한 6,144자 이내인지 검사했다.
- 고정 provider 5.100.0의 S3 버킷 소스와 현재 bootstrap의 7개 resource 블록을 읽고 조회·설정 작업 범위를 확인했다.
- 이후 실제 AssumeRole·bootstrap validate/plan/apply 및 AWS 조회가 성공했고, 후속 plan은 변경 없음이었다. **미실행:** IAM Access Analyzer 서버 검증, 정책 시뮬레이터, bootstrap destroy/실제 복구. 생성·조회 성공을 삭제/복구 권한까지 검증한 것으로 해석하지 않는다.

근거: [AWS 서비스 권한 JSON](https://docs.aws.amazon.com/service-authorization/latest/reference/service-reference.html), [S3 Action·조건](https://docs.aws.amazon.com/service-authorization/latest/reference/list_s3.html), [AWS provider 5.100.0 S3 구현](https://github.com/hashicorp/terraform-provider-aws/blob/v5.100.0/internal/service/s3/bucket.go), [Terraform S3 backend의 상태·잠금 권한](https://developer.hashicorp.com/terraform/language/backend/s3), [IAM 권한 경계](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html), [PassRole 제한](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html).
