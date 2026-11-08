# Dev 기반 구성

현재 root는 **VPC + ECR + EKS/OIDC + RDS/Redis/MQ + ACM/IRSA/상품 이미지 S3**를 연결한다. 아직 AWS에 적용하지 않았다.
ALB는 이후 Controller가 Ingress를 보고 생성한다. 앱 실제 배포, Jenkins/Argo CD, Prometheus/Grafana, SNS/Budget은 다음 단계다.

## 자격증명 없이 검사

저장소 루트에서 Terraform >= 1.11을 사용한다. 최초 init은 provider 다운로드에 네트워크가 필요하다.

```powershell
terraform fmt -check -recursive terraform
terraform -chdir=terraform/envs/dev init -backend=false -input=false -lockfile=readonly
terraform -chdir=terraform/envs/dev validate
terraform -chdir=terraform/envs/dev test
```

test는 mock provider와 plan으로만 실행하며 AWS API를 호출하지 않는다.
이 결과가 실제 AWS 호환성/권한/Node 기동 성공을 의미하지는 않는다.

## 실제 AWS plan 전 준비

1. 전용 실습 AWS 계정/프로필, 배포 권한 및 assume 가능한 운영자 Role을 확인한다.
2. `terraform.tfvars.example`을 복사하고 /32 공인 IP와 Role ARN을 채운다.
3. 서울 EKS 1.35/add-on 호환 버전, MariaDB 10.11.x patch와 데이터 서비스 타입/버전을 조회해 고정한다. 데이터 인증값 3개는 각기 다른 난수 영문/숫자 32~64자로 보호된 입력을 사용한다.
4. 별도 S3 bootstrap을 검토·생성하고 `backend.hcl.example`의 실제 bucket을 채운다.
5. `terraform init -reconfigure -backend-config=backend.hcl`로 원격 state를 연결한다.
6. `terraform plan -input=false -out=foundation.tfplan` 결과, 비용/종료 시각과 생성 범위를 확인한 후 적용한다.

읽기 전용 조회 예시:

```powershell
aws sts get-caller-identity
aws eks describe-cluster-versions --region ap-northeast-2 --cluster-versions 1.35
aws eks describe-addon-versions --region ap-northeast-2 --kubernetes-version 1.35 --addon-name vpc-cni
aws eks describe-addon-versions --region ap-northeast-2 --kubernetes-version 1.35 --addon-name coredns
aws eks describe-addon-versions --region ap-northeast-2 --kubernetes-version 1.35 --addon-name kube-proxy
aws rds describe-db-engine-versions --region ap-northeast-2 --engine mariadb --query "DBEngineVersions[?starts_with(EngineVersion, '10.11.')].[EngineVersion,DBParameterGroupFamily]"
aws elasticache describe-cache-engine-versions --region ap-northeast-2 --engine redis --engine-version 7.1
aws mq describe-broker-instance-options --region ap-northeast-2 --engine-type RabbitMQ --host-instance-type mq.m7g.medium
```

예시의 IP/계정은 문서용이며 add-on 값은 의도적인 미완성 표시다. 복사만으로 배포가 준비되지 않는다.
state/plan/tfvars에는 계정 정보와 민감 값이 포함될 수 있으므로 Git에 올리지 않는다.

기존에 적용한 state에 이 코드를 바로 연결하지 않는다. 데이터 모듈 호출 제거와 NAT 주소 변경이 있으므로 기존 자원이 있다면 삭제/교체 계획을 먼저 검토해야 한다.
[구조·정리 근거·검증 한계·다음 단계](../../../docs/restart/terraform-foundation.md)

[관리형 데이터 연결, 비밀번호/state, TLS 및 MQ 로그 후처리](../../../docs/restart/managed-data-services.md)

[HTTPS 인증서 DNS 검증·S3 공개 정책 사전 확인·배포 파일 생성](../../../docs/restart/https-app-deployment.md)
