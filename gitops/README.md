# GitOps 배포 경로

실제 AWS 출력이 없으므로 가짜 환경을 커밋하지 않는다. `environments/dev`는 최초 환경 준비 후 생성한다.

1. `scripts/prepare-deployment.mjs`로 실제 환경 `.local/deploy/dev-001`을 생성한다.
2. `node scripts/gitops-release.mjs promote .local/deploy/dev-001`을 실행한다.
3. `kubectl kustomize gitops/environments/dev`와 Git diff를 검토한다. 이 경로에는 Secret/비밀번호/kubeconfig를 넣지 않는다.
4. 최초 승격 PR을 main에 병합한다. Controller → routing/TGB → Secret → application 순서와 Pod gate를 먼저 확인한다.
5. Argo Application을 등록/수동 동기화한 뒤 자동 동기화를 활성화한다.

Jenkins는 기존 환경의 image digest와 release.json만 변경하는 PR을 만든다. main에 직접 push하지 않는다.
release.json은 추적 자료이며 Kustomize의 resources 목록에 넣지 않는다.
새 배포는 PR 병합을 거치고, Argo CD가 main을 읽어 반영한다.
상세 초기 구성/실험/복구 절차는 [CI/CD 진행서](../docs/restart/jenkins-argocd.md)에 기록한다.
