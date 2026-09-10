output "broker_id" {
  description = "Amazon MQ broker ID."
  value       = aws_mq_broker.this.id
}

output "broker_arn" {
  description = "Amazon MQ broker ARN."
  value       = aws_mq_broker.this.arn
}

output "amqps_endpoint" {
  description = "RabbitMQ AMQPS endpoint."
  value       = aws_mq_broker.this.instances[0].endpoints[0]
}

output "rabbitmq_host" {
  description = "RabbitMQ hostname for Spring RABBITMQ_HOST."
  value       = replace(replace(aws_mq_broker.this.instances[0].endpoints[0], "amqps://", ""), ":${var.amqp_port}", "")
}

output "rabbitmq_port" {
  description = "RabbitMQ AMQPS port for Spring RABBITMQ_PORT."
  value       = var.amqp_port
}

output "console_url" {
  description = "RabbitMQ management console URL."
  value       = aws_mq_broker.this.instances[0].console_url
}

output "security_group_id" {
  description = "Amazon MQ security group ID."
  value       = aws_security_group.this.id
}
