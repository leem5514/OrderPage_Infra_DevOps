resource "aws_security_group" "this" {
  name        = "${var.broker_name}-sg"
  description = "RabbitMQ AMQPS from EKS nodes only"
  vpc_id      = var.vpc_id
  # VPC 전체 CIDR 대신 지정한 EKS SG를 가진 ENI에서 해당 포트로 오는 연결만 받는다.
  ingress {
    description     = "RabbitMQ AMQPS from EKS"
    from_port       = 5671
    to_port         = 5671
    protocol        = "tcp"
    security_groups = [var.allowed_security_group_id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = var.tags
}
resource "aws_mq_broker" "this" {
  broker_name    = var.broker_name
  engine_type    = "RabbitMQ"
  engine_version = "4.2"
  # mq.t3.micro는 신규 생성 불가. 평가용 단일 m7g.medium을 사용한다.
  host_instance_type  = "mq.m7g.medium"
  deployment_mode     = "SINGLE_INSTANCE"
  subnet_ids          = [var.subnet_ids[0]]
  security_groups     = [aws_security_group.this.id]
  publicly_accessible = false
  encryption_options {
    use_aws_owned_key = true
  }
  # RabbitMQ는 서비스 연결 역할로 로그를 보낸다. Broker ID가 정해진 뒤 보관 정책을 설정한다.
  logs {
    general = true
  }
  maintenance_window_start_time {
    day_of_week = "SUNDAY"
    time_of_day = "19:00"
    time_zone   = "UTC"
  }
  # Terraform provider는 RabbitMQ 사용자 변경/드리프트를 관리하지 못한다.
  user {
    username = "orderadmin"
    password = var.admin_password
  }
  auto_minor_version_upgrade = true
  apply_immediately          = false
  tags                       = var.tags
}
