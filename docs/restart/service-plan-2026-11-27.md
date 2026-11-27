# 첫 서비스 plan: 생성 전에 무엇을 확인했나

2026-11-27 KST. Infra #20을 병합한 뒤 **실제 AWS 인증과 S3 backend를 사용하는 서비스 plan**을 만들었다. 결과는 **생성 74, 수정 0, 삭제 0, 교체 0**이다. 74개는 서버 수가 아니라 보안 그룹, IAM 정책 연결, 로그 그룹 등을 포함한 Terraform 관리 자원 수다. 적용 시점에 조회하는 data source 3개는 별도다.

**서비스 apply는 하지 않았다. 이 plan은 배포 승인이 아니라 검토 자료다.** 아래 내용은 plan 작성 시점 기록이다. 후속으로 [EKS 운영 Role 생성과 STS 인증](eks-operator-role.md)을 완료했으며, 비용·실행 권한 검토는 남아 있다. 지정한 EKS 운영 Role의 실제 생성, 실행 권한 설계, 최신 비용 및 가동 시간 검토가 남아 있다. 실제 AWS에 적용된 것은 앞 단계의 state용 S3뿐이다.

## 이번에 입력한 값과 선택 이유

사용자는 SNS 수신 이메일을 지정하고 EKS 운영 Role을 Terraform 실행 Role과 분리하기로 했다. 기존 구성의 Jenkins EC2와 CloudWatch/SNS를 실제 변수에서 켜서 전체 실습 구성을 검토했다. 저장소의 기본값이나 애플리케이션 코드는 바꾸지 않았다.

| 입력 | 검토용 설정 | 확인 범위 |
|---|---|---|
| AWS 인증 | `orderpage-deploy` | STS에서 예상 계정과 `orderpage-terraform-deploy` 일치 |
| EKS 운영 주체 | `orderpage-eks-operator` Role | ARN 입력만 완료. Role 생성·STS 검증 전 |
| API 접속 허용 | 현재 PC의 공인 IPv4 `/32` 하나 | AWS checkip 조회값. VPN/회선 변경 시 재확인 |
| EKS | 1.35, STANDARD 지원 | 서울 API에서 표준 지원 확인 |
| VPC CNI / CoreDNS / kube-proxy | `v1.22.4-eksbuild.14` / `v1.13.2-eksbuild.75` / `v1.35.3-eksbuild.69` | 1.35·EC2·amd64 기본 호환 후보. 취약점 부재 보장은 아님 |
| RDS | MariaDB 10.11.19, db.t4g.micro, gp3 20GiB | available·주문 가능·암호화 지원 확인 |
| Redis / MQ | Redis 7.1 / RabbitMQ 4.2, mq.m7g.medium 단일 | 지원 메타데이터 확인. 실제 배치·재고 확인 아님 |
| Jenkins AMI | AL2023 2023.12.20261120.0, kernel 6.1, x86_64 | Amazon 소유 이미지 조회. 부팅·bootstrap 실행 전 |
| 알림 | CloudWatch/SNS 활성, 이메일 로컬 입력 | 실제 메일 발송·구독 승인 전 |
| Budget | 금액 미확정으로 비활성 | 기존 Cost Anomaly 비활성도 유지 |

배포 Role로 13개 조회 묶음을 실행했다. 첫 병렬 조회에서 3개가 실패했지만 개별 재조회는 성공했다. 최초 실패 원인을 특정하지 못했으며 이를 서비스 미지원으로 해석하지 않았다.

실제 계정, IP, 이메일은 `terraform/envs/dev/terraform.tfvars.json`에만 있다. 세 서비스 암호는 서로 다른 24바이트 암호학적 난수를 48자리 hex로 생성해 `.local/service-secrets.dpapi`에 Windows CurrentUser DPAPI로 암호화했다. plan 실행 프로세스에만 `TF_VAR_*`로 복호화해 전달하고 종료 시 환경 변수를 제거했다. 다른 PC/Windows 사용자에서 자동 복구되는 백업은 아니다.

**저장 plan은 암호를 평문으로 포함할 수 있다.** DPAPI로 입력을 보관해도 plan 자체가 암호화되는 것은 아니다. `service-review.tfplan`, tfvars, `.terraform`, 로그, `.local`은 모두 Git 제외 대상이며 원문을 PR이나 채팅에 붙이지 않는다.

## plan이 보여 준 구성

