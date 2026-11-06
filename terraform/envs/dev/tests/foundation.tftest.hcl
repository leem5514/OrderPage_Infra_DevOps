# 모든 run은 mock provider + plan이다. AWS API 호출/실제 리소스 생성이 없다.
mock_provider "aws" {
  mock_data "aws_region" {
    defaults = { name = "ap-northeast-2" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

run "private_network_and_single_nat" {
  command = plan
  module { source = "../../modules/vpc" }
  variables {
    name                 = "test"
    vpc_cidr             = "10.20.0.0/16"
    availability_zones   = ["ap-northeast-2a", "ap-northeast-2c"]
    public_subnet_cidrs  = ["10.20.1.0/24", "10.20.2.0/24"]
    private_subnet_cidrs = ["10.20.101.0/24", "10.20.102.0/24"]
  }
  assert {
    condition     = length(aws_subnet.private) == 2 && alltrue([for s in aws_subnet.private : !s.map_public_ip_on_launch])
    error_message = "Node subnet 2개에 public IP 자동 할당이 없어야 합니다."
  }
  assert {
    condition     = alltrue([for s in aws_subnet.public : !s.map_public_ip_on_launch])
    error_message = "Public subnet도 EC2 public IP를 자동으로 할당하면 안 됩니다."
  }
  assert {
    condition     = aws_vpc_endpoint.s3.vpc_endpoint_type == "Gateway"
    error_message = "S3는 유료 interface endpoint 대신 gateway endpoint를 사용해야 합니다."
  }
}

run "eks_security_and_cost_controls" {
  command = plan
  module { source = "../../modules/eks" }
  variables {
    cluster_name        = "test"
    kubernetes_version  = "1.35"
    cluster_subnet_ids  = ["subnet-00000000000000001", "subnet-00000000000000002"]
    node_subnet_ids     = ["subnet-00000000000000001", "subnet-00000000000000002"]
    public_access_cidrs = ["203.0.113.10/32"]
    admin_principal_arn = "arn:aws:iam::123456789012:role/Operator"
    # 구문 테스트용 값이다. AWS 호환 버전으로 쓰면 안 된다.
    addon_versions = {
      vpc-cni = "v1.0.0-eksbuild.1", coredns = "v1.0.0-eksbuild.1", kube-proxy = "v1.0.0-eksbuild.1"
    }
  }
  assert {
    condition     = aws_eks_cluster.this.upgrade_policy[0].support_type == "STANDARD" && aws_cloudwatch_log_group.cluster.retention_in_days == 3
    error_message = "연장 지원 과금/무기한 로그 보관을 막아야 합니다."
  }
  assert {
    condition     = aws_eks_cluster.this.access_config[0].authentication_mode == "API" && !aws_eks_cluster.this.access_config[0].bootstrap_cluster_creator_admin_permissions
    error_message = "관리자 접근은 명시적인 Access Entry로 관리해야 합니다."
  }
  assert {
    condition     = aws_eks_cluster.this.vpc_config[0].endpoint_private_access && aws_eks_cluster.this.vpc_config[0].public_access_cidrs == toset(["203.0.113.10/32"])
    error_message = "Private endpoint와 지정 운영자 IP 제한을 유지해야 합니다."
  }
  assert {
    condition = (
      aws_eks_node_group.default.scaling_config[0].min_size == 2 &&
      aws_eks_node_group.default.scaling_config[0].max_size == 2 &&
      aws_eks_node_group.default.scaling_config[0].desired_size == 2 &&
      aws_eks_node_group.default.capacity_type == "ON_DEMAND"
    )
    error_message = "기준 실험은 Spot 변동 없이 Node 2대로 고정해야 합니다."
  }
  assert {
    condition     = aws_eks_node_group.default.ami_type == "AL2023_x86_64_STANDARD" && aws_launch_template.node.metadata_options[0].http_tokens == "required"
    error_message = "AL2023와 IMDSv2를 사용해야 합니다."
  }
  assert {
    condition     = aws_iam_openid_connect_provider.cluster.client_id_list == toset(["sts.amazonaws.com"])
    error_message = "IRSA OIDC audience는 STS로 제한해야 합니다."
  }
  assert {
    condition     = alltrue([for b in aws_launch_template.node.block_device_mappings : b.ebs[0].encrypted && b.ebs[0].volume_type == "gp3" && b.ebs[0].volume_size == 20])
    error_message = "Node 디스크는 암호화된 20GiB gp3여야 합니다."
  }
}

run "reject_public_api_for_everyone" {
  command = plan
  module { source = "../../modules/eks" }
  variables {
    cluster_name        = "test"
    kubernetes_version  = "1.35"
    cluster_subnet_ids  = ["subnet-00000000000000001", "subnet-00000000000000002"]
    node_subnet_ids     = ["subnet-00000000000000001", "subnet-00000000000000002"]
    public_access_cidrs = ["0.0.0.0/0"]
    admin_principal_arn = "arn:aws:iam::123456789012:role/Operator"
    addon_versions      = { vpc-cni = "v1.0.0-eksbuild.1", coredns = "v1.0.0-eksbuild.1", kube-proxy = "v1.0.0-eksbuild.1" }
  }
  expect_failures = [var.public_access_cidrs]
}

run "reject_root_and_unpinned_addons" {
  command = plan
  module { source = "../../modules/eks" }
  variables {
    cluster_name        = "test"
    kubernetes_version  = "1.35"
    cluster_subnet_ids  = ["subnet-00000000000000001", "subnet-00000000000000002"]
    node_subnet_ids     = ["subnet-00000000000000001", "subnet-00000000000000002"]
    public_access_cidrs = ["203.0.113.10/32"]
    admin_principal_arn = "arn:aws:iam::123456789012:root"
    addon_versions      = { vpc-cni = "latest" }
  }
  expect_failures = [var.admin_principal_arn, var.addon_versions]
}

run "protect_experiment_images" {
  command = plan
  module { source = "../../modules/ecr" }
  variables { repository_name = "test-backend" }
  assert {
    condition     = aws_ecr_repository.this.image_tag_mutability == "IMMUTABLE" && !aws_ecr_repository.this.force_delete
    error_message = "이미지 태그 재사용과 암묵적인 전체 이미지 삭제를 막아야 합니다."
  }
}

run "root_module_wiring" {
  command = plan
  variables {
    eks_public_access_cidrs = ["203.0.113.10/32"]
    eks_admin_principal_arn = "arn:aws:iam::123456789012:role/Operator"
    eks_addon_versions      = { vpc-cni = "v1.0.0-eksbuild.1", coredns = "v1.0.0-eksbuild.1", kube-proxy = "v1.0.0-eksbuild.1" }
    # mock 전용 문자열. 실제 AWS 계정에서 사용하는 인증값이 아니다.
    rds_engine_version      = "10.11.13"
    rds_master_password     = "MockOnlyRdsPassword1234567890123456"
    redis_auth_token        = "MockOnlyRedisToken1234567890123456"
    rabbitmq_admin_password = "MockOnlyMqPassword1234567890123456"
  }
  assert {
    condition     = output.eks_cluster_name == "orderpage-dev" && output.backend_ecr_repository_name == "orderpage-backend"
    error_message = "Root의 기반 모듈 연결 결과가 예상한 실습 이름과 다릅니다."
  }
  assert {
    condition     = output.data_endpoints.db_port == 3306 && output.data_endpoints.redis_port == 6379 && output.data_endpoints.rabbitmq_port == 5671
    error_message = "Root 데이터 서비스 접속 계약이 예상 포트와 다릅니다."
  }
}
