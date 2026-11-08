# 현재 배포 구조의 기준

현재 목표 구조와 구성 선택 이유는 [새 진행서](restart/project-process.md), 구현된 기반 코드의 범위는 [Terraform 기반 기록](restart/terraform-foundation.md)을 따른다.

- 서비스: 브라우저 → Vercel 정적 Vue 화면. 브라우저 API 요청 → 서울 ALB → EKS Service/Pod → 관리형 데이터 서비스.
- 배포: private EC2 Jenkins 테스트/이미지 빌드 → ECR digest 및 Infra PR → 병합 → Argo CD → EKS.
- 인프라: Terraform → VPC/ECR/EKS 및 후속 데이터·권한·관측.
- 관측: CloudWatch Alarm → Amazon SNS, Kubernetes 지표 → Prometheus/Grafana, 비용 → Cost Explorer.

현재 코드 검증 범위는 VPC/ECR/EKS/OIDC, RDS/Redis/MQ와 ACM/IRSA/상품 이미지 S3/Kubernetes 설정이며 AWS 생성은 아직 하지 않았다.
EC2 Jenkins/IAM과 CI·GitOps 설정도 추가했다. [가동 순서와 미검증 범위](restart/jenkins-argocd.md)를 구분한다.
저장소의 기존 orderpage-devops-architecture 이미지/SVG와 아이콘은 향후 그림 수정용 원본이다.
기존 그림에는 Jenkins 직접 배포 등 옛 설계가 있어 현행 구조 그림으로 인용하지 않는다.

아이콘 출처: [Kubernetes Icons](https://github.com/kubernetes/community/tree/main/icons). 라이선스: Apache-2.0 또는 CC-BY-4.0.
