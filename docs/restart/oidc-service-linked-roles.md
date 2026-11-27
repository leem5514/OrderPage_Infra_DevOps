# 배포 권한 2단계: OIDC와 서비스 연결 Role

현재 결과는 **검토용 정책 코드와 plan**이다. 권한을 AWS에 부여하거나 EKS를 생성한 상태가 아니다. PR #24를 병합한 뒤, 기존 IAM 위임 정책에서 빠져 있던 두 영역을 구현했다. 정책 생성기의 `REVIEW_ONLY_DO_NOT_ATTACH`와 `readyForApply: false`를 유지한다.

## OIDC를 한 번 더 나누는 이유

백엔드 업로드와 ALB Controller Pod는 IRSA를 통해 AWS Role을 사용한다. IAM OIDC 공급자는 그때 EKS가 발급한 토큰을 신뢰하는 연결점이다. issuer URL의 마지막 ID는 클러스터가 만들어져야 알 수 있다.

서울 issuer 전체에 쓰기를 허용하면 다른 클러스터의 OIDC 공급자에도 접근할 여지가 생긴다. 생성 요청의 프로젝트 태그만으로 기존 공급자의 소유권까지 보장할 수도 없다. 따라서 기본 정책에서는 OIDC 쓰기를 명시적으로 거부하고, 실제 클러스터를 조회한 뒤 정확한 ARN 하나만 허용한다. OIDC 공급자 생성은 신뢰 관계에 영향을 주는 작업이므로 범위를 제한한다. [AWS CreateOpenIDConnectProvider 설명](https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreateOpenIDConnectProvider.html).

| 단계 | 확인·결과 | 아직 하지 않는 일 |
|---|---|---|
| 기본 검토본 생성 | `.local/iam-deploy-foundation-review`에 정책 6개와 manifest, OIDC는 전부 Deny | AWS API 호출·권한 부여·서비스 생성 |
| 최초 EKS 생성 준비 | 서비스 쓰기 정책·예산·가동 시간 확정 후, EKS와 선행 자원만 별도 plan 검토 | 현재는 apply하지 않음 |
| 실제 issuer 연결 | `--bind-oidc`로 STS 주체와 서울 `orderpage-dev` ACTIVE 상태 확인, 정확한 공급자 하나만 허용하는 새 검토본 생성 | 계정 ID나 issuer를 소스에 저장, 임의 공급자 자동 승인 |
| 전체 배포 준비 | 변경된 정책 전체 검토·연결, 새 **전체 plan**으로 노드·IRSA·데이터·관측 구성 검토 | 오래된 전체 plan 재사용 |

조회 명령은 `orderpage-deploy`를 명시한다. 다른 계정, root/다른 Role, 다른 클러스터, 다른 리전, ACTIVE가 아닌 상태, 잘못된 issuer URL이면 중단한다. 자격증명·endpoint 환경 변수 덮어쓰기도 거부한다. 오류 원문이나 토큰은 출력하지 않는다. 기존 개인 출력 폴더는 덮어쓰지 않으며 연결 단계 출력은 `.local/iam-deploy-oidc-bound-review`로 분리한다.

