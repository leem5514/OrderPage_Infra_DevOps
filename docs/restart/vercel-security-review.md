# Vercel 배포 도구 보안 재검토

> 후속 결정: 사용자가 공식 REST API 전환을 승인했다. CLI·전용 lockfile·설치 단계를 제거했으며 [현재 구현과 검증](vercel-rest-deployment.md)을 따른다. 아래는 전환 전 조사·차단 기록이며 upstream CLI 취약점이 패치됐다는 뜻이 아니다.

2026-11-17. BE #6과 Infra #16은 main에 병합했다. 이번에는 실제 배포 토큰을 받는 Vercel CLI를 점검했다. **CLI 권고는 아직 해결되지 않았으며, 실제 배포 활성화는 보류한다.**

## 최신 버전으로 바꾸면 끝나는가

같은 날 공식 npm 레지스트리로 현재 고정 버전 65.12.1과 최신 안정 후보 65.17.0을 비교했다. 후보는 저장소 밖 임시 폴더에서 설치·검사했고 실제 lockfile에는 적용하지 않았다.

| 대상 | npm audit의 영향 패키지 항목 | 판정 |
|---|---|---|
| 현재 65.12.1 | critical 1 / high 21 / moderate 16 = 38 | 실제 토큰 사용 보류 |
| 후보 65.17.0 | critical 1 / high 21 / moderate 16 = 38 | 버전 갱신만으로 해결되지 않음 |

이는 취약점 38개를 실제 공격으로 재현했다는 뜻이 아니다. 상위 패키지에 전파된 항목까지 포함하는 npm 수치다. 직접 advisory URL을 중복 제거한 목록, 패키지 경로와 lockfile 해시는 [검사 근거 JSON](security-evidence/vercel-cli-2026-11-17.json)에 보관했다.

실제 설치된 `vercel/dist/vc.js`도 확인했다. 이 파일은 플랫폼별 native 실행 파일 또는 `@vercel/cli-support`의 JS 번들로 연결한다. 따라서 npm overrides로 외부 패키지 버전을 바꿔 audit 숫자가 줄더라도, 이미 묶인 코드와 native 실행 파일까지 수정됐다고 결론 낼 수 없다. 이번에는 무리한 주요 버전 override, 자동 `--force` 다운그레이드, 설치 파일 직접 수정을 하지 않았다.

대표적인 critical 항목은 node-tar의 압축 해제/파싱 자원 소진이다. 현재 프로젝트는 `--prebuilt` 정적 배포이며 archive 옵션·Functions 빌드를 사용하지 않는다. 그러나 이 사실만으로 CLI의 초기화·다운로드·번들 내부 모든 경로가 안전하다고 입증한 것은 아니다. 임의의 예외 목록으로 배포 보류를 해제하지 않았다.

## 먼저 적용한 보호

Jenkins의 Vercel 단계는 다음 순서로 실행한다.

`CLI 설치(스크립트 실행 금지) → npm audit → Vercel 토큰 바인딩 → 대상 사전 확인 → 배포 → 도메인 smoke`

`npm audit --audit-level=high`에서 high/critical이 있거나 조회가 실패하면 이후 단계로 가지 않는다. **현재 lockfile로는 의도적으로 중단된다.** moderate까지 모두 없다는 뜻이나 native 바이너리 검사를 대신하는 것은 아니다. 현재 `deploymentEnabled=false`도 유지한다.

배포 스크립트에서는 별도의 세 가지 위험을 보완했다.

- `.vercel/output/static` 내부 파일뿐 아니라 상위 산출물 디렉터리와 설정 파일 자체의 symlink도 거부한다. 예상한 정적 폴더 대신 외부 파일이 올라가지 않게 한다.
- CLI에는 실행에 필요한 경로·임시 폴더·로케일과 해당 Vercel 자격증명만 넘긴다. AWS/GitHub 키, `NODE_OPTIONS`, TLS 검증 우회 변수는 상속하지 않는다. Git 읽기 명령에는 Vercel 토큰도 넘기지 않는다.
- 외부 API/CLI 오류 원문은 보고서·콘솔에 남기지 않는다. 알려진 토큰 한 개만 문자열 치환하면 다른 비밀이 남을 수 있으므로 직접 작성한 메시지만 기록한다.

같은 호스트의 프로세스를 완전히 격리한 것은 아니다. Jenkins 계정·Docker 권한·EC2 역할의 실제 접근 범위는 별도 확인 대상이다. 기업용 proxy나 별도 인증서 환경변수를 요구하는 환경에서는 허용 목록을 검토한 뒤 추가해야 한다.

## 검증한 것과 하지 않은 것

Node 22.23.4에서 Infra 회귀 검사 38개가 모두 통과했다(실패·건너뜀 0). 배포·GitOps·Vercel·비용 보고·관측·plan 검토를 포함하며, 실제 클라우드 배포 검사는 아니다.

현재·후보 CLI 모두 격리된 임시 홈과 토큰 없는 환경에서 `--version`, `deploy --help`를 실행했다. 버전 및 `--prebuilt`/`--prod` 옵션을 확인했다. 이 검사는 실제 업로드 성공의 증거가 아니다.

배포 모의 검사는 잘못된 계정·도메인·CORS·변경된 산출물의 사전 거부, CLI 실패, 오래된 HTML, 잘못된 MIME, 정상 배포 흐름을 확인한다. 추가로 실제 Windows junction 거부와 다른 비밀이 포함된 오류의 비노출, 자격증명 환경변수 분리를 확인했다. 실제 Jenkins 서버/Declarative linter 실행은 하지 않았다.

AWS/Vercel 자원 생성, 토큰 입력, 파일 업로드, 도메인 변경과 비용 발생 작업은 수행하지 않았다. FE 앱 의존성과 기능 코드는 수정하지 않았다.

## 다음 선택

조사 당시 두 경로를 제안했고, 이후 사용자는 1번을 선택했다.

1. **공식 REST API 전환 검증**: Jenkins와 Vercel은 유지하고, 검증한 정적 파일을 파일 업로드·배포 생성 API로 전달한다. CLI 의존성을 없앨 수 있지만 업로드 실패·완료 대기·라우팅·산출물 일치 확인 코드를 직접 관리해야 한다. API의 공개 스키마에는 CLI의 `--prebuilt` 옵션이 그대로 존재하지 않으므로, 같은 동작이라고 가정하지 않고 정적 배포 계약부터 검증해야 한다.
2. **CLI 유지**: 현재 검사에서 배포를 차단하고, 안전한 공식 패치 조합이 나온 뒤 번들/실행 경로와 실제 배포를 다시 확인한다.

첫 커밋은 공통 보호와 조사 기록만 반영했다. 같은 PR의 후속 커밋은 사용자 선택에 따라 REST 전환을 구현한다. 미해결 upstream 권고의 위험 수용이나 실제 운영 배포 승인은 아니다.

근거: [CLI 인증 옵션](https://vercel.com/docs/cli/global-options), [prebuilt 배포](https://vercel.com/docs/cli/deploy), [node-tar 권고](https://github.com/isaacs/node-tar/security/advisories/GHSA-23hp-3jrh-7fpw), [공식 API 스키마](https://vercel.com/openapi.json), [파일 업로드 API](https://vercel.com/docs/rest-api/deployments/upload-deployment-files), [배포 생성 API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment).
