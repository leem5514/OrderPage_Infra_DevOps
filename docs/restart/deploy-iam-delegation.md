# 배포 권한 1단계: IAM 위임과 EKS 운영자 등록

2026-11-27 KST. **PR #24로 IAM 위임 1단계를 병합했다. 후속 구현은 OIDC·서비스 연결 Role을 포함한 검토용 정책 6개다. AWS에 정책을 생성·연결하거나 서비스를 배포하지 않았다.** 이 문서의 90개 테스트와 44개 요청 검사는 1단계 기록이며, 최신 95개 테스트와 최초 EKS plan은 [2단계 설명](oidc-service-linked-roles.md)에 기록한다.

## 지금 해결하는 문제

Terraform이 Role을 만들 수 있게 하려면 일반 서비스 생성 권한 외에 IAM 권한이 필요하다. 이를 넓게 부여하면 배포 실행자가 자신의 정책을 바꾸거나, 임의 Role을 서비스에 전달하거나, EKS에 다른 관리자를 등록할 수 있다. 이번 묶음은 그 경로를 역할 이름·권한 상한·전달 서비스·운영자 ARN으로 제한한다.

이미 AWS에 만든 `orderpage-dev-boundary-*`는 **workload Role의 권한 상한**이다. 이번 `OrderPageWorkload*`와 `OrderPageDeploymentGuardrails`, `OrderPageEksAccessManagement`는 나중에 **Terraform 실행 Role의 권한**으로 검토하는 별도 정책이다. 둘을 서로 바꿔 연결하면 안 된다.

## 허용과 거부를 어떻게 나눴나

| 요청 | 허용 범위 | 차단하거나 남겨 둔 제한 |
|---|---|---|
| Role 생성 | 정확한 Role 5개, 각 Role에 대응하는 상한, 프로젝트·환경·관리 도구 요청 태그 | 상한 누락과 다른 역할의 상한 지정은 명시적 Deny |
| Role 갱신·삭제 | 현재 상한이 해당 역할의 상한인 경우 | 경계 제거는 Deny. 상한은 별도 관리자 경로에서 관리 |
| 관리형 정책 연결 | Cluster/Node/Jenkins/Controller 각각 현재 Terraform에 선언된 정책 | 다른 관리형 정책의 연결은 이 Allow 목록에 없음 |
| inline 정책 | Jenkins와 백엔드 업로드 Role만, 해당 상한 아래 | inline 본문 자체를 IAM 조건으로 고정하지는 못함 |
| PassRole | Cluster·Node → EKS, Jenkins → EC2 | 다른 Role과 전달 서비스는 명시적 Deny |
| IAM 보조 자원 | Controller 정책 1개, Jenkins instance profile 1개 | 다른 관리형 정책 및 profile 변경은 명시적 Deny |
| EKS 운영자 등록 | `orderpage-dev`에 `orderpage-eks-operator` STANDARD entry | 다른 주체·클러스터, 임의 username/group, UpdateAccessEntry는 Deny |
| EKS 관리자 정책 | 위 entry에 지정된 ClusterAdminPolicy와 cluster scope | 다른 entry·정책·scope로 연결하는 요청은 Deny |
| 실행자·운영자·bootstrap 및 사용자/그룹 수정 | 허용하지 않음 | 지정 보호 주체의 IAM 작업과 배포 Role의 추가 AssumeRole은 Deny |

