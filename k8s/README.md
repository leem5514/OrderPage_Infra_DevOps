# Kubernetes Manifests

EKS 배포용 Kubernetes manifest를 관리합니다.

## Structure

```text
base/
controllers/
  aws-load-balancer-controller/
overlays/dev/
overlays/prod/
```

## Apply

개발 환경 배포:

```bash
kubectl apply -k k8s/overlays/dev
kubectl rollout status deployment/orderpage-backend -n orderpage --timeout=180s
```

이미지는 Jenkins 파이프라인에서 ECR push 이후 다음 명령으로 교체합니다.

```bash
kubectl set image deployment/orderpage-backend orderpage-backend=<ecr-image-uri> -n orderpage
```

## Notes

- `k8s/base/secret.yaml`은 포트폴리오 실습용 placeholder입니다. 실제 배포 전에는 RDS, Redis, Amazon MQ, JWT 값을 Jenkins credential 또는 External Secrets 방식으로 교체해야 합니다.
- Ingress는 AWS Load Balancer Controller가 설치된 EKS를 전제로 합니다.
- HPA는 CPU 70%, memory 80% 기준으로 2~5개 Pod 사이에서 scale out 되도록 설정했습니다.
