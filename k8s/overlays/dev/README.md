# Dev Overlay

개발 환경 Kubernetes overlay를 관리합니다.

현재 dev overlay는 base manifest 위에 개발 환경용 endpoint placeholder를 덮어씁니다.

배포 전 교체 대상:

- `patch-configmap.yaml`의 RDS endpoint
- `patch-configmap.yaml`의 Redis endpoint
- `patch-configmap.yaml`의 Vercel frontend origin
- `patch-ingress.yaml`의 API host
- `base/secret.yaml`의 placeholder secret 값
