# Argo CD

공식 chart 10.14.0 / app v3.6.1을 로컬 Helm template으로 검증한다. 실제 설치는 아직 하지 않았다.
values.dev.yaml은 비HA/ClusterIP, ApplicationSet replicas=0, Dex/Notifications 비활성이다.
AppProject는 Infra 저장소와 orderpage namespace의 기본 리소스만 허용한다.
Application은 main의 gitops/environments/dev를 읽고 최초 자동 동기화는 꺼져 있다.

실제 환경 승격과 routing/TGB/Secret/Pod readiness gate 준비를 마친 뒤 수동 sync로 확인하고 자동 동기화를 켠다.
Secret은 Git에서 관리하지 않는다. UI는 port-forward로만 접속한다.
설치·최초 적용·복구 및 측정 절차는 [CI/CD 진행서](../docs/restart/jenkins-argocd.md)를 따른다.
