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
