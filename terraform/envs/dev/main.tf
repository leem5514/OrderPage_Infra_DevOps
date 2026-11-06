# 네트워크/EKS 기반과 관리형 데이터 서비스를 연결한다.
# 아직 실제 apply하지 않으며, 앱/컨트롤러/관측 설정은 후속 단계다.
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

# 기본 VPC CNI에서 Pod의 서비스 접속 트래픽은 Node ENI/SG를 따른다.
# 클러스터 SG 제한은 namespace/Pod별 격리를 보장하지 않는다.
module "mariadb" {
  source                    = "../../modules/rds"
  identifier                = "${var.project_name}-${var.environment}-mariadb"
  vpc_id                    = module.vpc.vpc_id
  subnet_ids                = module.vpc.private_subnet_ids
  allowed_security_group_id = module.eks.cluster_security_group_id
  engine_version            = var.rds_engine_version
  master_password           = var.rds_master_password
  tags                      = local.common_tags
}
module "redis" {
  source                    = "../../modules/elasticache"
  replication_group_id      = "${var.project_name}-${var.environment}-redis"
  vpc_id                    = module.vpc.vpc_id
  subnet_ids                = module.vpc.private_subnet_ids
  allowed_security_group_id = module.eks.cluster_security_group_id
  auth_token                = var.redis_auth_token
  tags                      = local.common_tags
}
module "rabbitmq" {
  source                    = "../../modules/amazonmq"
  broker_name               = "${var.project_name}-${var.environment}-rabbitmq"
  vpc_id                    = module.vpc.vpc_id
  subnet_ids                = module.vpc.private_subnet_ids
  allowed_security_group_id = module.eks.cluster_security_group_id
  admin_password            = var.rabbitmq_admin_password
  tags                      = local.common_tags
}
