# 고정 Replica / HPA 비교

기본 배포는 Pod 2개 고정이다. hpa-enabled/hpa.yaml만 적용하면 CPU requests 대비 평균 사용률 70%를 기준으로 2~4개를 조절한다.
메모리 기준과 기존 max 5는 제거했다. requests/limits/이미지/DB 설정은 비교 중 바꾸지 않는다.

metrics-server는 아직 설치하지 않았다. 실제 실험 전에 metrics.k8s.io, kubectl top pods/nodes, 관측 도구 포함 Node 여유를 확인한다.
고정/활성 overlay는 현재 템플릿 렌더 검증용이며 실환경에서는 준비된 manifest에 실험용 HPA만 추가한다.

Before로 되돌릴 때 manifest에서 빼는 것만으로 기존 HPA가 지워지지 않는다.
실험 대상 context를 확인하고 해당 HPA를 삭제한 후 replicas=2로 맞춘다.
Argo CD를 붙인 뒤에는 선언 상태와 실험 변경이 서로 되돌리지 않도록 GitOps 소유권을 먼저 정한다.

측정 항목: 동일 부하의 p95, 처리 RPS, 5xx/timeout, Pod 수, 증설/Ready 시간. 최소 3회 반복하고 실제 결과만 기록한다.
[실험 기준](../../../docs/restart/project-process.md)
