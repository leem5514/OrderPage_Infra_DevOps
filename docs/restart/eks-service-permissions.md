# EKS를 만들고 정리하기 위한 권한

2026-11-27. PR #25의 민감정보 검사를 다시 수행하고 병합했다. 그 다음 EKS 클러스터 1개·노드 그룹 1개·기본 add-on 3개의 생명주기 권한을 검토용으로 구현했다. **AWS 정책 연결과 서비스 apply는 하지 않았다.**

## 생성과 수정·삭제를 같은 ARN으로 제한하면 안 되는 이유

기존 IAM 위임 정책은 Role·OIDC·EKS 운영자 등록을 담당한다. 이번에는 실제 EKS 서비스를 만들고, 변경하고, 실습 후 삭제하는 API를 추가했다. 공식 권한표와 프로그램형 참조를 대조하면서 생성 API의 제약을 구분했다.

| 작업 | IAM에서 검사하는 대상 | 이번 구현 |
|---|---|---|
| `CreateCluster` | 리소스 수준 제한 미지원, `Resource=*` 필요 | 계정·서울·프로젝트 태그·명시 버전·STANDARD 지원·API 인증·생성자 관리자 비활성·로그·private endpoint 조건 |
| `CreateNodegroup`, `CreateAddon` | 부모 cluster ARN | 정확한 `orderpage-dev`와 생성 태그. 생성할 자식 이름은 plan 검사에서 확인 |
| Cluster 갱신·삭제 | cluster ARN | `orderpage-dev` 하나 |
| Node group 갱신·삭제 | nodegroup ARN | `orderpage-dev-default`, AWS가 부여하는 마지막 ID만 와일드카드 |
| Add-on 갱신·삭제 | addon ARN | `coredns`, `kube-proxy`, `vpc-cni` 세 이름, 마지막 ID만 와일드카드 |

