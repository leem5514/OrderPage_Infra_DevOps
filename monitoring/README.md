# 운영 모니터링

현재 AWS 기본 관측은 [Terraform 모듈](../terraform/modules/operations-monitoring/README.md)에서 관리한다.
RDS/Redis/MQ 6개 경보, 옵션 Jenkins 1개/ALB 3개, SNS 이메일, Dashboard와 선택 Budget을 구성했다.
실제 적용/이메일 발송/비용 조회는 아직 하지 않았다.

- [파일 역할·적용 순서·장애 비교·비용과 미검증 범위](../docs/restart/cloudwatch-cost-monitoring.md)
- cost-settings.example.json: Cost Explorer 조회 입력 예시. 실제 값은 .local에 복사한다.
- prometheus/grafana: 다음 단계의 Kubernetes 관측 작업 경로. 아직 설치 설정은 없다.

기존 빈 설명만 있던 README를 현재 구현과 연결했다. 사용하지 않는 Prometheus/Grafana 수집기를 실행 중이라고 표시하지 않는다.
