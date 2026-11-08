# Jenkins 한 대에 controller와 전용 agent 프로세스를 분리한다.
# 호스트 격리는 아니므로 신뢰한 본인 저장소 main만 실행하는 단기 실습용이다.
data "aws_ami" "selected" {
  owners = ["amazon"]
  filter {
    name   = "image-id"
    values = [var.ami_id]
  }
  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}
resource "aws_security_group" "this" {
  name_prefix = "${var.name}-"
  description = "No inbound; Jenkins access through SSM only"
  vpc_id      = var.vpc_id
  ingress     = []
  # GitHub/Maven/Docker Hub/SSM/ECR 다운로드는 기존 NAT를 사용한다.
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = var.tags
}
resource "aws_iam_role" "this" {
  name = var.name
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ec2.amazonaws.com" } }]
  })
  tags = var.tags
}
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_role_policy" "ecr" {
  role = aws_iam_role.this.id
  name = "backend-image-publish"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage", "ecr:DescribeImages", "ecr:DescribeRepositories"]
        Resource = var.ecr_repository_arn
      }
    ]
  })
}
resource "aws_iam_instance_profile" "this" {
  name = var.name
  role = aws_iam_role.this.name
}
resource "aws_instance" "this" {
  ami                         = data.aws_ami.selected.id
  instance_type               = "m6i.large"
  subnet_id                   = var.subnet_id
  associate_public_ip_address = false
  vpc_security_group_ids      = [aws_security_group.this.id]
  iam_instance_profile        = aws_iam_instance_profile.this.name
  user_data                   = file("${path.module}/bootstrap.sh")
  user_data_replace_on_change = true
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
  root_block_device {
    volume_type           = "gp3"
    volume_size           = 30
    encrypted             = true
    delete_on_termination = true
  }
  tags       = merge(var.tags, { Name = var.name })
  depends_on = [aws_iam_role_policy_attachment.ssm, aws_iam_role_policy.ecr]
}
