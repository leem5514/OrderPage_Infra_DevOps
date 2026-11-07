mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { id = "test-product-images", arn = "arn:aws:s3:::test-product-images" }
  }
}
run "controller_trust_is_exact" {
  command = plan
  module { source = "../../modules/load-balancer-controller-irsa" }
  variables {
    role_name         = "test-controller"
    oidc_provider_arn = "arn:aws:iam::123456789012:oidc-provider/oidc.eks.ap-northeast-2.amazonaws.com/id/TEST"
    oidc_provider_url = "https://oidc.eks.ap-northeast-2.amazonaws.com/id/TEST"
  }
  assert {
    condition = (
      jsondecode(aws_iam_role.this.assume_role_policy).Statement[0].Condition.StringEquals["oidc.eks.ap-northeast-2.amazonaws.com/id/TEST:sub"] == "system:serviceaccount:kube-system:aws-load-balancer-controller" &&
      jsondecode(aws_iam_role.this.assume_role_policy).Statement[0].Condition.StringEquals["oidc.eks.ap-northeast-2.amazonaws.com/id/TEST:aud"] == "sts.amazonaws.com"
    )
    error_message = "Controller IRSA를 다른 ServiceAccount 또는 audience에 열면 안 됩니다."
  }
  assert {
    condition     = length(aws_iam_policy.controller.policy) <= 6144
    error_message = "고정 정책이 IAM 관리형 정책 크기 한도를 넘었습니다."
  }
}
run "public_images_without_public_writes" {
  # mock provider에만 apply한다. 실제 AWS API는 호출하지 않는다.
  command = apply
  module { source = "../../modules/product-images" }
  variables {
    bucket_name       = "test-product-images"
    role_name         = "test-backend"
    oidc_provider_arn = "arn:aws:iam::123456789012:oidc-provider/oidc.eks.ap-northeast-2.amazonaws.com/id/TEST"
    oidc_provider_url = "https://oidc.eks.ap-northeast-2.amazonaws.com/id/TEST"
  }
  assert {
    condition = (
      jsondecode(aws_s3_bucket_policy.images.policy).Statement[0].Action == "s3:GetObject" &&
      jsondecode(aws_s3_bucket_policy.images.policy).Statement[0].Resource == "arn:aws:s3:::test-product-images/*" &&
      jsondecode(aws_s3_bucket_policy.images.policy).Statement[0].Condition.Bool["aws:SecureTransport"] == "true"
    )
    error_message = "공개 권한은 해당 버킷의 HTTPS 이미지 읽기뿐이어야 합니다."
  }
  assert {
    condition = (
      jsondecode(aws_iam_role_policy.upload.policy).Statement[0].Action == ["s3:PutObject"] &&
      jsondecode(aws_iam_role_policy.upload.policy).Statement[0].Resource == "arn:aws:s3:::test-product-images/*" &&
      jsondecode(aws_iam_role.backend.assume_role_policy).Statement[0].Condition.StringEquals["oidc.eks.ap-northeast-2.amazonaws.com/id/TEST:sub"] == "system:serviceaccount:orderpage:orderpage-backend" &&
      jsondecode(aws_iam_role.backend.assume_role_policy).Statement[0].Condition.StringEquals["oidc.eks.ap-northeast-2.amazonaws.com/id/TEST:aud"] == "sts.amazonaws.com"
    )
    error_message = "업로드는 정확한 백엔드 ServiceAccount/STS 및 전용 버킷에만 허용해야 합니다."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.images.block_public_acls && aws_s3_bucket_public_access_block.images.ignore_public_acls && !aws_s3_bucket.images.force_destroy
    error_message = "공개 ACL 및 이미지가 남은 버킷의 강제 삭제를 막아야 합니다."
  }
}
run "acm_uses_dns_without_replacing_apex" {
  command = plan
  variables {
    eks_public_access_cidrs = ["203.0.113.10/32"]
    eks_admin_principal_arn = "arn:aws:iam::123456789012:role/Operator"
    eks_addon_versions      = { vpc-cni = "v1.0.0-eksbuild.1", coredns = "v1.0.0-eksbuild.1", kube-proxy = "v1.0.0-eksbuild.1" }
    rds_engine_version      = "10.11.13"
    rds_master_password     = "MockOnlyRdsPassword1234567890123456"
    redis_auth_token        = "MockOnlyRedisToken1234567890123456"
    rabbitmq_admin_password = "MockOnlyMqPassword1234567890123456"
  }
  assert {
    condition     = aws_acm_certificate.api.domain_name == "api-devops.auctionbid.shop" && aws_acm_certificate.api.validation_method == "DNS"
    error_message = "실습 API 하위 도메인에 DNS 검증 인증서를 요청해야 합니다."
  }
}
