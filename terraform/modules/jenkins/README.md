# EC2 Jenkins

서울 AL2023 x86_64 / m6i.large / private subnet / encrypted gp3 30GiB.
인바운드 규칙과 public IP 없이 기존 NAT로 다운로드하며 SSM으로 운영한다.
EC2 Role은 SSM과 지정 ECR 업로드/조회만 허용한다. EKS Access Entry나 앱 비밀 권한은 없다.
IMDSv2 필수/hop=1. Controller/agent는 같은 호스트의 별도 사용자·프로세스다.

user-data는 OS 도구만 설치한다. 실제 Jenkins WAR/agent는 [설치 절차](../../../docs/restart/jenkins-argocd.md)에 따라 구성한다.
root의 enable_jenkins는 기본 false다. 실제 가동 전 AMI/비용/plan을 확인한다.
user-data/AMI 변경 시 EC2 교체가 발생할 수 있으며 종료 시 root 볼륨도 삭제된다. Jenkins 기록을 먼저 내보낸다.
