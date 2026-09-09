# VPC Module

VPC, public/private subnet, route table, internet gateway, NAT gateway를 관리합니다.

## Features

- VPC DNS hostnames/support 활성화
- Public subnet과 Internet Gateway 구성
- Private subnet과 NAT Gateway 구성
- EKS/ALB 연동을 위한 subnet tag 추가
- 비용 절감을 위한 단일 NAT Gateway 기본 구성

## Usage

```hcl
module "vpc" {
  source = "../../modules/vpc"

  name               = "orderpage-dev"
  vpc_cidr           = "10.20.0.0/16"
  availability_zones = ["ap-northeast-2a", "ap-northeast-2c"]

  public_subnet_cidrs  = ["10.20.1.0/24", "10.20.2.0/24"]
  private_subnet_cidrs = ["10.20.101.0/24", "10.20.102.0/24"]

  enable_nat_gateway = true
}
```
