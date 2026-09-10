# Terraform Remote State Bootstrap

Terraform state는 어떤 AWS 리소스가 이미 만들어졌는지 기록하는 장부입니다.

이 bootstrap root module은 `terraform/envs/dev` 같은 실제 환경을 만들기 전에, state 파일을 저장할 S3 bucket을 먼저 생성합니다.

## 왜 필요한가

- 로컬 PC의 `terraform.tfstate` 분실 위험을 줄입니다.
- S3 versioning으로 state 변경 이력을 복구할 수 있습니다.
- S3 backend `use_lockfile`로 동시에 `apply`되는 상황을 막습니다.
- Jenkins 같은 CI/CD 환경에서도 같은 state를 바라보게 만들 수 있습니다.

현재 Terraform S3 backend는 `use_lockfile = true` 방식의 S3 lockfile을 지원합니다. DynamoDB 기반 locking은 과거에 많이 쓰였지만 현재 Terraform 문서에서는 deprecated로 안내됩니다.

## 사용 순서

1. 예시 변수 파일을 복사합니다.

```bash
cp terraform.tfvars.example terraform.tfvars
```

2. `state_bucket_name`을 본인 AWS 계정에서 전역으로 유일한 이름으로 바꿉니다.

```hcl
state_bucket_name = "orderpage-devops-tfstate-123456789012-ap-northeast-2"
```

3. bootstrap을 실행합니다.

```bash
terraform init
terraform plan
terraform apply
```

4. 출력된 bucket 이름을 `terraform/envs/dev/backend.hcl`에 반영합니다.

```bash
terraform -chdir=../../envs/dev init -backend-config=backend.hcl
```

## 생성 리소스

- S3 bucket
- S3 public access block
- S3 bucket owner enforced ownership
- S3 versioning
- S3 AES256 default encryption
- S3 lifecycle rule for old state versions
- S3 bucket policy denying non-HTTPS access
