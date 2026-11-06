# 4단계: Terraform 기반 정리와 AWS 생성 전 검증

기준일: 2026-11-06. 이전 BE/FE/Infra PR #1 병합 후 main에서 `codex/terraform-foundation`을 만들었다.
이번 단계는 코드를 검증하는 단계이며 **AWS 리소스 생성, 실제 AWS plan, DNS/Vercel 변경은 하지 않았다.**

## 1. 이번에 해결한 문제

기존 dev root를 실행하면 VPC/EKS뿐 아니라 RDS/Redis/MQ까지 함께 생성됐다.
EKS에는 전체 인터넷 API 접근 기본값, AL2 AMI, AWS 기본 Kubernetes 버전 의존, 외부 autoscaler를 가정한 desired_size 무시 설정이 남아 있었다.
이전 Jenkins pipeline은 EKS에 직접 배포해 새 요구사항인 Argo CD의 배포 소유권과 충돌했다.

root를 기반 세 모듈로 좁히고, 더 이상 사용하지 않는 실행 코드와 중복 계획 문서를 제거했다.
전체 앱을 새로 만들거나 재고 알고리즘/조회 성능을 바꾸는 작업은 하지 않았다.

## 2. 구성과 선택 이유

| 구성 | 현재 코드 | 이유/한계 |
|---|---|---|
| VPC | 10.20.0.0/16, 서울 2a/2c | 반복 가능한 실습 네트워크. 계정의 기존 CIDR와 충돌 여부는 실제 plan 전 확인 |
| Subnet | public 2개 + private 2개 | ALB/NAT는 public, Node/향후 데이터 서비스는 private |
| 라우팅 | public → IGW, private → zonal NAT 1개 | 사설 Node의 이미지/API egress. NAT 장애 및 교차 AZ 비용 한계 존재 |
| S3 endpoint | Gateway, public/private route table 연결 | 같은 리전의 S3 이미지 레이어 등의 NAT 통과를 줄임. IAM 권한을 대신하지 않음 |
| ECR | IMMUTABLE, push scan, 최근 30개, force_delete=false | 이미지 식별과 증거 보호. 보존 한도를 넘는 오래된 이미지는 lifecycle로 만료될 수 있음 |
| EKS | 명시적 1.35, STANDARD 지원 정책 | 현재 표준 지원 버전. AWS 기본값 변화와 연장 지원 과금 의존을 줄임 |
| API 접근 | private endpoint + 운영자 공인 IPv4 /32 | 로컬 kubectl 접근과 내부 Node 통신을 함께 지원 |
| 관리자 | API 인증, 지정 IAM Role Access Entry | 생성자의 숨은 관리자 권한 대신 코드로 운영 접근을 관리 |
| Node | AL2023 x86, m6i.large ON_DEMAND 2대 | Java 11 이미지 호환, CPU credit/Spot 중단 변수를 제외 |
| Node 디스크 | 암호화 gp3 20 GiB씩 | 기본 저장 장치 정책 명시. AMI와 bootstrap은 EKS 관리 |
| IMDS | v2 필수, hop limit 1 | 일반 Pod가 Node 자격증명에 의존하지 않게 하고 앱 권한은 후속 IRSA로 분리 |
| Add-on | vpc-cni/coredns/kube-proxy 버전 입력 필수 | 실제 호환 버전을 조회해 고정. metrics-server는 HPA 준비 단계에서 추가 |
| CloudWatch | api/audit/authenticator, 보관 3일 | control plane 운영 기록. 앱 로그/Alarm/SNS 구현 완료라는 뜻은 아님 |

단일 Managed Node Group의 두 AZ 지정은 각각 정확히 한 대씩 배치됨을 보장하지 않는다.
Node 수는 기본 min/desired/max 모두 2지만 AWS의 Node 업데이트 과정에서는 일시적인 증설과 비용이 생길 수 있다.
HPA는 Pod 수를 조절하며 Node 자동 증설과 다르다. 현재 Node desired_size를 무시하는 설정은 제거했다.

