# Jenkins에서 Vercel REST API로 정적 배포하기

2026-11-17. 사용자가 공식 REST API 전환을 선택했다. Jenkins와 Vercel은 유지하고, **토큰을 받는 Vercel CLI와 전용 package/lockfile을 제거**한다. 이 문서는 현재 실행 경로이며, [CLI 조사 기록](vercel-security-review.md)은 전환 이유를 보존한다.

## 왜 바꾸었나

현재 CLI와 최신 후보 모두 npm audit 영향 패키지 38개가 남았다. overrides로 숫자를 줄여도 번들·native 코드까지 수정됐다는 근거가 없었다. 이 앱은 Vue 정적 파일만 배포하므로 CLI의 다양한 빌드 기능 대신 필요한 공식 API만 호출한다.

| 유지한 것 | 바뀐 것 |
|---|---|
| Jenkins 테스트·빌드, Vercel CDN·도메인 | CLI 설치/실행 대신 Node 22 기본 fetch |
| FE 산출물 hash·SPA 경로·없는 자산 404 | 검증한 파일을 `public/` 아래에 업로드 |
| 토큰 없는 빌드, 배포 단계에서만 토큰 바인딩 | 전용 CLI 의존성·lockfile·CLI audit 단계 삭제 |
| 실제 계정·도메인·CORS 사전 확인 | REST 완료/오류/시간 초과 처리를 직접 관리 |

CLI를 패치한 것이 아니라 실행 의존성에서 제거했다. FE 빌드 도구의 권고, Node 자체와 Jenkins 호스트의 보안 검토는 여전히 필요하다. 더 빠르거나 저렴해졌다는 측정 결과는 없다.

## 실행 흐름과 파일 역할

```text
FE main → Jenkins 테스트·lint·build·package (토큰 없음)
        → 산출물 검증·바이트 확보 → 프로젝트/도메인/API CORS 확인
        → POST /v2/files → POST /v13/deployments (한 번)
        → GET /v13/deployments/{id} 대기
        → READY + aliasAssigned → 운영 alias의 배포 ID 확인 → 운영 HTML·JS·SPA·404 smoke
        → .local/frontend-deployment.json 기록
```

`scripts/vercel-deploy.mjs`는 기존 FE의 `.vercel/output/static`과 `config.json`, `.local/build-evidence.json`을 읽는다. 이 디렉터리는 기존 패키징 계약으로 유지하지만 REST API에 Build Output API/`prebuilt` 필드를 보내지는 않는다. FE 코드나 package 스크립트 수정은 필요하지 않다.

`prepareUpload`는 검증한 바이트를 메모리에 확보하고 SHA256을 다시 비교한다. 업로드 도중 바뀐 파일을 새로 읽지 않는다. 파일은 `public/index.html`, `public/js/...`처럼 전달하고 Infra가 만든 `vercel.json`만 루트에 추가한다. 앱 소스·package.json·node_modules·Functions·로컬 환경 파일은 목록에 넣지 않는다. 파일 API가 요구하는 SHA1은 업로드 식별자로만 쓰고, 기존 SHA256 증거를 유지한다.

생성 설정은 `framework=null`, `installCommand=""`, `buildCommand=""`, `outputDirectory="public"`이다. 원격에서 npm 설치나 앱 재빌드를 하지 않도록 명시한다. 생성 요청의 `projectSettings`에는 `rootDirectory=null`, `nodeVersion=22.x`도 지정한다. **이 설정은 Vercel 프로젝트 설정에 저장될 수 있으므로 전용 프로젝트를 사용한다.** FE 저장소의 수동 source-build용 vercel.json은 이 경로에서 업로드하지 않는다.

라우팅은 기존과 같이 실제 파일 → 없는 js/css/img/fonts 404 → SPA index 순서다. 기존 `handle: filesystem`은 공식 스키마에서 허용하지만 문서상 deprecated다. 이번에는 라우팅 정책까지 변경하지 않고 보존한다. `git.deploymentEnabled=false`도 생성 설정에 포함한다. 기존 Git 연결·Deploy Hook 등 다른 배포 경로는 실제 프로젝트에서 별도로 확인한다.

## 실패와 비용을 다루는 방식

