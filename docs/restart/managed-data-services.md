# 5단계: 관리형 데이터 서비스·접근 권한·로그 보관

기준일: 2026-11-06. 기반 커밋 `bd5bdaa` 위의 `codex/managed-data-services`.
PR #2가 아직 열려 있어 이번 PR의 base는 `codex/terraform-foundation`이다. 병합 순서는 기반 PR → 이번 PR이다.

**AWS 리소스 생성, 실제 AWS plan, 자격증명 조회, DNS 변경은 하지 않았다.** 코드와 AWS 없는 테스트를 검증했다.

## 1. 지금 실제로 추가한 것

| 대상 | 설정 | 이유 |
|---|---|---|
| RDS MariaDB | 10.11의 정확한 patch 입력 필수, db.t4g.micro, Single-AZ, gp3 20GiB | 기존 MariaDB 앱과 맞춘 실습 구성 |
| RDS 보안 | private, EKS SG → 3306, 저장 암호화, require_secure_transport=ON | 서버에서 평문 접속 차단 |
| RDS 보관 | 자동 백업 1일, error/slowquery 로그 3일 | 짧은 실습에서 운영 기록 확보 |
| Redis | OSS 7.1, cache.t4g.micro 1개, cluster mode disabled | 현재 앱의 DB 1/2/3 사용 유지 |
| Redis 보안 | EKS SG → 6379, TLS required, AUTH 필수, 저장 암호화 | 무인증/평문 경로 제거 |
| Redis 보관 | snapshot 1일, slow/engine 로그 3일 | 최소 관측과 복구 자료 |
| MQ | RabbitMQ 4.2, mq.m7g.medium, SINGLE_INSTANCE, private subnet 하나 | 현재 신규 생성 가능한 평가용 타입 |
| MQ 보안/로그 | EKS SG → AMQPS 5671, AWS 소유 키, 일반 로그 활성 | 앱 TLS 연결과 기본 운영 로그 |
| EKS OIDC | issuer + audience sts.amazonaws.com | 후속 서비스별 IRSA Role의 신뢰 공급자 |

이것은 고가용성 데이터 계층이 아니다. RDS는 Single-AZ, Redis는 replica 없음, MQ도 단일 인스턴스다.
실습의 HPA·롤링 배포 비교는 애플리케이션 계층을 대상으로 하며 데이터 계층 장애까지 무중단이라고 주장하지 않는다.
MQ 단일 m7g.medium은 기본 200GB 스토리지 비용이 있으므로 기존 견적에 포함한 가정을 유지한다.
AWS의 엔진/API 지원과 quota는 실제 계정의 서울 리전에서 다시 확인한다.

## 2. 접근 제어는 어디까지인가

기존 세 데이터 모듈은 VPC CIDR 전체를 허용했다. 이제 `allowed_security_group_id` 한 개만 받는다.
dev root는 EKS의 cluster security group ID를 넘긴다. 기본 Managed Node Group은 이 SG를 Node에 연결한다.

- RDS/Redis/MQ SG에는 서비스 포트 하나씩만 inbound로 허용한다.
- RDS public endpoint, Redis/MQ 인터넷 공개, 평문 MQ 5672, MQ 관리 UI 포트는 열지 않았다.
- SG 허용은 네트워크 접근 제어다. 데이터베이스·Redis·MQ 계정 인증과는 별개다.
- 같은 EKS SG를 사용하는 다른 Pod까지 구별하는 정책은 아니다. namespace별 격리나 Security Groups for Pods를 구현했다고 해석하면 안 된다.
- 이후 Node launch template SG, VPC CNI, Security Groups for Pods를 바꾸면 이 접근 경계를 다시 검증한다.

OIDC 공급자가 생겼다고 앱이나 ALB Controller에 AWS 권한이 생기지는 않는다.
다음 단계에서 namespace/ServiceAccount subject와 audience를 제한한 서비스별 Role, 필요한 AWS policy, ServiceAccount annotation을 연결한다.
DB/Redis/MQ 비밀번호 인증을 IRSA가 대신하는 것도 아니다.

