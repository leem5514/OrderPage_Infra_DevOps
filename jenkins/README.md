# Jenkins

`Jenkinsfile.infra`는 Terraform 형식/정적/mock 검증만 한다. Linux agent에 Git/Terraform >=1.11이 필요하며 AWS credential/backend.hcl은 받지 않는다.

`Jenkinsfile.backend`는 EC2 전용 Linux agent(orderpage-ci)에서 실행할 새 pipeline이다.

- BE main → Java 11 테스트 → 기존 Dockerfile 빌드 → ECR digest → Infra 배포 PR.
- 최초 이미지만 만들 때 CREATE_DEPLOYMENT_PR=false, 실제 GitOps 환경 승격 후 true.
- BE main만 5분 polling하고 Infra checkout은 poll=false로 재귀 실행을 방지한다.
- 사람의 PR 병합 후 Argo CD가 EKS를 동기화한다. Jenkins에는 EKS 권한을 주지 않는다.
- FE Jenkins 검증/Vercel 배포는 후속 작업이다.

현재 Terraform pipeline에는 실제 plan/apply 및 plan 파일 보관 기능이 없다. 계정별 사전 점검과 승인된 생성 목록을 준비한 다음 운영 절차를 추가한다.

서버 실행, Declarative linter, Docker/ECR 실제 연결은 아직 미검증이다.
[EC2 설치/Job/credential/Argo·실험·복구 절차](../docs/restart/jenkins-argocd.md)를 따른다.
