# HPA Benchmark Variants

동일한 애플리케이션과 리소스 요청값을 유지한 채 HPA 유무만 바꾸는 S05 비교 구성이다.

## 비교군

| Variant | Deployment replicas | HPA |
|---|---:|---|
| `fixed-replicas` | 2 | 없음 |
| `hpa-enabled` | 시작 2, 최소 2, 최대 5 | CPU 70%, Memory 80% |

두 Variant는 모두 `k8s/overlays/dev`를 재사용한다. 이미지, ConfigMap, Secret, Service, Ingress,
Probe, CPU/Memory requests와 limits는 동일하다.

## 선행조건

Terraform EKS Add-on 목록에 `metrics-server`가 포함되어 있어야 한다.

```powershell
kubectl get apiservice v1beta1.metrics.k8s.io
kubectl top nodes
kubectl top pods -n orderpage
```

Metrics Server는 HPA용 현재 CPU/Memory 값을 제공한다. 장기 보관과 성능 분석은 Prometheus/Grafana를 사용한다.

## Before: Pod 2개 고정

이미 존재하는 HPA는 렌더링 결과에서 빠지는 것만으로 삭제되지 않으므로 먼저 명시적으로 제거한다.

```powershell
kubectl delete hpa orderpage-backend -n orderpage --ignore-not-found
kubectl apply -k k8s/benchmarks/hpa/fixed-replicas
kubectl scale deployment/orderpage-backend -n orderpage --replicas=2
kubectl rollout status deployment/orderpage-backend -n orderpage --timeout=180s
```

## After: HPA 활성

```powershell
kubectl apply -k k8s/benchmarks/hpa/hpa-enabled
kubectl get hpa orderpage-backend -n orderpage --watch
```

## 측정 규칙

- 두 Variant는 같은 Git commit과 ECR image tag를 사용한다.
- Before와 After 사이에 DB/Redis/RabbitMQ 설정을 변경하지 않는다.
- 워밍업 2분, 본 테스트 10분, 정리 3분을 동일하게 적용한다.
- 동시 사용자 100, 300, 500 단계를 각각 최소 3회 실행한다.
- p50/p95/p99, TPS, 오류율, Pod 수, CPU/Memory, Scale-out/Ready 시간을 기록한다.
- 테스트 직전 `kubectl get deployment,hpa,pods -n orderpage` 결과를 증거로 저장한다.
