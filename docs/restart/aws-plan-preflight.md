# 실제 AWS plan 전 점검 — 계정·인증·비용

기준일: 2026-11-14 KST. Infra #7·#8과 BE #2는 `main`에 병합됐다. 이 문서는 Terraform을 AWS 계정에 처음 연결하기 전의 점검 결과와 다음 실행 순서를 기록한다. AWS 리소스 생성, 원격 state 생성, 실제 `plan`, Vercel 배포는 아직 수행하지 않았다.

## 이번 점검 결과

| 항목 | 확인 결과 | 다음 조건 |
|---|---|---|
| AWS CLI | v2.34.19, `default` 프로필에 기존 키가 있으나 STS `InvalidClientTokenId` | 유효한 임시 인증 프로필과 대상 계정 확인 |
| Terraform | v1.16.2, AWS provider v5.100.0. `init -backend=false`, `validate`, mock 22개 통과 | 원격 backend·실제 변수로 계정 조회와 `plan` |
| 상태 저장소 | `backend.hcl.example`만 있음 | S3 bootstrap 계획 검토 후 생성·연결 |
| 배포 변수 | 예시 IP·계정·버전 placeholder, 암호 없음 | 실제 운영자 Role, /32 IP, add-on/RDS 버전, 세 비밀값 |
| Jenkins/관측 | `enable_jenkins=false`, `enable_operations_monitoring=false` 기본 | AMI·SNS 수신 주소·비용과 운영 시간을 검토한 뒤 활성화 |
| 비용 | 2026-11-06/08 보관 단가의 실습 추정치만 있음 | 시작 직전 실제 단가·계정 혜택·종료 시각 재확인 |

STS 오류는 현재 키가 AWS에서 인증되지 않는다는 뜻이다. 키 값 자체를 채팅·Git·로그에 붙이지 않는다. 인증이 실패한 상태에서는 `plan`을 실제 AWS 계정 검토 결과라고 부르지 않는다. `init -backend=false`도 실제 원격 state 연결을 뜻하지 않는다.

## `default` 갱신과 별도 프로필 비교

| 방식 | 장점 | 1~3일 실습의 실수·보안 측면 |
|---|---|---|
| `default` 갱신 | 기존 명령에서 프로필을 생략할 수 있어 간단하다 | 프로필을 빠뜨린 명령도 이 계정을 사용한다. 기존 키를 덮어써 다른 프로젝트에 영향을 줄 수 있다 |
| `orderpage-lab` 같은 별도 프로필 | 실습 계정과 다른 AWS 작업을 구분하고 명령·로그에 대상 계정을 드러낼 수 있다 | `--profile` 또는 현재 터미널의 `AWS_PROFILE` 지정이 필요하다. 프로필 분리만으로 IAM 권한이나 유출 위험이 줄지는 않는다 |

**권장:** 별도 프로필 + 사람의 임시 자격증명 + 필요한 IAM 권한. 가능하면 IAM Identity Center의 SSO 프로필을 사용한다. 그렇지 않고 콘솔 IAM 사용자/연동 계정을 쓰는 경우 현재 CLI의 `aws login --profile orderpage-lab`을 고려한다. 이는 브라우저 인증으로 임시 자격증명을 만들며, IAM 사용자/역할에는 AWS가 요구하는 `SignInLocalDevelopmentAccess` 권한이 필요하다. 기존 장기 키를 새 프로필에 단순 복사하는 것은 보안 개선이 아니다. 루트 access key로 Terraform을 실행하지 않는다. CLI 로그인 세션은 갱신/재로그인이 필요할 수 있으므로 3일 가동 중 인증 상태를 확인한다.

고정된 Terraform AWS provider v5.100.0은 `AWS_PROFILE`과 `credential_process`를 지원한다. `aws login` 프로필을 provider가 직접 읽지 못한다면 AWS 공식 예시대로 별도 프로필의 `credential_process = aws configure export-credentials --profile orderpage-lab --format process`를 사용한다. 이 출력에는 임시 비밀값이 있으므로 터미널에 직접 출력하거나 저장하지 않는다. 실제 적용 전 `aws sts get-caller-identity`와 Terraform의 동일 계정 접근을 각각 확인한다.

