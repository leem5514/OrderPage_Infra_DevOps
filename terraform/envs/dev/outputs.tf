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
