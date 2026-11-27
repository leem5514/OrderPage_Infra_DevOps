# Terraform이 만드는 Role의 권한 상한 준비

2026-11-27 KST. **정책 파일 5개와 Terraform 연결을 준비했다. AWS에 정책을 생성하거나 서비스 생성 권한을 부여한 단계는 아니다.** 새 실제 plan은 생성 74개로 기존과 같고, Role 5개의 `permissions_boundary` 외 나머지 자원의 계획 값은 같았다.

## 왜 배포 전에 이 작업을 하나

Terraform은 클러스터·Node·Jenkins·백엔드 업로드·ALB Controller용 Role을 만든다. 앞으로 배포 Role에 IAM 생성 권한을 줄 때 이름만 제한하면 해당 이름의 Role에 지나치게 넓은 정책을 연결할 여지가 있다. 별도로 관리하는 상한을 연결해, 일반 권한 정책을 바꾸더라도 검토한 범위를 넘지 못하게 준비한다.

권한 상한 자체는 권한을 부여하지 않는다. 일반 IAM 권한과 상한이 함께 허용해야 실행할 수 있다. 다만 Role 세션에 직접 부여된 resource policy 등에는 평가 예외가 있으므로 모든 접근 경로를 통제하는 방화벽으로 해석하면 안 된다. [AWS 권한 상한과 평가 설명](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html).

이번에는 현재 연결하는 정책의 범위를 고정한다. 운영 성공을 확인하지 않은 상태에서 필요한 Action까지 임의로 제거하지 않았으며, 아래 남는 범위도 그대로 기록한다.

| Terraform Role | 관리자 소유 상한 정책 이름 | 상한의 내용과 남는 범위 |
|---|---|---|
| `orderpage-dev-cluster-role` | `orderpage-dev-boundary-cluster` | 고정한 EKS Cluster 정책. 일부 EC2/ELB/Auto Scaling 권한은 `Resource=*`다. |
| `orderpage-dev-node-role` | `orderpage-dev-boundary-node` | Worker/CNI/ECR pull 정책 합집합. 범용 ECR pull과 upstream image import, Pod Identity용 `eks-auth:AssumeRoleForPodIdentity`, 수집한 ECR 정책의 bearer token Action도 남는다. 현재 앱은 IRSA를 사용한다. |
| `orderpage-dev-jenkins` | `orderpage-dev-boundary-jenkins` | SSM agent 기본 정책과 지정 ECR의 push/조회. SSM 기본 정책의 GetParameter/GetParameters도 포함하며, 계정 전체의 비밀 조회 차단을 보장한다고 표현하지 않는다. |
| `orderpage-dev-backend-upload` | `orderpage-dev-boundary-backend-upload` | 현재 계정의 전용 상품 이미지 버킷 객체 PutObject만. |
| `orderpage-dev-alb-controller` | `orderpage-dev-boundary-alb-controller` | 고정한 공식 v3.6.2 정책. 태그 조건, ELB 서비스 연결 Role 생성, 인증서 조회 및 일부 WAF/Shield 권한을 보존한다. 사용하지 않는 기능은 Helm에서 비활성이다. |

이 범위는 최소 권한의 최종 형태가 아니다. 현재 신뢰 정책의 정확한 서비스/ServiceAccount 제한과 함께 사용한다. 상한에 AWS 리전 제한을 임의로 덧붙이지 않았으므로 조회 정책의 서울 제한과도 구분해야 한다.

## 생성한 파일과 보호 범위

[생성기](../../scripts/prepare-workload-boundaries.mjs)는 공식 정책 스냅샷의 해시, 계정 ID 형식과 IAM 관리형 정책의 6,144자 제한을 검사한다. 출력은 Git에서 제외한 `.local/iam-workload-boundaries`에만 두며 기존 결과를 덮어쓰지 않는다.

정책 JSON 5개 외에 다음 파일이 있다.

- `manifest.json`: 정책 이름·ARN·문자 수·SHA256. 콘솔에 붙여 넣는 정책은 아니다.
- `plan-read.json`: 기존 `OrderPageServicePlanRead`의 갱신본. 현재 Controller 정책과 상한 5개에 대한 GetPolicy/GetPolicyVersion/ListPolicyVersions/ListPolicyTags만 허용한다. 쓰기 권한을 추가하지 않는다.

