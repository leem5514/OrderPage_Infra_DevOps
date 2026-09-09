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

현재 완료:

- dev 환경 Terraform provider 기본 구조 추가
- 백엔드 이미지 저장용 ECR module 추가
- ECR lifecycle policy 추가
- ECR scan on push 설정 추가
- VPC module 추가
- public/private subnet, internet gateway, NAT gateway, route table 구성 추가
- EKS module 추가
- EKS cluster, managed node group, add-on, IAM role 구성 추가

다음 작업:

- AWS credential 준비 후 `terraform init`, `terraform plan` 실행
- RDS/ElastiCache module 순차 확장
- Kubernetes manifest 실제 EKS 적용 검증

## Phase 4. Kubernetes

- Namespace
- Deployment
- Service
- Ingress
- ConfigMap
- Secret
- HPA
- Readiness/Liveness probe

현재 완료:

- 백엔드 base manifest 추가
- dev Kustomize overlay 추가
- ALB Ingress, HPA, Actuator probe, Prometheus scrape annotation 추가
- Jenkins `eks-deploy` 단계와 `kubectl apply -k` 배포 흐름 연결

다음 작업:

- AWS Load Balancer Controller 설치
- 실제 RDS/Redis/RabbitMQ endpoint와 Secret 교체
- `kubectl apply -k k8s/overlays/dev` 실제 EKS 적용 검증

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
