resource "aws_elasticache_subnet_group" "this" {
  # ElastiCache node가 배치될 subnet 묶음이다. Redis도 DB처럼 private subnet에 둔다.
  name        = "${var.replication_group_id}-subnet-group"
  description = "Private subnet group for ${var.replication_group_id}"
  subnet_ids  = var.subnet_ids

  tags = merge(var.tags, {
    Name = "${var.replication_group_id}-subnet-group"
  })
}

resource "aws_security_group" "this" {
  name        = "${var.replication_group_id}-sg"
  description = "Allow Redis access to ${var.replication_group_id}"
  vpc_id      = var.vpc_id

  # Redis는 외부 인터넷에 열지 않고 VPC 내부 CIDR에서만 6379 접근을 허용한다.
  ingress {
    description = "Redis access from allowed CIDR blocks"
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
    Name = "${var.replication_group_id}-sg"
  })
}

resource "aws_elasticache_parameter_group" "this" {
  name        = "${var.replication_group_id}-parameter-group"
  family      = var.parameter_group_family
  description = "Redis parameters for ${var.replication_group_id}"

  # Redis latency tracking을 켜서 명령 지연을 관측하고 부하테스트 리포트에 활용한다.
  parameter {
    name  = "latency-tracking"
    value = "yes"
  }

  tags = merge(var.tags, {
    Name = "${var.replication_group_id}-parameter-group"
  })
}

resource "aws_cloudwatch_log_group" "slow_log" {
  # SLOWLOG는 Redis 명령 중 오래 걸린 명령을 확인하는 관측 지점이다.
  name              = "/aws/elasticache/${var.replication_group_id}/slow-log"
  retention_in_days = var.log_retention_in_days

  tags = merge(var.tags, {
    Name = "${var.replication_group_id}-slow-log"
  })
}

resource "aws_cloudwatch_log_group" "engine_log" {
  # Engine log는 Redis 엔진 이벤트와 장애 분석을 위한 로그다.
  name              = "/aws/elasticache/${var.replication_group_id}/engine-log"
  retention_in_days = var.log_retention_in_days

  tags = merge(var.tags, {
    Name = "${var.replication_group_id}-engine-log"
  })
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = var.replication_group_id
  description          = var.description

  # 백엔드가 Spring Redis 설정을 사용하므로 Redis OSS 호환 엔진으로 시작한다.
  engine         = "redis"
  engine_version = var.engine_version
  node_type      = var.node_type
  port           = var.port

  subnet_group_name    = aws_elasticache_subnet_group.this.name
  security_group_ids   = [aws_security_group.this.id]
  parameter_group_name = aws_elasticache_parameter_group.this.name

  # dev 기본값은 비용 절감을 위해 단일 노드다. HA 비교 실험 시 2개 이상과 failover를 켠다.
  num_cache_clusters         = var.num_cache_clusters
  automatic_failover_enabled = var.automatic_failover_enabled
  multi_az_enabled           = var.multi_az_enabled

  at_rest_encryption_enabled = true
  transit_encryption_enabled = var.transit_encryption_enabled
  auth_token                 = var.transit_encryption_enabled ? var.auth_token : null

  snapshot_retention_limit   = var.snapshot_retention_limit
  snapshot_window            = var.snapshot_window
  maintenance_window         = var.maintenance_window
  auto_minor_version_upgrade = true
  apply_immediately          = var.apply_immediately

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.slow_log.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.engine_log.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "engine-log"
  }

  tags = merge(var.tags, {
    Name = var.replication_group_id
  })
}
