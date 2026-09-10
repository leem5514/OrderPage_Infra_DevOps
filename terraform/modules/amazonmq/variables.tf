variable "broker_name" {
  description = "Amazon MQ RabbitMQ broker name."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where the Amazon MQ security group is created."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs where the broker is deployed."
  type        = list(string)
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to connect to RabbitMQ."
  type        = list(string)
}

variable "engine_version" {
  description = "Amazon MQ RabbitMQ engine version."
  type        = string
  default     = "4.2"
}

variable "host_instance_type" {
  description = "Amazon MQ broker instance type."
  type        = string
  default     = "mq.t3.micro"
}

variable "deployment_mode" {
  description = "RabbitMQ broker deployment mode."
  type        = string
  default     = "SINGLE_INSTANCE"

  validation {
    condition     = contains(["SINGLE_INSTANCE", "CLUSTER_MULTI_AZ"], var.deployment_mode)
    error_message = "deployment_mode must be SINGLE_INSTANCE or CLUSTER_MULTI_AZ for RabbitMQ."
  }
}

variable "amqp_port" {
  description = "AMQPS port exposed by Amazon MQ for RabbitMQ."
  type        = number
  default     = 5671
}

variable "admin_username" {
  description = "Amazon MQ RabbitMQ admin username."
  type        = string
  default     = "orderadmin"
}

variable "admin_password" {
  description = "Amazon MQ RabbitMQ admin password. Stored in Terraform state."
  type        = string
  sensitive   = true
}

variable "consumer_timeout_ms" {
  description = "RabbitMQ consumer acknowledgement timeout in milliseconds."
  type        = number
  default     = 1800000
}

variable "general_log_enabled" {
  description = "Enable Amazon MQ general logs in CloudWatch."
  type        = bool
  default     = true
}

variable "kms_key_id" {
  description = "Optional customer-managed KMS key ARN for broker encryption."
  type        = string
  default     = null
}

variable "maintenance_day_of_week" {
  description = "Maintenance window day of week."
  type        = string
  default     = "SUNDAY"
}

variable "maintenance_time_of_day" {
  description = "Maintenance window start time in HH:mm format."
  type        = string
  default     = "19:00"
}

variable "maintenance_time_zone" {
  description = "Maintenance window time zone."
  type        = string
  default     = "UTC"
}

variable "auto_minor_version_upgrade" {
  description = "Enable automatic minor version upgrades."
  type        = bool
  default     = true
}

variable "apply_immediately" {
  description = "Apply modifications immediately instead of during maintenance window."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Common resource tags."
  type        = map(string)
  default     = {}
}
