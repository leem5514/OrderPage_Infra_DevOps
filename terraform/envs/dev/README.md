# Terraform Dev Environment

개발 환경용 Terraform root module입니다.

초기 구성 순서:

1. provider/backend 설정
2. VPC module 연결
3. ECR module 연결
4. EKS module 연결
5. RDS/ElastiCache module 연결

현재 포함된 리소스:

- VPC
- Public subnet
- Private subnet
- Internet Gateway
- NAT Gateway
- Route table
- Backend ECR repository
- EKS cluster
- EKS managed node group
- EKS managed add-ons
- RDS MariaDB instance
- RDS DB subnet group
- RDS security group
- RDS CloudWatch log export

사용 예시:

```bash
terraform init
terraform plan
terraform apply
```

변수 예시는 `terraform.tfvars.example`을 참고합니다.

RDS password는 실제 값으로 커밋하지 않습니다. PowerShell에서는 아래처럼 환경변수로 주입할 수 있습니다.

```bash
$env:TF_VAR_rds_master_password = 'change-me-strong-password'
```

EKS kubeconfig 연결 예시:

```bash
aws eks update-kubeconfig --region ap-northeast-2 --name orderpage-dev
kubectl get nodes
```
