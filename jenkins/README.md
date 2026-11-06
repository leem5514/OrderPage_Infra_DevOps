# Jenkins

현재 제공하는 `Jenkinsfile.infra`는 Terraform 형식/정적/mock 검증만 한다.
Linux agent에 Git, Terraform >= 1.11 및 provider 다운로드 네트워크가 필요하다.
AWS credential과 backend.hcl은 필요하지 않다. Jenkins 서버에서 실제 실행한 결과는 아직 없다.

옛 Backend pipeline의 직접 kubectl 배포는 제거했다. 새 역할은 다음 단계에서 구현한다.

- Jenkins: BE 테스트 → Docker 빌드 → ECR push → Git 배포 이미지 변경.
- Argo CD: Infra Git 변경 감지 → EKS 동기화/배포.
- FE: Jenkins 검증 → Vercel CLI 배포.

현재 Terraform pipeline에는 실제 plan/apply 및 plan 파일 보관 기능이 없다. 계정별 사전 점검과 승인된 생성 목록을 준비한 다음 운영 절차를 추가한다.
