locals {
  oidc_provider_host = replace(var.oidc_provider_url, "https://", "")
}
# 정책은 공식 v3.6.2 파일을 고정한다. 최신 URL을 apply 때마다 내려받지 않는다.
resource "aws_iam_policy" "controller" {
  name   = "${var.role_name}-policy"
  policy = jsonencode(jsondecode(file("${path.module}/vendor/iam_policy.v3.6.2.json")))
  tags   = var.tags
}
resource "aws_iam_role" "this" {
  name = var.role_name
  # audience와 정확한 ServiceAccount를 모두 검사한다.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = var.oidc_provider_arn }
      Condition = { StringEquals = {
        "${local.oidc_provider_host}:sub" = "system:serviceaccount:kube-system:aws-load-balancer-controller"
        "${local.oidc_provider_host}:aud" = "sts.amazonaws.com"
      } }
    }]
  })
  tags = var.tags
}
resource "aws_iam_role_policy_attachment" "this" {
  role       = aws_iam_role.this.name
  policy_arn = aws_iam_policy.controller.arn
}
