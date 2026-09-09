# OrderPage Infra DevOps

OrderPage 서비스의 DevOps 인프라 레포지토리입니다.

이 레포지토리는 Terraform, Kubernetes, Jenkins, Monitoring, Load Test, 운영 문서를 관리합니다.

## Repository Map

```text
terraform/
  envs/
    dev/
    prod/
  modules/
    vpc/
    ecr/
    eks/
    rds/
    elasticache/
    iam/
k8s/
  base/
  overlays/
    dev/
    prod/
jenkins/
monitoring/
  prometheus/
  grafana/
load-test/
  k6/
docs/
```

## Target Architecture

- Frontend: Vercel
- Backend Runtime: Amazon EKS
- Container Registry: Amazon ECR
- Database: Amazon RDS MariaDB
- Cache: Amazon ElastiCache Redis
- Message Queue: RabbitMQ on EKS or Amazon MQ
- Load Balancer: AWS Load Balancer Controller + ALB
- Observability: Prometheus + Grafana + CloudWatch Logs
- IaC: Terraform
- CI/CD: Jenkins

## First Milestones

1. Terraform backend and provider setup
2. ECR module
3. VPC module
4. Backend Docker image push pipeline
5. EKS cluster
6. Backend Kubernetes deployment
7. Prometheus/Grafana dashboard
8. k6 performance test report
