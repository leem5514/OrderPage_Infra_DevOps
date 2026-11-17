# 배포 전 보안 잔여 항목 판단

기준일: **2026-11-16 KST**. README PR [#13](https://github.com/leem5514/OrderPage_Infra_DevOps/pull/13)은 main에 병합했다. 이번 단계는 최신 main의 잔여 위험을 판정하는 작업이며, 애플리케이션 수정·의존성 업그레이드·AWS 실행은 하지 않았다.

**후속 진행:** 이 판단서의 Infra [PR #14](https://github.com/leem5514/OrderPage_Infra_DevOps/pull/14)를 병합했다. 주문 입력 검증 수정은 BE [PR #5](https://github.com/leem5514/OrderPage_BE_DevOps/pull/5)에서 전체 테스트 50건을 통과한 후 main에 병합했다(Infra #15도 병합). [변경·검증 상세](https://github.com/leem5514/OrderPage_BE_DevOps/blob/adf1eea042b1e369f8cd612b7de949b80bd274ad/docs/order-input-validation.md)를 따른다. 아래 버전·권고 수치는 수정 전 조사 기록이다. 2026-11-17의 [백엔드 보안 기반 갱신 결과](backend-security-baseline.md)는 BE #6·Infra #16 병합까지 완료했다. [Vercel CLI 재검토](vercel-security-review.md)에서는 최신 후보에도 38개 영향 패키지가 남았으므로 실제 토큰 사용 보류를 유지한다.

## 결론: 현재 버전의 공개 배포는 보류

이전 로컬 테스트 통과만으로 배포 준비가 끝났다고 판단할 수 없다. **주문 입력 검증 누락과 긴 비밀번호 검증 문제를 로컬에서 재현**했고, 백엔드 실행 의존성과 Vercel 배포 CLI에서 추가 보안 권고를 확인했다.

계정 확인·보호된 입력 준비·Terraform plan 검토는 계속 준비할 수 있다. 그러나 공개 ALB에 앱을 연결하거나 실제 배포 토큰으로 CLI를 실행하기 전에는 아래 필수 항목을 해결하고 재검증한다. 짧은 1~3일 가동도 이러한 문제를 없애지는 않는다.

| 분류 | 대상 | 판단과 통과 조건 |
|---|---|---|
| **병합 완료** | 주문 수량 검증 | BE PR #5가 main에 반영됐다. 전체 목록 선검증·400 응답·업무 의존성 미호출·정상 배열 계약을 확인했다. |
| **병합 완료** | BE 실행 의존성·비밀번호 검증 | Java 21/Boot 4.1.2·72바이트 입력 정책·공통 encoder를 검증했다. Java 68건, Docker 기능 13개·보안/지표 6개·장애/종료 검사 통과. BE #6·Infra #16에 반영됐다. |
| **실제 배포 토큰 사용 전 필수** | Vercel CLI 의존성 | 현재 65.12.1과 최신 후보 65.17.0 모두 영향 패키지 38개다. Jenkins 토큰 바인딩 전 high/critical 검사를 추가했다. REST API 전환 또는 CLI 패치 대기 선택이 필요하며 현재 배포는 차단된다. |
| **조건부 진행 가능** | FE 빌드·개발 도구 | 정적 파일 배포, 검토된 소스만 빌드, 개발 서버 중지, 토큰 없는 빌드가 전제다. devDependencies라는 이유만으로 안전하다고 결론 내리지 않는다. |
| **실제 계정 연결 때 필수** | IAM·Secret·Jenkins·Vercel 접근자 | 코드에 있는 제한과 실제 계정 권한은 별개다. 계정/Role, SNS 구독, 최소 권한 토큰, state 접근 권한을 확인한다. |
| **추가 보강 후보** | 컨테이너·CI 호스트·세션 회수 | 비root 실행·capability 제한, CI의 Docker 권한 경계, 비밀번호 변경 후 기존 refresh token 폐기 등을 검토한다. 실사용 계정 도입 전 세션 회수 정책은 필요하다. |

이 판정은 비용을 늘리는 WAF·상용 스캐너·관리형 보안 서비스를 추가하는 제안이 아니다. 우선 **기존 코드의 검증·의존성·권한 경계**를 수정하는 접근이다.

## 1. 검사 대상과 수치의 의미

| 대상 | 기준 SHA / 버전 | 결과 |
|---|---|---|
| BE | `2670c9e046fb8bd0357ab2e5f4456c22ea145f00` | Gradle에서 추출한 실행 모듈 129개 중 34개가 OSV 권고 범위와 일치. 중복 ID를 제거하면 187개 권고 ID |
| FE | `36f6bff2ca36206e5189613cb20ca02e874a8e2d` | npm audit 영향 패키지 18개: high 8 / moderate 10. 직접 연결된 고유 advisory URL은 17개. `--omit=dev` 결과 0개 |
| Infra | `a7e7b92f4d5f96bae6b42b2bee8bc26ea3f2ccaf` | Infra 루트 npm audit 0개 |
| Vercel CLI | Infra의 `vercel 65.12.1` 전용 lockfile | 영향 패키지 38개: critical 1 / high 21 / moderate 16. 고유 advisory URL은 43개 |

npm의 `total`은 영향을 받는 패키지 항목 수이며, 서로 다른 취약점 개수와 같지 않다. OSV 결과도 **버전 범위 일치**이며, 187개의 공격 경로를 실제 재현했다는 뜻이 아니다. 같은 권고가 여러 모듈에 걸리므로 모듈별 수를 합산하지 않았다. 조회된 OSV ID 중 withdrawn 표시는 없었다.

기계 판독용 [검사 근거 JSON](security-evidence/assessment-2026-11-16.json)에 전체 모듈·버전·권고 ID, npm 패키지 경로, lockfile SHA-256, Git 제외 검사와 재현 결과를 보관했다. 계정 ID·토큰·실제 암호는 포함하지 않는다. OSV에는 공개 Maven 좌표와 버전만 전송했다.

## 2. 실제로 재현한 문제

### 주문 요청의 음수 수량이 검증을 통과한다

`OrderSaveReqDto.productCount`에는 `@Positive`가 있지만, Controller의 `@RequestBody List<@Valid OrderSaveReqDto>`만으로 현재 MVC 경로의 항목 검증이 실행되지 않았다. standalone MockMvc에서 음수 수량 요청이 **201 응답**을 만들고, mock `OrderingService`에 같은 음수 값이 전달되는 것을 확인했다.

후속 `OrderingService`는 그 수량을 재고 처리기로 전달하고, Redis 차감 스크립트에는 양수 검증이 없다. 따라서 재고 증가·잘못된 주문 기록으로 이어질 수 있는 코드 경로가 있다. 이번 재현은 **MVC 입력 경계까지만 확인**했으며 실제 DB·Redis 재고를 변경하거나 외부 서버를 공격하지 않았다.

수정 완료 조건은 단순히 어노테이션을 하나 더 붙이는 것이 아니다. 유효하지 않은 주문 전체를 재고·DB·MQ 호출 전에 거부하고, 0/음수/누락 ID/빈 목록/정상 목록을 검사한다. 기존 FE의 JSON 배열 요청 계약은 유지한다. 두 재고 처리 모드가 같은 입력 검증을 거쳐야 비교 실험도 오염되지 않는다.

### 긴 비밀번호의 다른 뒷부분을 구분하지 못한다

현재 `WebConfig`의 `PasswordEncoderFactories.createDelegatingPasswordEncoder()`는 BCrypt를 사용한다. 동일한 ASCII 앞 72바이트에 서로 다른 뒷부분을 붙인 합성 비밀번호로 확인했을 때, 다른 입력에도 `matches()`가 true였다. 회원가입·변경 경로에는 이 길이의 상한 정책도 없다.

이는 [Spring Security CVE-2025-22228](https://spring.io/security/cve-2025-22228/)의 설명과 부합한다. 모든 짧은 비밀번호를 임의로 맞힐 수 있다는 의미는 아니다. 지원되는 보안 수정 버전으로 이동하고, UTF-8 바이트 길이·기존 계정 영향까지 고려한 정책과 회귀 검사를 함께 적용한다.

### 재현 검사 실행 방법

기존 주문 진단은 Service를 mock으로 대체하므로 새 Service 검증을 평가할 수 없다. 혼동을 막기 위해 실행 파일은 제거하고 [수정 전 진단 원본](https://github.com/leem5514/OrderPage_Infra_DevOps/blob/64de8de3f054c290a95de70ccc787e1dfdab6611/docs/restart/security-evidence/OrderValidationAssessmentTest.java)은 Git 이력으로 보존한다. 수정 후에는 BE의 실제 Service를 연결한 OrderInputValidationTest와 직접 Service 검사를 사용한다.

이전 비밀번호 진단은 취약 동작의 성공을 기대하므로 최신 코드의 합격 기준으로 사용할 수 없다. 실행 파일과 전용 Gradle init을 제거했다. [수정 전 진단 원본](https://github.com/leem5514/OrderPage_Infra_DevOps/blob/ae854c56b318caa37e5b5e23332f7e580a78ea98/docs/restart/security-evidence/PasswordLengthAssessmentTest.java)은 Git 이력에 보존한다. 수정 후에는 BE의 PasswordValidationTest 및 실제 Docker security-smoke를 실행한다.

주의: 최신 라이브러리만 적용한 실험에서도 기본 encoder의 초과 입력 허용이 남았다. 앱의 공통 encoder와 서비스 경계에서 명시적으로 거부하는 정책까지 적용한 것이 이번 완료 기준이다.

초기 보안 판단 당시에는 BE 테스트 23개와 주문 진단 1개를 함께 실행해 통과했고, 이후 추가한 비밀번호 진단을 포함한 두 진단 검사도 통과했다. 이는 위 표의 수정 전 SHA에 대한 기록이며, 주문 수정 후 결과는 BE PR #5의 정규 테스트 50건으로 구분한다.

## 3. BE 권고를 모두 같은 위험으로 취급하지 않는다

실제 실행 버전은 Spring Boot 2.7.11, Spring Framework 5.3.27, Spring Security 5.7.8, Tomcat 9.0.74, Jackson 2.13.5, SnakeYAML 1.30 등이다. 전체 목록은 JSON에 보관했다.

| 권고 예시 | 현재 코드와의 관계 | 판단 |
|---|---|---|
| CVE-2025-22228 / BCrypt | 실제 PasswordEncoder 사용, 합성 입력으로 재현 | 수정 필수 |
| Tomcat multipart 관련 권고 | 상품 업로드가 존재한다. 메서드 권한 검사와 multipart 파싱 순서·크기 제한까지 확인 필요 | 미해당 처리하지 않고 업데이트·검증 대상 |
| CVE-2025-24813 / Tomcat partial PUT | 쓰기 가능한 DefaultServlet·특정 파일 세션 조건이 필요. 현재는 stateless 설정이고 해당 쓰기 활성화가 확인되지 않음 | 버전 경고만으로 RCE 가능하다고 단정하지 않음 |
| CVE-2024-38816 / Spring functional resources | 현재 소스에서 RouterFunctions + FileSystemResource 정적 제공 조합을 확인하지 못했고 Tomcat 사용 | 현재 코드에서 성립 근거 없음. 업데이트 대상에서 삭제하는 근거는 아님 |
| 기타 Jackson·Netty·AMQP·로그 라이브러리 | 공개 HTTP 파싱, 외부 서비스 응답, 특정 기능 사용 여부가 각각 다름 | 버전별 권고와 기능 사용을 확인해야 하며 모든 항목의 도달 가능성 분석은 미완료 |

[Tomcat 공식 권고](https://tomcat.apache.org/security-9.html)와 [Spring functional resource 권고](https://spring.io/security/cve-2024-38816/)의 전제조건을 함께 봤다. 운영 시 실제 컨테이너 설정이 바뀌면 위 판단도 달라질 수 있다.

Spring Boot 2.x의 OSS 지원은 [2.7.18 릴리스에서 종료](https://spring.io/blog/2023/11/23/spring-boot-2-7-18-available-now/)됐다. 따라서 2.7.11을 2.7.18로 올리는 것만으로 현재 보안 잔여 문제가 끝났다고 판단하면 안 된다. **공개 지원 중인 Spring Boot 계열과 맞는 Java 버전으로의 전환을 우선 검토**하고, 실제 수정 시점의 지원표·BOM·의존성을 다시 확인한다. 상용 지원 구매는 최소 비용 목표의 기본 해결안으로 잡지 않는다.

## 4. FE와 배포 CLI는 별도 판단

### FE 정적 배포: 제한 조건을 붙인 진행 가능

`npm audit --omit=dev`는 0개였지만 개발/빌드 도구에는 cross-spawn, PostCSS, serialize-javascript, webpack-dev-server 등 권고가 남는다. 정적 파일만 Vercel에 올리므로 개발 서버 취약점이 운영 서버로 그대로 배포되는 구조는 아니다.

다만 빌드 도구는 Jenkins에서 실행된다. 외부 PR·의심되는 CSS/소스·미검토 의존성을 실제 credential이 있는 환경에서 빌드하면 별도의 위험이 생긴다. Jenkins 빌드 단계에는 Vercel/GitHub 배포 토큰을 넣지 않는 현재 분리를 유지하고, 사용자 검토를 거친 main만 실행한다. EC2 인스턴스 역할과 Docker 권한까지 없어지는 것은 아니다.

`npm run serve`를 쓰지 않는 정적 빌드 경로로 제한한다. localhost 바인딩만으로 개발 서버 권고가 모두 해결되지는 않는다. [webpack-dev-server 공식 권고](https://github.com/webpack/webpack-dev-server/security/advisories/GHSA-4v9v-hfq4-rm2v)는 개발 중 악성 사이트 방문에 따른 소스 노출을 설명한다. 실습·CI 중 개발 서버는 종료한다.

FE lockfile에는 npmjs 373개, npmmirror 599개의 HTTPS resolved 항목이 섞여 있다. 악성 패키지가 있다는 증거는 아니지만, 향후 의존성 정비 때 출처를 정리하고 integrity·버전 변경을 검토할 대상이다. 자동 `--force`가 제시하는 Vue CLI 3 계열 변경을 보안 해결로 적용하지 않는다.

### Vercel CLI: 토큰이 주입되는 실행 도구

`jenkins/vercel-cli`는 FE와 별도의 의존성 집합이다. 현재 실제 배포 시 이 CLI에 VERCEL_TOKEN 환경변수를 전달하므로 FE 런타임 audit 0개를 이 도구의 안전 근거로 사용할 수 없다.

38개 패키지 항목 중 critical은 node-tar의 입력 제한 없는 압축 해제/파싱 DoS 권고다. [node-tar 공식 권고](https://github.com/isaacs/node-tar/security/advisories/GHSA-23hp-3jrh-7fpw)에 따른 경고이며, CLI가 토큰을 탈취한다거나 실제 prebuilt 배포에서 공격이 가능하다고 재현한 것은 아니다. undici 등 다른 경로의 권고도 남아 있다.

별도 임시 폴더에서 `npm audit fix --package-lock-only --ignore-scripts --no-fund`를 시험했지만 Vercel 65.12.1과 영향 패키지 38개가 그대로였다. 후보는 저장소에 적용하지 않았다. 자동 제안에는 현재 고정값보다 낮은 65.2.0도 나타나므로 `--force`를 정답으로 사용하지 않는다.

다음 수정에서는 지원되는 CLI와 전이 의존성 조합을 정한 뒤 Node 22 호환성, 정적 산출물 검증, 토큰의 환경변수 전달·마스킹, prebuilt 배포 명령과 오류 처리를 재검증해야 한다. 남는 권고는 실제 실행 경로를 확인해 근거 있는 예외로 남겨야 한다.

## 5. 비밀값·권한 경계 재확인

현재 추적 파일 BE 84개 / FE 48개 / Infra 200개에서 AWS access key ID, GitHub token, 개인키 헤더, Slack token의 **알려진 형식**을 검색했고 일치는 없었다. 민감 문자열 원문을 출력하거나 문서에 담지 않았다. 이번 검사는 현재 트리만 대상으로 하며 과거 Git 이력·원격 계정 alert를 다시 조회한 것은 아니다.

12개의 대표 파일 경로를 `git check-ignore --no-index`로 확인했다. 실제 tfvars/backend/Secret/state/plan, FE 환경 파일과 BE 별도 프로필·키 파일은 예상대로 제외된다. **추적 중인 예시나 application.yml에 실제 값을 쓰면 여전히 공개된다.** 임의의 DB 암호, 알려지지 않은 토큰 형식이나 이미지 속 비밀은 이 검색으로 검증할 수 없다.

| 코드에서 확인한 보호 | 실제 배포 전 남은 확인 |
|---|---|
| Jenkins private EC2, inbound 없음, SSM, IMDSv2·hop limit 1 | 실제 IAM 주체, Jenkins 관리자·agent 권한, Docker group 접근. 같은 호스트의 프로세스 분리는 보안 격리와 다름 |
| EKS Node IMDSv2·hop limit 1, Backend IRSA의 service account 조건 | Pod에서 의도한 역할만 사용하는지, 호스트 네트워크 예외나 실제 RBAC/SG가 없는지 |
| 제품 이미지 버킷 HTTPS GetObject만 공개, 백엔드 PutObject 한정 | 실제 bucket policy·계정 공개 차단 설정·업로드 파일 내용과 공개 데이터 범위 |
| K8s 필수 Secret 7개 참조, 준비 도구의 형식 검사 | 난수 생성·서로 다른 키·실제 인증 성공. 길이 검사가 암호의 충분한 무작위성을 증명하지는 않음 |
| ALB에서 /actuator 차단, 관리 UI는 내부용 | 실제 DNS/ALB 경로에서 차단되는지와 클러스터 내부 접근 범위 |
| 배포 토큰은 Jenkins withCredentials 구간에서만 바인딩 | Jenkins/Vercel/GitHub 실제 사용자·토큰 범위·만료, 로그·artifact·state 읽기 권한 |

컨테이너에는 비root 실행·권한 상승 금지·capability 제거를 강제하는 설정이 아직 없다. 실제 이미지와 파일 쓰기 요구를 확인한 뒤 보강할 후보이며, 이 사실만으로 호스트 탈출이 가능하다고 판단하지 않는다. `resetPassword`는 기존 refresh token 삭제를 하지 않으므로 유출 후 세션 회수 정책도 실사용 계정 전 정해야 한다.

전체 침투 테스트, 컨테이너 OS/JDK 이미지 CVE 검사, Jenkins WAR/플러그인 검사와 실제 AWS/Vercel 접근자 검토는 이번 결과에 포함하지 않는다. 새 프레임워크로 변경하면 의존성·보안 경계 판단을 다시 수행해야 한다.

## 6. 다음 작업 순서

1. **주문 검증 수정 PR 검토·병합**: BE PR #5의 전체 목록 선검증과 테스트 50건 결과를 확인한다. 변경 상세는 위 후속 기록을 따른다.
2. **BE 보안 기반 갱신**: 지원되는 Java·Spring Boot 조합으로 변경하고 BCrypt 포함 실행 의존성을 다시 검사한다. 기능·성능 개선은 섞지 않는다.
3. **Vercel CLI 정비**: 실제 토큰 없이 후보를 검증하고 잔여 권고의 실행 조건을 확인한다. FE 개발 도구는 제한 조건과 다음 정비 계획을 함께 유지한다.
4. **컨테이너·실제 계정 확인**: 이미지 검사, 최소 권한, 보호된 입력·state, Jenkins 설치 버전과 접근자를 확인한다.
5. **그 뒤 plan 검토 → 가동 → 기능·관측 확인 → 기준 실험**으로 진행한다.

각 필수 항목이 해결됐다는 근거를 이 문서에 갱신한 뒤 공개 배포 판단을 바꾼다. 현재 문서는 보안 수정 완료 선언이 아니라, **실행 전 해결해야 할 항목을 확정한 기록**이다.
