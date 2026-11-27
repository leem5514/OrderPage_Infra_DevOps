# 상태 저장소: Role 전환과 실제 plan 검증

2026-11-27. **IAM Role 전환과 실제 AWS 인증을 사용한 bootstrap plan이 성공했다. apply는 실행하지 않았다.**

사용자가 `OrderPageAssumeBootstrap` 정책 연결을 완료했다고 알린 뒤 검증했다. 콘솔 스크린샷은 정책 연결 버튼을 누르기 전 화면이지만, 이후 실제 STS 응답에서 지정 계정의 `orderpage-terraform-bootstrap` assumed-role임을 확인했다. 따라서 완료 여부는 화면만으로 추정하지 않았다.

## 인증은 어떻게 이어지는가

`orderpage-login`의 브라우저 임시 로그인 → `orderpage-lab`의 credential_process → 새 `orderpage-bootstrap`의 AssumeRole 순서다.

새 프로필은 기존 로그인 프로필을 source로 사용하며 세션 기간은 3,600초다. 기존 default/login/lab 설정은 유지했다. 실제 계정 ID·Role ARN은 로컬 AWS config에만 들어가며 키를 새로 만들거나 저장소에 넣지 않았다. Terraform 실행 프로세스에는 `AWS_PROFILE=orderpage-bootstrap`을 지정했다.

## 생성 예정인 것은 버킷 1개와 설정 6개

Terraform 1.16.2 / AWS provider 5.100.0으로 `validate`가 통과했고, `plan -detailed-exitcode`는 변경 예정이 있음을 뜻하는 종료 코드 2로 완료됐다. 저장된 plan을 JSON으로 읽어 다음 항목을 검토했다.

| Terraform 관리 대상 | 계획 및 확인한 값 |
|---|---|
| S3 bucket | Role 정책이 허용한 정확한 이름, 서울 리전, `force_destroy=false` |
| Public access block | 네 가지 공개 차단 옵션 모두 true |
| Ownership controls | `BucketOwnerEnforced` |
| Versioning | `Enabled` |
| Default encryption | `AES256` / SSE-S3 |
| Lifecycle | 이전 버전이 된 객체를 90일 후 만료 |
| Bucket policy | HTTP 거부 정책. ARN 결정 후 JSON이 완성되므로 plan에서 본문은 unknown |

**생성 7 / 수정 0 / 삭제 0 / 교체 0.** 버킷 7개라는 의미가 아니다. VPC·EKS·EC2·RDS·Redis·MQ·ALB·앱 배포는 이 plan에 없다. HTTP 거부는 기존 HCL의 `aws:SecureTransport=false`, Deny, 버킷/객체 범위를 확인했으며 실제 적용 후 정책 조회로 재확인해야 한다.

계정 정보가 없는 [검토 요약](security-evidence/bootstrap-plan-2026-11-27.json)에 검토한 plan의 SHA256과 설정을 기록했다. 원본 plan, tfvars, 실행 로그 및 로컬 상세 요약은 Git 제외 경로에 보관했다. 공개 요약에는 계정 ID, 실제 버킷 이름, 인증값이 없다.

## 성공으로 확인된 것과 아직 확인하지 않은 것

확인된 것은 source 사용자 인증, Role 전환, 고정 provider 인증, Terraform 구성의 유효성 및 계획 내용이다. **새 자원에 대한 plan은 생성 API를 실제로 실행하지 않는다.** 따라서 S3 Create/Put/Delete 권한이 모두 충분한지, 버킷 이름이 실제로 확보 가능한지, 적용 후 설정이 일치하는지는 아직 확인하지 않았다. IAM 정책 시뮬레이션이나 Access Analyzer 서버 검증도 수행하지 않았다.

초기 `validate`의 provider 응답 오류는 실행 격리 밖 재검증으로 해결됐다. 최초 plan 명령은 PowerShell 인자 해석 오류로 AWS 생성 전 중단됐고, 인자를 배열로 전달한 재실행이 성공했다. 성공을 위해 인프라 코드나 IAM 권한을 넓히지 않았다.

## 다음 실행의 범위와 비용

다음은 검토한 **bootstrap plan만 apply**하는 단계다. 적용 후에는 공개 차단·암호화·버전 관리·HTTP 거부를 조회하고, bootstrap 로컬 state를 보호된 위치에 백업한다. 서비스용 원격 backend 초기화와 VPC/EKS 배포는 별도 배포 Role 준비 후 진행한다.

S3는 저장량·요청 등에 따른 사용량 과금이다. 이번 plan에는 시간 단위로 실행되는 EKS·EC2·NAT가 없지만 S3 사용을 무조건 무료라고 보장하지 않는다. 실제 금액은 저장할 state와 버전 수, 요청량, 계정의 크레딧 조건에 따라 달라진다. [AWS S3 요금 안내](https://aws.amazon.com/s3/pricing/)

버킷의 현재 버전 객체는 90일 만료 대상이 아니다. 프로젝트 종료 후에도 state와 이전 버전을 남기면 저장 비용이 계속될 수 있다. `force_destroy=false`이므로 객체가 있는 버킷을 Terraform이 강제로 비우지 않는다. 인프라 정리 완료·state 백업 확인 후 버전과 버킷의 보존/삭제를 결정한다.

이번 작업에서는 승인 전 실제 버킷 생성과 저장된 plan 적용을 실행하지 않았다. 오래된 plan을 그대로 사용하지 않고, 적용 전에 프로필·코드·입력 변경 여부를 확인한다.
