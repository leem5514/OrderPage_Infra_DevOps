# k6 Benchmarks

DevOps Before/After 실험에서 동일한 부하를 반복하기 위한 k6 스크립트다.

배포·CI/CD·Requests·장애 탐지의 저율 지속 부하는 [실험 계획](../../docs/restart/experiment-plan-review.md)과 `run-availability.ps1`을 사용한다. 아래 HPA manifest는 실제 계정 값이 없는 정적 초안이다. EKS에 바로 적용하지 말고 실제 GitOps 환경 승격 후 이미지 digest/리소스/자동 동기화 설정을 확인한다.

## S05 HPA 시나리오

HPA 실험은 인증이나 재고 소모가 없는 `GET /product/list?page=0&size=20`을 사용한다.
재고 알고리즘 비교는 새 범위에서 제외한다. 이 스크립트는 향후 HPA 실험에 재사용할 초안이며 부하/자원 예산을 확인한 뒤 실행한다.

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

현재 `k8s/benchmarks/hpa`는 값이 비어 있는 정적 초안이다. 실제 EKS에 `kubectl apply -k`를 실행하지 않는다. 클러스터와 GitOps 환경이 준비되면 해당 환경의 불변 이미지 digest, kubecontext, Argo CD 동기화 동작, Metrics API와 Node 여유를 먼저 검증하고 실험용 overlay를 별도 검토한다.

그 뒤 같은 digest와 데이터로 고정 2 Pod와 HPA 2~4 Pod를 각각 적용해 100 VU부터 실행한다. 부하 발생기 한계와 비용을 확인한 다음에만 300/500 VU를 고려한다. 매 반복에서 `run-hpa.ps1`의 k6 원본·Kubernetes 상태를 수집하고 [보고서 양식](../experiment-report.template.md)에 기록한다. 현재의 실행기는 실제 kubecontext·호스트를 고정하지 않으므로 승격 환경과 맞춰 검증하기 전에는 실행하지 않는다.

## 결과

실행기는 다음 경로에 메타데이터, k6 요약, Kubernetes 실행 전후 상태를 저장한다.

```text
benchmarks/results/S05/<yyyy-mm-dd>/<before-fixed|after-hpa>/users-<n>/run-<n>/
```

Raw 결과는 Git에 커밋하지 않는다. 검토가 끝난 대표값과 Grafana 화면 링크만
새 진행서의 실험 기준에 따라 `docs/restart` 아래에 실제 측정 보고서를 작성한다.

## 주의사항

- Before와 After는 같은 Git commit과 ECR image tag를 사용한다.
- 테스트 사이에 RDS, Redis, RabbitMQ 설정을 변경하지 않는다.
- 로컬 PC의 다른 작업이 k6 부하 발생기에 영향을 주지 않게 한다.
- 500 VU 실행 전 100 VU 결과와 AWS 비용·용량을 먼저 확인한다.
- k6는 Node.js가 아닌 자체 JavaScript runtime을 사용하므로 npm package를 임의로 추가하지 않는다.
