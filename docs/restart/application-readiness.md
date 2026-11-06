# 2단계: 애플리케이션 배포 준비 점검

기준일: 2026-11-06. 상태: 코드 점검/최소 수정/로컬 테스트 완료, AWS 실행 검증 전.

## 1. 이번 단계의 목적과 기준

Terraform이 서버를 만들어도 앱의 인증·의존성·수집 설정이 맞지 않으면 배포에 실패하거나 지표가 왜곡된다. 비용이 발생하기 전에 현재 앱을 빌드하고, 운영을 막는 결함을 수정하며, IaC가 주입할 설정을 확정하는 단계다.

| 저장소 | 확인한 main SHA | 작업 브랜치 |
|---|---|---|
| BE | 15de89623b441bd97921e42a80f6028572407f1b | codex/deployment-readiness |
| FE | a1218dcbe0f58e07b5c4f5bc87ac8a85052a17a4 | codex/deployment-readiness |
| Infra | ed29a28에서 계획 브랜치 시작 | codex/restart-cost-plan |

기존 로컬 BE/Infra에는 미커밋 성능 실험이 있어 work 하위의 새 checkout을 사용했다. 기존 작업을 삭제하거나 가져오지 않았다. GitHub 기준에 이미 있던 재고 처리 모드/성능 설정은 되돌리지 않고 고정했다. 이번 변경은 아직 main 병합이 아니므로 CI 소스 브랜치도 이를 구분해야 한다.

## 2. 코드에서 확인한 현재 구조

- FE: Vue 3/Vue CLI 정적 SPA, history router, Axios API 호출, EventSourcePolyfill SSE. Vercel은 dist 배포와 index.html fallback을 담당한다.
- BE: Spring Boot 2.7.11, Java target 11, Gradle 8.8, Spring Security/JWT, JPA/MariaDB, Redis, RabbitMQ, S3 SDK, Actuator/Prometheus registry.
- 사용자 인증: access JWT + Redis DB 1의 refresh token. 재고는 Redis DB 2, SSE 연결 설정은 DB 3을 사용한다.
- 기본 주문 처리는 REDIS_ASYNC다. Redis Lua 후 RabbitMQ consumer가 DB 재고를 반영한다. 이번 포트폴리오에서 이 알고리즘을 Before/After로 바꾸지 않는다.
- 상품 등록은 S3 PutObject, 화면은 저장된 S3 URL로 이미지를 읽는다. API 업로드 권한과 브라우저 읽기 권한은 별개다.
- Dockerfile은 Java 11 멀티 스테이지 빌드다. bootJar만 실행하므로 Jenkins의 test 단계를 별도로 유지해야 한다.

## 3. 수정한 운영 결함

| 문제 | 증거와 영향 | 조치 |
|---|---|---|
| 회원가입 ADMIN 지정 | 요청 role이 저장됨. 새 통합 테스트가 기존 코드에서 실패 | 공개 가입에서 USER 강제 |
| 고정 관리자 비밀번호 | 기본 기동 시 알려진 계정 생성. 기존 코드에서 회귀 테스트 실패 | 초기화 기본 off, Secret 비밀번호로 1회 생성 |
| 관리자 알림 대상 고정 | 관리자 이메일을 바꾸면 주문 알림을 못 받음 | 생성/알림이 ADMIN_EMAIL 공유 |
| AWS IAM 역할 미사용 | StaticCredentialsProvider만 사용 | DefaultCredentialsProvider와 STS 모듈로 IRSA 지원 준비 |
| Redis TLS/AUTH 누락 | 직접 만든 3개 팩토리가 속성을 읽지 않음 | DB 1/2/3에 TLS/password 적용 |
| MQ 서버 신원 미검증 | 현재 클라이언트의 무인자 useSslProtocol은 인증서 검증 생략 | JVM trust store + hostname verification |
| 오류율 왜곡 | JWT filter가 뒤쪽 예외도 401로 변환 가능 | 인증 검증과 업무 처리를 분리 |
| FE 갱신 재귀 | refresh의 401도 같은 인터셉터로 다시 refresh | 독립 요청 인스턴스, 동시 갱신 공유, 실패 시 logout |

재고 알고리즘, SQL 최적화, pool/thread/consumer 수, 번들 용량을 개선하지 않았다. Spring/SDK/프론트 의존성 전체 업그레이드나 전체 보안 감사를 완료한 것도 아니다.

## 4. 검증 기록

| 검사 | 결과 | 의미/한계 |
|---|---|---|
| BE 기준 test bootJar | 기존 14개 통과 | 원격 기준 빌드 가능 |
| 보안 결함 재현 | 추가한 2개 테스트가 기존 구현에서 실패 | 공개 ADMIN 가입/고정 관리자 생성 확인 |
| BE 수정 후 test bootJar | 20개 통과 | H2 context/MockMvc, 단위 회귀 테스트. JDK 17로 Java 11 target 빌드 |
| docker compose config --quiet | 성공 | Compose 문법/치환만 확인 |
| Docker engine | dockerDesktopLinuxEngine pipe 없음 | Docker build/Compose 기동 미실행 |
| FE npm ci | 성공 | lockfile 기반 설치. 보안 취약점 전체 검사 결과는 아님 |
| FE npm test | 5개 통과 | RT 만료/없음, 성공, 동시 요청, 로그인/500 제외 |
| FE lint --no-fix | 성공 | 수정 전후 통과 |
| FE build | 성공 | 후보 HTTPS API URL이 bundle에 포함됨 |

