# RDS Module

MariaDB RDS instance를 private subnet에 생성하는 모듈입니다.

## Features

- RDS MariaDB instance
- DB subnet group
- VPC security group
- Private subnet only
- Storage encryption
- Storage autoscaling
- Automated backup
- CloudWatch error/slowquery log export
- Slow query parameter group

## Usage

```hcl
module "mariadb" {
  source = "../../modules/rds"

  identifier          = "orderpage-dev-mariadb"
  vpc_id              = module.vpc.vpc_id
  subnet_ids          = module.vpc.private_subnet_ids
  allowed_cidr_blocks = [module.vpc.vpc_cidr_block]

  database_name   = "ordersystem"
  master_username = "orderadmin"
  master_password = var.rds_master_password

  tags = {
    Project     = "orderpage"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
```

## Portfolio Point

로컬 MariaDB에서 RDS로 전환하면 백업, 암호화, 장애 복구, CloudWatch 로그 수집을 코드로 설명할 수 있습니다. 이후 k6 테스트에서 DB connection pool, slow query, p95 latency를 함께 비교하는 근거가 됩니다.
