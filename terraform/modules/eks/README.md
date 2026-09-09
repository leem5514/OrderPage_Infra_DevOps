# EKS Module

Amazon EKS cluster, node group, cluster addons를 관리합니다.

## Features

- EKS cluster
- EKS managed node group
- Cluster IAM role
- Node group IAM role
- 필수 AWS managed policy attachment
- EKS managed add-ons
  - `vpc-cni`
  - `coredns`
  - `kube-proxy`
- Control plane log 설정
- HPA 실험을 고려한 managed node group scaling 설정

## Usage

```hcl
module "eks" {
  source = "../../modules/eks"

  cluster_name       = "orderpage-dev"
  cluster_subnet_ids = module.vpc.private_subnet_ids
  node_subnet_ids    = module.vpc.private_subnet_ids

  node_instance_types = ["t3.medium"]
  node_desired_size   = 2
  node_min_size       = 1
  node_max_size       = 3

  tags = {
    Project     = "orderpage"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}
```

## Cost Note

개발 환경 기본값은 작은 managed node group으로 시작합니다. 실제 부하 테스트 전까지는 `node_desired_size`를 낮게 유지하고, 테스트 시점에만 확장하는 것을 권장합니다.
