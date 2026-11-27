variable "role_name" { type = string }
variable "oidc_provider_arn" { type = string }
variable "oidc_provider_url" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}

variable "permissions_boundary_arn" {
  description = "관리자 소유 alb-controller 권한 상한 정책 ARN. 권한 부여 정책과 별개다."
  type        = string
  nullable    = false
  validation {
    condition     = can(regex("^arn:aws:iam::[0-9]{12}:policy/orderpage-dev-boundary-alb-controller$", var.permissions_boundary_arn))
    error_message = "해당 역할용 orderpage-dev-boundary-alb-controller 정책 ARN이 필요합니다."
  }
}
