# 배포 준비 재개 지점

기준일: 2026-11-27 KST. 주간 한도나 세션 중단 후 같은 작업을 이어가기 위한 기록이다. 재개할 때는 GitHub 상태와 로컬 변경을 먼저 확인한다.

| 항목 | 현재 확인된 상태 |
|---|---|
| 병합 완료 | PR #23, merge `7cfffc332f9fb7165052f52e4feb7e07d5566159` |
| 후속 브랜치 | `codex/deploy-iam-delegation` — IAM 위임·EKS 접근 검토 정책 |
| AWS에 만들어진 기반 | 기존 S3 state bootstrap. 서비스 VPC/EKS/RDS 등은 apply하지 않음 |
| 상한 정책 | 5개 생성, 기본 버전 v1, 준비한 본문과 일치, 연결/사용 수 0 |
| 실제 권한 | 기존 배포 Role은 state/조회 단계. 이번 쓰기 정책은 미생성·미연결 |
| 최신 실제 plan | 생성 74, 수정/삭제 0, Role 상한 연결 5개. 과거 검토본이며 실행 승인본이 아님 |
| 이번 검증 | Node 90개 통과. 기존 plan의 17개 자원·44개 요청 조건 로컬 대조 통과. OIDC 1개 미검토 |
| 가동 시간·예산 | 최대 3일 이내라는 제한만 확정. 구체적인 가동 목표와 월 Budget 금액은 미확정 |

## 다음 순서

1. 이 브랜치의 PR 상태·변경·검사를 확인한다. 새 작업을 기존 미완성 변경 위에 무조건 덮어쓰지 않는다.
2. OIDC 공급자 관리 범위와 서비스 연결 Role 생성 의존 권한을 확정한다. IAM guard와의 충돌 및 다른 클러스터/공유 Role 영향까지 검토한다.
3. VPC·EC2·EKS 본체·데이터·저장소·관측의 생성/갱신/정리 정책을 완성한다. IAM 정책 크기와 Role의 정책 연결 수를 함께 확인한다.
4. 전체 정책의 Allow/Deny 조합, 실제 AWS 정책 검증, Role trust·inline 본문과 provider 삭제 경로를 다시 확인한다. 로컬 검사 결과를 실제 IAM 승인 결과로 취급하지 않는다.
5. 가동 시간·Budget·현재 비용을 확인하고 필요한 최종 정책만 관리자 경로로 연결한다. 새 plan을 생성해 검토한 후 서비스 apply를 진행한다.

## 비공개 파일 위치

아래는 저장소 기준 상대 경로다. 모두 Git 제외 대상이며 **파일 내용이나 계정·키·암호를 공개하지 않는다.**

| 위치 | 용도 |
|---|---|
| `.local/iam-workload-boundaries/` | 이미 원격 확인한 상한 정책 5개와 조회 정책 |
| `.local/iam-deploy-delegation-review/` | 이번 검토용 쓰기 정책 5개와 manifest. 아직 연결 금지 |
| `.local/remote-boundary-verification.json` | 원격 정책 조회 결과 |
| `.local/delegation-plan-contract-review.json` | 로컬 요청 대조 상세 결과 |
| `.local/service-secrets.dpapi` | 현재 Windows 사용자로 암호화한 서비스 비밀값 |
| `terraform/envs/dev/terraform.tfvars.json` | 실제 배포 입력. 이메일·운영 IP 등 포함 |
| `terraform/envs/dev/backend.hcl` | 기존 state backend 설정 |
| `terraform/envs/dev/service-boundaries-review.tfplan` | 암호를 포함할 수 있는 과거 검토 plan |

AWS CLI는 `orderpage-deploy`를 명시한다. `default`에는 과거 무효 자격증명이 남아 있어 자동 선택하지 않는다. 로그인이 만료되면 기존 임시 로그인 경로를 갱신하고 STS 계정·역할을 다시 확인한다. 새 장기 Access Key를 발급하거나 환경변수에 키를 복사하는 방식으로 우회하지 않는다.

실행/검증 근거는 [IAM 위임 설명](deploy-iam-delegation.md), [전체 진행서](project-process.md), [최신 비용 검토](cost-review-2026-11-27.md)에서 이어서 읽는다.
