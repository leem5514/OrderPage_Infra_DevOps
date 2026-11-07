# ALB는 Controller가 소유한다. Terraform에서 같은 ALB를 중복 생성하지 않는다.
module "aws_load_balancer_controller_irsa" {
  source            = "../../modules/load-balancer-controller-irsa"
  role_name         = "${var.project_name}-${var.environment}-alb-controller"
  oidc_provider_arn = module.eks.oidc_provider_arn
  oidc_provider_url = module.eks.cluster_oidc_issuer_url
  tags              = local.common_tags
}
resource "aws_acm_certificate" "api" {
  domain_name       = var.api_domain_name
  validation_method = "DNS"
  # DNS 제공자를 아직 확정하지 않았으므로 기존 zone/레코드는 자동 변경하지 않는다.
  lifecycle { create_before_destroy = true }
  tags = local.common_tags
}
variable "api_domain_name" {
  type    = string
  default = "api-devops.auctionbid.shop"
  validation {
    condition     = can(regex("^[a-z0-9-]+\\.auctionbid\\.shop$", var.api_domain_name))
    error_message = "기존 apex를 건드리지 않는 auctionbid.shop 하위 도메인을 지정해야 합니다."
  }
}
output "https_deployment" {
  value = {
    api_domain          = var.api_domain_name
    certificate_arn     = aws_acm_certificate.api.arn
    controller_role_arn = module.aws_load_balancer_controller_irsa.role_arn
    # 인증서 생성 뒤 이 CNAME들을 DNS 제공자에 등록하고 ISSUED를 확인한다.
    validation_records = [for option in aws_acm_certificate.api.domain_validation_options : {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }]
  }
}
