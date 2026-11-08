variable "name" {
  type = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,49}$", var.name))
    error_message = "이름은 소문자/숫자/하이픈 3~50자여야 합니다."
  }
}
variable "notification_email" {
  description = "실제 수신 주소. tfvars/state에는 저장되므로 Git에 넣지 않는다. 구독 승인 필요."
  type        = string
  validation {
    condition     = can(regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", var.notification_email)) && !can(regex("(?i)(example\\.(com|test)|REPLACE)", var.notification_email))
    error_message = "SNS 구독 승인이 가능한 실제 이메일 주소가 필요합니다."
  }
}
variable "rds_identifier" { type = string }
variable "redis_cluster_id" {
  description = "ReplicationGroupId가 아니라 실제 member CacheClusterId."
  type        = string
}
variable "mq_broker_name" {
  description = "MQ Broker dimension에는 ID/ARN이 아닌 broker_name을 사용한다."
  type        = string
}
variable "jenkins" {
  type    = object({ instance_id = string })
  default = null
}
variable "alb" {
  description = "Controller 생성 후 확인한 ARN suffix. 생성 전에는 null로 두고 2차 plan으로 연결한다."
  type        = object({ load_balancer = string, target_group = string })
  default     = null
  validation {
    condition = var.alb == null ? true : (
      can(regex("^app/[A-Za-z0-9-]+/[a-f0-9]{16}$", var.alb.load_balancer)) &&
      can(regex("^targetgroup/[A-Za-z0-9-]+/[a-f0-9]{16}$", var.alb.target_group))
    )
    error_message = "ALB app/name/id와 TargetGroup targetgroup/name/id suffix를 입력하세요. ARN 전체/DNS는 잘못된 dimension입니다."
  }
}
variable "monthly_budget_usd" {
  description = "선택 기능. 계정 전체 월 누적 비용 알림값이며 3일 프로젝트 지출 상한/자동 차단이 아니다."
  type        = number
  default     = null
  validation {
    condition     = var.monthly_budget_usd == null ? true : var.monthly_budget_usd > 0
    error_message = "예산은 양수여야 합니다. 미확정이면 null로 둡니다."
  }
}
variable "tags" {
  type    = map(string)
  default = {}
}
