# 모든 인증 문자열은 mock 테스트 전용이다. 실제 AWS에서는 절대 사용하지 않는다.
mock_provider "aws" {}

run "rds_private_tls_and_bounded_cost" {
  command = plan
  module { source = "../../modules/rds" }
  variables {
    vpc_id                    = "vpc-00000000000000001"
    subnet_ids                = ["subnet-00000000000000001", "subnet-00000000000000002"]
    allowed_security_group_id = "sg-00000000000000001"
    identifier                = "test-mariadb"
    engine_version            = "10.11.13"
    master_password           = "MockOnlyRdsPassword1234567890123456"
  }
  assert {
    condition = length(aws_security_group.this.ingress) == 1 && alltrue([
      for rule in aws_security_group.this.ingress :
      rule.from_port == 3306 && rule.to_port == 3306 && rule.protocol == "tcp" &&
      rule.security_groups == toset(["sg-00000000000000001"]) &&
      try(length(rule.cidr_blocks), 0) == 0 && try(length(rule.ipv6_cidr_blocks), 0) == 0
    ])
    error_message = "데이터 포트는 지정 EKS SG에서만 허용해야 합니다."
  }
  assert {
    condition = (
      !aws_db_instance.this.publicly_accessible && !aws_db_instance.this.multi_az &&
      aws_db_instance.this.storage_encrypted && aws_db_instance.this.instance_class == "db.t4g.micro" &&
      aws_db_instance.this.allocated_storage == 20 && aws_db_instance.this.max_allocated_storage == 0
    )
    error_message = "RDS의 private/암호화/실습 자원 상한 설정이 바뀌었습니다."
  }
  assert {
    condition     = anytrue([for p in aws_db_parameter_group.this.parameter : p.name == "require_secure_transport" && p.value == "1"])
    error_message = "RDS가 평문 접속을 거부해야 합니다."
  }
  assert {
    condition = (
      aws_db_instance.this.backup_retention_period == 1 && aws_db_instance.this.skip_final_snapshot &&
      aws_db_instance.this.delete_automated_backups &&
      alltrue([for group in aws_cloudwatch_log_group.database : group.retention_in_days == 3])
    )
    error_message = "테스트 데이터의 백업/종료/로그 보관 정책을 확인하세요."
  }
}

run "redis_requires_tls_and_auth" {
  command = plan
  module { source = "../../modules/elasticache" }
  variables {
    vpc_id                    = "vpc-00000000000000001"
    subnet_ids                = ["subnet-00000000000000001", "subnet-00000000000000002"]
    allowed_security_group_id = "sg-00000000000000001"
    replication_group_id      = "test-redis"
    auth_token                = "MockOnlyRedisToken1234567890123456"
  }
  assert {
    condition = length(aws_security_group.this.ingress) == 1 && alltrue([
      for rule in aws_security_group.this.ingress :
      rule.from_port == 6379 && rule.to_port == 6379 && rule.protocol == "tcp" &&
      rule.security_groups == toset(["sg-00000000000000001"]) &&
      try(length(rule.cidr_blocks), 0) == 0 && try(length(rule.ipv6_cidr_blocks), 0) == 0
    ])
    error_message = "데이터 포트는 지정 EKS SG에서만 허용해야 합니다."
  }
  assert {
    condition = (
      aws_elasticache_replication_group.this.transit_encryption_enabled &&
      aws_elasticache_replication_group.this.transit_encryption_mode == "required" &&
      aws_elasticache_replication_group.this.at_rest_encryption_enabled &&
      aws_elasticache_replication_group.this.auth_token_update_strategy == "SET"
    )
    error_message = "Redis의 TLS/인증/저장 암호화 정책이 필요합니다."
  }
  assert {
    condition = (
      aws_elasticache_replication_group.this.cluster_mode == "disabled" &&
      aws_elasticache_replication_group.this.num_cache_clusters == 1 &&
      !aws_elasticache_replication_group.this.automatic_failover_enabled &&
      aws_elasticache_replication_group.this.snapshot_retention_limit == 1 &&
      alltrue([for group in aws_cloudwatch_log_group.redis : group.retention_in_days == 3])
    )
    error_message = "Redis DB 1/2/3 호환성과 단일 노드/로그 보관 조건을 유지해야 합니다."
  }
}

run "mq_private_amqps_single_instance" {
  command = plan
  module { source = "../../modules/amazonmq" }
  variables {
    vpc_id                    = "vpc-00000000000000001"
    subnet_ids                = ["subnet-00000000000000001", "subnet-00000000000000002"]
    allowed_security_group_id = "sg-00000000000000001"
    broker_name               = "test-rabbitmq"
    admin_password            = "MockOnlyMqPassword1234567890123456"
  }
  assert {
    condition = length(aws_security_group.this.ingress) == 1 && alltrue([
      for rule in aws_security_group.this.ingress :
      rule.from_port == 5671 && rule.to_port == 5671 && rule.protocol == "tcp" &&
      rule.security_groups == toset(["sg-00000000000000001"]) &&
      try(length(rule.cidr_blocks), 0) == 0 && try(length(rule.ipv6_cidr_blocks), 0) == 0
    ])
    error_message = "데이터 포트는 지정 EKS SG에서만 허용해야 합니다."
  }
  assert {
    condition = (
      !aws_mq_broker.this.publicly_accessible &&
      aws_mq_broker.this.engine_type == "RabbitMQ" && aws_mq_broker.this.engine_version == "4.2" &&
      aws_mq_broker.this.host_instance_type == "mq.m7g.medium" &&
      aws_mq_broker.this.deployment_mode == "SINGLE_INSTANCE" &&
      length(aws_mq_broker.this.subnet_ids) == 1 && aws_mq_broker.this.logs[0].general
    )
    error_message = "MQ의 private AMQPS/지원 타입/단일 인스턴스/로그 조건을 유지해야 합니다."
  }
}
run "reject_short_rds_password_and_unpinned_version" {
  command = plan
  module { source = "../../modules/rds" }
  variables {
    vpc_id                    = "vpc-00000000000000001"
    subnet_ids                = ["subnet-00000000000000001", "subnet-00000000000000002"]
    allowed_security_group_id = "sg-00000000000000001"
    identifier                = "test-mariadb"
    engine_version            = "10.11"
    master_password           = "short"
  }
  expect_failures = [var.engine_version, var.master_password]
}
run "reject_empty_redis_auth" {
  command = plan
  module { source = "../../modules/elasticache" }
  variables {
    vpc_id                    = "vpc-00000000000000001"
    subnet_ids                = ["subnet-00000000000000001", "subnet-00000000000000002"]
    allowed_security_group_id = "sg-00000000000000001"
    replication_group_id      = "test-redis"
    auth_token                = ""
  }
  expect_failures = [var.auth_token]
}
run "reject_mq_cidr_and_weak_password" {
  command = plan
  module { source = "../../modules/amazonmq" }
  variables {
    vpc_id                    = "vpc-00000000000000001"
    subnet_ids                = ["subnet-00000000000000001"]
    allowed_security_group_id = "10.20.0.0/16"
    broker_name               = "test-rabbitmq"
    admin_password            = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  expect_failures = [var.allowed_security_group_id, var.admin_password]
}