| 구성 | 이번 plan |
|---|---|
| 네트워크 | VPC 1, 서브넷 4, NAT 1, EIP 1, S3 gateway endpoint 1 |
| EKS | 클러스터 1, node group 1(노드 2대 고정), add-on 3 |
| 데이터 | RDS 1, Redis replication group 1(노드 1), MQ broker 1 |
| CI | private Jenkins EC2 1, SSM instance profile |
| 관측 | 로그 그룹 5, CloudWatch 경보 7, dashboard 1, SNS topic/subscription |
| 앱 기반 | ECR, ACM, 이미지용 S3, OIDC/IRSA |

ALB는 나중에 Controller가 Ingress를 보고 만든다. 이 plan에는 ALB, 앱 Pod, Argo CD, Prometheus/Grafana, Vercel 배포가 들어 있지 않다. ALB 관련 경보도 ALB/TG 식별자를 확보한 뒤 연결한다. 따라서 **이 plan만으로 전체 서비스나 전체 비용을 계산했다고 볼 수 없다.**

검토한 22개 조건에는 EKS STANDARD 지원, API `/32`, creator admin 비활성화, 운영 Role 분리, 고정 worker 2대, NAT 1개, private RDS/MQ/Jenkins, RDS·Redis 암호화, Redis TLS, Jenkins IMDSv2, SNS 수신 주소 일치가 포함된다. 생성 전 ARN 하나는 미확정이므로 알려진 IAM attachment에 AdministratorAccess가 없다는 검사와 구분했다. [값을 제외한 검토 근거](security-evidence/service-plan-2026-11-27.json)에 결과를 남겼다.

`plan -detailed-exitcode`의 종료 코드 2는 변경 목록이 있다는 정상 결과였다. 잠금 옵션을 끄지 않았으며, 종료 후 지정 state prefix를 조회했을 때 state 객체와 현재 잠금 객체 모두 없었다. 이는 잠금 충돌·과거 버전 삭제·복구 시험을 했다는 뜻이 아니다. bootstrap state는 이전 위치에 유지한다.

## 비용 검토에서 남은 일

이번 plan은 EKS worker용 m6i.large 2대, Jenkins용 m6i.large 1대, NAT 1개, RDS·Redis·MQ 단일 구성을 유지한다. HPA 실험의 고정 노드 조건과 managed MQ 선택을 변경하지 않았다. 작은 사양으로 바꾼 뒤 실행되지 않는 위험과 비용을 함께 검토해야 한다.

기존 [비용 계산](pricing-evidence/estimate.mjs)은 과거 단가에 기반한다. 최신 가격으로 확정하지 않았으므로 이 문서에서는 예상 총액을 재확정하지 않는다. apply 전에 ALB/IPv4, EBS·MQ 저장소, NAT 데이터 처리, 로그·경보, 전송 비용과 잔존 리소스를 포함해 12/24/72시간 시나리오를 다시 계산해야 한다. 사용자의 최소 비용·최대 3일 원칙은 유지하지만 금액 한도와 실제 시작·종료 시각은 미확정이다.

## 다음 작업 순서

1. [EKS 운영 Role 안내](eks-operator-role.md)대로 관리자 콘솔에서 Role과 전환 정책을 연결한다. 계정이 채워진 `.local/iam-eks-operator` 파일을 사용한다.
2. 별도 `orderpage-eks` 프로필로 STS를 확인한다. 클러스터가 없으므로 이 단계에서 kubectl 성공을 기대하지 않는다.
3. plan의 74개 자원에 필요한 생성·변경·삭제·PassRole 권한과 IAM 위임 범위를 설계한다. 현재 조회 정책은 apply용이 아니다.
4. 최신 비용, 실제 운영 시간, Budget 금액, 자원 종료 절차를 확정한다.
5. Role/권한/변수에 변경이 생기면 새 plan을 만들고 검토한 후 apply를 결정한다. 보관한 검토용 plan을 무조건 재사용하지 않는다.

로컬 재실행은 `AWS_PROFILE=orderpage-deploy`, 실제 tfvars, 복호화된 세 `TF_VAR_*`가 필요하다. 이번 Windows 실행 보조 파일은 작업공간의 `outputs/run-service-review-plan.ps1`에 있으며 기존 plan을 덮어쓰지 않도록 중단한다. 자격증명이나 plan을 다른 PC로 복사해 재실행하지 않는다.

## 로컬 검사

IAM 검사 18개를 기본 npm test 명령에 포함했다. 전체 69개 검사가 통과했고 문서 링크도 확인했다. 첫 전체 검사에서 고정 chart 환경 변수 누락과 샌드박스 symlink 권한으로 5개가 실패했으며, 기존 chart 경로와 일반 실행 환경을 사용해 재검증했다. 테스트를 건너뛰거나 기대값을 완화하지 않았다.
