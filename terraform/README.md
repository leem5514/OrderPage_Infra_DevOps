# Terraform

AWS 인프라를 코드로 관리한다.

## Structure

```text
envs/dev
envs/prod
modules/vpc
modules/ecr
modules/eks
modules/rds
modules/elasticache
modules/iam
```

## Commands

```bash
terraform fmt -recursive
terraform init
terraform plan
terraform apply
```

## Current Scope

현재 dev 환경에는 VPC 네트워크, 백엔드 Docker 이미지를 저장할 ECR repository, EKS cluster와 managed node group 구성이 포함되어 있습니다.

```bash
cd terraform/envs/dev
terraform init
terraform plan
```
