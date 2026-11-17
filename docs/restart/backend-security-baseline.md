# 백엔드 보안 기반과 CI 연결

2026-11-17. **BE #5와 Infra #15는 main에 병합 완료**했다. 후속 보안 변경 [BE #6](https://github.com/leem5514/OrderPage_BE_DevOps/pull/6)과 [Infra #16](https://github.com/leem5514/OrderPage_Infra_DevOps/pull/16)도 main에 병합했다. 아래 반영 순서는 작업 당시 기록이며, 현재 다음 단계는 [Vercel CLI 보안 검토](vercel-security-review.md)다.

## 이번에 바꾼 이유

지원 종료된 Spring Boot 2.7 기반을 그대로 공개하는 대신 Java 21 LTS / Spring Boot 4.1.2로 전환했다. 업데이트 과정에서 기존 API의 권한·응답·재고 메시지·관측 경로를 함께 검증했다. Jenkins의 앱 테스트도 Java 21 Docker 이미지로 맞춘다. EC2/EKS 인스턴스 수·사양·유료 서비스는 추가하지 않았다.

비밀번호는 8자 이상, UTF-8 72바이트 이하로 제한한다. 라이브러리 교체만 한 상태에서는 긴 입력의 같은 앞부분을 허용했기 때문에 서비스와 공통 PasswordEncoder에 명시적인 제한을 적용했다. 정상 범위의 기존 BCrypt 해시는 유지한다. JWT 키의 해석은 UTF-8로 명시했으므로 기존 토큰은 재로그인이 필요하다.

애플리케이션 파일별 변경과 호환 제한은 [BE 상세 기록](https://github.com/leem5514/OrderPage_BE_DevOps/blob/76a6bd04c00835268722f5301f8ab36c85d1171e/docs/security-baseline.md)에 정리했다.

## Infra에서 같이 바꿔야 하는 것

| 파일 | 역할과 변경 이유 |
|---|---|
| `scripts/ci-backend.sh` | 소스만 mount한 Java 21 컨테이너에서 테스트한다. AWS/GitHub 토큰을 테스트 컨테이너에 주입하지 않는 기존 경계를 유지한다. |
| `jenkins/Jenkinsfile.backend` | 테스트 stage 이름과 실제 Java 버전을 맞춘다. ECR digest → Infra PR → Argo CD 흐름은 같다. |
| `k8s/base/config.env` | HTTP histogram의 환경변수 이름을 수정한다. |
| `scripts/prepare-deployment.mjs` | 실제 배포 overlay를 만들 때도 올바른 histogram 이름을 쓰게 한다. |
| `scripts/tests/deployment.test.mjs` | 생성된 ConfigMap의 수정된 설정을 검사한다. 실제 바인딩 성공은 아래 Docker 검사로 별도 확인했다. |

`management.metrics.distribution.percentiles-histogram.http.server.requests`의 환경변수는 **`MANAGEMENT_METRICS_DISTRIBUTION_PERCENTILESHISTOGRAM_HTTP_SERVER_REQUESTS`**다. 하이픈을 제거해야 하는 자리에 밑줄을 넣은 기존 이름은 다른 속성으로 해석됐다. Docker에서 기동 실패를 재현했고, 수정 후 앱 기동 및 `http_server_requests_seconds_bucket` 출력을 확인했다. 이 값이 없으면 Grafana의 p95 그래프도 올바르게 준비되지 않는다.

## 확인한 증거와 한계

| 검사 | 결과 |
|---|---|
| Java 21 테스트 + bootJar | 68건 통과. 이전 주문 검증을 포함해 JWT·권한·비밀번호·Redis/MQ/SSE 직렬화 확인 |
| Linux Docker 빌드 | Temurin 21 JDK/JRE 이미지 빌드·기동 성공 |
| 실제 로컬 서비스 | 기본 기능 13개, 보안·histogram 6개 통과. 기존 검증용 MariaDB 데이터 유지 상태에서 수행 |
| DB 장애·복구 | liveness 200/readiness 503 → DB 복구 후 앱 재시작 없이 readiness 200 |
| 종료 | 열린 SSE 정상 EOF, SIGTERM만 사용, exit 143. SSE 중 0.615초 / 유휴 1.034초는 로컬 단일 관측 |
| Infra | 기존 전체 검사 36건 통과. 공식 chart 로컬 렌더 포함 |
| 최종 실행 의존성 | Maven 모듈 174개, OSV 버전 일치 모듈 0개 / 고유 권고 ID 0개 |

[기계 판독용 근거](security-evidence/backend-runtime-2026-11-17.json)에 공개 Maven 좌표와 버전·조회 시각·검증 요약을 보관했다. 이전 187개 권고 기록은 과거 조사 자료로 그대로 보존한다. 라이브러리 집합이 달라졌으므로 두 결과를 성능 개선율이나 실제 공격 감소율로 계산하지 않는다.

이번에는 Boot 기본 조합에 남은 RabbitMQ 5.30.0/MariaDB 3.5.10 권고 14개도 재조회했다. 공식 수정이 포함된 같은 주 버전 5.37.1/3.5.11을 지정하고 테스트했다. JJWT 0.13.0과 AWS SDK BOM 2.59.2도 함께 검증했다. OSV 결과는 컨테이너 OS 검사나 실제 IAM/TLS 검증을 대신하지 않는다.

취약 동작의 성공을 기대하던 `PasswordLengthAssessmentTest`와 전용 `reproduce.init.gradle`은 제거했다. 과거 파일은 Git 이력에 남기고, 앞으로는 BE의 정규 회귀 검사와 Docker smoke를 사용한다.

## 반영 순서와 다음 작업

1. 새 BE PR과 Infra PR의 diff·검증 결과를 함께 검토한다. Jenkins 설정만 먼저 활성화하거나 과거 이미지에 새 검증 결과를 붙이지 않는다.
2. 두 PR 반영 후 Jenkins에서 해당 BE main을 테스트·빌드하고 새 ECR digest를 생성한다. 이번 단계에서는 실제 Jenkins/ECR 배포를 실행하지 않았다.
3. **Vercel CLI의 잔여 보안 권고를 정리한 뒤** 실제 배포 토큰을 사용한다. FE 정적 런타임 audit 결과로 CLI 안전성을 대신 판단하지 않는다.
4. 실제 AWS 프로필·IAM·Secret·DNS·SNS 입력을 확인하고 Terraform plan의 자원·비용·삭제 절차를 검토한다. 계정별 plan과 apply는 아직 하지 않았다.

72시간 이내 최소 비용 실습 조건은 그대로다. 상용 스캐너나 새 AWS 서비스를 추가하지 않았고, 이번 검증은 로컬 PC에서만 수행했다. 공개 배포 보류를 전체 해제한 단계는 아니다.
