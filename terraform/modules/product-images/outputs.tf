output "bucket_name" { value = aws_s3_bucket.images.id }
output "backend_role_arn" { value = aws_iam_role.backend.arn }
