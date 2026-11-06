# EKS 기반 모듈

표준 지원 정책의 EKS, 명시적인 운영자 Access Entry, private subnet의 AL2023 m6i.large Node 2대, 기본 add-on 3개를 만든다.
API 공개 경로는 운영자 IPv4 /32로 제한하며 VPC 내부 private endpoint도 켠다.
CloudWatch control plane 로그 3종은 3일 보관한다. 앱 로그/SNS/대시보드는 후속 단계다.

Node 디스크는 gp3 20 GiB 암호화, IMDSv2 필수, hop limit 1이다.
앱이 Node IAM role에 의존하면 안 된다. AWS Load Balancer Controller 설치 시 region/vpcId와 IRSA를 명시해야 한다.
CNI는 기반 기동 단계에서 Node role 권한을 사용한다. 앱 S3/Controller 권한을 Node role에 추가하지 않는다.

Node 수는 고정하지만 Node group 업데이트 때 AWS가 일시적으로 추가 Node를 만들 수 있다.
두 AZ를 사용해도 Node가 각 AZ에 정확히 한 대씩 배치됐다는 보장은 없으므로 실제 가동 때 확인한다.
HPA/metrics-server/IRSA/CSI/Argo CD는 이 모듈의 현재 범위에 없다.

[전체 입력/검증/한계](../../../docs/restart/terraform-foundation.md)
