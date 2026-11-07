# 공개 상품 이미지 전용 버킷

2026-11-07 사용자 선택: 이미지 읽기만 공개, 업로드는 백엔드 IRSA.

- 공개 권한은 HTTPS GetObject만. 목록 조회/업로드/삭제는 공개하지 않는다.
- 백엔드 Role은 orderpage/orderpage-backend ServiceAccount와 STS audience에만 연결된다.
- 앱의 PutObject만 허용하고 Node Role에는 S3 권한을 추가하지 않는다.
- ACL 비활성, 저장 AES256 암호화, force_destroy=false.
- 계정/조직 수준 Block Public Access가 공개 정책을 막으면 적용은 실패한다. 계정 전체 설정을 자동 완화하지 않는다.
- 현재 생성 전 코드이며 실제 공개 읽기/무인증 업로드 거부/IRSA를 가동 후 확인한다.
- 상품 이미지 외 개인정보·비밀 파일을 넣지 않는다. 종료 시 보존 대상을 내보내고 버킷을 비운 뒤 삭제한다.