## 3. 입력값과 민감 정보

| 입력 | 용도 |
|---|---|
| rds_engine_version | 서울의 지원 목록에서 고른 MariaDB 10.11.x 정확한 patch |
| rds_master_password | 최초 DB 관리자 |
| redis_auth_token | Redis AUTH |
| rabbitmq_admin_password | 최초 MQ 관리자 |

세 인증값은 각각 다른 난수 영문/숫자 32~64자로 주입한다. 서로 다른 문자 4개 이상을 요구한다.
이 범위는 서비스마다 다른 비밀번호 제약의 공통 부분을 사용하는 프로젝트 입력 규칙이다.
예시 파일에 실제 비밀번호를 넣지 않으며 TF_VAR 환경변수 또는 Git에서 제외된 보호된 tfvars를 사용한다.
테스트 파일의 MockOnly 문자열은 실제 계정용이 아니다.

`sensitive=true`는 출력 마스킹이다. 현재 provider 인수로 전달한 인증값은 state에 저장된다.
S3 state의 암호화·공개 차단·접근 IAM·버전 기록 보호가 필요하며 state/plan을 Git 또는 공개 artifact에 올리지 않는다.
Secret 주입 경로와 Kubernetes RBAC는 앱 배포 단계에서 함께 검증한다.
`data_endpoints` output에는 host/port/DB 이름/Broker ID만 있고 비밀번호는 없다.

MQ의 `user`는 최초 관리자 생성용이다. 현재 provider는 RabbitMQ 사용자 갱신/드리프트를 관리하지 못한다.
terraform.tfvars의 MQ 비밀번호만 바꾸고 회전이 완료됐다고 판단하면 안 된다. RabbitMQ 관리 API를 통한 별도 계정/회전 절차가 필요하다.
Redis의 SET 전략도 무중단 토큰 교체 절차가 아니다. 현재는 새 실습 환경의 인증 필수 설정으로 사용한다.

## 4. 앱 연결 계약 — 아직 실제 연결은 안 함

현재 빌드 JAR에 MariaDB Connector/J 3.0.10, RabbitMQ Java client 5.14.2가 들어 있음을 확인했다.
앱에는 Redis TLS/AUTH 및 MQ JVM 인증서/호스트명 검증 코드가 이미 있으므로 이번에는 앱 코드를 바꾸지 않았다.

| 환경변수 | 후속 배포에서 사용할 형태 |
|---|---|
| DB_URL | jdbc:mariadb://RDS_HOST:3306/ordersystem?sslMode=verify-full&serverSslCert=/etc/rds-ca/ap-northeast-2-bundle.pem |
| DB_USERNAME / DB_PASSWORD | ordersystem 스키마용 별도 앱 계정과 비밀번호 |
| REDIS_HOST / REDIS_PORT | primary endpoint / 6379 |
| REDIS_SSL_ENABLED / REDIS_PASSWORD | true / 주입한 AUTH 토큰 |
| RABBITMQ_HOST / RABBITMQ_PORT | AMQPS hostname / 5671 |
| RABBITMQ_SSL_ENABLED | true |
| RABBITMQ_USERNAME / RABBITMQ_PASSWORD | 별도로 준비한 앱 계정 |
| RABBITMQ_VHOST | / |

RDS CA 파일의 이미지 포함 또는 read-only mount가 필요하다. 아직 파일을 배포하지 않았다.
[공식 RDS 인증서 안내](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)의 서울 CA를 사용하고 인증서/호스트명 검증을 끄는 우회는 하지 않는다.

Terraform은 현재 SQL 앱 사용자나 RabbitMQ 앱 사용자를 생성하지 않는다.
초기 관리자 계정으로 제한된 운영 경로에서 앱 계정/권한을 준비한 뒤 일반 Pod에는 앱 자격증명만 넣는다.
DB 앱 계정은 현행 ddl-auto=update가 요구하는 ordersystem 내부 DDL/DML 권한을 검토하며 전역 관리자 권한을 주지 않는다.
관리 경로(SG 제한/일시적 작업 Pod 등)는 후속 배포 단계에서 정하고, 관리 UI를 인터넷 전체에 열지 않는다.

