# Base

공통 Kubernetes manifest를 관리합니다.

포함 리소스:

- Namespace
- ServiceAccount
- ConfigMap
- Secret placeholder
- Backend Deployment
- ClusterIP Service
- HorizontalPodAutoscaler
- ALB Ingress

기본 컨테이너 이름과 Deployment 이름은 Jenkins 배포 단계와 맞춰 `orderpage-backend`로 고정합니다.
