# RDS MariaDB (실습용)

dev root에서 사용하는 Single-AZ db.t4g.micro / gp3 20GiB 모듈이다.
MariaDB 10.11의 정확한 patch 버전을 필수 입력한다. 서버 TLS 필수, EKS SG에서 3306만 허용한다.
스토리지 암호화, 1일 백업, error/slowquery 로그 3일 보관을 설정했다. 스토리지 자동 확장은 끈다.

테스트 데이터 전용: destroy 시 최종 snapshot을 생략하고 자동 백업도 삭제한다.
실제 AWS 생성/접속은 아직 검증하지 않았다.
관리자 계정은 초기 스키마/앱 계정 생성용이다. 앱에 계속 관리자 비밀번호를 넣지 않는다.
[접속 계약·검증·종료 절차](../../../docs/restart/managed-data-services.md)
