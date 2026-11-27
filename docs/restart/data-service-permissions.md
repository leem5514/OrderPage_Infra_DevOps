# 데이터 서비스 권한: 작은 실습 환경을 만들고 정리하기

2026-11-27. PR #27의 공개 파일 283개와 변경 커밋을 다시 검사해 민감정보 탐지 0건을 확인하고 병합했다. 이어서 데이터 서비스 정책 4개와 plan 검사기를 작성했다. **Terraform HCL·앱 코드·자원 수는 바꾸지 않았고 AWS 정책 연결·서비스 apply도 하지 않았다.**

## 이번에 준비한 범위

기존 코드의 데이터 서비스 자원 6개를 대상으로 한다. 보안 그룹은 [이전 네트워크 권한](network-compute-permissions.md)에서 다뤘고, 로그 그룹·로그 전달 권한은 관측 권한 단계에서 합친다.

| 서비스 | 현재 실습 구성 | 정책에서 제한하는 주요 범위 |
|---|---|---|
| RDS MariaDB | `db.t4g.micro`, 20GiB gp3, 단일 AZ, private | 지정 DB·subnet/parameter group 이름. 생성 시 작은 타입·저장소 크기·암호화·private·단일 AZ |
| ElastiCache Redis | `cache.t4g.micro` 1개, cluster mode 비활성 | 지정 replication/subnet group 및 기본 parameter group. 생성 시 작은 타입·TLS·저장 암호화·인증 토큰 |
| Amazon MQ RabbitMQ | `mq.m7g.medium`, 단일 인스턴스, private | 생성 시 서울·계정·요청 태그. 이후 변경·삭제는 지정 broker 이름과 AWS가 부여하는 ID 범위 |

새 자원에 생성 태그를 요구하는 조건을 기존 부모에 그대로 붙이지 않았다. RDS의 DB 생성은 DB 외에 parameter/subnet/기본 option group 권한도 나누어 허용한다. Redis는 replication group 외에 AWS가 만드는 자식 cache cluster, subnet group, `default.redis7` 사용을 구분한다. 기본 그룹은 프로젝트 태그를 갖지 않으므로 이름이 정해진 ARN으로 제한한다.

