# k6 Benchmarks

DevOps Before/After 실험에서 동일한 부하를 반복하기 위한 k6 스크립트다.

## S05 HPA 시나리오

HPA 실험은 인증이나 재고 소모가 없는 `GET /product/list?page=0&size=20`을 사용한다.
주문 API 부하는 Redis/RabbitMQ 비교 모드가 준비된 뒤 별도 시나리오로 추가한다.

기본 부하 단계:

```text
2분  : 0명에서 목표 사용자까지 증가
10분 : 목표 사용자 수 유지
3분  : 목표 사용자에서 0명까지 감소
```

목표 사용자는 `100`, `300`, `500` 중 하나이며 각 Variant를 최소 3회, 권장 5회 실행한다.

기본 성공 기준:

- HTTP 오류율 1% 미만
- Check 성공률 99% 초과
- Product list p95 1,000ms 미만
- Product list p99 2,000ms 미만

지연시간 기준은 실측 전 포트폴리오 목표값이며 결과값이 아니다.

## 실행 순서

Before 환경을 적용한다.

```powershell
kubectl delete hpa orderpage-backend -n orderpage --ignore-not-found
kubectl apply -k k8s/benchmarks/hpa/fixed-replicas
kubectl scale deployment/orderpage-backend -n orderpage --replicas=2
```

Before 테스트를 실행한다.

```powershell
.\benchmarks\k6\run-hpa.ps1 `
  -Variant fixed `
  -Users 100 `
  -RunNumber 1 `
  -BaseUrl https://api.dev.example.com `
  -ImageTag <immutable-ecr-tag>
```

After 환경을 적용한다.

```powershell
kubectl apply -k k8s/benchmarks/hpa/hpa-enabled
kubectl get hpa orderpage-backend -n orderpage --watch
```

After 테스트를 실행한다.

```powershell
.\benchmarks\k6\run-hpa.ps1 `
  -Variant hpa `
  -Users 100 `
  -RunNumber 1 `
  -BaseUrl https://api.dev.example.com `
  -ImageTag <immutable-ecr-tag>
```

같은 방식으로 사용자 300명과 500명, Run 1~5를 실행한다.

## 결과

실행기는 다음 경로에 메타데이터, k6 요약, Kubernetes 실행 전후 상태를 저장한다.

```text
benchmarks/results/S05/<yyyy-mm-dd>/<before-fixed|after-hpa>/users-<n>/run-<n>/
```

Raw 결과는 Git에 커밋하지 않는다. 검토가 끝난 대표값과 Grafana 화면 링크만
`docs/performance-report.md`에 기록한다.

## 주의사항

- Before와 After는 같은 Git commit과 ECR image tag를 사용한다.
- 테스트 사이에 RDS, Redis, RabbitMQ 설정을 변경하지 않는다.
- 로컬 PC의 다른 작업이 k6 부하 발생기에 영향을 주지 않게 한다.
- 500 VU 실행 전 100 VU 결과와 AWS 비용·용량을 먼저 확인한다.
- k6는 Node.js가 아닌 자체 JavaScript runtime을 사용하므로 npm package를 임의로 추가하지 않는다.