정확한 공급자 안에서는 생성·삭제·태그·thumbprint·client ID 갱신을 허용한다. 현재 Terraform의 client ID는 `sts.amazonaws.com`이다. **이 IAM 정책은 client ID/태그 값이나 trust JSON 본문 전체를 고정하지 않는다.** 최종 plan에서 issuer·aud·sub·태그를 다시 확인해야 한다. [고정 AWS provider v5.100.0 구현](https://github.com/hashicorp/terraform-provider-aws/blob/v5.100.0/internal/service/iam/openid_connect_provider.go).

## 최초 plan을 실제로 확인한 결과

AWS 인증을 사용해 `-target=module.eks.aws_eks_cluster.this`의 검토용 plan을 생성했다. **생성 19개, 수정·삭제 0개**이며 OIDC 공급자와 노드 그룹은 포함되지 않는다. VPC 15개 자원과 EKS 본체·로그 그룹·cluster Role·정책 연결 4개가 대상이다. 비공개 plan/로그는 Git에서 제외하고 [자원 종류·개수와 해시](security-evidence/oidc-service-linked-2026-11-27.json)만 남겼다.

이 target은 issuer를 알기 위한 최초 의존성 구성에 한정한다. HashiCorp는 target을 일상 배포에 사용하지 말고 예외 상황으로 제한하도록 안내한다. 최초 단계 후에는 반드시 전체 plan을 다시 만들고 누락 자원과 드리프트를 확인한다. 기존 전체 plan의 74개와 이번 19개를 합산하지 않는다. 같은 구성의 부분집합이다. [Terraform resource targeting](https://developer.hashicorp.com/terraform/cli/commands/plan#resource-targeting).

**첫 단계부터 EKS·NAT·공인 IPv4 등의 비용이 발생한다.** 권한 생성기와 검토 plan을 작성했다고 유료 서비스를 만든 것은 아니다. 실제 적용은 권한 묶음 완성·예산/시간 확정 뒤에 진행하고, OIDC 연결 작업 때문에 중간 상태를 오래 방치하지 않는다. 종료 때는 전체 구성을 기준으로 정리한다.

## 서비스 연결 Role은 일반 workload Role과 다르다

서비스 연결 Role(SLR)은 AWS 서비스가 정의하고 사용하는 계정 공용 Role이다. 프로젝트 workload Role의 경계 정책 5개를 이 Role에 붙이는 방식으로 관리하지 않는다. 이름·서비스·계정이 정확히 일치하는 아래 7개만 생성 대상으로 제한하고 임의 suffix는 허용하지 않는다.

| 서비스 | 기본 Role 이름 | 공식 근거 |
|---|---|---|
| EKS | `AWSServiceRoleForAmazonEKS` | [EKS cluster](https://docs.aws.amazon.com/eks/latest/userguide/using-service-linked-roles-eks.html) |
| EKS 관리형 노드 그룹 | `AWSServiceRoleForAmazonEKSNodegroup` | [EKS node group](https://docs.aws.amazon.com/eks/latest/userguide/using-service-linked-roles-eks-nodegroups.html) |
| EC2 Auto Scaling | `AWSServiceRoleForAutoScaling` | [Auto Scaling](https://docs.aws.amazon.com/autoscaling/ec2/userguide/autoscaling-service-linked-role.html) |
| RDS | `AWSServiceRoleForRDS` | [RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAM.ServiceLinkedRoles.html) |
| ElastiCache | `AWSServiceRoleForElastiCache` | [ElastiCache](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/using-service-linked-roles.html) |
| Amazon MQ | `AWSServiceRoleForAmazonMQ` | [Amazon MQ](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/using-service-linked-roles.html) |
| Elastic Load Balancing | `AWSServiceRoleForElasticLoadBalancing` | [ELB](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/elb-service-linked-roles.html) |

AWS IAM의 생성 예제는 `CreateServiceLinkedRole` 외에 `AttachRolePolicy`, `PutRolePolicy`도 포함한다. 공식 프로그램형 참조의 CreateServiceLinkedRole 작업에도 PutRolePolicy가 의존 작업으로 표시된다. 기존 guard는 workload Role 5개 이외의 이 두 작업을 전부 거부했으므로, CreateServiceLinkedRole Allow만 추가하면 충돌할 수 있었다. 예외를 정확한 SLR 7개에만 추가하고 기존 workload Role 허용 조건은 유지했다. [IAM 생성 권한 예제](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create-service-linked-role.html), [IAM 프로그램형 참조](https://servicereference.us-east-1.amazonaws.com/v1/iam/iam.json).

이 의존 권한은 임의 Role의 정책 수정 권한이 아니다. 해당 SLR 안에서는 IAM Allow의 정책 본문/PolicyARN 조건을 추가로 고정하지 않았으며, SLR 정책 수정은 AWS 서비스가 관리한다는 제약에 의존한다. 실제 AWS 호출에서 필요한 의존 권한·context는 아직 검증하지 않았다. [SLR API의 서비스 소유 제약](https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreateServiceLinkedRole.html).

SLR에 대한 일반 CreateRole·신뢰 정책 수정·태그 수정·정책 분리·PassRole·삭제는 이 묶음에서 명시적으로 거부한다. 존재 확인용 GetRole은 지정 7개만 허용한다. 현재 사용자 권한으로 원격 7개의 존재 여부를 확인한 것은 아니며, 새 검토 정책을 연결하지 않은 상태다.

공유 SLR을 Terraform 프로젝트 자원으로 추가하지 않았다. 전체 프로젝트 destroy로 다른 프로젝트가 쓰는 공유 Role을 삭제하지 않도록 DeleteServiceLinkedRole은 거부한다. 계정 전체에서 더 이상 쓰이지 않는 Role의 삭제는 별도 관리자 검토 대상이다. 서비스별 생성 API를 나중에 허용할 때는 SLR을 통해 발생하는 간접 권한도 함께 검토한다.

## 검증 범위와 다음 단계

Node 전체 **95개**, IAM 위임 **14개** 테스트가 통과했다. OIDC 미연결 차단, 잘못된 계정·리전·issuer, 자격증명 덮어쓰기, 오류 출력, SLR 이름/suffix/서비스 제한, 공유 Role 삭제 차단을 검사했다. 기존 실제 plan에서 추출한 44개 요청도 새 정책에서 모두 허용됐다. 실제 issuer가 없는 현재의 OIDC 연결 성공 테스트는 **fixture**를 사용했으며 실제 EKS 인증 성공과 구분한다.

공식 서비스 참조와 양쪽 단계의 Action·Resource·Condition 지원 범위를 대조했다. 6개 정책은 모두 6,144자 이하이고 최대 5,688자다. 용량을 나누기 위해 기존 경계 불일치 Deny를 lifecycle 정책으로 이동했으므로 기존 guard만 단독 교체하지 않고 전체 묶음으로 검토한다. 로컬 평가기는 AWS IAM 시뮬레이터가 아니며 SCP·세션·resource policy를 검사하지 않는다.

다음은 VPC·EC2·EKS 본체·데이터·스토리지·관측의 생성/갱신/삭제 권한을 작성하는 것이다. 그 후 전체 IAM 정책 연결 수와 크기, 실제 AWS 정책 검증, 비용·가동 시간, 최신 plan과 정리 경로를 확인한다. 지금 콘솔에서 새 정책 6개를 생성하거나 연결할 필요는 없다.
