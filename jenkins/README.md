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
  -> EKS rollout
```

`DEPLOY_TARGET` 파라미터로 실행 범위를 조절합니다.

| Value | Behavior |
|---|---|
| `build-only` | 테스트, JAR 빌드, Docker 이미지 빌드까지만 수행 |
| `ecr-push` | Docker 이미지 빌드 후 Amazon ECR에 push |
| `eks-deploy` | ECR push 후 EKS deployment image 업데이트 |

초기 로컬 Jenkins에서는 `build-only`로 먼저 검증하고, AWS credential과 EKS 접근 설정이 준비되면 `ecr-push`, `eks-deploy`로 확장합니다.

Jenkins agent 요구 사항:

- JDK 11
- Git
- Docker CLI 및 Docker daemon 접근 권한
- AWS CLI
- kubectl

추후 Jenkins credential로 분리할 값:

- AWS access key
- AWS secret key
- AWS account ID
- ECR repository name
- kubeconfig 또는 EKS 접근 권한
