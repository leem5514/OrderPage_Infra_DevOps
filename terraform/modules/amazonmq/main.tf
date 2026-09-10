resource "aws_security_group" "this" {
  name        = "${var.broker_name}-sg"
  description = "Allow RabbitMQ access to ${var.broker_name}"
  vpc_id      = var.vpc_id

  # Amazon MQ for RabbitMQ는 TLS 기반 AMQPS endpoint를 제공한다.
  # 백엔드는 VPC 내부에서만 5671로 접근하도록 제한한다.
  ingress {
    description = "AMQPS access from allowed CIDR blocks"
    from_port   = var.amqp_port
    to_port     = var.amqp_port
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  egress {
    description = "Allow outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.broker_name}-sg"
  })
}

resource "aws_mq_configuration" "this" {
  # RabbitMQ configuration은 Cuttlefish 형식으로 작성한다.
  # consumer_timeout은 메시지를 가져간 consumer가 ack를 너무 오래 안 할 때 끊는 보호장치다.
  name           = "${var.broker_name}-configuration"
  description    = "RabbitMQ configuration for ${var.broker_name}"
  engine_type    = "RabbitMQ"
  engine_version = var.engine_version

  data = <<-CONFIG
    consumer_timeout = ${var.consumer_timeout_ms}
  CONFIG

  tags = merge(var.tags, {
    Name = "${var.broker_name}-configuration"
  })
}

resource "aws_mq_broker" "this" {
  broker_name = var.broker_name

  # 애플리케이션은 RabbitMQ protocol을 사용하고, 운영은 Amazon MQ가 담당한다.
  engine_type        = "RabbitMQ"
  engine_version     = var.engine_version
  host_instance_type = var.host_instance_type
  deployment_mode    = var.deployment_mode

  # SINGLE_INSTANCE는 subnet 1개만 필요하다. CLUSTER_MULTI_AZ 전환 시 여러 subnet을 사용한다.
  subnet_ids          = var.deployment_mode == "SINGLE_INSTANCE" ? [var.subnet_ids[0]] : var.subnet_ids
  security_groups     = [aws_security_group.this.id]
  publicly_accessible = false

  configuration {
    id       = aws_mq_configuration.this.id
    revision = aws_mq_configuration.this.latest_revision
  }

  encryption_options {
    use_aws_owned_key = var.kms_key_id == null
    kms_key_id        = var.kms_key_id
  }

  logs {
    general = var.general_log_enabled
  }

  maintenance_window_start_time {
    day_of_week = var.maintenance_day_of_week
    time_of_day = var.maintenance_time_of_day
    time_zone   = var.maintenance_time_zone
  }

  # RabbitMQ user 정보는 Terraform state에 평문으로 저장되므로 실제 운영에서는 state 보안이 중요하다.
  user {
    username = var.admin_username
    password = var.admin_password
  }

  auto_minor_version_upgrade = var.auto_minor_version_upgrade
  apply_immediately          = var.apply_immediately

  tags = merge(var.tags, {
    Name = var.broker_name
  })
}
