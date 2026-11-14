# 자격증명·접근 권한 점검

점검일: 2026-11-14 KST. 대상은 OrderPage BE/FE/Infra DevOps의 GitHub 원격 브랜치와 로컬 재시작 checkout이다. 이전 로컬 checkout과 원본 `order-*-deploy`에서는 알려진 키 형식만 추가 검색했다. 이 점검은 실제 AWS/Vercel/Jenkins 계정의 내부 설정이나 PC의 다른 사용자가 가진 파일 권한까지 증명하지 않는다.

## 확인한 현재 상태

| 대상 | 확인 결과 |
|---|---|
| GitHub 저장소 | 세 저장소 모두 공개. 각 저장소의 협업자 목록은 `leem5514` 관리자 1명, deploy key 0개, GitHub Actions secret 0개. Secret scanning과 push protection이 활성화됐고 조회 가능한 미해결 alert는 0개였다. |
| Git 원격·이력·PR | HTTPS 원격 URL에 사용자명/토큰이 없었다. 모든 원격 브랜치를 가져와 커밋 이력의 AWS access key, GitHub PAT, 개인키 등 알려진 형식을 검색했다. 발견된 형식 일치는 테스트용 URL 문자열뿐이며 실제 키로 확인된 것은 없다. 공개 PR 14개의 제목·본문과 일반 댓글(0개)에서도 해당 키 형식은 없었다. |
| 현재 로컬 입력 | AWS/GitHub/Vercel 관련 환경 변수 이름의 값은 현재 셸에 없었다. 실제 `terraform.tfvars`, `backend.hcl`, `.tfplan`, bootstrap 변수, `.local/secrets/backend.env`도 없었다. 이전 AWS `default` 프로필은 인증 실패였고, 로컬 Git 자격증명은 저장소 파일이 아닌 OS 자격증명 경로에서 사용한다. |
| 배포 자격증명 흐름 | Jenkins의 GitHub/Vercel 토큰은 `withCredentials` 구간에만 바인딩한다. Jenkins EC2는 인스턴스 역할로 ECR에 접근하고, Backend Pod는 IRSA로 상품 이미지 버킷에 `PutObject`만 한다. 로컬 AWS 프로필을 Pod나 Jenkins에 복사하는 경로는 없다. |
| 공개 접근 | 상품 이미지 전용 S3는 사용자가 선택한 대로 HTTPS `GetObject`만 공개한다. 객체 키를 아는 누구나 이미지를 읽을 수 있다. Terraform state 버킷은 공개 접근 차단과 암호화가 설정돼 있다. EKS 관리 Role은 클러스터 관리자 권한이므로 지정할 ARN과 AssumeRole 권한을 별도로 확인해야 한다. |

GitHub의 alert 0개나 패턴 검색 통과는 **유출이 절대 없었다는 보증이 아니다**. 사용자 정의 DB/JWT 암호, 짧은 키, 로그/스크린샷, 오래된 별도 저장소, Jenkins/Vercel/AWS 계정 안의 비밀은 이 검색으로 완전히 판단할 수 없다. GitHub push protection도 인식하는 비밀 형식에만 적용되고 사용자가 우회할 수 있다.

## 실제 값을 채울 때 Git 노출 경로

| 값의 위치 | `git add .` 결과 | 안전한 입력 경로 |
|---|---|---|
| Infra `terraform/envs/dev/terraform.tfvars`, `backend.hcl`, `*.tfplan`, `*.tfstate` | `.gitignore`로 제외 | 해당 파일과 S3 원격 state의 읽기 권한을 운영자에게 제한. `sensitive = true`는 state 안의 값 제거가 아니다. |
| Infra `.local/secrets/backend.env`, `.local/plan-reviews/*` | `.local/`로 제외 | Secret 파일은 이 경로에만 만들고 `kubectl --from-env-file`로 전달한다. |
| BE/FE `.env`, `.env.production`, `.env.local` 등과 BE의 별도 `application-*.yml` | 보강한 `.gitignore`로 제외 | FE의 `VUE_APP_*` 값은 정적 JS에 노출되므로 API 공개 주소만 넣는다. 토큰은 Jenkins credential에 둔다. |
| Infra `k8s/backend-secret.env`, `k8s/**/secret.yaml`, Jenkins `.env`, 개인키 파일 | 보강한 `.gitignore`로 제외 | Secret manifest나 개인키는 GitOps 저장소에 만들지 않는다. |
| **이미 추적 중인** `.env.example`, `backend-secret.env.example`, `terraform.tfvars.example`, `backend.hcl.example`, `application.yml`, Jenkinsfile, GitOps 설정 | **값을 수정해 커밋하면 공개 GitHub에 그대로 노출** | 예시 파일은 예시만 유지하고, 새 실제 파일을 별도 이름으로 만든다. 추적 중인 파일에는 `.gitignore`가 적용되지 않는다. |

`git add -f`는 ignore를 우회한다. 커밋/PR을 올리기 전 `git status --short`와 `git diff --cached --name-only`로 파일 이름을 확인한다. 의심 파일의 내용을 터미널 로그나 채팅에 복사하지 않는다. 키를 한 번이라도 공개 커밋/PR/빌드 로그에 넣었다면 삭제 커밋만으로 끝나지 않으므로 **먼저 발급처에서 폐기·재발급**하고, 영향 범위와 이력/아티팩트를 확인한다.

## 배포 전에 다시 확인할 것

1. 운영자 AWS Role은 필요한 계정에만 AssumeRole 가능하게 설정하고 EKS 관리자 ARN이 의도한 주체인지 확인한다. `AWS_PROFILE`/STS 계정과 Terraform backend/provider 계정이 동일해야 한다.
2. Terraform `plan`/state에는 DB·Redis·MQ 비밀번호가 포함될 수 있다. Git, PR, Jenkins artifact, 채팅에 첨부하지 않는다. 원격 S3 state 접근 정책과 보존 버전을 확인한다.
3. BE `compose.yaml`의 DB `1234`, RabbitMQ `guest`, 개발용 JWT 값은 로컬 데모 전용이다. 포트는 localhost에만 바인딩하도록 보강했지만 이 값을 EKS Secret에 복사하지 않는다.
4. BE Dockerfile은 `src`를 이미지에 포함한다. `.dockerignore`로 로컬 환경 파일과 별도 프로필 YAML을 제외했지만 **이미 추적된 `application.yml`에 비밀값을 넣으면 JAR/ECR에도 들어간다**.
5. BE `application.yml`의 공개 개발용 JWT 기본값을 운영에서 쓰면 해당 키를 아는 사람이 권한 claim이 있는 토큰을 만들 수 있다. K8s Deployment는 필수 Secret key 7개를 각각 참조해 누락 시 Pod 시작을 막는다. 배포 전에 `.local/secrets/backend.env` 검증을 통과시키고 실제 Pod의 키 주입 상태를 값 출력 없이 확인해야 한다. K8s 외부 실행에서는 여전히 별도 강제가 필요하다.
6. FE는 로그인/갱신 토큰을 `localStorage`에 보관한다. Git에 토큰을 올리는 경로는 아니지만, 같은 origin에서 실행된 악성 스크립트가 사용자 세션을 읽을 수 있다. 이 점검은 전체 XSS 검증을 대신하지 않는다.
7. 배포용 Jenkins credential 저장소/사용자 권한, Vercel 팀 접근자, AWS IAM 사용자/Role 및 S3 bucket policy는 실제 계정 연결 후 별도 조회한다. 지금은 코드와 GitHub 저장소 상태까지만 확인했다.
