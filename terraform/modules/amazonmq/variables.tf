variable "broker_name" {
  description = "실습 리소스 이름."
  type        = string
}
variable "vpc_id" {
  description = "보안 그룹을 생성할 VPC."
  type        = string
}
variable "subnet_ids" {
  description = "private subnet ID 목록."
  type        = list(string)
}
variable "allowed_security_group_id" {
  description = "접속을 허용할 EKS Node 보안 그룹. CIDR 허용은 지원하지 않는다."
  type        = string
  validation {
    condition     = can(regex("^sg-[0-9a-f]+$", var.allowed_security_group_id))
    error_message = "허용 출발지는 유효한 보안 그룹 ID여야 합니다."
  }
}
variable "tags" {
  description = "공통 태그."
  type        = map(string)
  default     = {}
}
variable "admin_password" {
  description = "최초 RabbitMQ 관리자 비밀번호. 생성 후 사용자 변경/회전은 RabbitMQ 관리 API 절차로 수행한다."
  type        = string
  sensitive   = true
  nullable    = false
  validation {
    condition     = can(regex("^[A-Za-z0-9]{32,64}$", var.admin_password)) && try(length(distinct(split("", var.admin_password))) >= 4, false)
    error_message = "실습 인증값은 서로 다른 문자 4개 이상을 포함한 영문/숫자 32~64자로 외부에서 주입해야 합니다."
  }
}
