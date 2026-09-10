data "aws_availability_zones" "available" {
  state = "available"

  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

module "vpc" {
  source = "../../modules/vpc"

  name               = "${var.project_name}-${var.environment}"
  vpc_cidr           = var.vpc_cidr
  availability_zones = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  enable_nat_gateway   = var.enable_nat_gateway

  tags = local.common_tags
}

module "backend_ecr" {
  source = "../../modules/ecr"

  repository_name = var.backend_ecr_repository_name
  force_delete    = true
  max_image_count = 30

  tags = local.common_tags
}

module "eks" {
  source = "../../modules/eks"

  cluster_name       = "${var.project_name}-${var.environment}"
  kubernetes_version = var.kubernetes_version
  cluster_subnet_ids = module.vpc.private_subnet_ids
  node_subnet_ids    = module.vpc.private_subnet_ids

  endpoint_private_access = true
  endpoint_public_access  = true
  public_access_cidrs     = var.eks_public_access_cidrs

  node_instance_types       = var.eks_node_instance_types
  node_capacity_type        = var.eks_node_capacity_type
  node_desired_size         = var.eks_node_desired_size
  node_min_size             = var.eks_node_min_size
  node_max_size             = var.eks_node_max_size
  node_max_unavailable      = 1
  enabled_cluster_log_types = var.eks_enabled_cluster_log_types

  tags = local.common_tags
}

module "aws_load_balancer_controller_irsa" {
  count  = var.enable_aws_load_balancer_controller_irsa ? 1 : 0
  source = "../../modules/load-balancer-controller-irsa"

  role_name            = "${var.project_name}-${var.environment}-aws-load-balancer-controller"
  oidc_provider_arn    = var.eks_oidc_provider_arn
  oidc_provider_url    = module.eks.cluster_oidc_issuer_url
  policy_arn           = var.aws_load_balancer_controller_policy_arn
  namespace            = var.aws_load_balancer_controller_namespace
  service_account_name = var.aws_load_balancer_controller_service_account_name

  tags = local.common_tags
}

module "mariadb" {
  source = "../../modules/rds"

  identifier          = "${var.project_name}-${var.environment}-mariadb"
  vpc_id              = module.vpc.vpc_id
  subnet_ids          = module.vpc.private_subnet_ids
  allowed_cidr_blocks = [module.vpc.vpc_cidr_block]

  database_name                   = var.rds_database_name
  master_username                 = var.rds_master_username
  master_password                 = var.rds_master_password
  engine_version                  = var.rds_engine_version
  parameter_group_family          = var.rds_parameter_group_family
  instance_class                  = var.rds_instance_class
  allocated_storage               = var.rds_allocated_storage
  max_allocated_storage           = var.rds_max_allocated_storage
  multi_az                        = var.rds_multi_az
  backup_retention_period         = var.rds_backup_retention_period
  enabled_cloudwatch_logs_exports = var.rds_enabled_cloudwatch_logs_exports
  performance_insights_enabled    = var.rds_performance_insights_enabled
  deletion_protection             = var.rds_deletion_protection
  skip_final_snapshot             = var.rds_skip_final_snapshot

  tags = local.common_tags
}

module "redis" {
  source = "../../modules/elasticache"

  replication_group_id = "${var.project_name}-${var.environment}-redis"
  description          = "OrderPage dev Redis for cache, token, stock, and SSE workloads"
  vpc_id               = module.vpc.vpc_id
  subnet_ids           = module.vpc.private_subnet_ids
  allowed_cidr_blocks  = [module.vpc.vpc_cidr_block]

  engine_version             = var.redis_engine_version
  parameter_group_family     = var.redis_parameter_group_family
  node_type                  = var.redis_node_type
  num_cache_clusters         = var.redis_num_cache_clusters
  automatic_failover_enabled = var.redis_automatic_failover_enabled
  multi_az_enabled           = var.redis_multi_az_enabled
  transit_encryption_enabled = var.redis_transit_encryption_enabled
  auth_token                 = var.redis_auth_token
  snapshot_retention_limit   = var.redis_snapshot_retention_limit
  log_retention_in_days      = var.redis_log_retention_in_days

  tags = local.common_tags
}

module "rabbitmq" {
  source = "../../modules/amazonmq"

  broker_name         = "${var.project_name}-${var.environment}-rabbitmq"
  vpc_id              = module.vpc.vpc_id
  subnet_ids          = module.vpc.private_subnet_ids
  allowed_cidr_blocks = [module.vpc.vpc_cidr_block]

  engine_version             = var.rabbitmq_engine_version
  host_instance_type         = var.rabbitmq_host_instance_type
  deployment_mode            = var.rabbitmq_deployment_mode
  admin_username             = var.rabbitmq_admin_username
  admin_password             = var.rabbitmq_admin_password
  consumer_timeout_ms        = var.rabbitmq_consumer_timeout_ms
  general_log_enabled        = var.rabbitmq_general_log_enabled
  auto_minor_version_upgrade = var.rabbitmq_auto_minor_version_upgrade

  tags = local.common_tags
}
