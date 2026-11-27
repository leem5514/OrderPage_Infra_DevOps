# 네트워크·EC2 실행 권한 검토본

**아직 AWS에 연결하지 않는다.** 기존 읽기·IAM 위임·EKS 정책과 합쳐 검토할 정책 4개다. 실제 계정과 검토한 Jenkins AMI는 로컬 입력으로만 사용한다. 생성 결과는 `.local/iam-network-compute-review`에 저장되며 Git에서 제외된다.

저장소 루트에서 실행한다. 아래 값은 자리표시자이므로 실제 입력으로 바꿔야 한다. Access Key·Secret Key를 입력하는 명령이 아니다.

```powershell
node scripts/prepare-network-compute-permissions.mjs <12자리-계정-ID> <검토한-Jenkins-AMI-ID>
node scripts/review-network-compute-plan.mjs terraform/envs/dev/<검토-plan>.tfplan <검토한-Jenkins-AMI-ID>
```

생성기는 기존 출력 폴더와 `.local` 링크 경로를 거부한다. 기존 결과가 있으면 임의로 덮어쓰지 말고 새 검토와 이전 검토의 차이를 먼저 확인한다. JSON은 들여쓰기를 유지하며 계정 ID와 AMI는 정책 본문에만 들어간다.

| 정책 | 범위 | 공백 제외 크기 |
|---|---|---:|
| `OrderPageNetworkCreate` | VPC·서브넷·IGW·EIP·NAT·라우팅 테이블·SG·S3 endpoint 생성 및 부모 접근 | 4,244자 |
| `OrderPageNetworkManage` | 프로젝트 네트워크 연결·변경·삭제, inline SG 규칙 | 4,876자 |
| `OrderPageComputeLifecycle` | EKS launch template, 지정 AMI의 Jenkins 생성·시작·정지·삭제 | 3,724자 |
| `OrderPageNetworkComputeTags` | 생성·기존 태그, 소유 태그 보호, 서울 밖 쓰기 거부 | 5,113자 |

`manifest.json`의 `REVIEW_ONLY_DO_NOT_ATTACH`, `readyForApply: false`는 의도된 상태다. plan 검사 통과도 AWS 권한 검증이나 배포 승인이 아니다. 미확정 ID와 AMI는 결과의 `unresolved`에 남는다.

[실행 과정과 제한 이유](../../docs/restart/network-compute-permissions.md), [공식 권한표 대조 자료](authorization-reference.json), [검증 결과](../../docs/restart/security-evidence/network-compute-permissions-2026-11-27.json)를 함께 확인한다.