- 파일 수 1000개·총 64MiB는 이 실습의 자체 한도다. Vercel 상품 한도라는 뜻이 아니다. 현재 산출물은 12개, 8,187,133바이트다.
- 파일은 순차 전송하고 동일 SHA1은 한 번 전송한다. 업로드 실패 시 배포 생성으로 넘어가지 않는다.
- 업로드부터 완료 대기까지 최대 10분, 개별 요청 최대 30초, 상태 조회 간격은 3초다. 401·429·5xx 등 HTTP 실패는 자동 재시도하지 않는다.
- 생성 POST는 응답 유실 시 서버에 접수됐을 수도 있다. `creationOutcome=unknown`과 실패 단계를 기록하며 자동 재생성하지 않는다. 재실행 전 Vercel 배포 목록과 FE SHA를 확인한다.
- 접수 뒤에는 배포 ID를 기록한다. ERROR/CANCELED/BLOCKED, 도메인 연결 오류, 대상 프로젝트·팀 불일치는 실패다. READY여도 도메인 연결 완료 전에는 성공으로 처리하지 않는다. 이어 운영 호스트의 alias를 조회해 이번 배포 ID인지 확인한다. 같은 파일을 제공하는 이전 배포를 성공으로 오인하지 않는다.
- 시간 초과는 원격 작업 취소를 의미하지 않는다. 실제 Vercel 상태를 확인한 뒤 필요하면 취소한다. 자동 삭제·롤백은 하지 않는다.
- 운영 도메인은 smoke보다 먼저 전환될 수 있다. smoke 실패 시 보고서 ID로 상태를 확인하고, Vercel에서 검증된 이전 배포로 복구한 뒤 smoke를 다시 확인한다. 이 단계는 무중단 보장이 아니다.

새 AWS 서비스나 유료 빌드 머신 옵션은 추가하지 않았다. 원격 설치/빌드 명령 생략이 Vercel의 모든 처리·트래픽이 무료라는 의미는 아니다. 계정 플랜·한도·배포 사용량은 실제 가동 전에 확인한다.

## 비밀값 경계

토큰은 Jenkins Secret text → Node 프로세스 메모리 → 고정 `https://api.vercel.com`의 Authorization 헤더로만 사용한다. 명령 인자·요청 JSON·산출물·보고서에 넣지 않는다. 리다이렉트는 거부하며 API CORS/smoke 요청에는 전달하지 않는다. Git 자식 프로세스에는 Vercel/AWS/GitHub 키나 Node 실행·TLS 우회 변수를 넘기지 않는다.

외부 오류 본문·예외 원문은 출력하지 않는다. 단계, 고정 메시지, HTTP 상태, 검증된 배포 ID/URL로 진단한다. 같은 Jenkins 사용자·Docker 권한·EC2 역할의 접근까지 격리한 것은 아니다. 프론트 파일 자체에 하드코딩한 비밀을 이 도구가 모두 탐지하는 것도 아니다.

## 확인한 범위

Node 22.23.4에서 Infra 검사 **51개 통과**(실패·건너뜀 0), 이 중 Vercel 배포 검사는 25개다. 정상 흐름 외에 업로드 거부, 인증 실패, 생성 응답 유실, 시간 초과, 오류 상태, 지연된 도메인 연결, 이전 배포를 가리키는 alias, 잘못된 대상/URL, 오래된 HTML, JS MIME, 산출물 변경·junction 및 비밀 원문 비노출을 확인했다. 기존 Helm 렌더링·GitOps·관측·비용·plan 검사도 포함한다.

기존 로컬 FE 산출물 12개를 그대로 검증했고 생성 설정을 포함해 13개 업로드 항목을 만들었다. 새 FE 빌드를 수행했다고 주장하지 않는다. 공식 OpenAPI 생성 요청 스키마와 공식 vercel.json의 **사용 필드 하위 스키마**를 대조했고, 알 수 없는 필드는 거부됐다. 전체 설정 스키마는 draft-04 선언과 미사용 experimental 필드의 새 문법이 혼재해 사용 부분만 검증했다. [계약 검증 근거](security-evidence/vercel-rest-2026-11-17.json)에 출처·해시·범위를 기록했다.

모의 요청은 실제 서비스의 수락·CDN 동작을 증명하지 않는다. 실제 Jenkins 서버/Declarative linter, Vercel 인증·업로드·도메인 연결·서버 라우팅과 AWS 생성은 미실행이다. `deploymentEnabled=false`, project/org ID 미입력 상태를 유지한다.

## 다음 실제 실행 전 준비

1. 이 PR 검토·병합 후 Jenkins가 Infra main을 읽도록 한다.
2. 전용 Vercel 프로젝트·Team ID, 실제 토큰 권한/만료, Git 중복 배포 비활성, 도메인 소유권/DNS를 확인한다.
3. 실제 API HTTPS·CORS와 환경변수를 확인한다. 공개 ID는 설정 파일, 토큰은 Jenkins Credential에만 입력한다.
4. 설정 변경을 검토한 후 배포를 활성화한다. 처음에는 한 번 실행하고 보고서·도메인·정적 hash·브라우저 API를 확인한다.

이후 반복 실행과 배포 시간 측정은 실제 성공을 확인한 뒤 시작한다. REST 전환 승인만으로 계정 생성이나 운영 배포를 실행하지 않았다.

공식 근거: [파일 업로드](https://vercel.com/docs/rest-api/deployments/upload-deployment-files), [배포 생성](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment), [배포 상태](https://vercel.com/docs/rest-api/deployments/get-a-deployment-by-id-or-url), [도메인 alias 조회](https://vercel.com/docs/rest-api/aliases/get-an-alias), [빌드 생략](https://vercel.com/docs/builds/configure-a-build), [설정과 라우팅](https://vercel.com/docs/project-configuration/vercel-json).
