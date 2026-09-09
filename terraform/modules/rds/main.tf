resource "aws_db_subnet_group" "this" {
  # RDS가 어느 subnet에 생성될 수 있는지 묶는다. 여기서는 private subnet만 전달한다.
  name        = "${var.identifier}-subnet-group"
  description = "Private subnet group for ${var.identifier}"
  subnet_ids  = var.subnet_ids

  tags = merge(var.tags, {
    Name = "${var.identifier}-subnet-group"
  })
}

resource "aws_security_group" "this" {
  name        = "${var.identifier}-sg"
  description = "Allow MariaDB access to ${var.identifier}"
  vpc_id      = var.vpc_id

  # DB는 외부 인터넷에 열지 않고 VPC 내부 CIDR에서만 3306 접근을 허용한다.
  ingress {
    description = "MariaDB access from allowed CIDR blocks"
    from_port   = var.port
    to_port     = var.port
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
    Name = "${var.identifier}-sg"
  })
}

resource "aws_db_parameter_group" "this" {
  name        = "${var.identifier}-parameter-group"
  family      = var.parameter_group_family
  description = "MariaDB parameters for ${var.identifier}"

  # slow query를 켜서 DB 병목을 CloudWatch 로그와 성능 리포트의 근거로 남긴다.
  parameter {
    name  = "slow_query_log"
    value = "1"
  }

  parameter {
    name  = "long_query_time"
    value = var.slow_query_time
  }

  parameter {
    name  = "log_output"
    value = "FILE"
  }

  tags = merge(var.tags, {
    Name = "${var.identifier}-parameter-group"
  })
}

resource "aws_db_instance" "this" {
  identifier = var.identifier

  # 백엔드가 이미 MariaDB dialect/JDBC URL을 사용하므로 앱 변경 없이 관리형 DB로 전환한다.
  engine         = "mariadb"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  # 스토리지 자동 확장으로 트래픽 증가 시 디스크 부족 위험을 줄인다.
  max_allocated_storage = var.max_allocated_storage
  storage_type          = var.storage_type
  storage_encrypted     = true

  db_name  = var.database_name
  username = var.master_username
  password = var.master_password
  port     = var.port

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.this.id]
  parameter_group_name   = aws_db_parameter_group.this.name
  # false로 두면 public IP를 받지 않는다. 접근은 EKS/VPC 내부에서만 한다.
  publicly_accessible    = false
  multi_az               = var.multi_az

  # 자동 백업은 장애 복구 시점과 운영 안정성 설명에 쓰는 핵심 설정이다.
  backup_retention_period   = var.backup_retention_period
  backup_window             = var.backup_window
  maintenance_window        = var.maintenance_window
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot     = true

  # error/slowquery 로그를 CloudWatch로 보내 DB 병목을 관측한다.
  enabled_cloudwatch_logs_exports = var.enabled_cloudwatch_logs_exports
  performance_insights_enabled    = var.performance_insights_enabled

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${var.identifier}-final"

  apply_immediately = var.apply_immediately

  tags = merge(var.tags, {
    Name = var.identifier
  })
}
