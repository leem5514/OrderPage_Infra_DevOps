# 외부 AWS 호출 없이 plan/apply를 흉내 낸다. 이메일은 테스트 전용 예약 도메인이다.
mock_provider "aws" {
  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
  mock_data "aws_region" { defaults = { name = "ap-northeast-2" } }
  mock_data "aws_partition" { defaults = { partition = "aws" } }
  mock_resource "aws_sns_topic" { defaults = { arn = "arn:aws:sns:ap-northeast-2:123456789012:orderpage-test-operations" } }
}
variables {
  name               = "orderpage-test"
  notification_email = "alerts@unit.invalid"
  rds_identifier     = "orderpage-test-mariadb"
  redis_cluster_id   = "orderpage-test-redis-001"
  mq_broker_name     = "orderpage-test-rabbitmq"
}
run "initial_metrics_have_real_dimensions_and_no_budget" {
  command = plan
  module { source = "../../modules/operations-monitoring" }
  assert {
    condition = (
      length(aws_cloudwatch_metric_alarm.operations) == 6 && length(aws_budgets_budget.account) == 0 &&
      aws_cloudwatch_metric_alarm.operations["redis-memory"].dimensions == tomap({ CacheClusterId = "orderpage-test-redis-001", CacheNodeId = "0001" }) &&
      aws_cloudwatch_metric_alarm.operations["mq-ready"].dimensions == tomap({ Broker = "orderpage-test-rabbitmq" })
    )
    error_message = "기본 6개 경보와 Redis/MQ 실제 dimension이 필요하며 임의 예산을 생성하면 안 됩니다."
  }
  assert {
    condition     = alltrue([for alarm in aws_cloudwatch_metric_alarm.operations : alarm.treat_missing_data == "missing" && alarm.period == 60 && alarm.evaluation_periods == 3 && alarm.datapoints_to_alarm == 2])
    error_message = "연속 지표의 결측을 정상으로 숨기지 않고 60초 2/3 평가를 사용해야 합니다."
  }
}
run "alb_and_jenkins_add_only_their_metrics" {
  command = plan
  module { source = "../../modules/operations-monitoring" }
  variables {
    alb     = { load_balancer = "app/orderpage/0123456789abcdef", target_group = "targetgroup/orderpage/0123456789abcdef" }
    jenkins = { instance_id = "i-0123456789abcdef0" }
  }
  assert {
    condition = (
      length(aws_cloudwatch_metric_alarm.operations) == 10 &&
      aws_cloudwatch_metric_alarm.operations["api-target-5xx"].dimensions["TargetGroup"] == "targetgroup/orderpage/0123456789abcdef" &&
      aws_cloudwatch_metric_alarm.operations["api-alb-5xx"].treat_missing_data == "notBreaching" &&
      aws_cloudwatch_metric_alarm.operations["api-healthy-hosts"].treat_missing_data == "missing" &&
      aws_cloudwatch_metric_alarm.operations["jenkins-status"].period == 300
    )
    error_message = "ALB 자체/앱 오류와 결측, EC2 기본 수집 주기를 구분해야 합니다."
  }
  assert {
    condition     = length(jsondecode(aws_cloudwatch_dashboard.operations.dashboard_body).widgets) == 10
    error_message = "모든 경보 지표가 서울 dashboard에 표시되어야 합니다."
  }
}
run "sns_policy_scopes_services_and_budget_is_opt_in" {
  command = apply
  module { source = "../../modules/operations-monitoring" }
  variables { monthly_budget_usd = 75 }
  assert {
    condition = (
      jsondecode(aws_sns_topic_policy.operations.policy).Statement[1].Condition.StringEquals["aws:SourceAccount"] == "123456789012" &&
      jsondecode(aws_sns_topic_policy.operations.policy).Statement[1].Condition.ArnLike["aws:SourceArn"] == "arn:aws:cloudwatch:ap-northeast-2:123456789012:alarm:orderpage-test-*" &&
      jsondecode(aws_sns_topic_policy.operations.policy).Statement[3].Principal.Service == "budgets.amazonaws.com" &&
      jsondecode(aws_sns_topic_policy.operations.policy).Statement[3].Condition.ArnEquals["aws:SourceArn"] == "arn:aws:budgets::123456789012:budget/orderpage-test-account-monthly"
    )
    error_message = "SNS 발행은 계정/경보 prefix 또는 정확한 Budget ARN에 제한되어야 합니다."
  }
  assert {
    condition     = length(aws_budgets_budget.account) == 1 && alltrue([for n in aws_budgets_budget.account[0].notification : n.notification_type == "ACTUAL"]) && length(aws_budgets_budget.account[0].cost_filter) == 0
    error_message = "옵션 예산은 계정 전체 실제 누적 비용이고 tag 누락 비용을 숨기면 안 됩니다."
  }
  assert {
    condition     = alltrue([for alarm in aws_cloudwatch_metric_alarm.operations : length(alarm.alarm_actions) == 1 && length(alarm.ok_actions) == 1 && length(alarm.insufficient_data_actions) == 1])
    error_message = "장애·복구·결측 알림을 연결해야 합니다."
  }
}
run "reject_dns_instead_of_arn_suffix" {
  command = plan
  module { source = "../../modules/operations-monitoring" }
  variables { alb = { load_balancer = "internal-example.elb.amazonaws.com", target_group = "bad" } }
  expect_failures = [var.alb]
}
run "reject_unconfirmed_placeholder_inputs" {
  command = plan
  module { source = "../../modules/operations-monitoring" }
  variables {
    notification_email = "user@example.com"
    monthly_budget_usd = -1
  }
  expect_failures = [var.notification_email, var.monthly_budget_usd]
}
