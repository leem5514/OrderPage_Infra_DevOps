# Amazon MQ for RabbitMQ (실습용)

RabbitMQ 4.2 / mq.m7g.medium / SINGLE_INSTANCE / private subnet 1개.
EKS SG에서 AMQPS 5671만 허용한다. 평문 5672와 관리 UI 포트는 열지 않는다.
관리형 기본 설정을 사용하며 불필요한 consumer_timeout 커스텀 configuration은 제거했다.

싱글 인스턴스의 기본 200GB 스토리지 비용을 포함해야 한다.
Terraform user.password는 최초 관리자 생성용이며 RabbitMQ 사용자 수정/비밀번호 드리프트를 관리하지 못한다.
일반 로그는 서비스 연결 역할로 전송한다. 생성 후 scripts/set-mq-log-retention.ps1로 실제 로그 그룹의 보관 3일을 설정해야 한다.
[접속·로그 수명·검증·제약](../../../docs/restart/managed-data-services.md)