RDS/Redis/MQ의 자동 패치는 유지한다. 실제 비교 실험은 maintenance window를 피하고, 전후 엔진 버전·설정 변경 여부를 기록한다.
이전 로컬 RabbitMQ 3.13 검증을 관리형 4.2의 호환성 검증으로 대신할 수 없다.

## 5. MQ 로그 보관의 예외와 처리

RDS/Redis는 Terraform이 로그 그룹을 먼저 만들어 3일 보관을 적용한다.
RabbitMQ는 Amazon MQ의 서비스 연결 역할이 로그를 전달하고 Broker 생성 후 실제 로그 그룹 경로가 결정된다.
현재 AWS provider 5.100.0의 MQ logs 블록에는 retention 설정이 없다. 이 때문에 새 로그 그룹을 Terraform으로 중복 생성하지 않는다.

생성 완료 후 실행할 절차:

```powershell
# 먼저 변경 대상 확인. WhatIf도 계정/Broker 조회 권한은 필요하다.
./scripts/set-mq-log-retention.ps1 -BrokerId <실제-Broker-ID> -ExpectedAccountId <실제-계정-ID> -Profile <실습-프로필> -WhatIf

# 확인한 동일 대상에 보관 3일 적용, 실제 정책 재조회
./scripts/set-mq-log-retention.ps1 -BrokerId <실제-Broker-ID> -ExpectedAccountId <실제-계정-ID> -Profile <실습-프로필>
```

스크립트는 계정·Broker ARN·리전·로그 그룹 경로를 확인하고 CLI 실패 시 중단한다.
로그 그룹이 없으면 임의로 만들지 않는다. MQ 상태/일반 로그 활성화/서비스 연결 역할을 확인한 뒤 다시 실행한다.
필요 권한은 STS 신원 조회, mq:DescribeBroker, logs:PutRetentionPolicy, logs:DescribeLogGroups다.
예상과 다른 계정을 막는 가드는 IAM 정책을 대신하지 않는다.

실제 명령은 아직 실행하지 않았다. 이것은 Terraform 밖의 명시적 후처리이며 자동 적용된 정책으로 기록하면 안 된다.
스크립트 결과의 LogGroup을 종료 목록에 남긴다. Terraform destroy는 이 서비스 생성 로그 그룹을 지우지 않는다.
증거를 내보낸 뒤 해당 로그 그룹의 보존/삭제 여부를 확인해야 저장 비용이 남지 않는다.

## 6. 제거·정리한 코드

- 데이터 SG의 allowed_cidr_blocks 및 VPC 전체 허용 규칙.
- Redis TLS OFF와 빈 AUTH 기본값, 미사용 HA/replica 옵션 및 reader endpoint 출력.
- 미사용 Redis latency-tracking 커스텀 parameter group. 기본 cluster-disabled parameter group 사용.
- MQ의 폐기된 mq.t3.micro 기본값, 사용하지 않는 multi-AZ/custom KMS 선택지.
- 기본값 재선언만 하던 MQ consumer_timeout configuration 리소스/변수.
- RDS 100GB 자동 확장과 미사용 사양/HA/Performance Insights 선택 변수.
- root 연결 계약과 맞지 않던 문서·Controller ServiceAccount 주석.

선택지를 삭제한 이유는 현재 확정한 짧은 실습 구성만 제공하기 위해서다.
운영 환경에 적용할 범용 모듈이나 모든 장애를 자동 복구하는 구성을 만든 것이 아니다.
이전 적용 state가 있다면 리소스/parameter group 삭제 또는 교체가 계획될 수 있으므로 실제 plan 없이 적용하면 안 된다.

## 7. 검증과 한계

