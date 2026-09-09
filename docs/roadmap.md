# Roadmap

## Phase 0. Repository Setup

- FE/BE/Infra 레포지토리 분리
- 기본 README 작성
- 환경변수 예시 작성
- 로컬 빌드 검증

## Phase 1. Application Stabilization

- Backend test profile 구성
- Testcontainers 또는 H2 기반 테스트 안정화
- DTO validation 보강
- Docker Compose 실행 검증

## Phase 2. CI/CD

- Jenkins 설치 방식 결정
- Backend Jenkinsfile 작성
- Docker image build
- ECR push
- 이미지 취약점 스캔 추가

현재 완료:

- `jenkins/Jenkinsfile.backend`에 백엔드 checkout, test, bootJar, docker build, ECR push, EKS deploy 단계 정의
- `DEPLOY_TARGET` 파라미터로 `build-only`, `ecr-push`, `eks-deploy` 실행 범위 분리

다음 작업:

- 실제 Jenkins 서버 또는 컨테이너 구성
- Jenkins agent에 JDK 11, Docker, AWS CLI, kubectl 설치
- AWS credential 연결
- ECR repository 생성 후 실제 push 검증

## Phase 3. Terraform

- VPC
- ECR
- EKS
- RDS
- ElastiCache
- IAM

## Phase 4. Kubernetes

- Namespace
- Deployment
- Service
- Ingress
- ConfigMap
- Secret
- HPA
- Readiness/Liveness probe

## Phase 5. Observability

- Spring Actuator + Micrometer
- Prometheus
- Grafana dashboard
- CloudWatch logs
- Alert rules

## Phase 6. Performance Report

- k6 load test
- Baseline measurement
- HPA comparison
- Redis/RabbitMQ scenario comparison
- Final performance report
