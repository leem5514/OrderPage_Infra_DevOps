output "replication_group_id" {
  description = "ElastiCache replication group ID."
  value       = aws_elasticache_replication_group.this.id
}

output "replication_group_arn" {
  description = "ElastiCache replication group ARN."
  value       = aws_elasticache_replication_group.this.arn
}

output "primary_endpoint_address" {
  description = "Primary Redis endpoint address."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "port" {
  description = "Redis port."
  value       = aws_elasticache_replication_group.this.port
}

output "security_group_id" {
  description = "Redis security group ID."
  value       = aws_security_group.this.id
}

output "subnet_group_name" {
  description = "ElastiCache subnet group name."
  value       = aws_elasticache_subnet_group.this.name
}
output "monitoring_cluster_id" {
  description = "단일 노드 구성의 실제 CacheClusterId. replication group ID와 구분한다."
  value       = one(aws_elasticache_replication_group.this.member_clusters)
}
