# AWS 기본 운영 관측

RDS/Redis/MQ의 기본 CloudWatch 지표 → Alarm → SNS 이메일과 같은 지표의 Dashboard를 구성한다.
Jenkins EC2와 Controller가 생성한 ALB/TG 식별값을 주면 해당 경보도 추가한다.

- 초기 경보 6개. Jenkins 1개/ALB 3개를 추가하면 총 10개다.
- 이메일 구독 확인은 수신자가 해야 한다. Terraform 완료와 이메일 전달 성공은 별도다.
- 지속 지표의 결측은 INSUFFICIENT_DATA, 드물게 발생하는 5xx 결측은 notBreaching으로 취급한다.
- SNS 발행 권한은 같은 계정/프로젝트 경보 prefix에 제한한다. 옵션 Budget은 정확한 ARN만 허용한다.
- Budget 금액 null이면 생성하지 않는다. 설정하면 계정 전체 월 ACTUAL 80%/100% 초과를 알린다.
- 기본 SNS topic은 별도 고객 관리 KMS 키를 사용하지 않는다. 경보에는 리소스 식별 정보가 포함될 수 있으므로 민감 payload를 넣지 않는다.
- 이 모듈은 EKS Pod/JVM 지표나 앱 stdout을 수집하지 않는다. 다음 Kubernetes 관측 단계와 구분한다.

[임계값·실제 적용 순서·장애 실험·비용·한계](../../../docs/restart/cloudwatch-cost-monitoring.md)
