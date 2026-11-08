# dev

이 디렉터리는 계정 정보가 없는 base의 렌더 확인용이다.

```powershell
kubectl kustomize k8s/overlays/dev
```

실제 배포 파일은 Terraform JSON 출력 + deployment-settings.example.json의 실제 값을 사용해 생성한다.
prepare-deployment는 .local/deploy 아래 새 디렉터리에만 생성하며 AWS/클러스터에 적용하지 않는다.
[전체 사용 절차](../../../docs/restart/https-app-deployment.md)
