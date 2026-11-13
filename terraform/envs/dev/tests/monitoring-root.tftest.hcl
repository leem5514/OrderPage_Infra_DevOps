mock_provider "aws" {
  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
  mock_data "aws_region" { defaults = { name = "ap-northeast-2" } }
  mock_data "aws_partition" { defaults = { partition = "aws" } }
  mock_data "aws_iam_policy_document" { defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" } }
}
run "root_monitoring_enabled_before_alb_creation" {
  command = plan
  variables {
    eks_public_access_cidrs      = ["203.0.113.10/32"]
    eks_admin_principal_arn      = "arn:aws:iam::123456789012:role/Operator"
    eks_addon_versions           = { vpc-cni = "v1.0.0-eksbuild.1", coredns = "v1.0.0-eksbuild.1", kube-proxy = "v1.0.0-eksbuild.1" }
    rds_engine_version           = "10.11.13"
    rds_master_password          = "MockOnlyRdsPassword1234567890123456"
    redis_auth_token             = "MockOnlyRedisToken1234567890123456"
    rabbitmq_admin_password      = "MockOnlyMqPassword1234567890123456"
    enable_operations_monitoring = true
    operations_email             = "alerts@unit.invalid"
  }
  assert {
    condition     = length(output.operations_monitoring.alarm_names) == 6 && !output.operations_monitoring.alb_connected
    error_message = "ALB 생성 전에도 실제 데이터 모듈과 연결한 6개 관측 경보를 plan할 수 있어야 합니다."
  }
}
