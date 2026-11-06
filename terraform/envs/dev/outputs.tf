output "vpc_id" {
  value = module.vpc.vpc_id
}
output "public_subnet_ids" {
  value = module.vpc.public_subnet_ids
}
output "private_subnet_ids" {
  value = module.vpc.private_subnet_ids
}
output "backend_ecr_repository_name" {
  value = module.backend_ecr.repository_name
}
output "backend_ecr_repository_url" {
  value = module.backend_ecr.repository_url
}
output "eks_cluster_name" {
  value = module.eks.cluster_name
}
output "eks_cluster_endpoint" {
  value = module.eks.cluster_endpoint
}
output "eks_node_group_name" {
  value = module.eks.node_group_name
}
output "eks_oidc_issuer_url" {
  description = "서비스별 IRSA trust policy에 사용할 issuer."
  value       = module.eks.cluster_oidc_issuer_url
}

output "eks_oidc_provider_arn" {
  value = module.eks.oidc_provider_arn
}
output "data_endpoints" {
  description = "비밀값을 제외한 접속 정보. 계정/CA 파일/Secret 주입은 후속 배포 단계에서 준비한다."
  value = {
    db_host       = module.mariadb.address
    db_port       = module.mariadb.port
    db_name       = module.mariadb.database_name
    redis_host    = module.redis.primary_endpoint_address
    redis_port    = module.redis.port
    rabbitmq_host = module.rabbitmq.rabbitmq_host
    rabbitmq_port = module.rabbitmq.rabbitmq_port
    broker_id     = module.rabbitmq.broker_id
  }
}
output "eks_cluster_security_group_id" {
  description = "후속 데이터 서비스의 접근 범위를 설계할 때 확인할 SG."
  value       = module.eks.cluster_security_group_id
}
