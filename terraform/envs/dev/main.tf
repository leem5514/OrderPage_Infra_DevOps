module "backend_ecr" {
  source = "../../modules/ecr"

  repository_name = var.backend_ecr_repository_name
  force_delete    = true
  max_image_count = 30

  tags = local.common_tags
}
