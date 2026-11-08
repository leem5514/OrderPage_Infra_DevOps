variable "enable_jenkins" {
  description = "EC2 Jenkins 사용 결정. 비용 검토 후 실제 가동 시 true로 설정한다."
  type        = bool
  default     = false
}
variable "jenkins_ami_id" {
  description = "서울 Amazon 소유 AL2023 x86_64 AMI. 활성화할 때 조회한 ID를 고정한다."
  type        = string
  default     = null
  validation {
    condition     = !var.enable_jenkins || can(regex("^ami-[a-f0-9]{17}$", var.jenkins_ami_id))
    error_message = "Jenkins 활성화 시 검증된 서울 AL2023 AMI ID가 필요합니다."
  }
}
module "jenkins" {
  count              = var.enable_jenkins ? 1 : 0
  source             = "../../modules/jenkins"
  name               = "${var.project_name}-${var.environment}-jenkins"
  vpc_id             = module.vpc.vpc_id
  subnet_id          = module.vpc.private_subnet_ids[0]
  ami_id             = var.jenkins_ami_id
  ecr_repository_arn = module.backend_ecr.repository_arn
  tags               = local.common_tags
  depends_on         = [module.vpc]
}
output "jenkins" {
  value = var.enable_jenkins ? {
    instance_id = module.jenkins[0].instance_id
    role_arn    = module.jenkins[0].role_arn
  } : null
}
