# 운영 모니터링

현재 AWS 기본 관측은 [Terraform 모듈](../terraform/modules/operations-monitoring/README.md)에서 관리한다.
RDS/Redis/MQ 6개 경보, 옵션 Jenkins 1개/ALB 3개, SNS 이메일, Dashboard와 선택 Budget을 구성했다.
실제 적용/이메일 발송/비용 조회는 아직 하지 않았다.

- [파일 역할·적용 순서·장애 비교·비용과 미검증 범위](../docs/restart/cloudwatch-cost-monitoring.md)
- cost-settings.example.json: Cost Explorer 조회 입력 예시. 실제 값은 .local에 복사한다.
- [Prometheus·Grafana·Metrics Server 구성과 실험 원본 내보내기](../docs/restart/prometheus-grafana.md): chart와 수집 설정은 로컬 렌더 검증 단계이며 실제 설치는 아직 하지 않았다.

관리형 서비스 경보는 CloudWatch, Kubernetes/애플리케이션 지표는 Prometheus가 담당한다.
