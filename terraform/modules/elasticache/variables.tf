variable "replication_group_id" {
  description = "ElastiCache Redis replication group ID."
  type        = string
}

variable "description" {
  description = "Description for the Redis replication group."
  type        = string
  default     = "OrderPage Redis replication group"
}

variable "vpc_id" {
  description = "VPC ID where the Redis security group is created."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs for the ElastiCache subnet group."
  type        = list(string)
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to connect to Redis."
  type        = list(string)
}

variable "engine_version" {
  description = "Redis OSS engine version."
  type        = string
  default     = "7.1"
}

variable "parameter_group_family" {
  description = "Redis parameter group family matching the engine major version."
  type        = string
  default     = "redis7"
}

variable "node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.micro"
}

variable "port" {
  description = "Redis port."
  type        = number
  default     = 6379
}

variable "num_cache_clusters" {
  description = "Number of cache nodes in the replication group."
  type        = number
  default     = 1

  validation {
    condition     = var.num_cache_clusters >= 1
    error_message = "num_cache_clusters must be at least 1."
  }
}

variable "automatic_failover_enabled" {
  description = "Enable automatic failover. Requires at least 2 cache clusters."
  type        = bool
  default     = false
}

variable "multi_az_enabled" {
  description = "Enable Multi-AZ. Requires automatic failover."
  type        = bool
  default     = false
}

variable "transit_encryption_enabled" {
  description = "Enable in-transit encryption. Requires Redis client SSL configuration."
  type        = bool
  default     = false
}

variable "auth_token" {
  description = "Redis auth token. Used only when transit encryption is enabled."
  type        = string
  default     = null
  sensitive   = true
}

variable "snapshot_retention_limit" {
  description = "Number of days to retain Redis snapshots."
  type        = number
  default     = 3
}

variable "snapshot_window" {
  description = "Daily time range in UTC during which snapshots are created."
  type        = string
  default     = "17:00-18:00"
}

variable "maintenance_window" {
  description = "Weekly time range in UTC for maintenance."
  type        = string
  default     = "sun:18:00-sun:19:00"
}

variable "log_retention_in_days" {
  description = "CloudWatch log retention days for Redis logs."
  type        = number
  default     = 14
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
