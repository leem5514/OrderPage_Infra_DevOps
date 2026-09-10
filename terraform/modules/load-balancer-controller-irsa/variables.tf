variable "role_name" {
  description = "IAM role name for AWS Load Balancer Controller IRSA."
  type        = string
}

variable "oidc_provider_arn" {
  description = "EKS OIDC provider ARN."
  type        = string
}

variable "oidc_provider_url" {
  description = "EKS OIDC provider issuer URL."
  type        = string
}

variable "policy_arn" {
  description = "IAM policy ARN for AWS Load Balancer Controller."
  type        = string
}

variable "namespace" {
  description = "Kubernetes namespace of the controller service account."
  type        = string
  default     = "kube-system"
}

variable "service_account_name" {
  description = "Kubernetes service account name used by AWS Load Balancer Controller."
  type        = string
  default     = "aws-load-balancer-controller"
}

variable "tags" {
  description = "Common resource tags."
  type        = map(string)
  default     = {}
}
