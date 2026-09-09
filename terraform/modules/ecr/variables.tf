variable "repository_name" {
  description = "ECR repository name."
  type        = string
}

variable "image_tag_mutability" {
  description = "ECR image tag mutability. Use IMMUTABLE for production-grade promotion."
  type        = string
  default     = "IMMUTABLE"

  validation {
    condition     = contains(["MUTABLE", "IMMUTABLE"], var.image_tag_mutability)
    error_message = "image_tag_mutability must be MUTABLE or IMMUTABLE."
  }
}

variable "scan_on_push" {
  description = "Enable vulnerability scanning when images are pushed."
  type        = bool
  default     = true
}

variable "encryption_type" {
  description = "ECR encryption type."
  type        = string
  default     = "AES256"

  validation {
    condition     = contains(["AES256", "KMS"], var.encryption_type)
    error_message = "encryption_type must be AES256 or KMS."
  }
}

variable "force_delete" {
  description = "Delete repository even when it still contains images. Useful for dev cleanup."
  type        = bool
  default     = false
}

variable "max_image_count" {
  description = "Maximum number of images to keep before lifecycle expiration."
  type        = number
  default     = 30

  validation {
    condition     = var.max_image_count > 0
    error_message = "max_image_count must be greater than 0."
  }
}

variable "tags" {
  description = "Common resource tags."
  type        = map(string)
  default     = {}
}
