# 첫 AWS 적용: Terraform 상태 저장소 생성 완료

2026-11-27. 사용자가 S3 상태 버킷 1개와 설정 6개의 생성을 승인했다. **저장된 plan을 적용해 7개 Terraform 관리 자원을 생성했고, AWS 조회 검증 및 적용 후 변경 없음까지 확인했다.** VPC/EKS나 애플리케이션 배포는 수행하지 않았다.

## 승인한 대상과 실제 적용

적용 전 저장된 plan의 SHA256이 [검토 기록](security-evidence/bootstrap-plan-2026-11-27.json)과 일치하는지 확인했다. 작업 트리와 기존 state 유무를 확인하고, STS에서 지정 계정의 `orderpage-terraform-bootstrap` Role임을 검증한 뒤 동일한 plan 파일을 적용했다. 적용 로그와 state에 관리 자원 7개가 기록됐다. 기존 자원의 수정·삭제는 없다.

| 대상 | AWS에서 직접 확인한 결과 |
|---|---|
| 상태 저장용 S3 버킷 | 서울 리전, 기대한 계정 소유 |
| 공개 접근 차단 | 네 가지 옵션 모두 true |
| 소유권·ACL | BucketOwnerEnforced, 버킷 소유자의 FULL_CONTROL만 존재 |
| 버전 관리 | Enabled |
| 기본 암호화 | AES256 / SSE-S3 |
| 이전 버전 수명 주기 | Enabled, 이전 버전이 된 후 90일 만료 |
| 버킷 정책 | 해당 버킷/객체의 HTTP 요청을 거부하는 단일 Deny |
| 태그 | Project/Environment/ManagedBy/Component가 코드와 일치 |

S3 조회 API 9개를 `--expected-bucket-owner`와 함께 호출해 검증했다. HTTP 차단은 정책을 읽어 확인했으며 인증값을 HTTP로 보내는 시험은 하지 않았다. 수명 주기 설정은 반영 대기 시간이 있었으나 권한 확대나 코드 변경 없이 완료됐다.

적용 후 실제 원격 상태를 읽는 `terraform plan -detailed-exitcode`가 **종료 코드 0, 변경 없음**으로 끝났다. [비식별 검증 요약](security-evidence/bootstrap-apply-2026-11-27.json)에 적용한 plan 해시와 결과를 기록했다. 생성 시 사용한 API와 조회는 성공했지만 삭제/복구 절차까지 시험한 것은 아니다.

## state와 비밀정보를 어떻게 보관했나

- bootstrap state는 `terraform/bootstrap/remote-state/terraform.tfstate`에 있다. Git 제외 상태이며 원격 backend로 옮긴 것은 아니다.
- `.local/state-backups/bootstrap-2026-11-27.tfstate.dpapi`에 Windows DPAPI CurrentUser 방식으로 암호화한 백업을 만들었다. 복호화한 바이트가 원본 state와 일치하는지 메모리에서 검증했다.
- 이 백업은 현재 Windows 사용자 환경에 종속된다. 별도 장치/원격 백업이 아니므로 PC나 사용자 프로필 손실에 대비한 전체 복구 대책을 완료한 것은 아니다. 실제 복구·state 교체는 하지 않았다.
- 실제 버킷 이름·계정 ID·프로필·원본 plan·실행 로그·state·백업은 Git에 넣지 않는다. 공개 요약에는 자원 식별자를 제외한 설정·결과만 남긴다.

이 버킷은 이후 서비스 인프라의 state를 보관할 준비가 된 상태다. 현재 bootstrap Role에는 객체 본문 읽기/쓰기 권한을 직접 부여하지 않았으므로, 서비스 환경 backend 초기화는 별도 배포 Role의 상태 파일·잠금 파일 권한을 구성한 다음 진행한다.

## 비용과 다음 단계

이번 실행으로 S3 버킷이 실제 계정에 존재한다. S3는 저장량·요청 등에 따라 과금되며 아직 실청구 금액은 조회하지 않았다. EKS·EC2·NAT·관리형 DB 등의 생성은 이번 실행에 포함되지 않았다. [AWS S3 요금 안내](https://aws.amazon.com/s3/pricing/)

90일 만료 규칙은 **이전 버전**에만 적용된다. 현재 state 객체나 버킷을 자동 삭제하지 않는다. 서비스 인프라 정리와 state 백업이 끝난 후 보존/삭제를 결정해야 한다. `force_destroy=false`도 유지했다.

다음은 VPC/EKS 등 서비스 인프라용 Role의 범위를 준비하고, state 객체/잠금 권한·실제 변수·예산을 확정해 서비스 환경 plan을 검토하는 것이다. 이번 S3 적용 승인을 전체 서비스 배포 승인으로 확대하지 않는다.
