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
