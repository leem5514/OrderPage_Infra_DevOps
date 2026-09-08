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
