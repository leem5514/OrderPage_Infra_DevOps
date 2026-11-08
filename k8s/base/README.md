# 기본 리소스

고정 Replica 2, RollingUpdate(maxUnavailable=0/maxSurge=1), readiness/liveness/startup probe.
ALB HTTPS → Pod IP, 공개 Actuator 경로는 404, 내부 ALB probe는 readiness 경로를 직접 확인한다.
Namespace의 ALB readiness gate는 초기 Pod 생성 전에 Service/TargetGroupBinding이 있어야 주입된다.

ConfigMap generator의 이름 hash로 설정/CA 변경을 Deployment에 반영한다.
Secret은 생성하지 않는다. 미주입 Secret이 있으면 Pod가 정상 기동할 수 없다.
HPA와 오래된 JVM/DB pool/consumer 튜닝 변수는 기본 manifest에서 제거했다. 앱 코드의 기존 기본값은 바꾸지 않는다.

[배포 순서](../../docs/restart/https-app-deployment.md)
