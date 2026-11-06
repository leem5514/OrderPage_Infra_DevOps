# Kubernetes 배포 초안

현재 폴더는 다음 단계에서 새 설계로 전환할 초안이다. AWS에 적용하지 않았다.
[진행서](../docs/restart/project-process.md)와 [Probe 검증](../docs/restart/lifecycle-readiness.md)이 현재 기준이다.

- base: Namespace, Deployment, Service, Ingress, ConfigMap, Secret/ServiceAccount 초안. 종료/Probe 수정 반영.
- overlays/dev: 기존 환경별 patch. 이미지/Secret/도메인 실제 값 주입이 필요.
- benchmarks/hpa: 읽기 부하의 고정/HPA 비교 초안. 현재 max 5 등은 새 계획의 자원 예산 검토 후 전환.
- controllers/aws-load-balancer-controller: IRSA/Helm 설치 초안. 버전/region/vpcId/실제 권한 확인 필요.

기존 base에는 HPA가 포함돼 있다. 후속 작업에서 기본 고정 Replica와 실험용 HPA를 분리한다.
새 Terraform 기반에는 metrics-server가 없으므로 HPA 실행 전 별도 설치/검증이 필요하다.
앱 CD는 Argo CD로 구성할 예정이며 Jenkins가 직접 kubectl set image를 실행하는 방식은 제거했다.
리셋에서 제외한 재고 알고리즘 비교 overlay는 삭제했다.

현재는 `kubectl kustomize k8s/overlays/dev`로 렌더 검증까지만 한다.
