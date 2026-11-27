# 실행 안내 — 무엇을 어떻게 설정하는가

> **문서 용도:** 설정 이유와 실행 순서를 찾는 목차입니다. 아래 파일은 기존 구현 설명과 당시 검증 기록을 보존합니다. 지금 완료됐는지는 [통합 점검표](../checks.md), 운영 한도는 [비용 계획](../costs.md)을 확인하세요. [문서 지도](../README.md)

| 문서 | 용도 |
|---|---|
| [IAM 임시 로그인과 CLI·Terraform 인증 연결](aws-login-readiness.md) | AWS 인증·입력 준비 |
| [plan 전에 확인할 프로필·입력·state와 인증 실패 대응](aws-plan-preflight.md) | AWS 인증·입력 준비 |
| [서울 리전에서 조회한 서비스 버전·인스턴스 호환성](seoul-compatibility.md) | 조회 시점의 호환성 근거이며 실제 생성 보장 아님 |
| [Terraform 모듈 구성과 초기 로컬 검증](terraform-foundation.md) | 구성 코드와 적용 절차 |
| [RDS·Redis·Amazon MQ 연결 및 TLS 설정](managed-data-services.md) | 구성 코드와 적용 절차 |
| [도메인·인증서·ALB·Kubernetes·Secret 연결 순서](https-app-deployment.md) | 구성 코드와 적용 절차 |
| [EC2 Jenkins 빌드와 ECR·Argo CD 배포 흐름](jenkins-argocd.md) | 구성 코드와 적용 절차 |
| [Vue 정적 파일, Vercel 도메인과 브라우저 API 경로](frontend-vercel.md) | 구성 코드와 적용 절차 |
| [Vercel CLI 대신 REST API로 업로드·완료 확인](vercel-rest-deployment.md) | 구성 코드와 적용 절차 |
| [CloudWatch 경보·SNS·Cost Explorer·Budget 설정](cloudwatch-cost-monitoring.md) | 구성 코드와 적용 절차 |
| [Kubernetes·HTTP 지표 수집과 내부 대시보드 접근](prometheus-grafana.md) | 구성 코드와 적용 절차 |
| [E01~E05 비교군·측정·결과 보관 절차](experiment-plan-review.md) | 실측 전 기준값·비교 조건·증거 수집 |

명령은 특별한 설명이 없으면 저장소 루트에서 실행합니다. 문서를 읽었다고 apply를 실행하는 것은 아니며, 현재 서비스 apply는 보류 상태입니다.
