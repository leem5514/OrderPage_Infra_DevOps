# IAM 로그인 완료와 사전 조회 권한 준비

> **문서 용도:** IAM 임시 로그인과 CLI·Terraform 인증 연결.
> **읽는 기준:** 구현 이유와 당시 검증·설정 순서를 보존한 문서입니다. 본문의 날짜·완료/미완료는 작성 당시 기준이며, 현재 상태는 [통합 점검표](../checks.md), 비용은 [비용·운영 계획](../costs.md)을 우선합니다. [문서 지도](../README.md)

2026-11-27 KST. **CLI 임시 로그인과 Terraform provider 인증 과정을 기록한다.** 사용자의 사전 조회 정책 연결 후 서비스 버전·사양 조회도 성공했다. 이후 별도 Role을 통한 [S3 bootstrap 적용](../checks.md#state)까지 완료했다. 서비스 환경의 VPC/EKS plan/apply는 아직 실행하지 않았다. Infra #18은 main에 병합됐다.

## 무엇이 확인됐나

| 확인 | 결과 |
|---|---|
| 브라우저 기반 CLI 로그인 | 성공, 장기 Access Key를 새로 만들지 않음 |
| STS 호출 주체 | 의도한 IAM 사용자, 루트 아님 |
| `orderpage-login` | 브라우저 임시 인증을 보관하는 로컬 프로필 |
| `orderpage-lab` | 위 프로필을 credential_process로 읽는 도구용 프로필 |
| 리전 | 두 프로필 모두 ap-northeast-2 |
| Terraform 인증 | 1.16.2 / 고정 AWS provider 5.100.0으로 실제 STS 데이터 조회 성공 |
| EKS 버전 조회 | 최초 AccessDenied → 사전 조회 정책 연결 후 성공 |

`default`의 기존 키는 수정하지 않았다. 프로필 분리는 AWS 계정이나 권한을 새로 만드는 작업이 아니다. 새 프로필에서도 연결한 IAM 사용자의 권한만 사용할 수 있다.

최초 Terraform 인증 검사는 Git 제외된 `.local/aws-auth-probe`에서 `aws_caller_identity` 데이터만 조회했다. 생성/변경/삭제할 resource 블록은 없었고, 이후 별도로 수행한 S3 bootstrap 및 실제 서비스가 포함된 `terraform/envs/dev`와 구분한다. 임시 자격증명·계정 ID·사용자 ARN·로그인 URL은 이 저장소에 기록하지 않는다.

## 두 프로필을 연결한 이유

고정 AWS provider 5.100.0과의 호환성을 위해 AWS 공식 credential_process 연결 방식을 사용했다. `orderpage-login`은 브라우저 인증, `orderpage-lab`은 해당 인증의 임시 자격증명을 필요할 때 받는 역할이다. 서로 다른 이름을 사용해 자기 자신을 호출하는 순환 구성을 피한다.

```ini
[profile orderpage-lab]
region = ap-northeast-2
credential_process = aws configure export-credentials --profile orderpage-login --format process
```

이는 로컬 AWS config의 비밀값 없는 설정 예시다. `export-credentials` 명령을 단독 실행해 출력을 채팅·로그에 복사하지 않는다. 실제 출력에는 임시 비밀값이 들어간다. 토큰 캐시와 실제 AWS config/credentials도 커밋하지 않는다.

세션이 만료되면 `aws login --profile orderpage-login --region ap-northeast-2`로 다시 로그인한다. `orderpage-lab`은 연결된 인증을 사용한다. AWS CLI 명령에는 `--profile orderpage-lab`, 실제 Terraform을 실행할 PowerShell에는 `$env:AWS_PROFILE = 'orderpage-lab'`을 사용한다. 다른 AWS 키 환경변수가 인증을 덮어쓰지 않는지도 확인한다.

## 연결한 사전 조회 권한

최초 그룹의 `SignInLocalDevelopmentAccess` 정책은 CLI 로그인용이다. EKS/RDS 등 조회·생성 권한을 부여하지 않는다. 다음 사전 조회를 위한 [정책 JSON](../../../iam/operator-preflight-readonly.json)을 준비했다.

| 범위 | 필요한 이유 |
|---|---|
| EKS 버전·add-on | 클러스터와 add-on 조합 호환성 확인 |
| RDS 엔진·주문 가능한 사양 | MariaDB patch와 인스턴스 조합 확인 |
| ElastiCache 엔진 | Redis 지원 버전 확인 |
| MQ 엔진·인스턴스 옵션 | RabbitMQ 엔진·사양·배포 모드 확인 |
| EC2 이미지·AZ·인스턴스 사양/제공 여부 | Amazon Linux 이미지와 서울 가용성 확인 |

허용 API는 11개를 명시했고 요청 리전은 서울로 제한했다. Resource `*`는 위 조회 API들이 개별 자원 ARN 제한을 지원하지 않기 때문이다. Action 와일드카드, Create/Delete, IAM 수정, PassRole, 비밀값 읽기, S3 객체 읽기 권한은 없다. EC2 이미지 조회에는 계정에서 보이는 이미지 메타데이터도 포함될 수 있으므로 결과 전체를 공개하지 않는다.

이 정책은 권한 경계나 명시적 Deny가 아니다. 다른 정책으로 부여된 권한을 제한하지 않는다. SCP/permissions boundary/명시적 Deny가 있으면 추가 후에도 거부될 수 있다. **이 정책만으로 실제 Terraform 기반 인프라 plan/apply를 수행할 수는 없다.** 배포용 Role과 state 접근 권한은 생성 대상·비용을 검토한 뒤 별도로 구성한다.

## 콘솔에서 연결한 순서 (완료 기록)

현재 IAM 사용자에게는 자기 권한을 수정할 권한이 없다. IAM 정책을 관리할 수 있는 관리자 세션에서 수행한다. 현재 계정에 별도 관리자가 없다면 루트는 이 초기 권한 설정에만 사용하고, CLI는 계속 IAM 사용자로 사용한다.

1. **IAM → 정책 → 정책 생성**으로 이동한다.
2. 정책 편집기를 **JSON**으로 선택하고 위 정책 파일 내용을 전체 붙여 넣는다.
3. **다음**에서 이름을 `OrderPagePreflightReadOnly`로 지정하고 검토 후 생성한다.
4. **IAM → 사용자 그룹 → 현재 사용자가 속한 그룹 → 권한 → 권한 추가 → 정책 연결**로 이동한다. 현재 화면에서 만든 그룹 이름은 `SignInLocalDevelopmentAccess`다.
5. `OrderPagePreflightReadOnly`를 검색·선택해 연결한다. 기존 로그인 정책은 유지한다.
6. IAM 사용자로 돌아와 연결 완료를 알린다. 이후 CLI로 조회 허용 여부와 버전·사양을 확인한다.

사용자가 정책을 생성하고 기존 그룹에 연결한 화면을 확인했다. 이후 CLI에서 11개 조회 API에 대한 13개 조회 묶음이 성공했다. [서울 조회 결과](seoul-compatibility.md)에 기록했다. 정책 JSON 구문과 공식 Action 목록/서울 조건을 확인했으며 실제 IAM Access Analyzer 검증·정책 시뮬레이션·쓰기 권한 거부 검증은 수행하지 않았다. 로그인 성공은 배포 권한이나 가용성·비용 검증 완료를 뜻하지 않는다.

이제 **실제 변수·예산·운영자 Role 확정 → state bootstrap 계획 검토 → 실제 환경 plan 검토** 순서다. [배포 전 준비 문서](aws-plan-preflight.md)를 함께 따른다.

첫 실행 권한은 [상태 버킷 전용 bootstrap Role](../iam/terraform-bootstrap-role.md)로 분리했다. 이후 새 `orderpage-bootstrap` 프로필의 STS Role 전환, [plan 검토](../checks.md#state), 승인된 [S3 적용·검증](../checks.md#state)을 완료했다. 서비스 환경을 생성하는 배포 Role과 apply는 여전히 별도 단계다.

근거: [AWS CLI 임시 로그인과 credential_process](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html), [EKS 권한](https://docs.aws.amazon.com/service-authorization/latest/reference/list_eks.html), [RDS 권한](https://docs.aws.amazon.com/service-authorization/latest/reference/list_rds.html), [ElastiCache 권한](https://docs.aws.amazon.com/service-authorization/latest/reference/list_elasticache.html), [MQ 권한](https://docs.aws.amazon.com/service-authorization/latest/reference/list_mq.html), [EC2 권한](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ec2.html), [RequestedRegion 조건](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html#condition-keys-requestedregion).
