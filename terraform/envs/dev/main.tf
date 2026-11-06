# 이번 단계의 실행 범위는 네트워크, 이미지 저장소, Kubernetes 기반뿐이다.
# DB/Redis/MQ와 컨트롤러는 후속 단계에서 검증 후 이 root에 연결한다.
module "vpc" {
  source = "../../modules/vpc"

  name                 = "${var.project_name}-${var.environment}"
  vpc_cidr             = "10.20.0.0/16"
  availability_zones   = ["ap-northeast-2a", "ap-northeast-2c"]
  public_subnet_cidrs  = ["10.20.1.0/24", "10.20.2.0/24"]
  private_subnet_cidrs = ["10.20.101.0/24", "10.20.102.0/24"]
  tags                 = local.common_tags
}

module "backend_ecr" {
  source = "../../modules/ecr"

  repository_name = "${var.project_name}-backend"
  # destroy가 측정용 이미지를 조용히 지우지 않도록 기본적으로 보호한다.
  force_delete    = false
  max_image_count = 30
  tags            = local.common_tags
}

module "eks" {
  source = "../../modules/eks"

  cluster_name        = "${var.project_name}-${var.environment}"
  kubernetes_version  = var.kubernetes_version
  cluster_subnet_ids  = module.vpc.private_subnet_ids
  node_subnet_ids     = module.vpc.private_subnet_ids
  public_access_cidrs = var.eks_public_access_cidrs
  admin_principal_arn = var.eks_admin_principal_arn
  addon_versions      = var.eks_addon_versions
  tags                = local.common_tags

  # Subnet ID만 준비된 시점에 Node가 시작하지 않도록 NAT/route/endpoint 완료도 기다린다.
  depends_on = [module.vpc]
}