CNI 권한은 최초 기반 기동용으로 Node role에 남겼다. 앱 S3/ALB Controller 권한을 이 role에 합치지 않는다.
ALB Controller 설치 시 IRSA 및 region/vpcId 명시가 필요하다. IAM OIDC provider와 Controller는 아직 생성하지 않는다.
EKS가 기본 네트워크를 bootstrap한 다음 Node가 준비되면 버전을 고정한 관리형 add-on으로 인수한다.

## 3. 파일 역할

| 파일 | 읽을 때 볼 부분 |
|---|---|
| terraform/envs/dev/main.tf | 실제 생성 범위를 결정하는 module 호출 세 개 |
| terraform/envs/dev/variables.tf | 리전, 명시 버전, 운영자 IP/Role/add-on 입력 계약 |
| terraform/envs/dev/outputs.tf | 후속 단계에 넘길 VPC/Subnet/ECR/EKS 식별자 |
| terraform/modules/vpc/main.tf | private outbound, NAT, route table, S3 endpoint |
| terraform/modules/eks/main.tf | IAM → 로그 그룹 → Cluster → Access Entry/Node → Add-on 의존성 |
| terraform/modules/eks/variables.tf | 공개 범위/Role/add-on 검증 규칙 |
| terraform/envs/dev/tests/foundation.tftest.hcl | AWS 없는 mock plan과 잘못된 입력 거부 검증 |
| jenkins/Jenkinsfile.infra | fmt/init/validate/mock test만 수행하는 검증 초안 |

`backend.tf`의 S3는 현재 자동 생성되지 않는다. `bootstrap/remote-state`를 별도로 검토하고 만든 뒤 실제 backend 설정을 연결한다.
S3 lockfile 및 테스트 도구의 기준을 맞추어 Terraform 최소 버전을 1.11로 정리했다.
AWS provider는 기존 lock의 5.100.0을 유지했다. 새 provider major upgrade는 이번 변경에 섞지 않았다.

## 4. 기존 코드 정리 기록

| 처리 | 대상 | 이유 |
|---|---|---|
| 삭제 | k8s/benchmarks/stock-processing 전체 5개 파일 | RDB_SYNC/REDIS_ASYNC 앱 알고리즘 비교는 리셋 후 범위 밖 |
| 삭제 | jenkins/Jenkinsfile.backend | Jenkins 직접 kubectl 배포는 Argo CD 역할과 충돌 |
| 삭제 | Terraform prod/IAM, Kubernetes prod의 README-only 템플릿 3개 | 실제 구현이 없고 현재 실습 환경도 하나 |
| 삭제 | 옛 roadmap/baseline-register/comparison-scenarios/performance-report 4개 | 옛 기준 SHA·재고 비교·Jenkins CD 계획을 현행 계획과 혼동할 위험 |
| 변경 | dev main/variables/outputs/example | 현재 호출하지 않는 DB/Redis/MQ/Controller 입력과 출력 제거 |
| 변경 | EKS/VPC | AL2, 개방 기본값, 가변 Node/desired_size 무시, NAT OFF 경로 제거 |
| 변경 | Jenkins Infra | 미완성 환경에 대한 실제 plan/apply 및 plan artifact 보관 제거 |
| 유지 | 데이터 서비스/IRSA 모듈 | 합의한 후속 서비스에 필요. 현재 root 미호출, 배포 준비 완료 아님 |
| 유지 | 읽기 부하/HPA 도구, 아이콘·옛 그림 원본 | 후속 실험/그림 수정에 재사용. 현행 완료 상태로 제시하지 않음 |

삭제 파일은 13개다. 앱 BE/FE 소스, 기존 미커밋 checkout, Docker 데이터는 건드리지 않았다.
삭제 이력은 Git에 남아 있으므로 중복 보관용 복사본을 새로 만들지 않았다.

남은 데이터 모듈은 다음 연결 작업에서 MQ 지원 타입, Redis TLS/AUTH, SG 출발지, 로그 보관 기간, 삭제/스냅샷 정책을 새 요구사항으로 수정해야 한다.
기존 Kubernetes/ALB 설치 스크립트와 HPA manifest도 아직 초안이다. placeholder를 그대로 적용하면 안 되며 후속 전환 시 계속 불필요한 코드를 정리한다.

