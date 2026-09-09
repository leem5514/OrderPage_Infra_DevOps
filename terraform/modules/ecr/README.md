# ECR Module

백엔드 Docker 이미지를 저장할 Amazon ECR repository를 관리합니다.

## Features

- 이미지 태그 immutability 설정
- push 시 이미지 취약점 스캔
- AES256 기본 암호화
- 오래된 이미지 lifecycle 정책
- dev 환경 정리를 위한 `force_delete` 옵션

## Usage

```hcl
module "backend_ecr" {
  source = "../../modules/ecr"

  repository_name = "orderpage-backend"
  force_delete    = true
  max_image_count = 30

  tags = {
    Project     = "orderpage"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
```
