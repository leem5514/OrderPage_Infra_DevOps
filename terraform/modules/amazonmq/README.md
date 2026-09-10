# Amazon MQ Module

Amazon MQ for RabbitMQ broker를 private subnet에 생성하는 모듈입니다.

## Features

- Amazon MQ managed RabbitMQ broker
- VPC security group
- Private subnet only
- RabbitMQ broker configuration
- General log export
- Maintenance window
- AWS owned key encryption

## Usage

```hcl
module "rabbitmq" {
  source = "../../modules/amazonmq"

  broker_name         = "orderpage-dev-rabbitmq"
  vpc_id              = module.vpc.vpc_id
  subnet_ids          = module.vpc.private_subnet_ids
  allowed_cidr_blocks = [module.vpc.vpc_cidr_block]

  admin_username = "orderadmin"
  admin_password = var.rabbitmq_admin_password

  tags = {
    Project     = "orderpage"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
```

## Portfolio Point

RabbitMQ를 EKS 내부에서 직접 운영하지 않고 Amazon MQ로 분리하면 broker 패치, 장애 복구, 로그 수집 같은 운영 부담을 관리형 서비스로 넘긴 결정을 설명할 수 있습니다. 이후 주문 API에서 synchronous DB 반영과 asynchronous queue 반영의 응답 시간 차이를 비교하는 근거가 됩니다.