## 5. 검증 결과와 해석

- Terraform CLI 1.16.2 / AWS provider 5.100.0.
- `init -backend=false -lockfile=readonly`: 공식 서명 provider 설치. S3 연결 없음.
- `validate`: 기반 root와 S3 remote-state bootstrap 모두 통과.
- `test`: mock plan 6개 통과, 실패 0.
  - private/public subnet public IP 자동 할당 차단 및 S3 gateway 종류.
  - EKS 표준 지원/3일 로그/명시 관리자/운영자 IP/Node 2대/AL2023/암호화 디스크/IMDSv2.
  - 0.0.0.0/0 API 접근 거부.
  - root ARN과 미고정 add-on 입력 거부.
  - ECR 태그 불변성과 force delete 차단.
  - dev root의 기반 모듈 연결.
- Terraform fmt, 삭제 경로 참조, Markdown 로컬 링크 및 Git diff 검사를 통과했다.

Windows sandbox 안에서는 provider 프로세스 통신이 실패했으며, 동일 validate/mock test를 일반 로컬 권한으로 실행해 통과했다.
AWS 자격증명은 읽지 않았고 mock이 AWS provider의 API 호출을 대체했다.

테스트는 Terraform 구문과 의도한 정책의 검증이다. 계정 IAM/서비스 quota/서울 AZ 용량, 실제 add-on 호환성/Node join, 네트워크 egress, ECR pull, 클러스터 접속은 실제 AWS plan 및 가동 시 검증해야 한다.
따라서 아직 성공적인 AWS 배포, 가용성 또는 비용 절감률을 주장할 수 없다.

## 6. 앞으로의 순서

1. **관리형 데이터/권한 연결**: RDS·Redis·MQ 사양, TLS/AUTH, Node/Pod 접근 SG, OIDC/IRSA, 앱의 필요한 S3 권한을 구성하고 검증한다.
2. **배포/관측 설정 완성**: ALB/ACM, Kubernetes 최소 base, HPA 별도 비교 overlay, Jenkins CI/Argo CD, Vercel, CloudWatch/SNS, Prometheus/Grafana, 비용 관측을 준비한다.
3. **AWS 실제 plan**: 계정/운영자 Role/IP, SNS 이메일, DNS 권한, add-on 버전, 실행/종료 시간과 예산을 확정하고 생성 대상을 검토한다.
4. **집중 가동/실측/삭제**: 동일 이미지·부하 조건으로 비교 지표를 수집하고 최대 72시간 전에 리소스를 정리한다.

지금 기반 코드만 미리 적용해 EKS를 켜둘 이유는 없다. 후속 설정을 준비한 후 가동 시간을 모아 비용을 줄인다.
ECR은 force_delete=false이므로 종료 때 필요한 이미지/digest를 보존하고 실습 이미지를 명시적으로 정리해야 한다. 이미지가 남으면 ECR destroy는 실패한다.
기존 원격 state가 발견되면 이번 root에 바로 적용하지 않는다. 모듈 호출 삭제와 NAT 주소 변경 때문에 기존 데이터 서비스 삭제/리소스 교체가 계획될 수 있다.

## 7. 공식 확인 근거

- [EKS 버전 수명](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html): 1.35 표준 지원 종료 2027-03-27. 실제 적용 전 재확인.
- [AWS provider 5.100.0 EKS 설정](https://github.com/hashicorp/terraform-provider-aws/blob/v5.100.0/website/docs/r/eks_cluster.html.markdown): STANDARD는 지원 종료 시 자동 업그레이드 정책이며 영구 버전 고정이 아니다.
- [EKS AL2023](https://docs.aws.amazon.com/eks/latest/userguide/eks-optimized-ami.html).
- [S3 gateway endpoint](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html): endpoint 자체 추가 요금 없음. 다른 AWS 사용료 전체가 무료라는 뜻은 아니다.
- [Terraform mock provider](https://developer.hashicorp.com/terraform/language/tests/mocking).
