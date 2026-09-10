# Jenkins

Jenkins pipeline 정의와 운영 문서를 관리합니다.

## Planned Pipelines

- Backend test/build
- Docker image build
- ECR push
- EKS deploy
- Terraform plan/apply

## Backend Pipeline

`Jenkinsfile.backend`는 백엔드 애플리케이션의 CI/CD 흐름을 정의합니다.

기본 흐름:

```text
백엔드 소스 체크아웃
  -> 이미지 태그 준비
  -> ./gradlew test
  -> ./gradlew bootJar
  -> docker build
  -> Amazon ECR push
  -> 인프라 소스 체크아웃
  -> kubectl apply -k
  -> EKS rollout
```

`DEPLOY_TARGET` 파라미터로 실행 범위를 조절합니다.

| Value | Behavior |
|---|---|
| `build-only` | 테스트, JAR 빌드, Docker 이미지 빌드까지만 수행 |
| `ecr-push` | Docker 이미지 빌드 후 Amazon ECR에 push |
| `eks-deploy` | Infra repository checkout, Kubernetes manifest apply, EKS deployment image 업데이트 |

초기 로컬 Jenkins에서는 `build-only`로 먼저 검증하고, AWS credential과 EKS 접근 설정이 준비되면 `ecr-push`, `eks-deploy`로 확장합니다.

Jenkins agent 요구 사항:

- JDK 11
- Git
- Docker CLI 및 Docker daemon 접근 권한
- AWS CLI
- kubectl
- kubectl 내장 Kustomize 지원 버전

추후 Jenkins credential로 분리할 값:

- AWS access key
- AWS secret key
- AWS account ID
- ECR repository name
- kubeconfig 또는 EKS 접근 권한
- Infra repository 접근 권한

## Infra Pipeline

`Jenkinsfile.infra`는 Terraform으로 AWS 인프라 변경을 검증하고, 필요할 때 승인 후 적용하는 흐름을 정의합니다.

기본 흐름:

```text
terraform fmt -check -recursive
  -> terraform init -backend-config=backend.hcl
  -> terraform validate
  -> terraform plan -out=tfplan
  -> 수동 승인
  -> terraform apply tfplan
```

`RUN_APPLY=false`가 기본값이므로 일반 실행은 plan까지만 수행합니다. 실제 리소스 변경은 Jenkins 화면에서 `RUN_APPLY=true`로 실행하고, `Terraform Apply` 단계의 수동 승인까지 통과해야 진행됩니다.

Jenkins agent 요구 사항:

- Terraform CLI
- AWS CLI
- AWS credential
- `terraform/envs/dev/backend.hcl`
- `TF_VAR_rds_master_password`
- `TF_VAR_rabbitmq_admin_password`

`backend.hcl`과 `TF_VAR_*` 값은 민감 정보 또는 계정별 설정이므로 Git에 커밋하지 않습니다. Jenkins credential 또는 Secret file credential로 주입합니다.
