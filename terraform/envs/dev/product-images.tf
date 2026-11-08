data "aws_caller_identity" "current" {}
output "deployment_account_id" {
  value = data.aws_caller_identity.current.account_id
}
module "product_images" {
  source            = "../../modules/product-images"
  bucket_name       = "${var.project_name}-${var.environment}-product-images-${data.aws_caller_identity.current.account_id}"
  role_name         = "${var.project_name}-${var.environment}-backend-upload"
  oidc_provider_url = module.eks.cluster_oidc_issuer_url
  oidc_provider_arn = module.eks.oidc_provider_arn
  tags              = local.common_tags
}
output "product_images" {
  value = {
    bucket_name      = module.product_images.bucket_name
    backend_role_arn = module.product_images.backend_role_arn
  }
}
