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

기본 컨테이너와 Deployment 이름은 `orderpage-backend`입니다. 현재 초안은 [전환 상태](../README.md)를 확인하고 사용하며, 앱 CD는 Argo CD로 구성할 예정입니다.
