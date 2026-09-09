output "instance_id" {
  description = "RDS instance ID."
  value       = aws_db_instance.this.id
}

output "instance_arn" {
  description = "RDS instance ARN."
  value       = aws_db_instance.this.arn
}

output "address" {
  description = "RDS instance address."
  value       = aws_db_instance.this.address
}

output "endpoint" {
  description = "RDS instance endpoint."
  value       = aws_db_instance.this.endpoint
}

output "port" {
  description = "RDS instance port."
  value       = aws_db_instance.this.port
}

output "database_name" {
  description = "Initial database name."
  value       = aws_db_instance.this.db_name
}

output "security_group_id" {
  description = "RDS security group ID."
  value       = aws_security_group.this.id
}

output "subnet_group_name" {
  description = "RDS DB subnet group name."
  value       = aws_db_subnet_group.this.name
}