계정 ID는 Access Key가 아니지만 공개 자료에는 넣지 않는다. 저장 plan에는 암호가 들어갈 수 있으므로 Git에 올리거나 화면 전체를 공유하지 않는다.

## 콘솔에서 할 일: 정책 생성 5번, 기존 조회 정책 편집 1번

IAM 정책 생성 권한을 가진 관리자 콘솔에서 진행한다. `orderpage-operator`에 관리자 정책을 추가할 필요는 없다.

1. AWS 콘솔 상단 검색창에서 **IAM**을 열고, 왼쪽 **정책 → 정책 생성 → JSON**을 선택한다.
2. 편집기 내용을 지우고 로컬 폴더의 `orderpage-dev-boundary-cluster.json` 전체를 붙여 넣는다. GitHub 원본 스냅샷이나 manifest를 붙여 넣지 않는다.
3. **다음**을 누르고 정책 이름을 `orderpage-dev-boundary-cluster`로 입력해 생성한다. 설명은 `OrderPage dev EKS cluster permissions boundary`로 입력할 수 있다.
4. 같은 방식으로 `node`, `jenkins`, `backend-upload`, `alb-controller` 파일을 각각 생성한다. 정책 이름은 위 표와 정확히 일치해야 하며 IAM 기본 경로 `/`를 사용한다.
5. 생성된 상한 5개를 사용자 그룹·배포 Role의 **권한 추가**에서 연결하지 않는다. 미래의 서비스 apply가 각각의 workload Role을 만들면서 **권한 경계** 항목에 연결한다. 현재는 정책 생성까지만 한다.
6. IAM **정책** 목록에서 기존 `OrderPageServicePlanRead`를 검색한다. 해당 정책의 **편집 → JSON**에서 로컬 `plan-read.json` 전체로 교체하고 저장한다. 새 버전이 기본 버전인지 확인한다. 기존 `orderpage-terraform-deploy` Role 연결은 그대로 유지한다.

정책 생성 화면에 Action/Resource 관련 오류가 있다면 저장 전에 해당 오류를 확인한다. ARN의 계정 자리에 `{{ACCOUNT_ID}}`가 남은 원본 템플릿을 사용하면 안 된다. 파일에는 계정이 이미 치환되어 있으며 키·비밀번호는 없다.

## 코드에서 연결되는 위치

[환경 연결 파일](../../terraform/envs/dev/workload-boundaries.tf)은 현재 AWS 호출 계정으로 상한 ARN 5개를 만든다. EKS의 두 Role과 Jenkins·상품 이미지·Controller 모듈에 필요한 ARN을 각각 전달한다. 모듈의 상한 변수는 필수이며 null·임의 정책 이름·AdministratorAccess ARN은 허용하지 않는다.

상한 정책을 생성하는 `aws_iam_policy` 자원은 서비스 Terraform에 넣지 않았다. **향후 배포 권한 정책**에서도 상한의 변경·삭제, 경계 제거, 배포/운영/bootstrap Role의 자기 수정을 제한해야 한다. HCL에 ARN이 있다는 사실만으로 해당 IAM 권한 제한까지 구현됐다고 볼 수 없다. 현재 배포 Role은 조회 단계다.

## 확인한 것과 아직 남은 것

- Node 테스트 81개, Terraform validate와 mock 테스트 25개 통과. 기존 테스트가 개인 tfvars의 활성화 값에 영향을 받던 부분은 시나리오 입력을 명시해 분리했다.
- 새 실제 plan: 생성 74, 수정/삭제 0, 상한 누락 Role 0. 앞선 plan과 비교해 Role의 상한 외 계획 값이 바뀌지 않았음을 확인했다. [비식별 검증 기록](security-evidence/workload-boundaries-2026-11-27.json).
- 정책 생성 전에도 ARN 문자열이 유효하면 plan은 통과할 수 있다. 원격 정책의 존재·기본 버전·본문 비교, 실제 IAM 권한 평가와 서비스 기동은 아직 검증하지 않았다.
- 정책 생성/조회 정책 편집이 끝나면 원격 정책 내용을 비교한다. 이어 정확한 PassRole, EKS 운영 Role 등록 제한, 서비스별 생성·삭제 권한을 구현한다. 비용·가동 시간·Budget을 확정하고 최종 plan을 검토한 뒤 apply로 진행한다.

새 서비스 자원은 생성하지 않았다. [비용 검토](cost-review-2026-11-27.md)의 자원 구성도 변하지 않았으며 월 Budget 금액은 아직 미확정이다.