- Terraform 1.16.2 / AWS provider 5.100.0: validate 성공.
- mock plan 12개 통과: 기존 기반 6개 + 데이터 보안/비용/입력 거부 6개.
- MQ 로그 스크립트 7개 통과: 정상 변경, WhatIf, 계정 불일치, Broker 계정 불일치, 미생성 로그 그룹, CLI 실패, 변경 후 정책 불일치.
- 재현: terraform -chdir=terraform/envs/dev test, ./scripts/tests/mq-log-retention.tests.ps1.
- mock은 AWS 생성, 실제 RDS patch 제공, TLS handshake, Node SG 전달, MQ queue 동작을 보장하지 않는다.

실제 가동 단계에서 최소 다음을 확인한다.

1. AWS 지원 타입/버전/가용 용량, Terraform plan의 생성·삭제·교체 목록과 비용.
2. Node에서 DB CA/호스트명 검증 성공, 평문 DB 접속 실패, Redis 무인증·평문 접속 실패.
3. 허용 EKS 경로의 서비스 접속, 허용하지 않은 출발지의 차단.
4. MQ 4.2에서 queue/exchange/DLQ 선언과 주문 Redis → MQ → MariaDB 반영.
5. RDS/Redis/MQ 로그 전달, MQ 보관 3일 후처리 확인.
6. 실제 엔진 버전/Pod 이미지/digest/설정으로 실험 기준점 기록.

## 8. 종료와 다음 단계

RDS는 테스트 데이터만 담는 전제로 최종 snapshot을 생략하고 자동 백업도 삭제한다.
Redis는 최종 snapshot을 자동 생성하지 않는다. 수동 snapshot이나 별도로 남긴 백업은 직접 목록을 확인한다.
MQ 메시지, DB/Redis 내용, 로그의 필요한 증거를 삭제 전에 내보낸다. 현재 설정을 실제 운영 데이터에 그대로 적용하지 않는다.

다음은 ALB/ACM 및 서비스별 IRSA, Kubernetes 앱 배포의 실제 Secret/CA/도메인 계약을 구성하는 단계다.
그 뒤 Jenkins/Argo CD, CloudWatch/SNS, Prometheus/Grafana와 비용 관측을 준비하고 집중 가동한다.

선행 결정 사항: 현재 상품 등록 코드는 S3 URL을 DB에 저장하고 브라우저가 직접 이미지를 읽는다.
비공개 S3에 업로드 권한만 주면 상품 이미지가 403이 될 수 있다.
상품 이미지 전용 공개 읽기 또는 비공개 객체의 서명 URL 등 제공 방식은 S3 배포 구성 전에 제안·확정해야 한다.
이번 단계에서는 임의로 버킷을 공개하거나 앱의 이미지 처리 코드를 변경하지 않았다.

## 9. 공식 근거

- [RDS MariaDB TLS 강제](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/mariadb-ssl-connections.require-ssl.html)
- [MariaDB Connector/J 3.0 TLS 설정](https://mariadb.com/resources/blog/whats-new-in-mariadb-connector-j-3-0/)
- [ElastiCache AUTH](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/auth.html)
- [AWS provider 5.100.0 Redis](https://github.com/hashicorp/terraform-provider-aws/blob/v5.100.0/website/docs/r/elasticache_replication_group.html.markdown)
- [MQ RabbitMQ 타입/기본 스토리지](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/rmq-broker-instance-types.html)
- [MQ RabbitMQ 버전 관리](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/rabbitmq-version-management.html)
- [RabbitMQ 로그와 서비스 연결 역할](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/rabbitmq-logging-monitoring.html)
- [AWS provider MQ 사용자 제한](https://github.com/hashicorp/terraform-provider-aws/blob/v5.100.0/website/docs/r/mq_broker.html.markdown)
- [IAM OIDC provider 인증서 처리](https://github.com/hashicorp/terraform-provider-aws/blob/v5.100.0/website/docs/r/iam_openid_connect_provider.html.markdown)
