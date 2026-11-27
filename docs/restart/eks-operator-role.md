# EKS 운영 Role 연결

Terraform 실행과 kubectl/Helm 운영을 다른 Role로 구분한다. 사용자가 2026-11-27에 선택한 방식이다. 생성 파일은 준비했으나 **아직 AWS Role 생성과 프로필 인증은 하지 않았다.**

| 주체 | 맡는 작업 |
|---|---|
| `orderpage-terraform-deploy` | Terraform plan. 실제 apply 정책은 후속 설계 |
| `orderpage-eks-operator` | 클러스터 접속 정보 조회와, 추후 Access Entry를 통한 kubectl/Helm 운영 |

IAM 정책 `OrderPageEksClusterRead`에는 서울 `orderpage-dev` 한 클러스터의 `eks:DescribeCluster`만 넣는다. 이 권한만으로 Pod 배포나 Secret 조회가 허용되지는 않는다. Kubernetes 권한은 기존 Terraform의 Access Entry와 `AmazonEKSClusterAdminPolicy` 연결이 **실제로 적용된 뒤** 생긴다.

클러스터 관리자 권한은 Controller/CRD, Argo CD, 모니터링 설치를 위한 실습용 운영 권한이다. 클러스터 내 Secret 조회와 권한 변경도 가능하므로 읽기 전용 Role이 아니다. AWS 인프라 생성 권한과 분리했다고 전체 권한이 작은 것은 아니다. 장기 운영에서는 설치용 관리자와 namespace별 일상 운영 권한을 추가로 분리한다.

## 관리자 콘솔에서 할 일

**`.template.json`이나 GitHub의 예시를 붙여 넣지 않는다.** 이번 파일은 [생성기](../../scripts/prepare-eks-operator-iam.mjs)가 실제 계정으로 만든 `.local/iam-eks-operator` 폴더에 있다. `{{ACCOUNT_ID}}`가 보이면 잘못된 파일이다.

1. **IAM → 정책 → 정책 생성 → JSON**에서 `cluster-read.json` 전체를 붙여 넣고 정책 이름을 **`OrderPageEksClusterRead`**로 생성한다.
2. **IAM → 역할 → 역할 생성 → 사용자 지정 신뢰 정책**에서 `trust.json` 전체를 붙여 넣는다. 신뢰 대상은 같은 계정의 `orderpage-operator` 사용자 한 명이다.
3. 다음 권한 정책 화면에서 **`OrderPageEksClusterRead`**만 체크한다. 역할 이름 **`orderpage-eks-operator`**로 생성하고 최대 세션 시간은 기본 1시간을 유지한다.
4. **IAM → 정책 → 정책 생성 → JSON**에서 `operator-assume.json`을 붙여 넣고 **`OrderPageAssumeEksOperator`**로 생성한다.
5. **IAM → 사용자 그룹 → `SignInLocalDevelopmentAccess` → 권한 → 권한 추가 → 정책 연결**에서 **`OrderPageAssumeEksOperator`**를 연결한다. 기존 네 정책은 유지한다.

정책·역할 생성 권한이 없는 실습용 사용자에게 AdministratorAccess를 붙이는 절차가 아니다. IAM 관리 권한이 있는 콘솔 세션에서 위 대상을 생성한다. `AmazonEKSClusterAdminPolicy`는 IAM 관리형 정책 검색창에서 연결하는 정책이 아니므로 이 단계에서 찾지 않는다.

## 연결 이후

`profile.example.ini`를 검토하고 기존 프로필을 유지하면서 `orderpage-eks`를 추가한다. STS로 계정과 Role을 확인한 후에만 운영 도구에서 사용한다. Terraform에는 계속 `orderpage-deploy`를 사용한다.

클러스터가 생성되고 Access Entry가 적용되면 다음 형태로 **별도 kubeconfig**를 만든다. IAM Role이 존재한다는 사실만으로 클러스터 접근 권한이 생기지는 않는다.

```powershell
aws eks update-kubeconfig --name orderpage-dev --region ap-northeast-2 --profile orderpage-eks --kubeconfig .local/deploy/dev/kubeconfig
kubectl --kubeconfig .local/deploy/dev/kubeconfig get nodes
```

기존 `install-aws-load-balancer-controller.ps1`의 `-Profile`에도 `orderpage-eks`를 전달한다. AWS 자격증명 환경 변수가 프로필을 덮어쓰지 않는지 확인하고, 루트 자격증명이나 로컬 로그인 토큰을 Jenkins/Pod에 복사하지 않는다.

MFA 장치 등록과 신뢰 정책의 MFA 조건 강제는 별개다. 현재 임시 로그인 경로의 MFA 조건 전달을 검증하지 않았으므로 검증되지 않은 MFA 강제 조건은 추가하지 않았다.

공식 근거: [kubeconfig에 필요한 DescribeCluster와 프로필 인증](https://docs.aws.amazon.com/eks/latest/userguide/create-kubeconfig.html), [IAM 권한과 별개인 EKS access policy](https://docs.aws.amazon.com/eks/latest/userguide/access-policies.html).
