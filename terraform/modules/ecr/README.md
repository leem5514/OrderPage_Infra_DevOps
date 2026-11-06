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
  force_delete    = false
  max_image_count = 30

  tags = {
    Project     = "orderpage"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
```

현재 dev root도 force_delete=false를 사용한다. 종료 시 필요한 이미지/digest를 보존하고,
실습 이미지 삭제 여부를 확인해 저장소를 비운 뒤 destroy한다. 이미지가 남아 있으면 ECR 삭제는 실패한다.
