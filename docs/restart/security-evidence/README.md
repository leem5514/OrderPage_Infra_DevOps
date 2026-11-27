# 검증 근거 JSON — 무엇을 확인했는지 남긴 기록

**이 폴더는 보안 설정을 적용하는 폴더가 아닙니다.** 코드·IAM·인증·Terraform plan을 검사하고 공개 가능한 결과만 저장한 자료입니다. 이름은 security-evidence지만 plan·운영 준비 근거도 포함합니다. 처음에는 [통합 점검표](../checks.md)를 읽고, 숫자나 검사 항목을 확인할 때 해당 JSON을 여세요. [문서 지도](../README.md)

## 먼저 볼 세 파일

- **전체 구성:** [budget48-plan](budget48-plan-2026-11-27.json) — Budget 포함 75개 계획. 실제 적용 전입니다.
- **권한 연결:** [deploy-policy-connection](deploy-policy-connection-2026-11-27.json) — 13개 정책 원격 대조와 임시 권한 해제.
- **다음 적용 범위:** [preapply-eks-plan](preapply-eks-plan-2026-11-27.json) — 최초 EKS 단계 19개 계획. apply 미실행입니다.

## 전체 파일 설명

| 파일 | 종류 | 담고 있는 내용 | 읽을 때 주의 |
|---|---|---|---|
| [apply-scope-2026-11-27.json](apply-scope-2026-11-27.json) | 권한 설계 입력 | plan 자원을 권한 설계 단위로 분류 | AWS에 연결할 정책 JSON 아님 |
| [assessment-2026-11-16.json](assessment-2026-11-16.json) | 과거 조사 | 수정 전 BE 의존성·FE/Infra npm 권고와 재현 결과 | 현재 잔여 취약점 수나 실제 공격 성공 수가 아님 |
| [backend-runtime-2026-11-17.json](backend-runtime-2026-11-17.json) | 앱 검증 | 보안 기반 갱신 후 의존성 조회·로컬 실행 검사 | AWS/EKS·컨테이너 OS 점검을 대신하지 않음 |
| [bootstrap-apply-2026-11-27.json](bootstrap-apply-2026-11-27.json) | 실제 적용 | state S3 적용 후 조회 및 변경 없음 확인 | 서비스 배포 완료 아님 |
| [bootstrap-plan-2026-11-27.json](bootstrap-plan-2026-11-27.json) | 적용 전 기록 | state S3 생성 전 7개 관리 자원 계획 | 서비스 VPC/EKS 계획 아님 |
| [budget48-plan-2026-11-27.json](budget48-plan-2026-11-27.json) | 최근 전체 plan | Budget 포함 75개 계획과 AWS 정책 검사 | 미확정 목적지/정책 26개; Budget 생성·수신 아님 |
| [data-service-permissions-2026-11-27.json](data-service-permissions-2026-11-27.json) | 서비스 권한 검사 | RDS·Redis·MQ 요청 조건과 plan 설정 검사 | 실제 DB/MQ TLS 연결 아님 |
| [deploy-delegation-2026-11-27.json](deploy-delegation-2026-11-27.json) | 로컬 IAM 검사 | Role 생성·PassRole·EKS 운영자 등록의 요청 조건 | AWS 실효 권한·SCP 검사 아님 |
| [deploy-policy-connection-2026-11-27.json](deploy-policy-connection-2026-11-27.json) | 실제 IAM 연결 | 13개 원격 본문 일치·state 읽기·거부 검사·installer 해제 | 모든 생성 API의 실효 권한 증명 아님 |
| [eks-operator-auth-2026-11-27.json](eks-operator-auth-2026-11-27.json) | AWS 인증 | 분리한 EKS 운영 Role의 STS 인증 | 클러스터 생성·kubectl 권한 동작 아님 |
| [eks-service-permissions-2026-11-27.json](eks-service-permissions-2026-11-27.json) | 서비스 권한 검사 | EKS 생성/변경/삭제 조건과 설정 검사 | 실제 EKS 생성 호출 아님 |
| [integrated-iam-2026-11-27.json](integrated-iam-2026-11-27.json) | 통합 설계 검사 | 정책 통합·문장 보존·원본 요청 계약 검토 | 작성 당시 미연결 상태이며 후속 연결 근거와 함께 읽음 |
| [network-compute-permissions-2026-11-27.json](network-compute-permissions-2026-11-27.json) | 서비스 권한 검사 | VPC·EC2의 요청 조건과 plan 설정 검사 | 실제 네트워크/서버 기동 아님 |
| [oidc-service-linked-2026-11-27.json](oidc-service-linked-2026-11-27.json) | 초기 설계 검증 | OIDC·서비스 연결 Role 정책과 당시 최초 EKS plan | 실제 issuer는 아직 미연결; 최신 plan은 preapply 파일 |
| [preapply-eks-plan-2026-11-27.json](preapply-eks-plan-2026-11-27.json) | 최근 최초 단계 plan | 19개 생성 계획·18개 검사·계획 해시·apply 미실행 | 최초 EKS 의존 자원만 포함; 전체 배포 계획 아님 |
| [seoul-compatibility-2026-11-27.json](seoul-compatibility-2026-11-27.json) | AWS 조회 | 서울 리전의 버전·인스턴스 호환성 조회 결과 | 현재 재고/한도·생성 성공을 보장하지 않음 |
| [service-plan-2026-11-27.json](service-plan-2026-11-27.json) | 과거 plan / 테스트 입력 | Budget 추가 전 전체 서비스 74개 계획의 정제 요약 | scripts/tests/apply-scope.test.mjs가 읽음; 최신 실행 plan 아님 |
| [service-plan-iam-validation-2026-11-27.json](service-plan-iam-validation-2026-11-27.json) | IAM 검증 | 서비스 조회/state 정책 검토 근거 | 서비스 생성 전체 권한 검사 아님 |
| [vercel-cli-2026-11-17.json](vercel-cli-2026-11-17.json) | 폐기 도구 조사 | CLI 유지 대신 REST 전환을 선택한 권고 근거 | CLI가 현재 사용된다는 뜻이 아님 |
| [vercel-rest-2026-11-17.json](vercel-rest-2026-11-17.json) | 배포 도구 검증 | 정적 파일 업로드·계정 검사·오류 처리 모의 결과 | 실제 Vercel 배포 성공 증거 아님 |
| [workload-boundaries-2026-11-27.json](workload-boundaries-2026-11-27.json) | 로컬 설정 검사 | workload Role 5개 권한 상한 준비와 plan 검토 | 실제 권한을 모두 검증하지 않음 |
| [workload-boundaries-remote-2026-11-27.json](workload-boundaries-remote-2026-11-27.json) | AWS 정책 조회 | 생성한 상한 5개와 로컬 본문 대조 | workload 실행 증거 아님 |

## 필드와 보존 원칙

- `date` / `checkedAt`: 검사 시점. 날짜가 최신이라고 모든 범위를 다시 검사한 것은 아닙니다.
- `sourceCommit` / SHA / 해시: 검사한 코드·파일을 식별합니다. 키나 토큰이 아닙니다.
- `checks`, `passed`: 해당 검사만의 결과. 실제 생성 API 성공과 다릅니다.
- `readyForApply`, `pending`, `limitations`: 당시 준비 판단과 한계. 현재 상태는 통합 점검표가 기준입니다.
- `create` / `resources`: Terraform 관리 자원 수·종류. 서버 대수와 다릅니다.

파일마다 스키마가 달라 위 필드가 모두 있는 것은 아닙니다. 표준 JSON에는 주석이 없어 설명을 이 README로 분리했습니다. 과거 결과를 최신인 것처럼 덮어쓰거나 서로 다른 scope를 합산하지 않습니다. 날짜별 원본은 비교·감사 근거와 회귀 테스트 입력으로 유지합니다. 실제 계정·이메일·IP·키·암호·raw state/plan을 추가하지 않습니다.
