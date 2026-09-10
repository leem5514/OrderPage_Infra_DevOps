variable "aws_region" {
  description = "AWS region where the Terraform state bucket is created."
  type        = string
  default     = "ap-northeast-2"
}

variable "project_name" {
  description = "Project name used for tags."
  type        = string
  default     = "orderpage"
}

variable "environment" {
  description = "Environment name used for tags."
  type        = string
  default     = "shared"
}

variable "state_bucket_name" {
  description = "Globally unique S3 bucket name for Terraform remote state."
  type        = string
}

variable "force_destroy" {
  description = "Allow Terraform to delete the bucket even when state objects remain. Keep false for normal operation."
  type        = bool
  default     = false
}

variable "noncurrent_version_expiration_days" {
  description = "Days to keep old state object versions before lifecycle expiration."
  type        = number
  default     = 90
}
