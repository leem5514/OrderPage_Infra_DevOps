# Prometheus와 Metrics Server

`values.dev.yaml`은 EKS 내부의 Prometheus Operator, Prometheus, Grafana, kube-state-metrics, node-exporter를 설치할 때 사용한다. `backend-servicemonitor.yaml`은 `orderpage` Service의 `/actuator/prometheus`를 발견한다. `metrics-server-values.dev.yaml`은 별도 Metrics API를 설치해 HPA의 CPU 지표를 제공한다.

RabbitMQ/Redis exporter와 HPA 리소스는 이 단계에서 설치하지 않는다. 실제 적용 순서, Secret, chart 버전, 수집 검증과 데이터 보존 제한은 [단계 기록](../../docs/restart/prometheus-grafana.md)에 정리했다.