이는 [공식 EKS 권한표](https://docs.aws.amazon.com/service-authorization/latest/reference/list_eks.html)와 [프로그램형 권한 참조](https://servicereference.us-east-1.amazonaws.com/v1/eks/eks.json)를 기준으로 작성한 정책이다. **클러스터 생성 이름이나 노드 수·인스턴스 타입·add-on 버전까지 IAM이 강제한다고 표현하지 않는다.** 태그 API는 지정 자원으로 제한하지만 이를 생성 요청의 모든 인자를 고정하는 장치로 간주하지 않는다. 추가 Allow 정책을 붙이면 달라지는 범위도 있으므로 최종 전체 정책을 함께 검토한다.

## 과금과 접근 설정은 어떻게 보호했나

생성 시 STANDARD 지원과 검토한 Kubernetes minor 버전을 요구한다. API 인증, 생성자의 자동 관리자 권한 비활성화, private endpoint, API/audit/authenticator 로그도 조건으로 확인한다. Auto Mode의 compute·storage·load balancing 기능을 켜는 요청, EXTENDED 지원이나 CONFIG_MAP 인증으로 바꾸는 요청은 명시적 Deny다. Fargate·외부 클러스터 등록·추가 OIDC 인증 연결·Pod Identity 변경도 현재 구성에 필요하지 않아 거부한다.

`UpdateClusterConfig`는 변경 필드만 보내므로 모든 생성 조건을 다시 요구하면 정상 갱신이 실패한다. 따라서 갱신은 `IfExists` 조건으로 **키를 보냈을 때의 값**을 제한한다. 필드 누락을 전체 구성의 안전성이 검증됐다는 뜻으로 해석하지 않는다. 실제 provider 호출과 현재 상태 확인이 필요하다. [provider cluster 구현](https://github.com/hashicorp/terraform-provider-aws/blob/v5.100.0/internal/service/eks/cluster.go).

노드 수·타입, public endpoint CIDR, 생성 이름 등은 별도 plan 검사로 확인한다. 현재 검토 기준은 두 대의 `m6i.large` ON_DEMAND 노드, 기본 add-on 세 개, 운영자 IPv4 `/32` 접근이다. 이는 현재 구성과 일치하는지의 검사이지 최저 비용 보장이나 지출 상한이 아니다. 노드를 더 큰 타입으로 바꾸거나 20대로 늘리는 변형 테스트는 실패하도록 했다.

plan 검사기는 읽기 전용 도구이며 직접 AWS API를 호출하는 사용자를 차단하지 않는다. subnet/Role/launch template의 아직 계산되지 않은 ID, provider 기본값, add-on 실제 호환성, Kubernetes 표준 지원 기간, 최종 금액은 따로 확인한다. 삭제·교체 plan은 이 생성 검사에서 보류하며 실제 종료 작업은 별도 정리 검토 후 실행한다.

## 기존 IAM 위임과의 연결

생성 API의 PassRole·TagResource 등 의존 권한은 기존 IAM 위임 정책과 함께 평가한다. 새 태그 제한에는 별도 운영자의 Access Entry도 포함해 이전 단계의 태그 작업을 막지 않게 했다. 업데이트 완료를 기다리는 `DescribeUpdate`와 태그 조회 권한도 포함한다. [node group 구현](https://github.com/hashicorp/terraform-provider-aws/blob/v5.100.0/internal/service/eks/node_group.go), [add-on 구현](https://github.com/hashicorp/terraform-provider-aws/blob/v5.100.0/internal/service/eks/addon.go).

provider 소스에 있는 `AssociateEncryptionConfig`는 현재 추가 KMS encryption 설정에서 사용하지 않으므로 부여하지 않았다. VPC, launch template, Jenkins EC2, 로그 그룹 생성 권한은 이 정책에 들어 있지 않다. CreateCluster의 CreateAccessEntry 의존 표기처럼 설정에 따라 필요한 경로는 실제 AWS 검증에서 재확인해야 한다. 현재는 생성자 관리자 권한과 Auto Mode를 비활성화한 구성을 기준으로 검사했다.

정책 2개의 공백 제외 크기는 각각 5,318자와 3,309자다. 기존 state/read 2개와 IAM 위임 검토본 6개까지 포함하면 현재 후보는 10개다. 나머지 서비스 정책을 완성한 뒤 실제 계정의 Role 연결 할당량과 대조하고 최종 묶음을 정리한다. 공식 기본값과 계정 적용값을 동일하다고 가정하지 않는다. [IAM 정책 크기·연결 할당량](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html).

## 확인한 결과와 남은 작업

- 신규 10개를 포함한 **Node 테스트 105개 통과**. 정상 생성·부분 갱신·삭제 외에 다른 계정/리전/자원, 추가 계산 기능, 운영자 권한 변경, 과도한 노드 수/타입을 검사했다.
- 저장된 실제 전체 plan의 EKS 설정 **16개**, 최초 EKS plan의 설정 **11개**가 통과했다. Terraform HCL은 바꾸지 않아 새 plan이나 Terraform mock 테스트를 불필요하게 반복하지 않았다.
- 이전 IAM 검토본과 합친 **22개 자원·86개 요청 조건**이 로컬 평가에서 허용됐다. 실제 issuer 연결 전인 OIDC 쓰기는 제외했다.
- 공식 Action·Resource·Condition 지원 범위, provider v5.100.0의 직접 API 호출 목록과 해시를 기록했다. 실제 AWS IAM 시뮬레이터, 정책 연결, 생성·삭제 시험은 아직 수행하지 않았다.

[검증 요약](security-evidence/eks-service-permissions-2026-11-27.json)에는 계정·IP·암호를 넣지 않았다. 실제 계정이 들어간 정책 2개와 manifest는 `.local/iam-eks-service-review`에만 있으며 Git에서 제외된다. [생성·검사 명령](../../iam/eks-service/README.md)을 사용해도 AWS 권한을 부여하거나 배포하지 않는다.

다음은 VPC·NAT·라우팅·보안 그룹과 launch template·Jenkins EC2의 권한이다. 이후 데이터·스토리지·관측 권한까지 완성하고, 최종 정책·정리 경로·예산·가동 시간·최신 plan을 확인한 뒤 실제 배포로 넘어간다. 현재 사용자에게 추가 IAM 정책 생성을 요청하는 단계는 아니다.