FE 환경: Node 20.16.0/npm 10.8.1. BE: JDK 17/Gradle 8.8. CI에서 쓸 지원 런타임은 따로 고정한다. Dockerfile의 Java 11/Linux 실행은 아직 검증하지 않았다.

FE에는 Browserslist 노후 데이터와 3개 webpack 용량 경고가 남는다. 성능 최적화 범위이므로 이번 수정에서 제외했다.

샌드박스의 Gradle 데몬 연결 제한은 정상 로컬 실행 권한으로 재실행해 해결했다. 테스트 통과를 AWS 로그인·주문·S3 업로드 성공으로 해석하지 않는다. 실제 RDS/MQ/Redis TLS, IAM 역할, 브라우저 CORS, Vercel 라우팅은 아직 미검증이다.

## 5. 다음 IaC에 반영할 설정

| 영역 | 필요한 결정/설정 | 완료 증거 |
|---|---|---|
| IAM | 앱 ServiceAccount용 IRSA, 최소 S3 권한, 고정 키 미주입 | Pod 안의 임시 자격증명으로 업로드 성공 |
| Redis | cluster mode disabled, TLS+AUTH, DB 1/2/3 | 로그인/재고/SSE 연결 성공 |
| Amazon MQ | m7g.medium의 지원 엔진 버전, 5671 TLS, 전용 사용자 | consumer 연결, 실제 메시지 처리 |
| DB | 지원 MariaDB, 앱 계정, TLS, 최초 schema 준비 | 연결/DDL 완료 후 다중 Pod validate |
| Secret/ConfigMap | JWT/DB/Redis/MQ 비밀과 endpoint/region 분리 | Git에 비밀 없음, 동일 Secret으로 replica 간 인증 |
| 관리자 | 공개 트래픽 전 단일 초기화, 이후 off | 생성/로그인 확인 및 초기화 비밀번호 제거 |
| HTTPS/CORS | 후보 api-devops/devops.auctionbid.shop DNS 충돌 확인, 서울 ACM | 브라우저 preflight와 실제 API 성공 |
| Probe | startup/readiness/liveness 역할 분리 | DB 장애 시 불필요한 liveness 재시작 없음 |
| Prometheus | 현재 익명 403 해결: 관리 포트/인증/내부 수집 경로 설계 | scrape UP, 외부 관리 endpoint 접근 차단 |
| S3 이미지 | getUrl은 presigned URL 아님. private 객체 읽기 방식 결정 | 상품 업로드 후 브라우저 이미지 200 |
| SSE | 현재 onerror에서 close. 재접속·idle timeout 확인 | Pod 교체 후 재연결 측정, HTTP와 분리 보고 |
| CI/CD | Jenkins test/build/ECR/Infra Git 갱신, Argo가 sync | Jenkins가 kubectl set image 직접 실행하지 않음 |
| FE 배포 | Jenkins 빌드 env 주입 후 Vercel CLI, Git 자동배포 중복 방지 | 실제 배포 산출물/환경 식별 |

이 표의 항목은 실제 서비스 가동 전/직후 확인할 배포 조건이다. 이번에 전부 구현한 항목이 아니다. 기존 Infra 파일을 그대로 apply하지 않는다.

## 6. 다음 작업 순서

1. 새 설계의 Terraform 디렉터리/상태 소유권을 정한다. 기존 실험 모듈을 무심코 함께 실행하지 않는다.
2. VPC·EKS·ECR·RDS·Redis·MQ·IRSA·CloudWatch/SNS·비용 태그를 필요한 최소 구성으로 작성한다. Cost Anomaly Detection은 비활성 예제만 둔다.
3. Helm/Kubernetes 기본 manifest, 관리 포트/Probe/Secret/Ingress, Argo 애플리케이션과 Jenkinsfile을 연결한다.
4. Docker 실행 가능한 환경에서 이미지와 전체 의존성 smoke를 검증하고 Terraform fmt/validate, Helm 렌더를 확인한다.
5. AWS CLI 계정/리전 확인 → plan 검토 → 예상 비용/가동 종료시각 확정 → apply 순서로 진행한다.
6. HTTPS·로그인·조회·이미지·SSE·알림 smoke 후에만 Before/After 측정을 시작한다. 둘 다 같은 수정된 앱 이미지를 사용한다.

비용 절약을 위해 AWS 생성 전까지 가능한 검증을 완료한다. 24시간 집중 측정, 최대 72시간 종료 계획은 유지한다.

## 7. 코드별 상세 기록

- [BE 변경·환경변수·관리자 초기화 절차](https://github.com/leem5514/OrderPage_BE_DevOps/blob/codex/deployment-readiness/docs/deployment-readiness.md)
- [FE 변경·Vercel 빌드 설정·검증](https://github.com/leem5514/OrderPage_FE_DevOps/blob/codex/deployment-readiness/docs/deployment-readiness.md)
- [비용과 생성/종료 계획](project-process.md)
