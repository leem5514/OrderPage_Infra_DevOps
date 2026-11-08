variable "cluster_name" {
  type = string
}
variable "kubernetes_version" {
  description = "배포 직전에 표준 지원 상태를 확인한 명시적 버전."
  type        = string
  validation {
    condition     = can(regex("^1\\.[0-9]+$", var.kubernetes_version))
    error_message = "Kubernetes minor version을 명시해야 합니다."
  }
}
variable "cluster_subnet_ids" {
  type = list(string)
}
variable "node_subnet_ids" {
  type = list(string)
}
variable "public_access_cidrs" {
  type = list(string)
  validation {
    condition = length(var.public_access_cidrs) > 0 && alltrue([
      for cidr in var.public_access_cidrs :
      can(cidrnetmask(cidr)) && can(regex("/32$", cidr))
    ])
    error_message = "운영자 IPv4 /32만 허용합니다. 0.0.0.0/0은 사용할 수 없습니다."
  }
}
variable "admin_principal_arn" {
  type = string
  validation {
    condition     = can(regex("^arn:aws:iam::[0-9]{12}:role/.+$", var.admin_principal_arn))
    error_message = "IAM Role ARN이 필요합니다. root/user/STS 세션 ARN은 허용하지 않습니다."
  }
}
variable "addon_versions" {
  type = map(string)
  validation {
    condition = (
      toset(keys(var.addon_versions)) == toset(["vpc-cni", "coredns", "kube-proxy"]) &&
      alltrue([for version in values(var.addon_versions) : can(regex("^v[0-9]+\\.[0-9]+\\.[0-9]+-eksbuild\\.[0-9]+$", version))])
    )
    error_message = "기본 add-on 3개의 호환 버전(vX.Y.Z-eksbuild.N)을 지정해야 합니다."
  }
}
variable "tags" {
  type    = map(string)
  default = {}
}
