# 배포 전 재검토 — 2026-11-15 KST

2026-11-27 후속: 최신 가격표의 단가와 Jenkins·관측을 포함한 계산은 [현재 비용 검토](cost-review-2026-11-27.md)를 참조한다. 아래 과거 견적은 당시 검토 기록으로 유지한다.

2026-11-16 추가 점검: [배포 전 보안 잔여 항목 판단](predeploy-security-assessment.md)에서 주문 입력·긴 비밀번호 문제를 재현하고 실행 의존성·Vercel CLI 권고를 확인했다. 아래는 11/15 검토 이력이며, 공개 배포 판단은 최신 문서를 따른다.

세 저장소의 GitHub main을 동기화한 뒤 코드·테스트·비용 가정을 재검토했다. AWS 리소스 생성과 실제 plan은 수행하지 않았다.

## 수정한 문제

- BE 회원 목록의 동일 조회가 두 번 실행돼 두 번째 호출을 제거했다. 실험에 필요한 HPA/고정 Replica 구성은 사용 목적이 있으므로 유지한다.
- Spring 입력 검증 예외는 거절된 password 값을 포함할 수 있어 stack trace를 기록하지 않게 했다. JWT 파서 원문 메시지도 기록하지 않는다. 알 수 없는 서버 오류는 예외 종류만 기록하고 HTTP와 응답 body 모두 500으로 맞춘다. 추적에 쓸 상세 예외를 줄이는 대신 비밀 입력 노출을 방지한다.
- FE lockfile의 semver 범위 내 보안 갱신을 적용했다. npm audit 전체 권고는 62건(critical 4/high 32)에서 18건(moderate 10/high 8)으로 감소했고, omit=dev 검사는 0건이었다. 남은 Vue CLI 개발 서버/빌드 도구 권고는 공개 런타임과 구분해야 한다. 개발 서버를 인터넷에 노출하지 않고, CI는 신뢰한 main만 빌드한다. force 수정은 CLI 구버전으로의 breaking change를 제안해 적용하지 않았다. 빌드 도구 교체는 별도 제안·호환성 검증이 필요하다.
- 비용 계산의 Jenkins 12시간 고정 가정을 제거했다. 정지 자동화가 없는 현재 구성에서는 Jenkins도 전체 실습시간으로 계산한다. k6는 기존 PC를 사용하므로 별도 EC2 발생기와 그 EIP를 제외하고 EBS는 worker 40GiB + Jenkins 30GiB로 계산한다.

## 최소 비용 판단

보관된 2026-11-06/08 서울 단가로 다시 계산하면 12/24/48/72시간은 각각 약 $9.74/$19.47/$38.94/$58.41이다. 현재 가격 견적 또는 지출 상한이 아니며 CloudWatch/알림/로그·데이터 전송·ALB LCU·ECR/S3 사용량·CPU credit·세금·Vercel 요금 등은 별도다. 기존 진행서의 $52.68은 Jenkins 12시간·k6 EC2 6시간을 가정한 과거 계산이므로 현재 기본값으로 사용하지 않는다.

| 구성 | 유지 근거 / 비용 제어 |
|---|---|
| EKS 표준 지원, worker m6i.large 2대 | 무중단 배포/HPA 실험의 고정 조건. 전체 실측 전 최소 사양이라고 단정하지 않는다. 작은 burstable 노드로 즉시 바꾸면 CPU credit과 비교 조건이 달라진다. |
| NAT 1대 / S3 Gateway endpoint | NAT 이중화와 여러 유료 Interface endpoint를 추가하지 않는다. NAT 처리량과 AZ 간 전송은 별도 관측한다. |
| RDS/Redis 단일 소형 인스턴스 | Multi-AZ/복제와 자동 스토리지 확장을 끈 실습 구성. 장애 시 데이터 복구가 필요한 운영 서비스의 기본값으로 쓰지 않는다. |
| Amazon MQ m7g.medium 단일 | 관리형 MQ 선택을 유지한다. 공식 문서상 t3.micro는 신규 생성 불가이며 m7g.medium은 평가용이다. 더 싼 자체 RabbitMQ는 운영 방식 변경이므로 별도 선택 사항이다. |
| Jenkins m6i.large 1대 | 사용자가 EC2 실행을 선택했다. 초기 빌드/CI 실험을 모아서 수행한 후 중지하면 compute 비용을 줄일 수 있지만 EBS/NAT/EKS 과금은 계속된다. |
| Prometheus/Grafana | EKS 내부 단일 인스턴스, PVC/외부 LB 없음. 유료 관리형 Prometheus/Grafana를 추가하지 않는다. |

AWS Budget은 지출을 자동 차단하지 않는다. 실습 시작 전 종료 시각과 예산을 정하고, 종료 시 Ingress/ALB 정리 후 Terraform 자원과 잔여 EBS/EIP/로그/이미지를 확인한다. 앱만 끄거나 PC를 종료해도 AWS 과금은 멈추지 않는다.

공식 확인: [EKS 표준/연장 지원 요금](https://aws.amazon.com/eks/pricing/), [MQ 지원 인스턴스](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/rmq-broker-instance-types.html).

## 검증과 한계

- BE Java 11 테스트 23개 통과. 민감 입력을 넣은 검증 예외와 서버 오류의 로그·응답에 입력값이 남지 않는 회귀 검사 포함.
- FE 테스트 9개와 lint, 운영 빌드 통과. 기존 산출물 덮어쓰기를 거부하는 패키저 정책에 따라 새 검증 폴더에서 정적 파일 12개 패키징 완료. 번들 크기 경고는 남아 있고 사용자 요청 범위에 따라 성능 목적의 코드 분할은 하지 않았다. 개발 서버는 localhost로 제한했다.
- Infra Node 테스트 36개, Terraform validate와 mock test 22개 통과. 실제 AWS 호환 버전/권한/자원 기동을 증명하는 검사는 아니다.
- 이미 추적된 예시/설정 파일을 실제 키로 채우면 여전히 Git에 노출된다. [자격증명 점검](credential-exposure-audit.md)의 보호 경로를 따른다.
- 전체 애플리케이션 침투 테스트, BE 모든 전이 의존성 CVE 검사, 실제 IAM/Vercel/Jenkins 접근자 검증은 완료한 것으로 주장하지 않는다. 비밀 패턴 검사 통과도 임의 형태의 암호 유출 부재를 보증하지 않는다.
