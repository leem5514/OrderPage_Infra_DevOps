variable "cluster_name" {
  description = "EKS cluster name."
  type        = string
}

variable "kubernetes_version" {
  description = "Kubernetes version. Null uses the current EKS default version."
  type        = string
  default     = null
}

variable "cluster_subnet_ids" {
  description = "Subnet IDs used by the EKS control plane."
  type        = list(string)
}

variable "node_subnet_ids" {
  description = "Subnet IDs used by the managed node group."
  type        = list(string)
}

variable "endpoint_private_access" {
  description = "Enable private API server endpoint."
  type        = bool
  default     = true
}

variable "endpoint_public_access" {
  description = "Enable public API server endpoint."
  type        = bool
  default     = true
}

variable "public_access_cidrs" {
  description = "CIDR blocks allowed to access the public API server endpoint."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "enabled_cluster_log_types" {
  description = "EKS control plane log types."
  type        = list(string)
  default     = ["api", "audit", "authenticator"]
}

variable "node_instance_types" {
  description = "Managed node group EC2 instance types."
  type        = list(string)
  default     = ["t3.medium"]
}

variable "node_ami_type" {
  description = "Managed node group AMI type."
  type        = string
  default     = "AL2_x86_64"
}

variable "node_capacity_type" {
  description = "Managed node group capacity type."
  type        = string
  default     = "ON_DEMAND"

  validation {
    condition     = contains(["ON_DEMAND", "SPOT"], var.node_capacity_type)
    error_message = "node_capacity_type must be ON_DEMAND or SPOT."
  }
}

variable "node_disk_size" {
  description = "Managed node root disk size in GiB."
  type        = number
  default     = 20
}

variable "node_desired_size" {
  description = "Initial desired node count."
  type        = number
  default     = 2
}

variable "node_min_size" {
  description = "Minimum node count."
  type        = number
  default     = 1
}

variable "node_max_size" {
  description = "Maximum node count."
  type        = number
  default     = 3
}

variable "node_max_unavailable" {
  description = "Maximum unavailable nodes during node group updates."
  type        = number
  default     = 1
}

variable "node_labels" {
  description = "Kubernetes labels applied to the managed node group."
  type        = map(string)
  default = {
    workload = "general"
  }
}

variable "cluster_addons" {
  description = "EKS managed add-ons installed after node group creation."
  type        = list(string)
  default     = ["vpc-cni", "coredns", "kube-proxy"]
}

variable "tags" {
  description = "Common resource tags."
  type        = map(string)
  default     = {}
}
