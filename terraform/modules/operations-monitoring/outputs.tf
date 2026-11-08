output "sns_topic_arn" { value = aws_sns_topic.operations.arn }
output "dashboard_name" { value = aws_cloudwatch_dashboard.operations.dashboard_name }
output "alarm_names" { value = sort([for alarm in aws_cloudwatch_metric_alarm.operations : alarm.alarm_name]) }
output "alb_connected" { value = var.alb != null }
