# EKS 지표 수집: Prometheus·Grafana·Metrics Server

기준일: 2026-11-13 KST. 이 단계는 chart 설정과 백엔드 수집 경로를 로컬에서 검증한다. AWS/EKS에 실제 설치하지 않았다.

## 목적과 선택

기존 CloudWatch/SNS는 RDS·Redis·MQ·ALB 등 AWS 리소스 상태와 이메일 경보를 맡는다. Prometheus는 EKS 안의 Pod/Node/HTTP/JVM 지표를 일정 간격으로 보관하고 Grafana가 이를 시각화한다. HPA의 CPU 판단은 별도 Kubernetes Metrics Server가 제공한다. Prometheus 설치만으로 HPA가 동작하는 것은 아니다. [AWS EKS 설명](https://docs.aws.amazon.com/eks/latest/best-practices/application.html)

공식 kube-prometheus-stack 92.7.0과 Metrics Server chart 3.14.0을 고정했다. Chart의 Kubernetes 요구 조건은 EKS 1.35와 맞지만 실제 API 서버/이미지 pull/노드 배치는 미검증이다. 설치 전에 chart와 이미지 보안 릴리스 및 EKS 지원 상태를 다시 확인한다.

2대의 m6i.large에 이미 BE 2 Pod, Argo CD, AWS Load Balancer Controller가 배치될 예정이다. Prometheus 1개, Grafana 1개, Operator, kube-state-metrics 1개, node-exporter 2개, Metrics Server 1개를 추가한다. 기본 Alertmanager와 수백 기본 규칙은 꺼서 CloudWatch/SNS와 중복 알림을 만들지 않는다. 관리형 EKS control plane의 scheduler/controller-manager/etcd scrape도 비활성이다. Node가 실제로 이 Pod를 수용하고 HPA 최대 4개까지 남는 여유가 있는지는 배포 뒤 `kubectl describe node`와 Pod Pending으로 확인한다. 부족하면 Node 사양/Pod requests를 실측으로 재설계한다. 리소스만 무조건 낮춰 목표를 맞추지 않는다.

Prometheus 30초 수집, 3일/2GB 보관 목표, Grafana UI/Dashboard는 ClusterIP와 127.0.0.1 port-forward만 사용한다. Grafana 관리자 비밀번호는 Git에 넣지 않고 기존 Secret을 참조한다. 대시보드 조회 RBAC는 `observability` namespace로 제한한다.

이번 구성은 별도 PVC를 만들지 않아 Prometheus Pod 재시작 시 TSDB와 수동 Grafana 설정이 사라질 수 있다. 각 비교 실험 직후 `.local/metrics`에 원본을 내보내고 별도로 보관한다. 증거의 지속성이 필요하면 EBS CSI와 영속 PVC를 별도 비용/권한 검토 후 추가한다. 3일 retention은 데이터 보존 보장이 아니라 상한 설정이다.

## 파일과 데이터 흐름

```text
BE Pod /actuator/prometheus ──> Service(orderpage:80) ──> ServiceMonitor ──> Prometheus
EKS kubelet/cAdvisor ───────────────────────────────────────────────────> Prometheus
kube-state-metrics + node-exporter ──────────────────────────────────────> Prometheus
Prometheus ──> Grafana 내부 Dashboard ──> 실험 후 localhost API 원본 내보내기
Metrics Server ──> metrics.k8s.io ──> HPA CPU 증설 판단
AWS 기본 지표 ──> CloudWatch Alarm ──> Amazon SNS 이메일 (별도 경로)
```

- `monitoring/prometheus/values.dev.yaml`: 경량 chart 구성·Prometheus 선택 범위·자원/보관/내부 접근.
- `monitoring/prometheus/metrics-server-values.dev.yaml`: HPA에 필요한 Metrics API.
- `monitoring/prometheus/backend-servicemonitor.yaml`: `orderpage` Service의 `http` 포트와 `/actuator/prometheus`를 30초 간격으로 발견. `release: orderpage-observe`가 차트 selector와 일치해야 한다.
- `monitoring/grafana/orderpage-dashboard.yaml`: API RPS, 5xx/s, p95, Pod CPU/메모리, 가용 Replica 6개 패널. 동일 ConfigMap을 Git으로 관리한다.
- `k8s/base/config.env`와 `scripts/prepare-deployment.mjs`: 모든 비교군에서 `http.server.requests` histogram을 동일하게 켜 p95 bucket을 생성.
- BE의 `SecurityConfigs.java`: `/actuator/prometheus` 익명 GET 허용. 공개 ALB Ingress는 `/actuator` prefix를 고정 404로 차단한다. 내부 Pod 네트워크의 다른 workload에서도 이 지표를 조회할 수 있으므로 민감 정보를 metric label에 넣지 않는다. `/actuator/metrics` 등 다른 경로의 인증은 유지한다.
- `scripts/export-prometheus-evidence.mjs`: localhost port-forward의 query_range 7개 결과를 `.local/metrics`에 저장. 결과 없음은 `no-data`로 표시.

RabbitMQ/Redis의 상세 내부 지표 exporter는 이번에 설치하지 않는다. 관리형 서비스 상태는 기존 CloudWatch/SNS 경보로 본다. Grafana에는 확인 가능한 데이터 패널만 배치했다. JVM/GC는 Micrometer 지표가 실제 Target에서 UP으로 수집된 뒤 추가한다.

## 적용 순서 — 실제 계정 준비 후

1. BE 변경 PR을 main에 병합하고 Jenkins에서 새 이미지 digest를 생성해 Argo CD로 동기화한다. 새 Pod의 내부 `/actuator/prometheus`가 200인지 확인한다. 외부 `https://api-devops.auctionbid.shop/actuator/prometheus`는 계속 404여야 한다.
2. 운영자 kubecontext가 목표 EKS/계정인지 확인한다. Namespace `observability`를 만들고 Grafana 관리자 Secret `orderpage-grafana-admin`에 `admin-user`와 `admin-password` 키를 넣는다. 비밀번호 파일은 Git에서 제외된 `.local` 안에 만들고 실행 후 보존/삭제 정책을 정한다. 실제 값이나 `--from-literal` 인자를 로그에 남기지 않는다.
3. `kubectl get apiservice v1beta1.metrics.k8s.io`와 `helm list -n kube-system`으로 기존 Metrics Server/EKS addon이 있는지 먼저 확인한다. 이미 운영 중이면 중복 설치하지 않는다. 없으면 `helm upgrade --install metrics-server` (chart 3.14.0, `kube-system`, `metrics-server-values.dev.yaml`) 후 `kubectl get --raw /apis/metrics.k8s.io/v1beta1/nodes`와 `kubectl top pods -A`를 확인한다. HPA 실험 전 Metrics API 정상 동작이 필수다.
4. `helm upgrade --install orderpage-observe` (chart 92.7.0, `observability`, `values.dev.yaml`, `--wait --atomic`)한다. CRD 설치, Operator/Prometheus/Grafana/KSM/node-exporter 배치를 확인한다. `kubectl get pods -n observability`에서 Pending/OOM이 없어야 한다.
5. Chart 설치 후 `kubectl apply -f monitoring/prometheus/backend-servicemonitor.yaml` 및 `kubectl apply -f monitoring/grafana/orderpage-dashboard.yaml`. ServiceMonitor CRD가 없으면 먼저 Chart 설치 실패를 해결한다.
6. `kubectl -n observability port-forward svc/orderpage-observe-kube-pro-prometheus 19090:9090 --address 127.0.0.1`, 별도 터미널에서 `kubectl -n observability port-forward svc/orderpage-observe-grafana 13000:80 --address 127.0.0.1`. 인바운드 ALB는 추가하지 않는다.
7. Prometheus Targets에서 BE 2개, kubelet/cAdvisor, KSM, node-exporter가 UP인지 확인한다. 빈 dashboard를 0 성능으로 발표하지 않는다. 실제 요청 부하를 준 뒤 `http_server_requests_seconds_bucket`, `container_cpu_usage_seconds_total`, `kube_deployment_status_replicas_available`의 존재와 라벨을 검증한다.
8. Grafana에서 6개 패널과 값/단위를 확인하고 먼저 기준 환경의 측정 창을 기록한다. 응답지연은 서버 HTTP histogram p95이며 브라우저 왕복/ALB 시간과 다를 수 있다.

Chart 다운로드와 로컬 검사:

```powershell
helm pull kube-prometheus-stack --repo https://prometheus-community.github.io/helm-charts --version 92.7.0 --destination .local
helm pull metrics-server --repo https://kubernetes-sigs.github.io/metrics-server/ --version 3.14.0 --destination .local
helm template orderpage-observe .local/kube-prometheus-stack-92.7.0.tgz --namespace observability --kube-version 1.35.0 -f monitoring/prometheus/values.dev.yaml
helm template metrics-server .local/metrics-server-3.14.0.tgz --namespace kube-system --kube-version 1.35.0 -f monitoring/prometheus/metrics-server-values.dev.yaml
```

실제 설치 명령은 위 `template`을 `upgrade --install`로 바꾸어 사용하고, 현재 kubecontext/생성 대상/Secret을 검토한 뒤 실행한다. Chart의 CRD는 Helm uninstall만으로 모두 제거되지 않을 수 있다. 실험 종료 시 ServiceMonitor와 Dashboard를 정리하고 Chart/잔존 리소스 목록을 확인한다.

## 정량 비교와 증거

기존 계획의 Recreate vs RollingUpdate, 기본 requests vs 실측 requests, 고정 2 Pod vs HPA 2~4 Pod는 **각각 하나의 조건만 변경**한다. 이미지/DB/Node/부하·30초 scrape/HTTP histogram을 고정한다. 최소 3회 반복하고 시각·조건·원본 결과를 함께 둔다.

- RPS: 5분 rate의 중앙값과 부하발생기 목표/실제 처리량을 함께 보고한다. 지표만으로 클라이언트 요청 성공을 증명하지 않는다.
- 5xx: Prometheus 서버 5xx/s와 ALB 5xx 건수, k6의 timeout/연결 오류를 나란히 기록한다. 0이나 빈 시계열을 혼동하지 않는다.
- p95: `http_server_requests_seconds_bucket`으로 계산한 5분 sliding window. k6 p95와는 관측 구간/대상을 구분한다.
- CPU/메모리: Pod 실사용량과 requests/limits, Node allocatable 및 Pod Pending을 함께 비교한다. requests만 낮아지고 Node 수가 같으면 EC2 비용 절감이라고 주장하지 않는다.
- HPA: Metrics API 정상 상태와 증설 시작/준비 완료 시각, `kube_horizontalpodautoscaler_status_current_replicas` 및 5xx/p95를 비교한다. Chart 설치가 HPA 활성화를 의미하지 않는다.

실험 시작/끝 시각을 UTC ISO로 `.local/metric-window.json`에 적는다. 최소 10분~최대 6시간(5분 rate warmup 포함), 3일 이내만 export한다. 예시 파일의 날짜는 실험 시각으로 바꾼다.

```powershell
Copy-Item monitoring/prometheus/metric-window.example.json .local/metric-window.json
node scripts/export-prometheus-evidence.mjs .local/metric-window.json
```

기준은 `phase=baseline`, 변경 후는 `phase=after`, 두 실행의 `scenario`/부하 조건은 동일하게 둔다. 원본 JSON에는 쿼리, series, UTC 수집 시각, no-data 상태가 남는다. 파일 저장은 동일 이름 덮어쓰기를 거부한다. 지표가 없는 실행은 개선율에서 제외하고 누락 이유와 실패 횟수에 남긴다. 동일 범위 비교에서 중앙값·최대치·표본 수를 계산하며, HPA의 증설 시간과 k6 측정은 별도 로그로 대조한다.

## 검증 범위와 비용

실제 chart 92.7.0/3.14.0을 Helm template으로 렌더했다. ServiceMonitor selector, Grafana Role/ClusterIP, Metrics API, Dashboard 6개와 외부 Ingress의 `/actuator` 404 경계를 로컬 테스트로 확인했다. JVM/Pod 수집 성공과 보관 3일 지속성은 실제 클러스터에서 검증해야 한다.

신규 Prometheus/Grafana Pod의 CPU·메모리가 EKS 두 Node 용량을 사용한다. 상시 AMP/AMG 과금은 만들지 않지만 기존 Node를 증설하면 비용이 크게 바뀔 수 있다. 실측 Pod requests와 스케줄 가능 여부를 보고 [기존 비용 계획](project-process.md)을 보정한다. Node 자원이 모자라도 차트를 띄우기 위해 서버 기능/보안 설정을 무리하게 약화하지 않는다.

공식 근거: [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack), [Prometheus Operator ServiceMonitor](https://prometheus-operator.dev/docs/getting-started/design/), [Metrics Server](https://github.com/kubernetes-sigs/metrics-server), [EKS HPA와 Metrics Server](https://docs.aws.amazon.com/eks/latest/best-practices/application.html).
