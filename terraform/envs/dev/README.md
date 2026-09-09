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

사용 예시:

```bash
terraform init
terraform plan
terraform apply
```

변수 예시는 `terraform.tfvars.example`을 참고합니다.

EKS kubeconfig 연결 예시:

```bash
aws eks update-kubeconfig --region ap-northeast-2 --name orderpage-dev
kubectl get nodes
```
