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
