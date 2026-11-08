variable "enable_operations_monitoring" {
  description = "실제 가동 전에 수신 이메일을 설정하고 활성화한다. 코드 작성만으로 AWS에 적용되지 않는다."
  type        = bool
  default     = false
}
variable "operations_email" {
  type    = string
  default = null
  validation {
    condition     = !var.enable_operations_monitoring || var.operations_email != null
    error_message = "모니터링 활성화에는 실제 SNS 수신 이메일이 필요합니다."
  }
}
variable "monitoring_alb" {
  type    = object({ load_balancer = string, target_group = string })
  default = null
}
variable "monthly_budget_usd" {
  type    = number
  default = null
}
module "operations_monitoring" {
  count              = var.enable_operations_monitoring ? 1 : 0
  source             = "../../modules/operations-monitoring"
  name               = "${var.project_name}-${var.environment}"
  notification_email = var.operations_email
  rds_identifier     = module.mariadb.instance_id
  redis_cluster_id   = module.redis.monitoring_cluster_id
  mq_broker_name     = module.rabbitmq.broker_name
  jenkins            = var.enable_jenkins ? { instance_id = module.jenkins[0].instance_id } : null
  alb                = var.monitoring_alb
  monthly_budget_usd = var.monthly_budget_usd
  tags               = local.common_tags
}
output "operations_monitoring" {
  value = var.enable_operations_monitoring ? {
    sns_topic_arn = module.operations_monitoring[0].sns_topic_arn
    dashboard     = module.operations_monitoring[0].dashboard_name
    alarm_names   = module.operations_monitoring[0].alarm_names
    alb_connected = module.operations_monitoring[0].alb_connected
  } : null
}