PassRole의 전달 서비스는 Role trust의 서비스 이름과 항상 같지 않다. 공식 API 의존 조건에서 EKS CreateNodegroup은 `eks.amazonaws.com`, Jenkins instance profile에 Role을 넣는 요청은 `ec2.amazonaws.com`이다. [EKS 공식 참조](https://docs.aws.amazon.com/service-authorization/latest/reference/list_eks.html), [IAM 공식 참조](https://docs.aws.amazon.com/service-authorization/latest/reference/list_iam.html).

EKS 관리자 정책을 해제하는 요청에는 연결 시의 accessScope 입력이 없다. 따라서 해제는 정확한 entry·policyArn으로 제한하고 연결 조건을 그대로 복사하지 않았다. instance profile도 현재 Terraform에 tags가 없어 생성 시 요청 태그를 강제하지 않고 정확한 ARN으로 제한했다.

## 삭제할 때 경계를 제거해야 하지 않나

고정 provider `hashicorp/aws` v5.100.0의 Role 삭제 경로를 읽었다. 연결 정리 후 DeleteRole을 호출하며, 경계 삭제는 `permissions_boundary`를 빈 값으로 갱신하는 별도 경로에 있다. 따라서 현재 코드의 destroy를 위해 경계 제거 권한을 먼저 열 필요는 없다고 판단했다. 이는 **소스 검토 결과**이며 실제 AWS 생성·삭제 시험 완료를 뜻하지 않는다. [provider Role 구현](https://github.com/hashicorp/terraform-provider-aws/blob/v5.100.0/internal/service/iam/role.go).

## 확인한 범위

새 테스트 9개를 포함해 전체 Node 테스트 **90개**가 통과했다. 허용 요청 외에 상한 누락·잘못된 경계·다른 계정·다른 클러스터·임의 관리자·잘못된 PassRole·자기 정책 수정 요청을 검사했다. 명시적 Deny가 필요한 항목은 추가적인 넓은 Allow를 테스트에 넣어도 거부되는지 확인했다.

공식 서비스 참조와 대조해 사용한 Action의 존재, 리소스 유형, 조건 키 지원, PassRole 의존 조건을 확인했다. 각 정책의 공백 제외 크기는 6,144자 이하다.

기존 실제 plan의 IAM 16개와 EKS 접근 설정 2개 중 **17개 자원에서 추출한 요청 조건 44개**가 로컬 검사에서 허용됐다. OIDC 공급자 1개는 의도적으로 미검토 목록에 남겼다. [비식별 대조 결과](security-evidence/deploy-delegation-2026-11-27.json).

이 검사는 AWS IAM Policy Simulator가 아니다. 작은 로컬 평가기는 Action/Resource와 StringEquals·StringNotEquals·Null만 검사한다. SCP·세션 정책·resource policy 및 AWS가 실제로 제공하는 context, provider의 전체 호출 흐름은 검증하지 않는다. Terraform HCL은 변경하지 않아 이전 plan이나 전체 Terraform 테스트를 불필요하게 반복하지 않았다.

## 적용 전에 반드시 해결할 범위

**신뢰 정책 본문은 이 권한 정책만으로 고정되지 않는다.** CreateRole/UpdateAssumeRolePolicy를 허용하는 한 임의 trust JSON을 전달할 여지가 있다. 현재 상한이 제한하는 workload 권한도 외부 주체에 노출되면 문제가 되므로, 최종 plan의 EC2/EKS 서비스 주체와 IRSA issuer·aud·sub를 따로 검토해야 한다. 현재처럼 배포 주체를 신뢰하는 개인 실습용 위임이며, 신뢰하지 않는 팀에 위임할 완전한 격리 정책으로 표현하지 않는다.

Controller의 정책 본문과 두 inline 정책 본문 역시 현재 내용 전체를 조건으로 고정한 것은 아니다. workload 상한과 최종 plan 검토를 함께 사용한다. 보호된 사용자/그룹의 `iam:*` Deny에는 해당 주체의 읽기도 포함되지만, 현재 Terraform 조회 경로는 이 주체들을 읽지 않는다.

OIDC issuer ID는 클러스터 생성 후 정해진다. 후속 구현은 생성 전 OIDC 변경을 거부하고, 생성 후 실제 클러스터를 조회해 정확한 공급자 하나에만 묶는다. 서비스 연결 Role 생성의 AttachRolePolicy/PutRolePolicy 의존 권한은 지정한 공유 Role 7개에 한해 guard 예외로 분리했다. [범위와 한계](oidc-service-linked-roles.md)를 함께 확인한다.

그다음 VPC·EC2·EKS 본체·RDS·Redis·MQ·ECR·S3·관측의 생성/갱신/삭제 요청을 작성하고 전체 묶음을 다시 검사한다. 가동 시간·Budget을 확정하고 최신 plan과 정리 경로까지 검토한 후에 최종 정책을 연결한다. **현재 검토본의 `REVIEW_ONLY_DO_NOT_ATTACH` 상태를 유지한다.**
