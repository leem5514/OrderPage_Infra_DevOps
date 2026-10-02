# Performance Report

이 문서는 부하 테스트와 운영 지표 측정 결과를 기록한다.

비교군, 실험 절차, 성공 기준은 [`comparison-scenarios.md`](./comparison-scenarios.md)를 따른다.
이 문서의 `TBD`는 실제 테스트 로그로만 교체하며 예상값을 측정값처럼 기록하지 않는다.

## Target Metrics

| Category | Metric | Before | After | Improvement |
|---|---:|---:|---:|---:|
| Deployment | Backend deployment lead time | TBD | TBD | TBD |
| Frontend | Vercel preview deployment time | TBD | TBD | TBD |
| API | p95 latency | TBD | TBD | TBD |
| API | p99 latency | TBD | TBD | TBD |
| Reliability | Error rate | TBD | TBD | TBD |
| Scalability | HPA scale-out time | TBD | TBD | TBD |
| Consistency | Oversell count | TBD | TBD | TBD |
| Messaging | RabbitMQ queue lag | TBD | TBD | TBD |

## Test Scenarios

- Product list read
- Login
- Order create
- Concurrent order 100 users
- Concurrent order 300 users
- Concurrent order 500 users
- HPA off vs on
- RabbitMQ consumer count comparison
- Redis stock check scenario

## Evidence

| Scenario ID | Git Commit | Test Time | Raw Result | Dashboard/Log | Notes |
|---|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD | TBD |

## Measurement Rules

- 동일한 애플리케이션 이미지와 테스트 데이터를 사용한다.
- 워밍업 후 최소 3회, 권장 5회 실행한다.
- p50, p95, p99, TPS, 오류율을 함께 기록한다.
- 성능 개선은 Oversell 0건과 데이터 최종 일치를 만족할 때만 인정한다.
- 운영 개선은 소요시간뿐 아니라 수동 단계 수와 실패/복구 결과를 함께 기록한다.
