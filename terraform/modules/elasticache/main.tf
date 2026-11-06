resource "aws_security_group" "this" {
  name        = "${var.replication_group_id}-sg"
  description = "Redis TLS from EKS nodes only"
  vpc_id      = var.vpc_id
  # VPC 전체 CIDR 대신 지정한 EKS SG를 가진 ENI에서 해당 포트로 오는 연결만 받는다.
  ingress {
    description     = "Redis TLS from EKS"
    from_port       = 6379
    to_port         = 6379
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
resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.replication_group_id}-subnet-group"
  subnet_ids = var.subnet_ids
  tags       = var.tags
}
resource "aws_cloudwatch_log_group" "redis" {
  for_each          = toset(["slow-log", "engine-log"])
  name              = "/aws/elasticache/${var.replication_group_id}/${each.key}"
  retention_in_days = 3
  tags              = var.tags
}
resource "aws_elasticache_replication_group" "this" {
  replication_group_id = var.replication_group_id
  description          = "OrderPage short-lived experiment Redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = "cache.t4g.micro"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.this.name
  security_group_ids   = [aws_security_group.this.id]
  # 앱이 Redis DB 1/2/3을 사용하므로 cluster mode를 켜면 안 된다.
  parameter_group_name       = "default.redis7"
  cluster_mode               = "disabled"
  num_cache_clusters         = 1
  automatic_failover_enabled = false
  multi_az_enabled           = false
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  auth_token                 = var.auth_token
  # ROTATE만 사용해 무인증 경로가 남는 경우를 피한다. 운영 중 토큰 교체는 별도 절차가 필요하다.
  auth_token_update_strategy = "SET"
  snapshot_retention_limit   = 1
  snapshot_window            = "17:00-18:00"
  maintenance_window         = "sun:18:00-sun:19:00"
  auto_minor_version_upgrade = true
  apply_immediately          = false
  dynamic "log_delivery_configuration" {
    for_each = aws_cloudwatch_log_group.redis
    content {
      destination      = log_delivery_configuration.value.name
      destination_type = "cloudwatch-logs"
      log_format       = "json"
      log_type         = log_delivery_configuration.key
    }
  }
  tags = var.tags
}
