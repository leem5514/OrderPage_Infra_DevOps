# 서비스 생성 권한: 지금 무엇을 더 검토해야 하나

2026-11-27 KST. 운영 Role 인증 기록인 Infra #22를 병합했다. 배포 Role의 실제 plan과 EKS 운영 Role 인증은 성공했지만, **서비스 apply 권한은 아직 부여하지 않았다.** 이 문서는 실제 plan의 74개 자원을 대상으로 한 권한 설계이며 콘솔에 붙여 넣는 정책 JSON이 아니다.

> 후속 구현: [권한 상한 파일·Terraform 연결·콘솔 순서](workload-boundaries.md)를 준비했다. 아래 boundary 미설정 5개는 최초 plan 시점의 기록이며, 새 plan은 상한 누락 0개다. 상한 정책은 AWS 생성과 원격 본문 확인까지 완료했다. 서비스 쓰기 권한은 아직 부여하지 않았다.

## 조회 권한을 곧바로 생성 권한으로 넓히지 않는 이유

현재 Terraform은 애플리케이션용 IAM Role 5개를 만들고 정책을 연결한다. 저장 plan에서 다섯 Role 모두 `permissions_boundary`가 비어 있었다. 현재 배포 Role은 조회 단계이므로 이것이 이미 관리자 권한을 획득했다는 뜻은 아니다. 하지만 여기에 `iam:CreateRole`, `iam:PutRolePolicy`, `iam:AttachRolePolicy`를 넓게 추가하면 Role 이름을 제한하더라도 높은 권한을 가진 새 Role을 만들 여지가 생긴다.

이번 설계는 **서비스별 생성 권한과 IAM 위임 권한을 따로 검토하고, workload Role마다 권한 상한을 먼저 설정**하는 방식이다. AWS가 모든 Role에 boundary를 의무화하는 것은 아니다. 이번 프로젝트에서 안전하게 IAM 생성을 위임하기 위한 선택이다. boundary는 권한을 부여하는 정책이 아니며, resource policy·trust policy까지 모든 위험을 자동으로 막아 주지는 않는다. [AWS 권한 경계 설명](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html).

## plan의 74개 자원을 나눈 결과

| 설계 단위 | 자원 수 | 허용 범위와 연결 시 검증할 점 |
|---|---:|---|
| 네트워크 | 19 | 서울 VPC·서브넷·라우팅·SG·NAT·EIP·S3 endpoint. 생성 시 요청 태그, 기존 자원 변경/삭제 시 자원 태그 또는 확정 ID를 사용한다. API마다 지원 조건이 달라 같은 태그 조건을 일괄 복사하지 않는다. |
| EKS 본체 | 5 | `orderpage-dev` 클러스터, 고정 node group, add-on 3개. Auto Mode/Fargate/추가 클러스터 생성은 포함하지 않는다. |
| EKS 접근 권한 | 2 | 운영 Role 한 개의 Access Entry와 cluster-admin 연결. 임의 주체나 별도 클러스터의 관리자 연결은 금지한다. |
| EC2 | 2 | EKS launch template와 Jenkins 인스턴스. 현재 인스턴스 타입·AMI/서브넷·암호화·IMDSv2 조건과 생성 시 참조되는 리소스의 권한도 확인한다. |
| 데이터 서비스 | 6 | 프로젝트 RDS/Redis/MQ와 subnet/parameter group. 생성뿐 아니라 실습 종료에 필요한 삭제 권한도 포함한다. |
| ECR | 2 | `orderpage-backend` repository와 lifecycle. 비어 있지 않은 repository는 현재 force_delete=false로 보호된다. |
| 상품 이미지 S3 | 5 | 지정된 이미지 버킷 설정만. 계정 전체 Public Access Block 변경이나 state 버킷 보호 설정 변경은 허용하지 않는다. |
| ACM | 1 | 서울 인증서. ARN이 생기기 전 요청 단계와 이후 조회·태그·삭제 단계를 나누며 DNS zone 변경은 포함하지 않는다. |
| 관측 | 16 | 로그 그룹 5, 경보 7, dashboard 1, SNS 관련 3. Budget 활성화 시 자원이 추가되므로 다시 분류한다. |
| IAM | 16 | Role 5, inline policy 2, attachment 6, instance profile 1, OIDC 1, controller policy 1. 아래 위임 제한을 적용한다. |

[분류기](../../scripts/review-apply-scope.mjs)는 **분류 74, 미분류 0, 삭제/교체 0, boundary 미설정 Role 5**를 반환했다. 새 자원 유형을 발견하면 미분류로 표시하고 자동으로 허용하지 않는다. 정책 본문, ARN 원문, 사용자 데이터, 암호는 요약하지 않는다. 이 도구는 권한 시뮬레이터나 실제 apply 실행 차단 장치가 아니다. `readyForApply=false`는 아직 연결할 최종 권한 정책이 없음을 명시한다.

## 다섯 Role의 권한 상한 설계

| Role 이름 | 경계에 포함할 기능 | 포함하지 않을 기능 |
|---|---|---|
| `orderpage-dev-cluster-role` | EKS control plane에 필요한 AWS 관리형 정책 범위 검토 | 임의 IAM 정책 수정·서비스 추가 |
| `orderpage-dev-node-role` | worker 조회, ECR pull, 현재 CNI의 ENI/IP 관리 | ECR push, 상품 이미지 업로드, Terraform state |
| `orderpage-dev-jenkins` | SSM agent 통신과 지정 ECR 이미지 push | IAM 변경, EKS 관리자, state 읽기 |
| `orderpage-dev-backend-upload` | 지정 상품 이미지 버킷의 PutObject | bucket 정책 변경, state, 다른 버킷 |
| `orderpage-dev-alb-controller` | 고정한 공식 controller 정책을 검토한 ALB/TG/SG/태그 작업 | 프로젝트 운영자·배포 Role 변경, state 접근 |

