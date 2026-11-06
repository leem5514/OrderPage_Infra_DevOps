# 3단계: 종료 처리와 Kubernetes 상태 점검 준비

기준일: 2026-11-06. AWS 생성/클러스터 적용 없이 앱 생명주기와 manifest를 준비했다.

## 앱에서 변경한 부분

- Spring Boot 2.7.11의 graceful shutdown을 명시적으로 활성화.
- Spring 종료 단계별 20초, Docker stop 유예 60초.
- liveness는 livenessState만 검사. readiness는 readinessState와 DB 검사.
- SSE는 ContextClosedEvent에서 열린 연결을 complete하고 신규 구독은 503으로 거절.
- 같은 사용자 재구독의 이전 연결을 닫고, 이전 callback이 새 연결을 지우지 않도록 처리.
- 재고 알고리즘/리소스·pool/thread 튜닝은 변경하지 않음.

## Infra 파일별 변경

| 파일 | 변경 | 이유 |
|---|---|---|
| k8s/base/deployment.yaml | startupProbe 추가 | 초기 기동에 약 120초 예산. 성공 전 다른 probe 보류 |
| 같은 파일 readinessProbe | /actuator/health/readiness | DB 연결이 끊긴 앱에 트래픽을 계속 보내지 않도록 준비 |
| 같은 파일 livenessProbe | /actuator/health/liveness | 공통 DB 장애로 전체 Pod를 재시작하지 않음 |
| 같은 파일 종료 설정 | terminationGracePeriodSeconds=60, preStop sleep 5 | 라우팅 대상 제외 전파 후 앱 정리에 시간을 줌 |
| k8s/base/ingress.yaml | ALB healthcheck를 readiness로 변경 | Service와 ALB의 준비 상태 판단 경로 정렬 |

preStop 5초도 총 60초 안에 들어간다. Spring 20초는 단계별 제한이라 전체 정리가 항상 60초 안에 끝난다는 보장은 없다. ALB target deregistration/EndpointSlice 전파시간과 부하를 실제 EKS에서 측정해 조정한다.

공유 DB가 내려가면 모든 Pod의 readiness가 실패할 수 있다. 주요 API에 DB가 필수인 현재 서비스의 선택이다. Redis/MQ 전체 업무 가용성은 이 readiness만으로 판정하지 않는다.

## 확인한 결과

| 검증 | 결과 |
|---|---|
| BE 회귀 테스트 / JAR | 22개 통과 / 빌드 성공 |
| Docker Java 11/Linux 빌드 | 성공 |
| 실제 검증 DB 중지 | liveness 200, readiness 503 |
| DB 복구 | readiness 200, 앱 재시작 횟수 변화 없음 |
| SSE 열린 상태에서 stop | 1.502초, SIGTERM만, ExitCode 143, SSE 정상 EOF |
| 유휴 stop | 1.171초, SIGTERM만, ExitCode 143 |
| 기존 기능 smoke | 13개 재통과 |
| kubectl kustomize k8s/overlays/dev | 렌더 성공, 경로/종료 설정 반영 확인 |

이전 stop의 SIGKILL/137과 구분된다. 두 종료 시간은 로컬 단일 실행으로, 통계적 성능 개선율이나 무중단 배포의 증거가 아니다. 단위 테스트는 JDK 17, 실제 컨테이너는 Java 11이었다.

Kustomize 렌더 성공은 Kubernetes API server의 스키마/admission 검증이나 클러스터 동작 검증이 아니다. Docker에 kubelet이 없으므로 실제 Pod 재시작 정책까지 관측한 것도 아니다.

## 기존 설정을 바로 apply하면 안 되는 이유

이번에는 기존 base의 생명주기 관련 부분만 변경했다. 이미지 placeholder, Secret 공급, 새 도메인, HPA 기본 활성 상태, Prometheus 수집 인증, Argo CD 연결 등 나머지 새 설계는 아직 전환 중이다. 이 base 전체를 새 완성 배포본으로 간주하지 않는다. HPA 실험은 기본 배포가 안정화된 뒤 별도 단계로 진행한다.

다음 작업은 새 Terraform 배포 구성과 Kubernetes 기준 구성을 정리하는 것이다. AWS 관리형 TLS/IRSA, 실제 ALB 라우팅 제외, 느린 HTTP 요청 drain, FE SSE 재연결, 롤링 배포 실패율은 이후 검증한다. 현재 FE는 SSE 오류 시 close하므로 서버 정상 종료만으로 알림 무중단을 주장하지 않는다.

검증은 별도 orderpage-readiness DB/포트에서 수행했다. 종료 후 검증 컨테이너를 중지하고 원래 order-be-deploy 네 개를 복구했다. 기존 DB를 삭제하지 않았다.

- [BE 상세 원인·설정·재현 명령](https://github.com/leem5514/OrderPage_BE_DevOps/blob/codex/deployment-readiness/docs/lifecycle-readiness.md)
- [Spring Boot 2.7.11 probe 문서](https://docs.spring.io/spring-boot/docs/2.7.11/reference/html/actuator.html#actuator.endpoints.kubernetes-probes)
- [Kubernetes 종료 절차](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination)
