resource "aws_s3_bucket" "images" {
  bucket        = var.bucket_name
  force_destroy = false
  tags          = var.tags
}
resource "aws_s3_bucket_ownership_controls" "images" {
  bucket = aws_s3_bucket.images.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_public_access_block" "images" {
  bucket             = aws_s3_bucket.images.id
  block_public_acls  = true
  ignore_public_acls = true
  # 사용자가 선택한 전용 공개 상품 이미지 버킷. 계정 전체 BPA는 변경하지 않는다.
  block_public_policy     = false
  restrict_public_buckets = false
}
resource "aws_s3_bucket_server_side_encryption_configuration" "images" {
  bucket = aws_s3_bucket.images.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_policy" "images" {
  bucket = aws_s3_bucket.images.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicImageReadOverHttps"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.images.arn}/*"
        Condition = { Bool = { "aws:SecureTransport" = "true" } }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.images.arn, "${aws_s3_bucket.images.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }
    ]
  })
  depends_on = [aws_s3_bucket_public_access_block.images]
}
locals {
  issuer_host = replace(var.oidc_provider_url, "https://", "")
}
resource "aws_iam_role" "backend" {
  name = var.role_name
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = var.oidc_provider_arn }
      Condition = { StringEquals = {
        "${local.issuer_host}:sub" = "system:serviceaccount:orderpage:orderpage-backend"
        "${local.issuer_host}:aud" = "sts.amazonaws.com"
      } }
    }]
  })
  tags = var.tags
}
resource "aws_iam_role_policy" "upload" {
  name = "product-image-upload"
  role = aws_iam_role.backend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = "${aws_s3_bucket.images.arn}/*"
    }]
  })
}
