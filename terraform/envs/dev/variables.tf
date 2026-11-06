variable "aws_region" {
  description = "이번 실습과 견적의 기준 리전."
  type        = string
  default     = "ap-northeast-2"
  validation {
    condition     = var.aws_region == "ap-northeast-2"
    error_message = "이번 구성은 서울(ap-northeast-2) 전용입니다."
  }
}

variable "project_name" {
  type    = string
  default = "orderpage"
}

variable "environment" {
  type    = string
  default = "dev"
  validation {
    condition     = var.environment == "dev"
    error_message = "현재 검증 대상 환경은 dev 하나입니다."
  }
}

variable "kubernetes_version" {
  description = "표준 지원 버전. 실제 가동 직전에 서울 리전 지원 상태를 다시 확인한다."
  type        = string
  default     = "1.35"
}

variable "eks_public_access_cidrs" {
  description = "kubectl을 실행할 운영자 공인 IPv4 /32 목록. 전체 인터넷 공개 금지."
  type        = list(string)
}

variable "eks_admin_principal_arn" {
  description = "클러스터 관리자 IAM Role ARN. STS 세션 ARN이나 root ARN을 넣지 않는다."
  type        = string
}

variable "eks_addon_versions" {
  description = "서울/EKS 버전 호환 확인 후 고정할 vpc-cni, coredns, kube-proxy 버전."
  type        = map(string)
}

variable "rds_engine_version" {
  description = "서울에서 지원하는 MariaDB 10.11.x 정확한 patch 버전."
  type        = string
}
variable "rds_master_password" {
  description = "DB 초기 관리자 비밀번호. TF_VAR 또는 보호된 tfvars로 주입."
  type        = string
  sensitive   = true
  nullable    = false
}
variable "redis_auth_token" {
  description = "Redis TLS/AUTH 토큰. TF_VAR 또는 보호된 tfvars로 주입."
  type        = string
  sensitive   = true
  nullable    = false
}
variable "rabbitmq_admin_password" {
  description = "RabbitMQ 최초 관리자 비밀번호. 생성 후 사용자 관리는 별도 절차."
  type        = string
  sensitive   = true
  nullable    = false
}
