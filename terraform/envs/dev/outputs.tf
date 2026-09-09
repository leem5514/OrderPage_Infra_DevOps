output "backend_ecr_repository_name" {
  description = "Backend ECR repository name."
  value       = module.backend_ecr.repository_name
}

output "backend_ecr_repository_url" {
  description = "Backend ECR repository URL for Jenkins."
  value       = module.backend_ecr.repository_url
}
