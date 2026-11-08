output "broker_id" {
  value = aws_mq_broker.this.id
}
output "broker_arn" {
  value = aws_mq_broker.this.arn
}
output "amqps_endpoint" {
  value = aws_mq_broker.this.instances[0].endpoints[0]
}
output "rabbitmq_host" {
  value = replace(replace(aws_mq_broker.this.instances[0].endpoints[0], "amqps://", ""), ":5671", "")
}
output "rabbitmq_port" {
  value = 5671
}
output "security_group_id" {
  value = aws_security_group.this.id
}
output "broker_name" {
  description = "CloudWatch Broker dimension은 이름이다."
  value       = aws_mq_broker.this.broker_name
}
