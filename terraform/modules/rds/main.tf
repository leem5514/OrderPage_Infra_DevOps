resource "aws_db_subnet_group" "this" {
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

  engine         = "mariadb"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
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
  publicly_accessible    = false
  multi_az               = var.multi_az

  backup_retention_period   = var.backup_retention_period
  backup_window             = var.backup_window
  maintenance_window        = var.maintenance_window
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot     = true

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
