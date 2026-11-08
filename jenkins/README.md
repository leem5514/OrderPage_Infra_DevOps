# Jenkins

`Jenkinsfile.infra`는 Terraform 형식/정적/mock 검증만 한다. Linux agent에 Git/Terraform >=1.11이 필요하며 AWS credential/backend.hcl은 받지 않는다.

`Jenkinsfile.backend`는 EC2 전용 Linux agent(orderpage-ci)에서 실행할 새 pipeline이다.

- BE main → Java 11 테스트 → 기존 Dockerfile 빌드 → ECR digest → Infra 배포 PR.
- 최초 이미지만 만들 때 CREATE_DEPLOYMENT_PR=false, 실제 GitOps 환경 승격 후 true.
- BE main만 5분 polling하고 Infra checkout은 poll=false로 재귀 실행을 방지한다.
- 사람의 PR 병합 후 Argo CD가 EKS를 동기화한다. Jenkins에는 EKS 권한을 주지 않는다.

`Jenkinsfile.frontend`는 같은 agent의 Node 22에서 FE main 테스트/lint/운영 빌드를 수행한다.

- `frontend-settings.json`의 `deploymentEnabled=false` 기본값에서는 정적 패키징까지만 실행한다.
- 실제 Vercel 프로젝트/도메인/API CORS 준비 후 활성화하면 고정 CLI로 검증한 정적 파일을 배포한다.
- FE Git 자동 배포는 끄며, 토큰은 배포 단계의 Jenkins credential로만 주입한다.
- Production 배포 후 HTML/JS hash와 SPA 경로를 확인한다. 실패 시 자동 rollback은 하지 않는다.
- [파일 역할·최초 연결·검증 결과·복구 절차](../docs/restart/frontend-vercel.md)를 따른다.

현재 Terraform pipeline에는 실제 plan/apply 및 plan 파일 보관 기능이 없다. 계정별 사전 점검과 승인된 생성 목록을 준비한 다음 운영 절차를 추가한다.

서버 실행, Declarative linter, Docker/ECR 실제 연결은 아직 미검증이다.
[EC2 설치/Job/credential/Argo·실험·복구 절차](../docs/restart/jenkins-argocd.md)를 따른다.
