# RDS 서울 CA bundle

공개 CA 인증서이며 비밀번호/개인키가 아니다.

- 원본: https://truststore.pki.rds.amazonaws.com/ap-northeast-2/ap-northeast-2-bundle.pem
- 다운로드: 2026-11-07 KST
- SHA256: 913fb5b814f17af79d4c1622584a8d0ceddf5b0d76fe353d0c7d1186cdd6b229
- read-only ConfigMap volume /etc/rds-ca 에 mount한다.
- DB_URL의 sslMode=verify-full과 serverSslCert를 함께 사용한다.
- CA 교체 시 공식 번들을 갱신하고 TLS 접속을 재검증한다. 실제 RDS 접속은 아직 검증하지 않았다.
