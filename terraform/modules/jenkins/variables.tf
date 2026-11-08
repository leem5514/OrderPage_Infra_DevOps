variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_id" { type = string }
variable "ami_id" { type = string }
variable "ecr_repository_arn" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
