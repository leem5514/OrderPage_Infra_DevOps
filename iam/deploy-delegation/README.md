# 배포 Role의 IAM·EKS 접근 관리 권한 검토본

**아직 AWS에 생성하거나 연결하지 않는다.** 이 묶음은 IAM 위임 부분의 검토본이며 서비스 apply에 필요한 전체 정책이 아니다. 일부 Allow만 먼저 연결하면 함께 검토한 Deny 보호 조건이 빠진다.

생성: `node scripts/prepare-deploy-delegation.mjs <12자리 계정 ID>`

결과는 Git 제외 경로 `.local/iam-deploy-delegation-review`에 들여쓴 JSON 5개와 manifest로 저장한다. 기존 폴더는 덮어쓰지 않는다. 계정 ID를 소스에 직접 넣거나 결과를 Git에 추가하지 않는다.

| 파일 | 책임 |
|---|---|
| `OrderPageWorkloadRoleLifecycle.json` | 지정 Role 5개 생성·갱신·삭제 및 역할별 상한 요구 |
| `OrderPageWorkloadRolePermissions.json` | 승인한 관리형 정책 연결, 두 Role의 inline 정책, 3개 Role의 PassRole |
| `OrderPageWorkloadIamResources.json` | Controller 정책 하나와 Jenkins instance profile 하나 관리 |
| `OrderPageDeploymentGuardrails.json` | 경계 제거·보호 정책 변경·실행자 수정·잘못된 PassRole 등의 명시적 거부 |
| `OrderPageEksAccessManagement.json` | 지정 운영자 하나의 Access Entry와 관리자 정책 연결·해제 |

[구현 설명·한계·남은 작업](../../docs/restart/deploy-iam-delegation.md)을 먼저 읽는다. `authorization-reference.json`은 공식 IAM/EKS/STS 서비스 참조에서 사용한 Action·Resource·Condition·API 의존 조건만 추린 검증 근거다. 원본 URL과 해시를 포함하며 원본 전체나 AWS IAM 시뮬레이터를 대신하지 않는다.
