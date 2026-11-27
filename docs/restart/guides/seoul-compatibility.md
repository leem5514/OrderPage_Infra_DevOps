# 서울 리전 사전 조회 결과

> **문서 용도:** 서울 리전에서 조회한 서비스 버전·인스턴스 호환성.
> **읽는 기준:** 구현 이유와 당시 검증·설정 순서를 보존한 문서입니다. 본문의 날짜·완료/미완료는 작성 당시 기준이며, 현재 상태는 [통합 점검표](../checks.md), 비용은 [비용·운영 계획](../costs.md)을 우선합니다. [문서 지도](../README.md)

2026-11-27 KST. 사용자가 조회 정책을 그룹에 연결한 뒤 IAM 사용자 CLI로 **11개 Describe API, 13개 조회 묶음**이 성공했다. 루트 인증은 사용하지 않았다. [계정 식별자를 제외한 조회 근거](../security-evidence/seoul-compatibility-2026-11-27.json)를 보관한다.

## 현재 코드와 맞춰 본 결과

| 대상 | 확인 결과 | 해석 |
|---|---|---|
| EKS 1.35 | STANDARD_SUPPORT, 표준 지원 종료 2027-03-27 | 현재 기본 버전을 지원 목록에서 확인 |
| VPC CNI | `v1.22.4-eksbuild.14` | 1.35에 대해 AWS가 기본으로 반환한 호환 후보 |
| CoreDNS | `v1.13.2-eksbuild.75` | 1.35/EC2/amd64 호환 후보 |
| kube-proxy | `v1.35.3-eksbuild.69` | 1.35/EC2/amd64 호환 후보 |
| RDS MariaDB | 10.11.13/14/15/16/18/19 available | 확인된 가장 높은 10.11 patch 후보는 10.11.19 |
| RDS 사양 | db.t4g.micro + gp3, 최소 20GiB, 암호화 지원 | 위 10.11 버전에서 주문 가능한 조합으로 조회됨 |
| Redis | 7.1, 파라미터 그룹 redis7 | 엔진 지원 확인; cache.t4g.micro의 실제 배치는 미검증 |
| RabbitMQ | 4.2 + mq.m7g.medium + SINGLE_INSTANCE | 현재 코드 조합이 지원 목록에 포함 |
| EKS/Jenkins EC2 | m6i.large, x86_64, 2vCPU/8GiB | 현재 코드 사양이며 성능 최적화로 변경하지 않음 |
| AZ | ap-northeast-2a/2c available, 두 AZ에 m6i.large 제공 | 재고나 실제 시작 성공을 보장하지 않음 |
| Jenkins AMI | Amazon 소유 AL2023 x86_64 이미지 후보 3개 | 공개 이미지 ID/이름을 근거 JSON에 기록, 최종 이미지 미선택 |

AWS 기본 add-on 버전은 호환 후보일 뿐 최신 버전이나 취약점 부재를 뜻하지 않는다. AMI 역시 목록 조회만 했으며 SSH/SSM·Jenkins·Docker 기동은 하지 않았다. RabbitMQ 4.3도 목록에 있지만 현재 4.2 코드를 불필요하게 올리지 않았다.

읽기 정책의 허용 동작을 확인했다. 다른 리전이나 쓰기 동작을 실제 호출해 거부를 시험한 것은 아니다. 전체 IAM 권한 감사나 정책 시뮬레이터 결과로 해석하지 않는다.

## 실제 변수에 넣을 수 있는 후보

다음 값은 조회 시점 후보이며 이번 작업에서 `terraform.tfvars.example`이나 실제 tfvars를 덮어쓰지 않았다. 배포 시작 전 같은 계정·리전에서 다시 확인하고 입력한다.

```hcl
kubernetes_version = "1.35"
eks_addon_versions = {
  vpc-cni    = "v1.22.4-eksbuild.14"
  coredns    = "v1.13.2-eksbuild.75"
  kube-proxy = "v1.35.3-eksbuild.69"
}
rds_engine_version = "10.11.19"
```

전체 응답은 Git 제외된 `.local/seoul-preflight-2026-11-27.json`에 보관하고, 공개 문서에는 필요한 서비스 메타데이터만 추렸다. 사용자 계정 ID·IAM ARN·토큰·개인 IP·이메일은 넣지 않았다.

## 이제 필요한 준비

1. **배포용 IAM Role과 정책**: 현재 권한은 조회용이다. S3 state 및 실제 생성·조회·종료에 필요한 권한을 Terraform 리소스 목록에서 정리해야 한다. 현재 IAM 사용자 ARN을 Role 전용 변수에 그대로 넣지 않는다.
2. **예산과 가동 시간**: 최대 72시간 원칙 안에서 실제 시작·종료 시각과 금액 한도를 확정하고 최신 단가를 다시 확인한다. 이번 조회는 비용 계산이 아니다.
3. **보호된 입력**: 운영자 /32 IP, SNS 이메일, DB/Redis/MQ 각각 다른 비밀값, Jenkins AMI를 준비한다.
4. **원격 state bootstrap 계획**: 버킷 정책·저장 위치·비용을 검토한 뒤 별도 생성한다.
5. **실제 환경 plan**: 생성·삭제·교체 목록과 총비용을 검토한 후 apply 여부를 결정한다.

현재 단계까지 유료 자원 생성, 서비스 기동, 실제 환경 plan/apply, Vercel 배포는 하지 않았다. [사전 점검 절차](aws-plan-preflight.md)와 [로그인·정책 연결 기록](aws-login-readiness.md)을 함께 따른다.
