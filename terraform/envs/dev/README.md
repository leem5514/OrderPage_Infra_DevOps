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
- ElastiCache Redis replication group
- ElastiCache Redis CloudWatch log export
- Amazon MQ RabbitMQ broker
- Amazon MQ RabbitMQ security group
- Amazon MQ RabbitMQ general log export
- AWS Load Balancer Controller IRSA role

사용 예시:

```bash
terraform init -backend-config=backend.hcl
terraform plan
terraform apply
```

변수 예시는 `terraform.tfvars.example`을 참고합니다.

Remote state는 `terraform/bootstrap/remote-state`에서 S3 bucket을 먼저 만든 뒤 활성화합니다.

```bash
cp backend.hcl.example backend.hcl
terraform init -backend-config=backend.hcl
```

`backend.hcl`에는 실제 S3 bucket 이름이 들어가므로 커밋하지 않습니다. 예시 파일만 Git에 남깁니다.

RDS password는 실제 값으로 커밋하지 않습니다. PowerShell에서는 아래처럼 환경변수로 주입할 수 있습니다.

```bash
$env:TF_VAR_rds_master_password = 'change-me-strong-password'
$env:TF_VAR_rabbitmq_admin_password = 'change-me-strong-password'
```

Redis TLS/auth는 백엔드 Redis SSL 설정과 함께 켜야 합니다. 현재 dev 기본값은 private subnet과 security group으로 접근을 제한하는 방식입니다.

Amazon MQ RabbitMQ는 AMQPS endpoint를 사용합니다. K8S manifest에서는 `RABBITMQ_SSL_ENABLED=true`와 `RABBITMQ_PORT=5671`로 연결합니다.

AWS Load Balancer Controller IRSA는 EKS OIDC provider와 Controller IAM policy ARN이 준비된 뒤 활성화합니다.

```hcl
enable_aws_load_balancer_controller_irsa = true
eks_oidc_provider_arn                   = "arn:aws:iam::<account-id>:oidc-provider/oidc.eks.ap-northeast-2.amazonaws.com/id/<oidc-id>"
aws_load_balancer_controller_policy_arn = "arn:aws:iam::<account-id>:policy/AWSLoadBalancerControllerIAMPolicy"
```

EKS kubeconfig 연결 예시:

```bash
aws eks update-kubeconfig --region ap-northeast-2 --name orderpage-dev
kubectl get nodes
```
