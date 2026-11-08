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
  description = "향후 IRSA 공급자 생성에 사용할 issuer. 현재 IAM OIDC provider는 아직 만들지 않는다."
  value       = module.eks.cluster_oidc_issuer_url
}
output "eks_cluster_security_group_id" {
  description = "후속 데이터 서비스의 접근 범위를 설계할 때 확인할 SG."
  value       = module.eks.cluster_security_group_id
}
