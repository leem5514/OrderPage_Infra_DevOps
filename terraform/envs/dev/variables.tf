variable "aws_region" {
  description = "AWS region for the dev environment."
  type        = string
  default     = "ap-northeast-2"
}

variable "project_name" {
  description = "Project name used for resource tags and naming."
  type        = string
  default     = "orderpage"
}

variable "environment" {
  description = "Environment name."
  type        = string
  default     = "dev"
}

variable "backend_ecr_repository_name" {
  description = "Backend ECR repository name."
  type        = string
  default     = "orderpage-backend"
}

variable "az_count" {
  description = "Number of availability zones used by the dev VPC."
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "az_count must be between 2 and 3."
  }
}

variable "vpc_cidr" {
  description = "CIDR block for the dev VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets."
  type        = list(string)
  default     = ["10.20.1.0/24", "10.20.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets."
  type        = list(string)
  default     = ["10.20.101.0/24", "10.20.102.0/24"]
}

variable "enable_nat_gateway" {
  description = "Enable a single NAT Gateway for private subnet outbound traffic."
  type        = bool
  default     = true
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version. Null uses the current EKS default version."
  type        = string
  default     = null
}

variable "eks_public_access_cidrs" {
  description = "CIDR blocks allowed to access the EKS public API endpoint."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "eks_enabled_cluster_log_types" {
  description = "EKS control plane log types."
  type        = list(string)
  default     = ["api", "audit", "authenticator"]
}

variable "eks_node_instance_types" {
  description = "EKS managed node instance types."
  type        = list(string)
  default     = ["t3.medium"]
}

variable "eks_node_capacity_type" {
  description = "EKS managed node capacity type."
  type        = string
  default     = "ON_DEMAND"
}

variable "eks_node_desired_size" {
  description = "Initial desired node count for the dev node group."
  type        = number
  default     = 2
}

variable "eks_node_min_size" {
  description = "Minimum node count for the dev node group."
  type        = number
  default     = 1
}

variable "eks_node_max_size" {
  description = "Maximum node count for the dev node group."
  type        = number
  default     = 3
}

variable "enable_aws_load_balancer_controller_irsa" {
  description = "Create AWS Load Balancer Controller IRSA role after OIDC provider and IAM policy are ready."
  type        = bool
  default     = false
}

variable "eks_oidc_provider_arn" {
  description = "EKS OIDC provider ARN. Required when enable_aws_load_balancer_controller_irsa is true."
  type        = string
  default     = null
}

variable "aws_load_balancer_controller_policy_arn" {
  description = "AWS Load Balancer Controller IAM policy ARN. Required when enable_aws_load_balancer_controller_irsa is true."
  type        = string
  default     = null
}

variable "aws_load_balancer_controller_namespace" {
  description = "Namespace where AWS Load Balancer Controller runs."
  type        = string
  default     = "kube-system"
}

variable "aws_load_balancer_controller_service_account_name" {
  description = "ServiceAccount used by AWS Load Balancer Controller."
  type        = string
  default     = "aws-load-balancer-controller"
}

variable "rds_database_name" {
  description = "Initial MariaDB database name for the backend."
  type        = string
  default     = "ordersystem"
}

variable "rds_master_username" {
  description = "RDS master username."
  type        = string
  default     = "orderadmin"
}

variable "rds_master_password" {
  description = "RDS master password. Provide with terraform.tfvars or TF_VAR_rds_master_password."
  type        = string
  sensitive   = true
}

variable "rds_engine_version" {
  description = "RDS MariaDB engine version."
  type        = string
  default     = "10.11"
}

variable "rds_parameter_group_family" {
  description = "RDS MariaDB parameter group family."
  type        = string
  default     = "mariadb10.11"
}

variable "rds_instance_class" {
  description = "RDS instance class for the dev database."
  type        = string
  default     = "db.t4g.micro"
}

variable "rds_allocated_storage" {
  description = "Initial RDS allocated storage in GiB."
  type        = number
  default     = 20
}

variable "rds_max_allocated_storage" {
  description = "Maximum RDS storage autoscaling size in GiB."
  type        = number
  default     = 100
}

variable "rds_multi_az" {
  description = "Enable Multi-AZ for the dev RDS instance."
  type        = bool
  default     = false
}

variable "rds_backup_retention_period" {
  description = "RDS automated backup retention days."
  type        = number
  default     = 7
}

variable "rds_enabled_cloudwatch_logs_exports" {
  description = "RDS MariaDB logs exported to CloudWatch Logs."
  type        = list(string)
  default     = ["error", "slowquery"]
}

variable "rds_performance_insights_enabled" {
  description = "Enable RDS Performance Insights."
  type        = bool
  default     = false
}

variable "rds_deletion_protection" {
  description = "Enable deletion protection for the dev RDS instance."
  type        = bool
  default     = false
}

variable "rds_skip_final_snapshot" {
  description = "Skip final snapshot when destroying the dev RDS instance."
  type        = bool
  default     = true
}

variable "redis_engine_version" {
  description = "ElastiCache Redis OSS engine version."
  type        = string
  default     = "7.1"
}

variable "redis_parameter_group_family" {
  description = "ElastiCache Redis parameter group family."
  type        = string
  default     = "redis7"
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type for dev."
  type        = string
  default     = "cache.t4g.micro"
}

variable "redis_num_cache_clusters" {
  description = "Number of Redis cache nodes in dev."
  type        = number
  default     = 1
}

variable "redis_automatic_failover_enabled" {
  description = "Enable Redis automatic failover. Requires at least 2 cache nodes."
  type        = bool
  default     = false
}

variable "redis_multi_az_enabled" {
  description = "Enable Redis Multi-AZ. Requires automatic failover."
  type        = bool
  default     = false
}

variable "redis_transit_encryption_enabled" {
  description = "Enable Redis in-transit encryption. Requires application Redis SSL settings."
  type        = bool
  default     = false
}

variable "redis_auth_token" {
  description = "Redis auth token. Used only when transit encryption is enabled."
  type        = string
  default     = null
  sensitive   = true
}

variable "redis_snapshot_retention_limit" {
  description = "Number of days to retain Redis snapshots."
  type        = number
  default     = 3
}

variable "redis_log_retention_in_days" {
  description = "CloudWatch log retention days for Redis logs."
  type        = number
  default     = 14
}

variable "rabbitmq_engine_version" {
  description = "Amazon MQ RabbitMQ engine version."
  type        = string
  default     = "4.2"
}

variable "rabbitmq_host_instance_type" {
  description = "Amazon MQ RabbitMQ broker instance type for dev."
  type        = string
  default     = "mq.t3.micro"
}

variable "rabbitmq_deployment_mode" {
  description = "Amazon MQ RabbitMQ deployment mode."
  type        = string
  default     = "SINGLE_INSTANCE"
}

variable "rabbitmq_admin_username" {
  description = "Amazon MQ RabbitMQ admin username."
  type        = string
  default     = "orderadmin"
}

variable "rabbitmq_admin_password" {
  description = "Amazon MQ RabbitMQ admin password. Stored in Terraform state."
  type        = string
  sensitive   = true
}

variable "rabbitmq_consumer_timeout_ms" {
  description = "RabbitMQ consumer acknowledgement timeout in milliseconds."
  type        = number
  default     = 1800000
}

variable "rabbitmq_general_log_enabled" {
  description = "Enable Amazon MQ RabbitMQ general logs."
  type        = bool
  default     = true
}

variable "rabbitmq_auto_minor_version_upgrade" {
  description = "Enable automatic minor version upgrades for Amazon MQ RabbitMQ."
  type        = bool
  default     = true
}
