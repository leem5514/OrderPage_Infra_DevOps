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
