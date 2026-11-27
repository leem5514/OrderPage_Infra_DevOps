# 2026-11-27 병합 전 비밀정보 재검사

**확인한 저장소·이력에서 검사 도구가 탐지한 키/토큰은 0건이다.** 이것은 계정 전체 또는 과거 모든 외부 공개 경로에서 유출이 없었다는 보증이 아니다. 실제 비밀값은 보고서에 기록하지 않는다.

## 확인 범위와 결과

공식 Gitleaks 8.30.1 Windows 배포 파일의 SHA256을 공식 체크섬과 대조한 뒤 실행했다. 저장소별 설정/ignore 파일 대신 기본 탐지 규칙을 명시했고, `gitleaks:allow` 주석도 무시하도록 검사했다. 출력과 로컬 보고서는 `--redact=100`으로 마스킹했다.

| 저장소 | 검사한 HEAD | 가져온 refs에서 도달 가능한 커밋 | 현재 스냅샷 탐지 | 이력 탐지 |
|---|---|---:|---:|---:|
| OrderPage_BE_DevOps | `4cacf704c0d9741fc9d687dfc2f035e02501d316` | 20 | 0 | 0 |
| OrderPage_FE_DevOps | `36f6bff2ca36206e5189613cb20ca02e874a8e2d` | 9 | 0 | 0 |
| OrderPage_Infra_DevOps | `8f2dbd73b38f65edae6b3d4f61be5a2ea56a1094` | 65 | 0 | 0 |

세 저장소 모두 shallow clone이 아니며, 원격의 모든 현재 브랜치와 태그를 fetch한 후 `git --log-opts="--all --full-history"`로 검사했다. 현재 스냅샷은 HEAD를 archive로 내보내 `dir`로 별도 검사했다. 위 커밋 수는 `git rev-list --all --count` 값으로, 변경 diff가 없는 merge 등을 제외하는 스캐너의 처리 커밋 수와 구분한다. 이 기록 자체의 추가 커밋은 병합 전에 별도 스테이징 검사한다.

추가 확인:

- 현재 추적 파일 및 Git 제외되지 않은 파일에 대해 AWS Access Key·GitHub token·개인키·Slack token 형식도 보조 검사했다. 일치 0건이었다.
- GitHub PR 28개(BE 6, FE 4, Infra 18)의 제목·본문에서 위 알려진 형식이 탐지되지 않았다. PR별 댓글/리뷰 조회는 모두 0개를 반환했다. PR 텍스트 검사는 Gitleaks 전체 규칙 검사가 아니다.
- `.env`, 실제 tfvars/backend/plan/state, `.local` 계정별 정책·인증 설정 파일의 Git 제외를 확인했다. 추적된 `ap-northeast-2-bundle.pem`은 공개 RDS CA 인증서이며 개인키가 아니다.
- `.local/iam-bootstrap/permissions.json`은 추적 중인 템플릿을 본인 계정 ID로 치환한 결과와 일치하는지 확인했다. 실제 계정 ID는 공개 대상 파일에서 제외한다.
- bootstrap 정책/생성기 회귀 검사 6개가 통과했다. Allow의 S3 Action 27개 모두 AWS 공식 서비스 참조에서 bucket 리소스 및 해당 조건 키 지원을 확인했다.

## 지금과 이후의 비밀값 관리

AWS 계정 ID와 리소스 ARN은 로그인 비밀키가 아니다. 그래도 공개 문서에는 실제 계정 값을 복사하지 않는다. 콘솔 화면에 계정 ID가 보인다고 Access Key/Secret Key가 노출된 것은 아니다.

실제 값은 Git 제외 파일에만 넣는다. **추적 중인 `.example`, `.template.json`, README, Jenkinsfile 등에 비밀값을 직접 입력하면 `.gitignore`가 보호하지 않는다.** `git add -f`도 제외 규칙을 우회한다. 다음 push 전에도 변경 diff와 비밀정보 검사를 수행해야 한다. 로컬 정책 생성기는 계정 ID만 필요하며 Access Key·Secret Key·비밀번호를 입력받지 않는다.

이번 검사의 범위 밖: 삭제된 원격 refs와 도달 불가능한 객체, 포크·외부 캐시, 스크린샷 전체, CI 실행 로그/아티팩트, AWS 계정 접근 기록, 로컬 PC의 모든 파일. 검사 결과만으로 활성 키의 존재·폐기 상태나 제3자 접근 이력을 단정하지 않는다.

## 정책 생성 화면의 안내 해석

`명시적 거부`에 **`aws:SecureTransport | Bool | false`**가 표시되는 것은 의도한 HTTP 차단이다. HTTPS 요청까지 모두 거부하는 설정이 아니다. 이 Deny는 유지한다.

상단의 “권한을 제공하지 않는 일부 작업, 리소스 또는 조건” 안내는 단순히 무시할 문구는 아니다. 이번 로컬 JSON을 대조한 결과 Allow 27개에는 지원되지 않는 Action/리소스/조건 조합이 없었다. Deny의 `s3:*`에는 `ListAllMyBuckets`, `GetAccountPublicAccessBlock`처럼 지정 버킷/객체 ARN에 적용되지 않는 작업도 포함된다. 공식 참조에서 이처럼 버킷/객체에 해당하지 않는 Action은 74개였다. **이 wildcard Deny가 요약 안내의 원인으로 추정된다.** 제공된 화면은 개별 미적용 작업까지 펼쳐져 있지 않아 콘솔이 지목한 목록을 직접 확인한 것은 아니다.

생성기가 만든 JSON을 그대로 사용했다면 위 요약만을 이유로 HTTP Deny를 삭제하거나 Resource를 `*`로 넓힐 필요는 없다. `나머지 표시`로 미적용 작업을 펼쳐 확인할 수 있다. 실제 JSON 편집기 오류가 있거나 Allow 작업이 미적용으로 나오면 원인을 다시 확인한다. 정책 생성 이후 Role 연결과 실제 AssumeRole/bootstrap plan 검증은 별도 단계이며 아직 수행하지 않았다.

근거: [Gitleaks 검사 옵션](https://github.com/gitleaks/gitleaks), [AWS 정책 요약 경고](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_understand-policy-summary.html), [S3 권한 참조](https://docs.aws.amazon.com/service-authorization/latest/reference/list_s3.html), [HTTP 차단 정책](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingEncryptionInTransit.html), [AWS 계정 ID의 성격](https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-identifiers.html).