[RDS 권한표](https://docs.aws.amazon.com/service-authorization/latest/reference/list_rds.html), [ElastiCache 권한표](https://docs.aws.amazon.com/service-authorization/latest/reference/list_elasticache.html), [MQ 권한표](https://docs.aws.amazon.com/service-authorization/latest/reference/list_mq.html)를 대조했다. 이번에 선택한 Action 40개와 provider v5.100.0 소스 6개의 해시는 [검토 자료](../../iam/data-services/authorization-reference.json)에 기록했다. 계정의 실제 유효 권한이나 서비스 실행 검증을 대신하는 자료는 아니다.

## 생성 조건을 수정 API에 그대로 쓰지 않은 이유

RDS 생성에는 `rds:PubliclyAccessible=false`를 사용할 수 있지만, 현재 권한 참조에서 `ModifyDBInstance`는 이 조건 키를 지원하지 않는다. 따라서 갱신 정책에 해당 조건을 넣어 공개 전환이 차단된다고 주장하지 않는다. 갱신에서는 지원되는 클래스·저장소 크기 등의 조건을 사용하고, private 설정은 plan에서 재검사한다.

Redis의 `AuthTokenEnabled`는 요청에 비어 있지 않은 토큰을 보냈는지 나타낸다. 정상적인 부분 갱신에서 토큰을 생략해도 false로 평가될 수 있으므로, 모든 갱신에 true를 강제하면 로그나 유지보수 설정 변경까지 막힐 수 있다. 생성에는 인증 조건을 요구하지만, 갱신의 인증·TLS·cluster mode는 plan 검토 항목으로 남겼다. 문자열 타입·parameter group 비교는 AWS 안내에 맞춰 대소문자를 구분하지 않는다. [ElastiCache 조건 사용 안내](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/IAM.ConditionKeys.html).

이 한계를 테스트에도 명시했다. IAM 로컬 평가에서 허용되는 공개 접근·인증 변경 사례가 있다는 사실과, 같은 변경을 plan 검사가 실패로 처리하는 사실을 각각 검증한다. **plan 검사기는 직접 API 호출을 막는 보안 경계가 아니다.** 실제 연결 전에는 최종 전체 정책과 실행 경로를 검토해야 한다. parameter group 내부의 `require_secure_transport` 값도 IAM만으로 고정할 수 없으므로 별도 검사한다.

## MQ는 생성 단계의 제약이 더 크다

`mq:CreateBroker`는 리소스 수준 권한을 지원하지 않아 `Resource=*`가 필요하다. IAM에 존재하지 않는 인스턴스 타입·엔진·public 접근 조건을 만들어 넣지 않았다. 현재 broker 이름, RabbitMQ 4.2, `mq.m7g.medium`, `SINGLE_INSTANCE`, private 여부는 plan 검사에서 확인한다. 이 정책이 같은 태그를 가진 다른 크기·엔진의 생성을 완전히 차단한다고 표현하지 않는다.

RabbitMQ는 서비스 연결 Role로 네트워크와 로그 작업을 수행한다. 기존 IAM 위임 정책의 `AWSServiceRoleForAmazonMQ` 생성 경로와 함께 검토했으며, ActiveMQ용 일반 ENI 생성·위임 권한을 배포 Role에 추가하지 않았다. 실제 서비스 의존 권한은 최초 적용 전후에 재확인해야 한다. [MQ 서비스 연결 Role](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/using-service-linked-roles.html).

provider가 RabbitMQ 사용자 변경·드리프트를 완전히 관리하지 못하는 한계도 유지된다. 이번 정책에 ActiveMQ 사용자 API나 추가 OAuth 인증 구성 권한을 넣어 해결된 것처럼 처리하지 않았다. [고정 provider의 broker 구현](https://github.com/hashicorp/terraform-provider-aws/blob/v5.100.0/internal/service/mq/broker.go).

## 비용과 삭제에 대한 판단

이번 정책은 현재 자원을 운영하고 정리할 권한을 준비한다. 새로운 자원이나 고가 구성을 추가하지 않았다. RDS 복제본·클러스터·스냅샷 복원, Redis 서버리스·글로벌 그룹·별도 클러스터 생성과 replica 수 변경, MQ 추가 configuration·replica 생성은 현재 필요 없어 거부한다. 생성 시 지원되는 타입·저장소 조건을 검사하지만, 실행 횟수나 MQ 크기까지 강제하는 지출 상한은 아니다.

기존 단기 실습 설정은 RDS 삭제 시 최종 snapshot을 남기지 않고 자동 백업도 삭제한다. 검사기는 이 설정과 보관 기간 1일을 확인한다. 이는 테스트 데이터에 대한 결정이며 운영 데이터에는 그대로 적용하면 안 된다. 실제 종료 때는 삭제 plan과 남은 백업·로그·네트워크 비용을 별도로 확인한다.

태그 정책은 생성 의존 태깅과 기존 자원 태깅을 나누고, 소유 태그 세 개의 값 변경·대소문자 변형 삭제·키 목록 없는 삭제를 거부한다. 다만 같은 명명 범위의 기존 자원에 올바른 생성 태그를 붙이는 경로까지 독점 소유로 증명하는 장치는 아니다. 다른 Allow와 관리자 권한까지 막는 permissions boundary로 해석하지 않는다.

## 검증 결과와 다음 단계

전체 Node 테스트 **125개**가 통과했다. 신규 10개는 잘못된 타입·큰 저장소·public DB·무인증 Redis·다른 리전·추가 제품·태그 변경 등을 포함한다. 이전 IAM·EKS·네트워크 정책과 함께 로컬 요청을 평가하고, 공식 Action/Resource/Condition 지원 범위도 검사했다. AWS IAM 시뮬레이터나 실제 생성·삭제 시험은 아직 아니다.

저장된 실제 전체 plan에서는 데이터 자원 **6개**, 설정 **22개**를 검사해 통과했다. 크기·버전·암호화·인증·로그·삭제 설정과 비밀값의 존재/민감 표기를 검사하고 결과에는 값 자체를 넣지 않았다. 비밀번호 강도나 정상 접속을 검증한 결과는 아니다. Redis의 nullable bool 두 개가 plan에서 문자열 `"true"`로 표현되는 차이도 반영했으며 `"false"`는 실패한다.

[공개 검증 결과](security-evidence/data-service-permissions-2026-11-27.json)는 고정된 항목명·참/거짓과 정책 크기만 담는다. 실제 계정이 들어간 정책 4개와 manifest는 `.local/iam-data-service-review`에만 생성했다. [명령과 파일 안내](../../iam/data-services/README.md)를 실행해도 AWS 정책을 생성·연결하지 않는다.

다음은 S3·ECR·ACM과 로그 전달·CloudWatch·SNS·비용 관측 권한이다. 현재 후보는 기존 14개와 이번 4개로 18개이므로, 나머지 권한을 완성한 뒤 중복을 정리하고 실제 Role 연결 할당량과 정책 크기를 확인해야 한다. 최종 유효 권한, 미확정 subnet/SG ID, 최신 버전·리전 제공 여부·가격, 예산·가동 시간, 최신 plan 검토가 끝나기 전에는 apply 준비 완료가 아니다.
