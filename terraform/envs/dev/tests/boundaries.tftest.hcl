# AWS API를 호출하지 않고 전체 plan의 Role별 상한 연결을 검증한다.
mock_provider "aws" {
  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
  mock_data "aws_region" { defaults = { name = "ap-northeast-2" } }
  mock_data "aws_iam_policy_document" { defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" } }
  mock_data "aws_ami" { defaults = { id = "ami-0123456789abcdef0" } }
}

variables {
  enable_operations_monitoring = false
  eks_public_access_cidrs      = ["203.0.113.10/32"]
  eks_admin_principal_arn      = "arn:aws:iam::123456789012:role/Operator"
  eks_addon_versions           = { vpc-cni = "v1.0.0-eksbuild.1", coredns = "v1.0.0-eksbuild.1", kube-proxy = "v1.0.0-eksbuild.1" }
  rds_engine_version           = "10.11.13"
  rds_master_password          = "MockOnlyRdsPassword1234567890123456"
  redis_auth_token             = "MockOnlyRedisToken1234567890123456"
  rabbitmq_admin_password      = "MockOnlyMqPassword1234567890123456"
  enable_jenkins               = true
  jenkins_ami_id               = "ami-0123456789abcdef0"
}

run "all_boundaries_are_in_current_account" {
  command = plan
  assert {
    condition = length(local.workload_boundaries) == 5 && alltrue([
      for kind, arn in local.workload_boundaries : arn == "arn:aws:iam::123456789012:policy/orderpage-dev-boundary-${kind}"
    ])
    error_message = "상한은 현재 계정의 지정한 5개 정책이어야 합니다."
  }
}

run "reject_unreviewed_project" {
  command = plan
  variables { project_name = "another-project" }
  expect_failures = [var.project_name]
}

run "reject_general_admin_boundary" {
  command = plan
  module { source = "../../modules/jenkins" }
  variables {
    name                     = "orderpage-dev-jenkins"
    vpc_id                   = "vpc-0123456789abcdef0"
    subnet_id                = "subnet-0123456789abcdef0"
    ami_id                   = "ami-0123456789abcdef0"
    ecr_repository_arn       = "arn:aws:ecr:ap-northeast-2:123456789012:repository/orderpage-backend"
    permissions_boundary_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
  }
  expect_failures = [var.permissions_boundary_arn]
}
