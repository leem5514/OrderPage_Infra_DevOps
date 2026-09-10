output "state_bucket_name" {
  description = "S3 bucket name for Terraform remote state."
  value       = aws_s3_bucket.terraform_state.bucket
}

output "state_bucket_arn" {
  description = "S3 bucket ARN for Terraform remote state."
  value       = aws_s3_bucket.terraform_state.arn
}

output "dev_backend_config" {
  description = "Backend config values for terraform/envs/dev/backend.hcl."
  value = {
    bucket       = aws_s3_bucket.terraform_state.bucket
    key          = "orderpage/dev/terraform.tfstate"
    region       = var.aws_region
    encrypt      = true
    use_lockfile = true
  }
}
