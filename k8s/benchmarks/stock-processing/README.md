# Stock Processing Benchmark Variants

동일한 주문 API에서 재고 처리 방식만 바꾸는 S11/S12 비교 구성이다. 두 Variant 모두 HPA를 제거하고
Pod를 2개로 고정해 자동 확장이 처리량과 응답시간에 영향을 주지 않게 한다.

## 비교군

| Variant | 환경변수 | 실시간 재고 처리 | RDB 반영 |
|---|---|---|---|
| `rdb-sync` | `RDB_SYNC` | RDB 비관적 행 잠금 | 요청 트랜잭션에서 동기 처리 |
| `redis-async` | `REDIS_ASYNC` | Redis Lua 원자 연산 | RabbitMQ Consumer가 비동기 처리 |

두 Variant의 이미지, replicas 2개, CPU/Memory requests와 limits, DB Pool, Service, Ingress,
Probe는 동일하다. Redis는 SSE 알림에도 사용되므로 `RDB_SYNC`가 Redis 서버 자체를 제거하는 비교는
아니다. 비교 대상은 주문 요청의 **재고 검증과 차감 경로**다.

## 공통 준비

기존 HPA는 manifest에서 빠지는 것만으로 삭제되지 않으므로 실험 전에 제거한다.

```powershell
kubectl delete hpa orderpage-backend -n orderpage --ignore-not-found
kubectl scale deployment/orderpage-backend -n orderpage --replicas=2
```

두 실험은 반드시 같은 Backend Git commit과 ECR image tag를 사용한다. Variant를 바꾸기 전에 주문,
상품 재고, Redis stock DB, RabbitMQ Queue를 같은 초기 상태로 되돌린다.

## Before: RDB_SYNC

```powershell
kubectl apply -k k8s/benchmarks/stock-processing/rdb-sync
kubectl rollout status deployment/orderpage-backend -n orderpage --timeout=180s
kubectl get deployment orderpage-backend -n orderpage -o jsonpath="{.spec.template.spec.containers[0].env}"
```

## After: REDIS_ASYNC

```powershell
kubectl apply -k k8s/benchmarks/stock-processing/redis-async
kubectl rollout status deployment/orderpage-backend -n orderpage --timeout=180s
kubectl get deployment orderpage-backend -n orderpage -o jsonpath="{.spec.template.spec.containers[0].env}"
```

Redis 비교가 끝나면 RabbitMQ Queue가 완전히 소진될 때까지 기다린 후 RDB와 Redis의 최종 재고가
일치하는지 확인한다. Queue에 남은 메시지를 제외하고 RDB 값만 비교하면 비동기 구조를 실패로 잘못
판단할 수 있다.

## 측정 항목

- 공통: 주문 TPS, p50/p95/p99, HTTP 오류율, 초과 판매 수
- RDB: Row Lock 대기시간, Deadlock 수, DB CPU와 connection 사용량
- Redis/RabbitMQ: Redis command latency, Queue depth/lag, Consumer 처리율, DLQ 메시지 수
- 정합성: 성공 주문 수량 합계, 최종 RDB 재고, 최종 Redis 재고, 유실 메시지 수

실측 전에는 어느 방식이 몇 퍼센트 개선됐다고 기록하지 않는다. 각 Variant를 최소 3회 실행하고 중앙값을
대표값으로 사용한다.
