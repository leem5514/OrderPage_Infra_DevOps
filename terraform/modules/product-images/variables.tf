variable "bucket_name" { type = string }
variable "role_name" { type = string }
variable "oidc_provider_url" { type = string }
variable "oidc_provider_arn" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
