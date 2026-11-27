# IAM 설계 — 누가 무엇을 할 수 있는가

> **문서 용도:** 권한 분리 이유와 정책 생성기를 이해하는 목차입니다. 이 Markdown을 AWS에 입력하지 않습니다. 실제 계정별 정책은 검토된 생성기로 Git 제외 위치에 만들며 계정 ID나 비밀값을 예제에 채워 커밋하지 않습니다. [문서 지도](../README.md)

먼저 [통합 설계](integrated-iam-review.md)를 읽고 필요한 서비스만 내려가세요. 현재는 통합 정책 13개 연결·원격 대조 완료, 기존 state/read 정책 2개 유지로 총 15개입니다. 아래 본문의 미연결·후속 PR 표시는 당시 이력입니다. 현재 결과·한계는 [통합 점검표](../checks.md#iam)를 따릅니다.

| 문서 | 설명 |
|---|---|
| [전체 서비스 자원을 권한 설계 단위로 나눈 이유](apply-permission-design.md) | 설계 근거·대상 API·조건과 당시 검사 |
| [Terraform이 생성하는 Role 5개의 최대 허용 권한](workload-boundaries.md) | 설계 근거·대상 API·조건과 당시 검사 |
| [배포 Role의 IAM 생성·PassRole·자기 권한 변경 방지](deploy-iam-delegation.md) | 설계 근거·대상 API·조건과 당시 검사 |
| [실제 EKS issuer 연결과 AWS 서비스 연결 Role의 권한](oidc-service-linked-roles.md) | 설계 근거·대상 API·조건과 당시 검사 |
| [EKS 생성·변경·삭제 API와 조건 제한](eks-service-permissions.md) | 설계 근거·대상 API·조건과 당시 검사 |
| [VPC·EC2·Jenkins 생성과 정리 권한](network-compute-permissions.md) | 설계 근거·대상 API·조건과 당시 검사 |
| [RDS·Redis·Amazon MQ 생성과 정리 권한](data-service-permissions.md) | 설계 근거·대상 API·조건과 당시 검사 |
| [22개 원본 정책을 13개 배포 정책으로 묶은 설계와 적용 순서](integrated-iam-review.md) | 전체 정책 구성과 2단계 배포의 출발점 |
| [kubectl·Helm 운영자 Role과 Terraform Role의 분리](eks-operator-role.md) | 설계 근거·대상 API·조건과 당시 검사 |
| [서비스 plan/state 접근 Role과 초기 인증 절차](service-plan-role.md) | 설계 근거·대상 API·조건과 당시 검사 |
| [상태 저장 S3 버킷 전용 Role과 초기 인증 절차](terraform-bootstrap-role.md) | 설계 근거·대상 API·조건과 당시 검사 |

정책 문법 검사와 로컬 요청 모의 검사는 실제 서비스 생성 성공을 보장하지 않습니다. EKS를 만든 뒤 실제 OIDC issuer 연결과 전체 plan 재검토가 필요합니다.
