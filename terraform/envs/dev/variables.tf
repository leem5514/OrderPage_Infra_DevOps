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
