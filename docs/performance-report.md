# Performance Report

이 문서는 부하 테스트와 운영 지표 측정 결과를 기록한다.

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
