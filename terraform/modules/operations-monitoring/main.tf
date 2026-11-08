data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}
locals {
  account = data.aws_caller_identity.current.account_id
  region  = data.aws_region.current.name
  arn     = "arn:${data.aws_partition.current.partition}"
  # 초기 임계값은 가설이다. 측정 전후 같은 값/평가 주기로 고정하고 실측으로 재검토한다.
  persistent = {
    "rds-cpu"      = { namespace = "AWS/RDS", metric = "CPUUtilization", stat = "Average", threshold = 80, comparison = "GreaterThanThreshold", dimensions = { DBInstanceIdentifier = var.rds_identifier } }
    "rds-memory"   = { namespace = "AWS/RDS", metric = "FreeableMemory", stat = "Average", threshold = 134217728, comparison = "LessThanThreshold", dimensions = { DBInstanceIdentifier = var.rds_identifier } }
    "rds-storage"  = { namespace = "AWS/RDS", metric = "FreeStorageSpace", stat = "Minimum", threshold = 2147483648, comparison = "LessThanThreshold", dimensions = { DBInstanceIdentifier = var.rds_identifier } }
    "redis-memory" = { namespace = "AWS/ElastiCache", metric = "DatabaseMemoryUsagePercentage", stat = "Average", threshold = 80, comparison = "GreaterThanThreshold", dimensions = { CacheClusterId = var.redis_cluster_id, CacheNodeId = "0001" } }
    "redis-cpu"    = { namespace = "AWS/ElastiCache", metric = "CPUUtilization", stat = "Average", threshold = 80, comparison = "GreaterThanThreshold", dimensions = { CacheClusterId = var.redis_cluster_id, CacheNodeId = "0001" } }
    "mq-ready"     = { namespace = "AWS/AmazonMQ", metric = "MessageReadyCount", stat = "Maximum", threshold = 100, comparison = "GreaterThanThreshold", dimensions = { Broker = var.mq_broker_name } }
  }
  base_alarms = { for key, spec in local.persistent : key => merge(spec, { period = 60, evaluations = 3, datapoints = 2, missing = "missing" }) }
  jenkins_alarms = var.jenkins == null ? {} : {
    # EC2 기본 모니터링에 맞춰 5분. Jenkins 프로세스/HTTP 생존 검사는 아니다.
    "jenkins-status" = { namespace = "AWS/EC2", metric = "StatusCheckFailed", stat = "Maximum", threshold = 0, comparison = "GreaterThanThreshold", dimensions = { InstanceId = var.jenkins.instance_id }, period = 300, evaluations = 2, datapoints = 2, missing = "missing" }
  }
  alb_alarms = var.alb == null ? {} : {
    "api-healthy-hosts" = { namespace = "AWS/ApplicationELB", metric = "HealthyHostCount", stat = "Minimum", threshold = 1, comparison = "LessThanThreshold", dimensions = { LoadBalancer = var.alb.load_balancer, TargetGroup = var.alb.target_group }, period = 60, evaluations = 3, datapoints = 2, missing = "missing" }
    # ALB 자체 오류와 앱 Target 오류를 분리한다. 합계 건수 알림이며 오류율이 아니다.
    "api-alb-5xx"    = { namespace = "AWS/ApplicationELB", metric = "HTTPCode_ELB_5XX_Count", stat = "Sum", threshold = 5, comparison = "GreaterThanOrEqualToThreshold", dimensions = { LoadBalancer = var.alb.load_balancer }, period = 60, evaluations = 3, datapoints = 2, missing = "notBreaching" }
    "api-target-5xx" = { namespace = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", stat = "Sum", threshold = 5, comparison = "GreaterThanOrEqualToThreshold", dimensions = { LoadBalancer = var.alb.load_balancer, TargetGroup = var.alb.target_group }, period = 60, evaluations = 3, datapoints = 2, missing = "notBreaching" }
  }
  alarms = merge(local.base_alarms, local.jenkins_alarms, local.alb_alarms)
}
resource "aws_sns_topic" "operations" {
  name = "${var.name}-operations"
  tags = var.tags
}
resource "aws_sns_topic_policy" "operations" {
  arn = aws_sns_topic.operations.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      { Sid = "AccountOwner", Effect = "Allow", Principal = { AWS = "${local.arn}:iam::${local.account}:root" }, Action = "SNS:*", Resource = aws_sns_topic.operations.arn },
      { Sid = "CloudWatchPublish", Effect = "Allow", Principal = { Service = "cloudwatch.amazonaws.com" }, Action = "SNS:Publish", Resource = aws_sns_topic.operations.arn,
      Condition = { StringEquals = { "aws:SourceAccount" = local.account }, ArnLike = { "aws:SourceArn" = "${local.arn}:cloudwatch:${local.region}:${local.account}:alarm:${var.name}-*" } } },
      { Sid = "RequireTLS", Effect = "Deny", Principal = "*", Action = "SNS:*", Resource = aws_sns_topic.operations.arn, Condition = { Bool = { "aws:SecureTransport" = "false" } } }
      ], var.monthly_budget_usd == null ? [] : [
      { Sid = "BudgetPublish", Effect = "Allow", Principal = { Service = "budgets.amazonaws.com" }, Action = "SNS:Publish", Resource = aws_sns_topic.operations.arn,
      Condition = { StringEquals = { "aws:SourceAccount" = local.account }, ArnEquals = { "aws:SourceArn" = "${local.arn}:budgets::${local.account}:budget/${var.name}-account-monthly" } } }
    ])
  })
}
resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.operations.arn
  protocol  = "email"
  endpoint  = var.notification_email
  # AWS가 보내는 확인 메일을 수신자가 승인해야 실제 알림을 받을 수 있다.
  depends_on = [aws_sns_topic_policy.operations]
}
resource "aws_cloudwatch_metric_alarm" "operations" {
  for_each                  = local.alarms
  alarm_name                = "${var.name}-${each.key}"
  alarm_description         = "OrderPage ${each.key}. Initial threshold; verify dimensions and real datapoints before experiments. See docs/restart/cloudwatch-cost-monitoring.md."
  namespace                 = each.value.namespace
  metric_name               = each.value.metric
  statistic                 = each.value.stat
  threshold                 = each.value.threshold
  comparison_operator       = each.value.comparison
  dimensions                = each.value.dimensions
  period                    = each.value.period
  evaluation_periods        = each.value.evaluations
  datapoints_to_alarm       = each.value.datapoints
  treat_missing_data        = each.value.missing
  alarm_actions             = [aws_sns_topic.operations.arn]
  ok_actions                = [aws_sns_topic.operations.arn]
  insufficient_data_actions = each.value.missing == "missing" ? [aws_sns_topic.operations.arn] : []
  tags                      = var.tags
  depends_on                = [aws_sns_topic_policy.operations]
}
resource "aws_cloudwatch_dashboard" "operations" {
  dashboard_name = "${var.name}-operations"
  dashboard_body = jsonencode({ widgets = [for index, key in sort(keys(local.alarms)) : {
    type = "metric", x = (index % 2) * 12, y = floor(index / 2) * 6, width = 12, height = 6,
    properties = {
      region      = local.region, title = key, stat = local.alarms[key].stat, period = local.alarms[key].period,
      metrics     = [concat([local.alarms[key].namespace, local.alarms[key].metric], flatten([for dimension, value in local.alarms[key].dimensions : [dimension, value]]))],
      annotations = { horizontal = [{ label = "initial threshold", value = local.alarms[key].threshold }] }
    }
  }] })
}
resource "aws_budgets_budget" "account" {
  count        = var.monthly_budget_usd == null ? 0 : 1
  name         = "${var.name}-account-monthly"
  account_id   = local.account
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  # 새 계정/짧은 실습에는 예측값보다 실제 누적값으로 알린다. 자동 중지는 하지 않는다.
  dynamic "notification" {
    for_each = [80, 100]
    content {
      comparison_operator       = "GREATER_THAN"
      threshold                 = notification.value
      threshold_type            = "PERCENTAGE"
      notification_type         = "ACTUAL"
      subscriber_sns_topic_arns = [aws_sns_topic.operations.arn]
    }
  }
  tags       = var.tags
  depends_on = [aws_sns_topic_policy.operations]
}
