output "vpc_id" {
  description = "Dev VPC ID."
  value       = module.vpc.vpc_id
}

output "public_subnet_ids" {
  description = "Dev public subnet IDs."
  value       = module.vpc.public_subnet_ids
}

output "private_subnet_ids" {
  description = "Dev private subnet IDs."
  value       = module.vpc.private_subnet_ids
}

output "backend_ecr_repository_name" {
  description = "Backend ECR repository name."
  value       = module.backend_ecr.repository_name
}

output "backend_ecr_repository_url" {
  description = "Backend ECR repository URL for Jenkins."
  value       = module.backend_ecr.repository_url
}

output "eks_cluster_name" {
  description = "Dev EKS cluster name."
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "Dev EKS cluster API endpoint."
  value       = module.eks.cluster_endpoint
}

output "eks_node_group_name" {
  description = "Dev EKS managed node group name."
  value       = module.eks.node_group_name
}

output "eks_oidc_issuer_url" {
  description = "Dev EKS OIDC issuer URL for IRSA."
  value       = module.eks.cluster_oidc_issuer_url
}

output "aws_load_balancer_controller_role_arn" {
  description = "AWS Load Balancer Controller IRSA role ARN."
  value       = try(module.aws_load_balancer_controller_irsa[0].role_arn, null)
}

output "rds_mariadb_endpoint" {
  description = "Dev RDS MariaDB endpoint."
  value       = module.mariadb.endpoint
}

output "rds_mariadb_address" {
  description = "Dev RDS MariaDB address for backend DB_URL."
  value       = module.mariadb.address
}

output "rds_mariadb_port" {
  description = "Dev RDS MariaDB port."
  value       = module.mariadb.port
}

output "rds_mariadb_database_name" {
  description = "Dev RDS MariaDB database name."
  value       = module.mariadb.database_name
}

output "redis_primary_endpoint_address" {
  description = "Dev Redis primary endpoint address for backend REDIS_HOST."
  value       = module.redis.primary_endpoint_address
}

output "redis_reader_endpoint_address" {
  description = "Dev Redis reader endpoint address."
  value       = module.redis.reader_endpoint_address
}

output "redis_port" {
  description = "Dev Redis port."
  value       = module.redis.port
}

output "rabbitmq_amqps_endpoint" {
  description = "Dev Amazon MQ RabbitMQ AMQPS endpoint."
  value       = module.rabbitmq.amqps_endpoint
}

output "rabbitmq_host" {
  description = "Dev RabbitMQ hostname for backend RABBITMQ_HOST."
  value       = module.rabbitmq.rabbitmq_host
}

output "rabbitmq_port" {
  description = "Dev RabbitMQ AMQPS port."
  value       = module.rabbitmq.rabbitmq_port
}

output "rabbitmq_console_url" {
  description = "Dev RabbitMQ management console URL."
  value       = module.rabbitmq.console_url
}