AWS CLI는 명시적 `--profile`을 우선 사용하고, Terraform은 현재 셸의 `AWS_PROFILE`을 읽는다. `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` 환경 변수가 있으면 프로필보다 우선할 수 있으므로 이름의 존재 여부만 확인하고 잘못된 값을 사용하는 셸을 정리한다. 기존 `default` 인증이 실패한다고 임의로 키를 삭제하지 않는다.

공식 근거: [AWS CLI 프로필](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html), [AWS CLI 로그인](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html), [IAM 임시 자격증명·최소 권한](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html), [AWS provider 5.100.0 인증](https://registry.terraform.io/providers/hashicorp/aws/5.100.0/docs).

## 실제 plan에 필요한 순서

1. 사용자가 AWS 콘솔에서 실습 계정과 배포용 IAM 주체를 확인하고 별도 프로필로 로그인한다. 이 문서의 예시 이름 `orderpage-lab`은 확정된 프로필명이 아니다. 프로필명만 공유하고 access key·secret·session token은 공유하지 않는다.
2. 다음 읽기 전용 명령에서 계정 ID·ARN·리전이 의도한 대상인지 확인한다. IAM 사용자 ARN인 경우 Terraform 배포용 Role을 assume하는 구성/권한도 별도 확인한다.

   ```powershell
   aws sts get-caller-identity --profile orderpage-lab --region ap-northeast-2
   aws configure get region --profile orderpage-lab
   ```

3. 서울 리전의 EKS 1.35와 필수 add-on, RDS 10.11 patch, Redis 7.1, Amazon MQ `mq.m7g.medium`, AL2023 x86 AMI의 실제 지원·가용성을 읽기 전용 API로 조회한다. [조회 명령](../../terraform/envs/dev/README.md)을 그대로 재사용하고 실패·미지원 버전은 변수에 넣지 않는다.
4. 운영자 공인 IPv4 `/32`와 `eks_admin_principal_arn`을 확인한다. `terraform.tfvars.example`을 Git 제외된 `terraform.tfvars`로 복사해 실제 버전과 Jenkins/관측 선택값을 채운다. RDS·Redis·MQ 암호 3개는 서로 다르게 만들고 보호된 입력으로 전달한다. tfvars/state/plan에는 민감 정보가 들어갈 수 있다.
5. 실습 시작·종료 시각과 비용 한도를 정한다. 보관된 2026-11-06/08 공개 단가 계산은 12시간 **$10.58**, 24시간 **$19.00**, 72시간 **$52.68**이다. [산식과 누락 항목](pricing-evidence/estimate.mjs)을 읽고 시작 직전 가격·데이터 전송·로그·세금·Vercel 요금을 다시 확인한다. 월 Budget은 지출 차단 장치가 아니다.
6. [원격 state bootstrap](../../terraform/bootstrap/remote-state/README.md)의 생성 목록과 bucket 이름을 먼저 검토한다. 생성 후 `backend.hcl`을 채워 `init -reconfigure -backend-config=backend.hcl`로 연결한다. 기존 state가 있다면 신규 state와 혼합하지 않는다.
7. 실제 프로필/변수/원격 state가 준비되면 `terraform plan -input=false -out=foundation.tfplan`의 **생성·교체·삭제 목록**을 검토한다. `apply` 전에 EKS/Node/NAT/RDS/Redis/MQ/Jenkins/CloudWatch의 시간당·스토리지 비용과 종료 방법을 확인한다. `plan`은 작성된 코드와 현재 계정 상태를 비교할 뿐, 서비스 기동 성공을 보증하지 않는다.

AWS 인증이 유효해질 때까지는 2단계 이후의 계정별 조회와 실제 `plan`을 수행할 수 없다. 다음 작업은 프로필을 연결하고 이 순서대로 읽기 전용 확인을 마치는 것이다.
