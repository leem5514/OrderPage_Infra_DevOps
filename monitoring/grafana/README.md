# Grafana

`orderpage-dashboard.yaml`은 Git으로 관리하는 6개 패널의 ConfigMap이다. API RPS·5xx/s·p95, Pod CPU·메모리, 가용 Replica를 보여준다. 차트 설치 후 적용하며 UI는 ClusterIP와 localhost port-forward로만 접근한다.

실측 시계열이 없는 패널은 성능 0으로 해석하지 않는다. [검증 순서와 한계](../../docs/restart/prometheus-grafana.md)를 참고한다.
