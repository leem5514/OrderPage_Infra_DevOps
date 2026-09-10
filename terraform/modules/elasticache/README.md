# ElastiCache Module

Redis 기반 Amazon ElastiCache replication group을 private subnet에 생성하는 모듈입니다.

## Features

- ElastiCache Redis replication group
- ElastiCache subnet group
- VPC security group
- Redis parameter group
- Private subnet only
- At-rest encryption
- Snapshot retention
- CloudWatch slow-log / engine-log export

## Usage

```hcl
module "redis" {
  source = "../../modules/elasticache"

  replication_group_id = "orderpage-dev-redis"
  vpc_id               = module.vpc.vpc_id
  subnet_ids           = module.vpc.private_subnet_ids
  allowed_cidr_blocks  = [module.vpc.vpc_cidr_block]

  node_type          = "cache.t4g.micro"
  num_cache_clusters = 1

  tags = {
    Project     = "orderpage"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
```

## Portfolio Point

Redis를 ElastiCache로 전환하면 재고 차감, refresh token 저장, SSE pub/sub 같은 기능을 관리형 캐시로 분리할 수 있습니다. 이후 k6 테스트에서 Redis 적용 전/후 API latency, DB query 감소, HPA scale out 반응을 비교하는 근거가 됩니다.
