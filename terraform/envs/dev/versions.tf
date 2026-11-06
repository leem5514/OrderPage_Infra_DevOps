terraform {
  # S3 use_lockfile와 mock test를 포함한 검증 도구의 최소 버전.
  required_version = ">= 1.11.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
