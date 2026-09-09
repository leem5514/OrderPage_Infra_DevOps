variable "identifier" {
  description = "RDS instance identifier."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where the RDS security group is created."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs for the DB subnet group."
  type        = list(string)
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to connect to MariaDB."
  type        = list(string)
}

variable "database_name" {
  description = "Initial database name."
  type        = string
  default     = "ordersystem"
}

variable "master_username" {
  description = "RDS master username."
  type        = string
  default     = "orderadmin"
}

variable "master_password" {
  description = "RDS master password. Provide via terraform.tfvars or TF_VAR_rds_master_password."
  type        = string
  sensitive   = true
}

variable "engine_version" {
  description = "MariaDB engine version."
  type        = string
  default     = "10.11"
}

variable "parameter_group_family" {
  description = "MariaDB parameter group family matching the engine major version."
  type        = string
  default     = "mariadb10.11"
}

variable "instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Initial allocated storage in GiB."
  type        = number
  default     = 20
}

variable "max_allocated_storage" {
  description = "Maximum storage autoscaling size in GiB. Set 0 to disable autoscaling."
  type        = number
  default     = 100
}

variable "storage_type" {
  description = "RDS storage type."
  type        = string
  default     = "gp3"
}

variable "port" {
  description = "MariaDB port."
  type        = number
  default     = 3306
}

variable "multi_az" {
  description = "Enable Multi-AZ deployment."
  type        = bool
  default     = false
}

variable "backup_retention_period" {
  description = "Automated backup retention days."
  type        = number
  default     = 7
}

variable "backup_window" {
  description = "Preferred backup window in UTC."
  type        = string
  default     = "18:00-18:30"
}

variable "maintenance_window" {
  description = "Preferred maintenance window in UTC."
  type        = string
  default     = "sun:19:00-sun:19:30"
}

variable "enabled_cloudwatch_logs_exports" {
  description = "MariaDB logs exported to CloudWatch Logs."
  type        = list(string)
  default     = ["error", "slowquery"]
}

variable "slow_query_time" {
  description = "Slow query threshold in seconds."
  type        = string
  default     = "1"
}

variable "performance_insights_enabled" {
  description = "Enable RDS Performance Insights."
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Enable deletion protection."
  type        = bool
  default     = false
}

variable "skip_final_snapshot" {
  description = "Skip final snapshot when destroying the DB instance."
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
