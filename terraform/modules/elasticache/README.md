# ElastiCache Redis (실습용)

Redis OSS 7.1 / cache.t4g.micro 1대, replica 없음, cluster mode disabled.
앱이 사용하는 Redis DB 1/2/3과 호환되도록 cluster mode를 고정한다.
TLS required + AUTH 필수, EKS SG의 6379만 허용한다. 저장 암호화, snapshot 1일, 로그 3일 보관.

auth_token_update_strategy=SET이며 무중단 비밀번호 교체 절차는 아니다.
앱의 REDIS_SSL_ENABLED=true와 REDIS_PASSWORD를 함께 설정한다.
[입력·검증·한계](../../../docs/restart/managed-data-services.md)
