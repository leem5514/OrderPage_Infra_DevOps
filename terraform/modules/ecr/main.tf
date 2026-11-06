resource "aws_ecr_repository" "this" {
  name = var.repository_name
  # 기본 IMMUTABLE: Git SHA 태그 재사용을 막고 실험 이미지 추적성을 유지한다.
  image_tag_mutability = var.image_tag_mutability
  force_delete         = var.force_delete

  # 이미지 push 시 취약점 스캔을 돌려 보안 지표를 남길 수 있다.
  image_scanning_configuration {
    scan_on_push = var.scan_on_push
  }

  # 저장소의 이미지 레이어를 암호화한다.
  encryption_configuration {
    encryption_type = var.encryption_type
  }

  tags = merge(var.tags, {
    Name = var.repository_name
  })
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name

  # 오래된 이미지를 자동 삭제해 저장 비용과 배포 후보 혼선을 줄인다.
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep recent images and expire older images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.max_image_count
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
