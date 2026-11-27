# 통합 점검표 — 완료 근거와 남은 확인

> **문서 용도:** 앱·비밀정보·IAM·Terraform 점검을 한곳에서 읽습니다. 기준일: 2026-11-27, PR #32 병합까지의 결과입니다. 아래 숫자는 기록 당시 검사 결과이며 이번 문서 정리에서 앱 전체를 다시 검사했다는 뜻이 아닙니다. [문서 지도](README.md)

## 지금 내릴 수 있는 판단

**서비스 apply 전 준비와 plan 검토까지 완료했습니다. 실제 클라우드 기동·공개 배포·성능 검증 완료가 아닙니다.** 문법 검사, 로컬 테스트, AWS 읽기, AWS 생성/운영은 서로 다른 검증 단계입니다. JSON의 `readyForApply` 값이나 과거 pending 목록도 작성 시점의 기록입니다.

<a id="plans"></a>
## Terraform plan·설정 점검

| 범위 | 결과 | 의미와 한계 |
|---|---|---|
| 최초 서비스 plan | 생성 74개, 수정/삭제/교체 0 | Budget 추가 이전 기록이며 실행할 최신 plan 아님 |
| Budget 포함 전체 plan | 생성 75개, 설정 검사 73개 통과, 미확정 정책/목적지 26개 | AWS 인증으로 plan 성공. 생성 API 성공의 증명 아님 |
| 최초 EKS 단계 plan | 생성 19개·수정/삭제 0, 범위/설정 18개 통과, validate 성공 | VPC·NAT·EKS 제어 영역만. 워커·운영자 접근·Budget/SNS 없음 |
| 전체 Infra 회귀 검사 | 최근 기능 변경 기준 142개 통과 | 모의 검사 포함. 배포·무중단·성능 실측 아님 |

[전체 plan 근거](security-evidence/budget48-plan-2026-11-27.json) · [최초 EKS plan 근거](security-evidence/preapply-eks-plan-2026-11-27.json)

처음 EKS issuer를 얻기 위해 target plan을 사용했습니다. 일상 배포의 기본 절차가 아닙니다. 실제 apply 전 인증·IP·state·정책·최신 plan을 다시 확인하고, EKS 생성 후 전체 plan을 다시 만듭니다. plan 파일에는 비밀이 있을 수 있어 공개하지 않습니다.

<a id="state"></a>
## State 저장소

S3 버킷 1개와 설정 6개를 실제 적용했습니다. AWS 조회 9개와 후속 plan 변경 없음, 로컬 state 암호화 백업을 확인했습니다. Terraform 관리 자원 7개는 버킷 7개라는 뜻이 아닙니다.

[적용 전 plan 근거](security-evidence/bootstrap-plan-2026-11-27.json) · [실제 적용 근거](security-evidence/bootstrap-apply-2026-11-27.json) · [재현용 Role 절차](iam/terraform-bootstrap-role.md)

<a id="iam"></a>
## IAM 연결과 권한

| 확인 | 결과 | 아직 보장하지 않는 것 |
|---|---|---|
| Workload 권한 상한 | 정책 5개 원격 본문 일치 | 해당 workload Role과 서비스 기동 |
| 통합 정책 | 13개 AWS ValidatePolicy findings 0, Role 연결 한도 20 | 모든 실효 권한·SCP·resource policy 조합 |
| 배포 Role 연결 | 신규 13개 + 기존 state/read 2개 = 15개, 원격 본문 일치 | 실제 생성 API 전체 동작 |
| 인증·state 읽기 | 지정 배포 Role 일치, 버킷 읽기 성공, 서비스 state prefix 객체 0 | 실제 배포 성공 |
| 거부 규칙 | state 객체 삭제·배포 Role 자기 정책 연결 explicitDeny | 다른 모든 호출의 허용/거부 |
| 임시 installer | 연결 해제 후 AttachmentCount 0 확인 | 다른 사용자·계정 전체 권한 감사 |

[실제 연결 근거](security-evidence/deploy-policy-connection-2026-11-27.json) · [통합 설계](iam/integrated-iam-review.md)

<a id="application"></a>
## 앱 기동·종료·보안 수정