AWS 관리형 정책을 권한 상한에 사용할 때는 필요한 여러 정책의 합집합과 버전 변경 영향을 검토한다. 단순히 `Action=*`를 boundary로 지정하면 이 표의 서비스 분리가 성립하지 않는다. 특히 controller 정책에는 일부 `Resource=*`와 ELB 서비스 연결 Role 생성이 들어 있으므로 무조건 최소 권한이라고 부르지 않는다.

경계 정책은 관리자 경로에서 먼저 만들고 배포 Role이 편집·삭제할 수 없도록 분리한다. 이후 Terraform Role 생성에 해당 경계 ARN을 연결하고, 배포 Role의 `CreateRole`/boundary 설정에는 `iam:PermissionsBoundary` 조건을 적용한다. 경계를 제거하는 `DeleteRolePermissionsBoundary`, 보호된 경계의 새 버전 생성, Terraform 실행 Role 자신·bootstrap Role·운영 Role·사용자 그룹의 권한 변경은 허용 대상에서 제외한다. Role을 삭제할 때도 경계를 먼저 떼는 방식이 필요하지 않은지 provider 실제 흐름을 확인한다.

OIDC 신뢰는 해당 클러스터 issuer와 `aud=sts.amazonaws.com`, 정확한 ServiceAccount의 `sub`로 한정한다. boundary는 외부 principal을 신뢰하게 만드는 trust 변경을 대신 통제하지 않으므로 생성·변경 경로를 따로 검토한다.

## PassRole과 클러스터 관리자 연결

`PassRole`은 Role 이름 태그로 제어하지 않고 **정확한 Role ARN과 전달 대상 서비스**를 묶는다. [AWS PassRole 주의사항](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html).

| 호출 경로 | 전달할 Role | 전달 대상 서비스 조건 |
|---|---|---|
| EKS CreateCluster | cluster-role | `eks.amazonaws.com` |
| EKS CreateNodegroup | node-role | `eks.amazonaws.com` |
| Jenkins EC2 실행 | jenkins | `ec2.amazonaws.com` |

Node Role의 trust는 EC2지만 **EKS CreateNodegroup API의 PassRole 의존 조건은 EKS**라는 점을 구분한다. [EKS API 권한 의존 조건](https://docs.aws.amazon.com/service-authorization/latest/reference/list_eks.html)을 기준으로 구현 후 실제 검증한다. IRSA의 두 Role이나 사람이 전환하는 운영 Role은 이 PassRole 목록에 자동 추가하지 않는다.

Access Entry 생성은 대상 cluster와 `eks:principalArn=운영 Role`, `eks:accessEntryType=STANDARD`로 제한한다. Access Policy 연결은 해당 access-entry ARN과 `eks:policyArn=AmazonEKSClusterAdminPolicy`, `eks:accessScope=cluster`를 조합한다. 이 API들은 이름에 IAM이 없어도 Kubernetes 권한 상승 경로가 되므로 일반 EKS 수정 권한과 따로 검토한다.

서비스 연결 Role은 계정에서 최초 사용 시 자동 생성이 필요할 수 있다. EKS/node group, Auto Scaling, RDS, Redis, MQ, ELB 각각의 기존 여부와 공식 서비스 이름을 확인한 뒤 필요한 `iam:CreateServiceLinkedRole`만 `iam:AWSServiceName`으로 제한한다. 계정 공유 서비스 연결 Role을 실습 종료 때 무조건 삭제하지 않는다.

## 구현과 적용 순서

1. 다섯 workload Role의 경계 정책을 구체화하고 관리자가 관리하는 별도 생성 경로를 준비한다.
2. Terraform의 다섯 Role에 경계를 연결하고 회귀 검사 및 새 plan에서 빠진 Role이 없는지 확인한다.
3. 위 10개 설계 단위를 실제 provider의 생성·갱신·삭제 API에 대응시킨다. 공식 서비스 참조로 Action·Resource·Condition을 검증하고 IAM 정책 크기 한도 안에서 나눈다.
4. 보호된 역할·경계 자체 변경 금지, 정확한 PassRole, EKS 관리자 등록 제한을 확인한 최종 정책만 배포 Role에 연결한다.
5. [현재 가격 검토](cost-review-2026-11-27.md)와 가동 목표·Budget을 확정하고 최신 plan을 다시 검토한다.

이 설계의 최초 기록은 1단계까지였다. 후속 작업에서 경계 파일과 Terraform 연결을 구현하고 새 plan까지 검증했다. 후속 작업에서 AWS 상한 정책 생성·본문 확인도 완료했다. [IAM 위임 검토본](deploy-iam-delegation.md)을 작성했으며 **서비스 쓰기 정책의 AWS 생성·부여는 아직 하지 않았다.** 분석 결과를 실제 권한 구현 완료로 표현하지 않는다. 74개 plan 성공 역시 앞으로의 생성 권한, 재고, 서비스 부팅 성공을 보장하지 않는다.

## 검증

새 비용 검사 4개와 권한 분류 검사 3개를 포함해 전체 npm test 76개가 통과했다. 실제 74개 유형 누락, 새 유형·삭제·boundary 누락 및 민감한 plan 값의 요약 유입을 검사했다. [분류 근거](security-evidence/apply-scope-2026-11-27.json)는 최초 plan 시점의 결과이며 IAM 정책 시뮬레이션 결과가 아니다. 최초 설계 단계에서는 Terraform HCL과 앱 코드를 바꾸지 않았다. 후속 상한 연결의 검증 결과는 위 구현 문서에 기록한다.
