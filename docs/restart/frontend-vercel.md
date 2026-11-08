# 8단계: 기존 PR 병합과 프론트 Jenkins → Vercel 배포 준비

기준일: 2026-11-08 KST. 사용자가 기존 PR의 순차 병합과 다음 작업을 요청했다.
이번 단계는 프론트엔드 CI/CD 코드와 로컬 검증이다. 실제 Vercel 프로젝트 생성/업로드/도메인 변경, AWS 생성은 실행하지 않았다.

## 1. 기존 PR 병합 결과

검증 당시 HEAD와 일치하는지 다시 확인하고 #2 → #3 → #4 → #5 순서로 main에 merge commit으로 병합했다.
각 PR에는 GitHub 검사 Job이 등록되어 있지 않았다. 이전 로컬/mock 검증을 근거로 병합했으며 GitHub CI가 통과했다고 해석하지 않는다.
연속 PR의 base를 앞선 병합 후 main으로 변경해 한국어 커밋 이력을 유지했다.

| PR | 내용 | main 병합 commit |
|---|---|---|
| [#2](https://github.com/leem5514/OrderPage_Infra_DevOps/pull/2) | Terraform 기반 | 2fd9d0fa4f56dd82f00261bcc7fee6effe30748c |
| [#3](https://github.com/leem5514/OrderPage_Infra_DevOps/pull/3) | 관리형 데이터 | b368f607259482b949ee5a9fd21571e56e4d48f3 |
| [#4](https://github.com/leem5514/OrderPage_Infra_DevOps/pull/4) | HTTPS·IRSA·이미지 | 1dc89cd24a73e5e81ef61de66e7aa34025a84728 |
| [#5](https://github.com/leem5514/OrderPage_Infra_DevOps/pull/5) | EC2 Jenkins·Argo CD | 0ffb17c44ffe1bdf90dfca3c1d763141b8275564 |

최종 main의 파일 내용은 검증한 52b360f와 동일했다. 병합은 AWS 배포 실행이 아니다.
그 main에서 Infra codex/frontend-vercel, FE main에서 codex/vercel-deployment로 이번 작업을 분리했다.
새 작업 PR은 기존 4개 PR의 병합 요청과 구분한다.

## 2. 실제 요청 경로와 Vercel 선택 이유

브라우저 → Vercel CDN: Vue HTML/JS/CSS/폰트/이미지 등 정적 파일.
브라우저 → api-devops.auctionbid.shop → 서울 ALB/EKS: API와 SSE.
상품 이미지는 기존 앱에 저장된 전용 S3 URL을 브라우저가 직접 읽는다.

이 앱은 Next.js/SSR/Functions를 사용하지 않는 Vue SPA다. 정적 파일은 CDN에서 제공되므로 Functions 리전을 서울로 지정한다고 정적 파일 전체를 서울에서만 제공하는 것은 아니다.
Jenkins EC2의 위치도 사용자의 API 요청 경로가 아니다. Vercel을 통한 API rewrite/proxy나 Function을 추가하지 않았으므로 현재 설계에서 API가 Vercel 서버 리전을 경유하지 않는다.
사용자의 실제 위치, DNS, CDN cache hit/miss, ISP에 따라 정적 파일 경로와 지연은 달라지며 특정 PoP나 한국 내 전달을 보장하지 않는다.

| 선택 | 이번 프로젝트에서의 판단 |
|---|---|
| Vercel | 정적 배포 버전/도메인/인증서 운영을 플랫폼에 맡기고 EKS·Terraform·관측 실험에 집중. Jenkins 검증 결과물을 CLI로 업로드 |
| S3 + CloudFront | AWS 안에서 OAC·버킷 정책·배포/캐시 무효화·인증서·SPA 라우팅을 직접 구성할 경험과 제어권이 늘어남 |

Vercel이 더 빠르거나 저렴하다고 측정 없이 주장하지 않는다. 실제 비교 시 같은 dist/브라우저 위치/네트워크/캐시 조건을 사용한다.
Vercel 요금/사용량은 AWS Cost Explorer에서 보이지 않으므로 별도 기록한다. 실제 계정의 플랜·이용 조건·배포 제한은 가동 전에 확인한다.

## 3. 파일과 책임

FE 저장소:

- vercel.json: Git 자동 배포 OFF. Jenkins와 중복된 배포 방지. 수동 source build에는 build:production 사용.
- scripts/check-production-env.cjs: 운영 API HTTPS/origin과 VUE_APP 변수 검사. CI에 로컬 .env 파일 혼입 금지.
- scripts/package-vercel.cjs: 검증한 dist를 Build Output API v3의 .vercel/output/static으로 복사.
- .vercel/output/config.json: 실제 파일 우선, 없는 js/css/img/fonts는 404, SPA 경로는 index.html.
- .local/build-evidence.json: API origin, Node 버전, UTC 시각, 파일별 byte/hash와 전체 산출물 hash.
- .nvmrc=22, 생성된 .local/.vercel은 Git 제외. 기존 앱 소스와 성능 알고리즘/의존성 버전은 수정하지 않음.

Infra 저장소:

- jenkins/Jenkinsfile.frontend: FE main polling, 테스트/lint/build/package, 활성화된 경우만 운영 배포.
- jenkins/frontend-settings.json: API/FE origin, Vercel project/org ID, deploymentEnabled. 비밀번호/token 금지.
- jenkins/vercel-cli: 공식 CLI 65.12.1을 별도 package-lock으로 고정. FE 의존성에 추가하지 않음.
- scripts/ci-frontend.sh: Node 22 검증과 실패 중단, TAP 및 CI 시작/종료/exit code 보관.
- scripts/vercel-deploy.mjs: 산출물 변경 검사, Vercel 계정/도메인/API CORS 확인, CLI 배포, 실제 도메인 smoke.

환경변수는 빌드 시 브라우저 JS에 박힌다. API 주소를 바꾸면 반드시 다시 빌드해야 한다.
VUE_APP_API_BASIC_URL만 공개 변수로 허용한다. 다른 VUE_APP_* 변수나 비밀값을 프론트 번들에 넣지 않는다.
클라이언트 소스나 public 폴더에 직접 작성한 비밀 문자열까지 자동 탐지하는 도구는 아니다. 원본 코드 검토도 필요하다.

## 4. Jenkins 구성 순서 — 실제 실행 전

1. 이번 FE PR을 main에 병합한 후 Infra PR을 병합한다. 기존 FE main에는 새 build:production/package:vercel 명령이 없으므로 먼저 준비해야 한다.
2. 기존 EC2 Jenkins의 orderpage-ci agent/Node 22를 사용한다. agent executor=1이므로 BE/FE Job이 동시에 메모리를 사용하지 않는다.
3. Pipeline from SCM은 Infra main, Script Path=jenkins/Jenkinsfile.frontend로 지정한다.
4. Infra checkout은 poll=false, FE main만 5분 polling. 최초 한 번 Build Now가 필요하다. Infra 설정만 바꾼 경우 수동 재실행한다.
5. 현재 deploymentEnabled=false이므로 Vercel token 없이 FE 테스트·빌드·정적 패키지까지만 실행한다.
6. 실제 Vercel 프로젝트를 준비하고 project ID(prj_), Team/Organization ID(team_)를 확인한다. 임의 ID로 배포하지 않는다.
7. 사용할 devops.auctionbid.shop이 비어 있는지 확인한 뒤 Vercel의 해당 프로젝트 안내값으로 DNS를 연결한다. 기존 apex/서비스를 덮어쓰지 않는다.
8. 실제 API HTTPS/인증서/기능과 Backend CORS_ALLOWED_ORIGINS의 FE origin을 확인한다.
9. Jenkins의 FE Job 전용 Folder에 Secret text credential orderpage-vercel-token을 등록한다. 해당 Vercel team/프로젝트에 필요한 범위와 짧은 만료를 사용한다. 개인 access token의 실제 권한 범위는 계정 기능에 따라 달라지므로 프로젝트 전용 권한이라고 가정하지 않는다.
10. frontend-settings.json의 실제 ID와 origin을 검토한 후 deploymentEnabled=true로 변경/병합한다. 이후 FE main 변경이 운영 배포를 유발한다.

Vercel 자동 Git 배포는 vercel.json의 git.deploymentEnabled=false로 끈다. 기존 프로젝트의 Deploy Hook 등 별도 자동화도 확인한다.
Vercel에 Git 저장소를 연결해 처음 import하는 경우 초기 배포가 별도로 시작될 수 있으므로 프로젝트 준비 시 확인한다.
운영 연결 이후 main 병합이 배포 승인 경계다. CI 단계에 별도 대기 승인을 넣지 않는다.

## 5. 한 번의 실행에서 일어나는 일

1. 새 workspace에 Infra/FE main checkout. FE 테스트/빌드 단계에는 VERCEL_TOKEN을 주입하지 않는다.
2. npm ci → 인증/배포 테스트 → lint --no-fix → 운영 API 검사 → production build → 정적 output 생성.
3. enabled=false이면 여기서 종료. 성공은 빌드 성공이지 배포 완료가 아니다.
4. enabled=true이면 별도 lockfile의 Vercel CLI를 설치한다.
5. 자격증명 단계에서 정적 파일 hash/라우팅/FE commit/추적 파일 변경 여부를 확인한다. functions가 있거나 빌드 후 파일이 바뀌면 중단한다.
6. Vercel 프로젝트의 accountId와 연결 도메인의 projectId/name/verified/Production 범위를 조회한다. 읽기 요청이며 프로젝트/도메인을 자동 생성·수정하지 않는다.
7. API /product/list에 FE origin으로 OPTIONS를 보내 정확한 Allow-Origin, GET, authorization/content-type 헤더를 확인한다.
8. vercel deploy --prebuilt --prod --yes로 검증한 정적 output만 업로드한다. 프로젝트 연결 파일에는 공개 ID만 기록한다.
9. 운영 도메인의 /, /login, /product/list가 이번 index.html hash를 제공하는지 확인한다. JS MIME/hash와 없는 JS의 404도 검사한다.

Build Output API v3를 직접 생성하므로 vercel pull/build를 다시 실행하지 않는다. Jenkins에서 테스트한 dist를 재빌드하지 않고 올리기 위함이다.
Vercel Dashboard 환경변수 변경만으로 이미 생성된 dist가 바뀌지 않는다. System Environment Variables/SSR/Functions 기능이 생기면 이 방식의 적합성을 다시 검토한다.
고정 CLI는 VERCEL_TOKEN 환경변수를 지원한다. --token 인자나 auth.json에 token을 기록하지 않는다. 전역 CLI 설정 경로도 .local 안으로 분리한다.

## 6. 실패와 복구

- 테스트/lint/build/package 실패 → 이후 단계 중단. tee가 테스트 실패를 숨기지 않게 pipefail 사용.
- 산출물/계정/도메인/CORS 사전 검사 실패 → deploy 명령 실행 안 함.
- Vercel API/CLI 실패 → 실패 기록. 오류 메시지의 token을 마스킹하고 API 응답 전체를 저장하지 않음.
- --prod 성공은 Production 도메인 전환을 포함한다. 후속 smoke 실패 시 이미 전환됐을 수 있으며 자동 rollback하지 않는다.
- 실패한 deployment URL/FE SHA/산출물 hash를 보고 Vercel의 이전 정상 Production deployment로 복구한다. 복구 기능과 허용 범위는 실제 플랜/프로젝트에서 확인한다. 복구 후 동일 smoke/기능 검사를 수행한다.
- 운영 도메인에 Deployment Protection을 걸어 인증 페이지를 제공하면 공개 smoke가 실패한다. 검증을 우회하거나 보호를 자동으로 해제하지 않는다.
- Frontend가 공개 정적 페이지라는 전제의 점검이다. 로그인/주문/토큰 갱신/SSE/이미지까지 검증한 결과가 아니다. 실제 브라우저 통합 검증은 배포 후 별도로 한다.

## 7. 기록과 비교

| 기록 | 활용 |
|---|---|
| frontend-tests.tap | 인증/배포 테스트 결과 |
| frontend-ci.json | 설치부터 패키징까지 전체 구간 시작/종료/exit code |
| build-evidence.json | API origin, Node 버전, 파일 크기/hash, 생성 시각 |
| frontend-deployment.json | FE commit, project, artifact hash, deployment URL, 단계/결과/UTC 시각 |

Jenkins archive에는 이 파일들만 보관한다. .vercel 전체, token, 프로젝트의 환경변수를 artifact로 보관하지 않는다.
실패가 다른 단계에서 났다면 일부 파일이 없을 수 있으며 Jenkins 로그로 함께 확인한다.

수동 vs Jenkins 비교는 같은 FE commit/API URL/Node 버전/lockfile을 사용한다. 캐시 유무와 install 시간을 분리해 해석한다.
commit → Jenkins polling/queue → 테스트·빌드·패키징 → Vercel 업로드/Production 전환 → smoke 완료를 기록한다.
Vercel vs S3+CloudFront 비교를 실제 수행할 경우 같은 정적 파일을 사용하고 브라우저 위치/캐시·DNS 조건을 기록한다. CDN 자체 개선율은 아직 없다.
이번 실제 로컬 빌드는 Windows Node 22.23.4이며 Jenkins Linux 실행시간과 직접 비교하지 않는다.

## 8. 검증 결과 및 미실행 범위

- FE Node 22.23.4: 테스트 9개, lint, production build, 정적 파일 12개 패키지 생성 통과.
- 기존 Browserslist 오래된 데이터/번들 크기 경고 3개 유지. 성능 개선이나 의존성 일괄 업그레이드는 하지 않음.
- Infra Vercel 배포 모의 테스트 10개 통과: 계정/도메인/CORS/dirty checkout/변경 산출물/CLI/이전 HTML/JS MIME/정상 경로.
- 기존 Kubernetes/GitOps 검사 13개를 포함한 Infra npm test 총 23개 통과.
- FE CI shell 모의 시나리오 6개 통과: 정상, install/test/lint/build/package 실패. 실제 npm/Vercel 실행은 이 mock 검사에 포함되지 않음.
- 고정 Vercel CLI 버전/도움말 실행 확인. --dry --prebuilt는 자격증명이 없어 거부됐으며 업로드/프로젝트 생성은 없었음.
- Jenkins 서버 실행/Declarative linter, Vercel 실제 인증·배포·CDN 라우팅, 브라우저 API 왕복, DNS/비용 실측은 미실행.

현재 stage의 테스트는 개선율 측정이 아니다. 실제 비교 실험 전에 관측 설정과 baseline 시나리오를 준비한다.
다음은 CloudWatch/SNS·Prometheus/Grafana 및 비용 관측 구성이다.

## 9. 공식 근거

- [Build Output API 설정](https://vercel.com/docs/build-output-api/configuration)
- [Vercel CLI deploy](https://vercel.com/docs/cli/deploy), [CLI 전역 설정](https://vercel.com/docs/cli/global-options)
- [Git 자동 배포 제어](https://vercel.com/docs/project-configuration/git-configuration)
- [프로젝트 조회](https://vercel.com/docs/rest-api/projects/find-a-project-by-id-or-name), [도메인 조회](https://vercel.com/docs/rest-api/projects/get-a-project-domain)
- [Vue CLI 환경변수](https://cli.vuejs.org/guide/mode-and-env.html)
- [Vercel CDN](https://vercel.com/docs/cdn), [Functions 리전](https://vercel.com/docs/functions/configuring-functions/region)