주문 배열 전체의 수량/입력 검증을 업무 호출 전에 수행하도록 수정했습니다(BE #5). 이후 Java 21·Spring Boot 기반 갱신과 긴 비밀번호 처리, JWT·Redis/MQ/SSE 직렬화 및 HTTP histogram 설정을 수정했습니다(BE #6). 상세 변경은 [BE 보안 기록](https://github.com/leem5514/OrderPage_BE_DevOps/blob/76a6bd04c00835268722f5301f8ab36c85d1171e/docs/security-baseline.md)을 따릅니다.

| 기록 당시 검사 | 결과 | 한계 |
|---|---|---|
| Java 테스트·bootJar | 68건 통과 | 실제 AWS 데이터 서비스 TLS 연결 아님 |
| 로컬 Docker | 기능 13개, 보안·histogram 6개 통과 | EKS·ALB 경로와 분리 |
| DB 장애·복구 | liveness 200/readiness 503 → 복구 후 readiness 200 | 실제 ALB 대상 제외 시간 미측정 |
| SIGTERM·SSE | 정상 EOF, SIGTERM 종료 확인 | FE 재연결·롤링 배포 실패율 미검증 |
| 실행 의존성 OSV 조회 | 당시 Maven 모듈 174개, 버전 일치 권고 0 | 미래 권고·OS/JDK 이미지 검사·침투 테스트 아님 |

[백엔드 실행 검증 근거](security-evidence/backend-runtime-2026-11-17.json). Readiness는 트래픽 준비 상태, Liveness는 앱 생존 상태, Startup은 초기 기동을 다룹니다. SSE 종료가 정상이어도 프론트 재연결까지 보장하지 않습니다.

<a id="vercel"></a>
## Vercel·프론트 배포 경로

Vercel CLI 65.12.1과 후보 65.17.0 모두 당시 npm audit 영향 패키지 38개가 남았습니다. 버전만 바꾸거나 overrides로 번들 내부까지 해결됐다고 주장하지 않고 **CLI를 제거하고 공식 REST API로 전환**했습니다. 업스트림 취약점을 패치한 것이 아닙니다.

[CLI 조사 근거](security-evidence/vercel-cli-2026-11-17.json) · [REST 검증 근거](security-evidence/vercel-rest-2026-11-17.json) · [현재 배포 절차](guides/vercel-rest-deployment.md)

실제 Vercel 토큰 범위·계정·도메인·Jenkins 최초 실행은 남아 있습니다. FE 빌드 도구의 당시 audit 권고 18개는 전체 보안 해결로 처리하지 않습니다. 신뢰한 소스만 토큰 없이 빌드하고 개발 서버를 외부에 노출하지 않는 조건을 유지합니다.

<a id="secrets"></a>
## 비밀정보 노출 점검과 입력 규칙

PR #32 병합 전 공개 파일 302개를 실제 계정·이메일·운영 IP·보호된 서비스 비밀값과 대조해 일치 0건을 확인했습니다. 해당 변경 커밋의 Gitleaks 탐지도 0건이며, 원본 plan 해시와 공개 검토 기록이 일치했습니다. 이는 **당시 확인 범위의 결과**이며 모든 키가 모든 곳에서 안전하다는 보증이 아닙니다.

| 값의 위치 | Git 공개 위험 | 입력 규칙 |
|---|---|---|
| 실제 tfvars/backend/state/plan, `.local/` | ignore로 제외하지만 강제 추가하면 공개 가능 | Git 제외 유지, state 읽기 제한, 원문 PR/채팅 첨부 금지 |
| 추적 중인 example/template/Jenkinsfile/application.yml | 값을 채우면 그대로 커밋될 수 있음 | 예시는 예시로 유지, 실제 값은 별도 비공개 파일/credential |
| Vue `VUE_APP_*` | 빌드된 브라우저 JS에 포함 | 공개 API 주소만 사용, 비밀 토큰 금지 |
| Jenkins credential·Pod Secret | Git 제외만으로 실제 계정 안전성을 보장하지 못함 | 로그·artifact·사용자 권한과 실제 주입 확인 |

Terraform `sensitive`는 state에서 값을 지우지 않습니다. `git add -f`는 ignore를 우회합니다. 노출이 발견되면 파일 삭제만 하지 말고 발급처에서 폐기·재발급하고 Git 이력·로그·artifact를 조사합니다. AWS 계정 ID/ARN은 비밀키와 다르지만 실제 값은 공개 근거에 복사하지 않습니다.

이전 이력 검사: 11월 27일 당시 BE 20·FE 9·Infra 65개 도달 가능 커밋과 스냅샷에서 탐지 0건을 확인했습니다. 삭제 refs·포크·외부 캐시·모든 스크린샷·CI 로그·PC 전체·실제 접근 이력은 범위 밖입니다. 이 숫자를 최신 전체 이력 검사 결과로 재사용하지 않습니다.

<a id="remaining"></a>
## 배포 전과 배포 후에 남은 확인

| 시점 | 확인할 것 | 완료 근거 |
|---|---|---|
| apply 전 | 로그인/Role/IP/state·최신 plan·Budget/SNS 준비 순서·48시간 정리 시한 | 당일 조회와 검토 기록 |
| EKS 생성 후 | 실제 OIDC, operator access entry, IRSA·RBAC·보안 그룹 | 실제 Role/클러스터 동작 |
| 공개 앱 연결 전 | Secret 주입, 데이터 TLS, 이미지·JDK/OS, 컨테이너 권한, Jenkins 접근자/플러그인/Docker 권한, Vercel 토큰 | 실제 배포 이미지와 계정 기준 점검 |
| 공개 앱 연결 후 | HTTPS·CORS, /actuator 외부 차단, 이미지 S3 공개 범위, SNS 수신, Prometheus Targets | 외부/내부 경로별 smoke·관측 |
| 실사용 계정 도입 전 | 비밀번호 변경 후 refresh token 회수·프론트 localStorage/XSS 경계 | 정책 결정과 동작 검증 |
| 실험·종료 | 기준값/변경값 비교, 증거 내보내기, ALB/NAT/EIP/EBS 등 잔여 확인 | 실측 결과·삭제 조회 |

## 이번 문서 정리의 검증

문서 이동 후 로컬 링크 334개·문서 내 앵커 23개를 검사했고 누락은 없었습니다. 원본 근거 JSON 25개는 본문을 바꾸지 않았으며 모두 파싱됩니다. 이 자료를 읽는 비용 계산·plan 분류 회귀 검사 7개가 통과했습니다. 공개 대상 294개 파일의 실제 민감값 대조와 변경분 Gitleaks 탐지 결과는 0건입니다.

Terraform HCL·배포 스크립트·정책·앱 동작은 변경하지 않았습니다. 삭제한 실행 파일은 과거 가격 가정의 중복 계산기뿐이며 현재 계산기와 입력은 유지합니다. 문서 정리 중 AWS apply나 클라우드 변경은 실행하지 않았습니다.

<a id="history"></a>
## 통합한 과거 문서의 원문

본문의 현재 판단과 중복되는 날짜별 파일은 제거했습니다. 변경 전의 재현 설명·SHA·검사 범위는 아래 고정 커밋에서 읽을 수 있습니다. **당시 미완료 항목을 현재 상태로 해석하지 마세요.** 원본 JSON은 [파일별 설명](security-evidence/README.md)과 함께 보존합니다.

- [application-readiness](https://github.com/leem5514/OrderPage_Infra_DevOps/blob/0676378d1fb7b1f125172a9dd3a88c2c47c94108/docs/restart/application-readiness.md)
- [lifecycle-readiness](https://github.com/leem5514/OrderPage_Infra_DevOps/blob/0676378d1fb7b1f125172a9dd3a88c2c47c94108/docs/restart/lifecycle-readiness.md)
- [backend-security-baseline](https://github.com/leem5514/OrderPage_Infra_DevOps/blob/0676378d1fb7b1f125172a9dd3a88c2c47c94108/docs/restart/backend-security-baseline.md)
- [predeploy-security-assessment](https://github.com/leem5514/OrderPage_Infra_DevOps/blob/0676378d1fb7b1f125172a9dd3a88c2c47c94108/docs/restart/predeploy-security-assessment.md)
- [deployment-review](https://github.com/leem5514/OrderPage_Infra_DevOps/blob/0676378d1fb7b1f125172a9dd3a88c2c47c94108/docs/restart/deployment-review.md)
- [vercel-security-review](https://github.com/leem5514/OrderPage_Infra_DevOps/blob/0676378d1fb7b1f125172a9dd3a88c2c47c94108/docs/restart/vercel-security-review.md)
- [credential-exposure-audit](https://github.com/leem5514/OrderPage_Infra_DevOps/blob/0676378d1fb7b1f125172a9dd3a88c2c47c94108/docs/restart/credential-exposure-audit.md)
- [secret-audit-2026-11-27](https://github.com/leem5514/OrderPage_Infra_DevOps/blob/0676378d1fb7b1f125172a9dd3a88c2c47c94108/docs/restart/secret-audit-2026-11-27.md)
- [service-plan-2026-11-27](https://github.com/leem5514/OrderPage_Infra_DevOps/blob/0676378d1fb7b1f125172a9dd3a88c2c47c94108/docs/restart/service-plan-2026-11-27.md)
- [bootstrap-plan-2026-11-27](https://github.com/leem5514/OrderPage_Infra_DevOps/blob/0676378d1fb7b1f125172a9dd3a88c2c47c94108/docs/restart/bootstrap-plan-2026-11-27.md)
- [bootstrap-apply-2026-11-27](https://github.com/leem5514/OrderPage_Infra_DevOps/blob/0676378d1fb7b1f125172a9dd3a88c2c47c94108/docs/restart/bootstrap-apply-2026-11-27.md)
