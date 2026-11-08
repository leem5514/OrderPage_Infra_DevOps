# 6단계: ALB HTTPS · IRSA · 상품 이미지 · Kubernetes 배포 준비

기준일: 2026-11-07 KST. 관리형 데이터 커밋 856aa4a 위의 codex/https-app-deployment.
PR #2와 #3는 작업 시작 시 미병합 상태였다. 이번 PR은 #3 브랜치를 기준으로 한다.

**완료 범위는 코드 작성·로컬 검증이다. AWS apply, DNS 변경, Vercel 배포, EKS 설치는 실행하지 않았다.**

## 1. 사용자 결정과 현재 구조

사용자 선택: 상품 이미지 전용 S3 버킷의 읽기만 공개하고 앱 수정은 최소화한다.

- 브라우저는 Vercel의 Vue 화면을 받고 API는 서울 ALB로 직접 호출한다.
- ALB HTTP 80은 HTTPS 443으로 redirect한다. 인증서는 서울 ACM에서 요청한다.
- ALB → Pod IP:8080, 외부 /actuator 경로는 404. ALB 자체 health check는 Pod readiness 경로를 직접 조회한다.
- Spring Boot의 상품 업로드는 전용 IRSA Role로 S3 PutObject를 수행한다.
- 브라우저는 기존 앱이 저장한 S3 HTTPS URL로 이미지를 읽는다. 프론트 정적 배포는 계속 Vercel이다.

S3 공개 권한은 해당 버킷의 HTTPS GetObject뿐이다. 무인증 업로드/삭제/목록 조회 권한은 주지 않는다.
BucketOwnerEnforced로 ACL을 사용하지 않으며 저장 암호화는 AES256이다.
force_destroy=false이므로 이미지가 남으면 destroy가 실패한다. 종료 시 보존할 파일을 내보내고 실습 객체를 명시적으로 정리한다.
이 버킷은 공개 상품 이미지 전용이며 개인정보/Secret을 넣는 저장소로 사용하지 않는다.

계정·조직 수준 Block Public Access는 건드리지 않았다.
실제 apply 전에 s3control get-public-access-block으로 계정 정책과 조직 제약을 확인한다.
공개 bucket policy가 차단되면 EKS를 먼저 켜지 말고 예외 허용 가능 여부 또는 이미지 제공 방식을 다시 결정한다.

## 2. 소유권과 파일별 역할

| 대상 | 관리 주체 / 파일 |
|---|---|
| VPC/EKS/데이터 서비스 | 기존 Terraform 모듈 |
| ACM 인증서 요청·DNS 검증값 출력 | terraform/envs/dev/https.tf |
| Controller IAM 정책/Role | modules/load-balancer-controller-irsa |
| 공개 이미지 버킷·Backend 업로드 Role | modules/product-images |
| Controller/ServiceAccount/CRD | 고정 Helm chart 3.6.2, app v3.6.2 |
| ALB/TargetGroup/관련 SG | AWS Load Balancer Controller가 Ingress를 보고 생성 |
| 앱 설정·Probe·Service·Ingress | k8s/base |
| 실제 계정별 manifest 준비 | scripts/prepare-deployment.mjs |
| 앱 Secret 입력 점검 | scripts/check-backend-secret.mjs |
| Controller 설치 | scripts/install-aws-load-balancer-controller.ps1 |

Terraform에서 ALB를 별도로 만들지 않는다. Controller와 Terraform이 같은 ALB를 동시에 관리하지 않게 한다.
Controller SA는 Helm이 생성한다. 예전 수동 SA manifest와 IAM policy 생성 스크립트는 제거했다.
Controller Role 신뢰는 kube-system/aws-load-balancer-controller + sts.amazonaws.com에 한정한다.
Backend Role은 orderpage/orderpage-backend + sts.amazonaws.com에 한정하고 전용 버킷 PutObject만 허용한다.
Node Role에는 앱의 S3 권한을 추가하지 않는다.

공식 Controller IAM 정책 원본과 라이선스를 vendor에 고정하고 SHA256을 기록했다.
이 정책에는 Resource=* 조회 등 범용 권한이 포함되므로 프로젝트에 완전히 맞춘 최소 권한 정책이라고 주장하지 않는다.
Helm에서는 region/vpcId를 명시하고 WAF/Shield, Service mutator, ALB/NLB Gateway 기능을 끈다.

## 3. Kubernetes 기본값과 배포 안전장치

- replicas=2 고정, RollingUpdate maxUnavailable=0 / maxSurge=1.
- startup/readiness/liveness 및 Pod 종료 유예 60초, preStop 5초는 이전 검증 설정을 유지.
- ConfigMap generator로 설정/CA 내용 변경 시 이름 hash가 변경되어 Pod template에 반영.
- RDS 서울 공식 공개 CA bundle을 ConfigMap으로 /etc/rds-ca에 read-only mount.
- DB_URL은 sslMode=verify-full + serverSslCert, Redis TLS/AUTH와 MQ TLS 활성.
- 실제 Secret은 base에 없다. 별도 주입한 orderpage-backend-secret을 참조한다.
- 기본 Kubernetes API 토큰 자동 mount는 끈다. IRSA의 AWS 전용 projected token은 webhook이 따로 주입한다.
- 요청/제한 자원은 이전 250m/512Mi, 1 CPU/1Gi를 유지했다. 실측 최적화 값이라고 해석하지 않는다.
- 기본 HPA를 제거하고 별도 실험 overlay에서만 CPU 기준 2~4개를 사용한다.

ConfigMap에서 중복된 Tomcat/DB pool/RabbitMQ concurrency override를 제거했지만, 같은 기존 앱 기본값을 사용한다.
BE/FE 소스와 성능 알고리즘은 변경하지 않았다.
Prometheus scrape annotation도 실제 수집이 준비되지 않아 제거했다. 이후 인증/관리 endpoint와 ServiceMonitor를 함께 구성한다.

### ALB readiness gate가 필요한 이유

앱의 readiness=200과 ALB TargetGroup의 Healthy는 시점이 다르다.
Namespace에 elbv2.k8s.aws/pod-readiness-gate-inject=enabled를 지정해 새 Pod가 ALB에서도 준비되었는지 롤링 배포에 반영한다.
주입은 Pod 생성 시점에만 발생하며, Service와 해당 TargetGroupBinding이 먼저 있어야 한다.
따라서 준비 도구는 routing.yaml과 application.yaml을 분리한다.

초기 순서가 틀려 gate가 없는 Pod가 생기면 단순히 Namespace label만 추가해 기존 Pod가 바뀌지 않는다.
TGB 확인 후 Pod를 교체하고 spec.readinessGates와 target-health 조건을 실제로 확인해야 한다.
이 설정만으로 무중단을 입증한 것은 아니다. ALB 전파·종료·진행 중 요청을 부하와 함께 측정해야 한다.

## 4. 배포 파일 준비 — 아직 AWS 실행 안 함

도구: Node 20+, npm ci, kubectl, Terraform >=1.11, Helm.
Node YAML 라이브러리는 yaml 2.9.1로 lock했고 npm audit에서 0 vulnerabilities를 확인했다.

실제 AWS 생성이 완료되어 output을 얻은 뒤 사용할 예시:

```powershell
New-Item -ItemType Directory -Path .local -Force
terraform -chdir=terraform/envs/dev output -json | Set-Content -Encoding utf8 .local/terraform-outputs.json
Copy-Item k8s/deployment-settings.example.json .local/deployment-settings.json
# settings에는 ECR에 이미 존재하는 sha256 digest, 정확한 FE HTTPS origin, 관리자 email을 입력한다.
node scripts/prepare-deployment.mjs --terraform-outputs .local/terraform-outputs.json --settings .local/deployment-settings.json --out .local/deploy/dev-001
```

계정/리전/도메인/endpoint/Role/인증서/버킷은 Terraform output에서 가져온다.
설정 파일에 비밀번호 키를 추가하면 거부한다. image tag 대신 digest가 필수다.
다른 계정의 Role/ACM, 다른 리전 endpoint, HTTP origin, 미완성 값은 거부한다.
출력 디렉터리는 .local/deploy 아래의 새 디렉터리를 사용한다. 이전 산출물과 섞어 덮어쓰지 않는다.

생성 파일:

| 파일 | 역할 |
|---|---|
| kustomization.yaml | 실제 값을 덮어쓰는 로컬 overlay |
| manifests.yaml | 전체 확인용, 실제 Secret 포함 안 함 |
| routing.yaml | Namespace/Service/Ingress를 먼저 준비 |
| application.yaml | ServiceAccount/ConfigMap/Deployment |
| controller-values.yaml | 실제 cluster/VPC/IRSA 값을 넣은 Helm values |
| environment.json | 설치 대상 계정/리전/cluster/인증서 정보 |

.local은 Git에서 제외한다. 다음 Argo CD 단계에서 비밀값 없는 manifest만 검토하여 GitOps 경로에 승격한다.
현재 생성물의 계정별 값이나 Helm template 내부 인증서 Secret을 그대로 공개 artifact로 올리지 않는다.

## 5. 실제 가동 시 순서

아래 절차는 아직 실행하지 않았다. 24~72시간 집중 가동 전에 CI/CD/관측·예산 준비를 끝낸다.

1. AWS 계정/IAM, 이미지 버킷 공개 정책 가능 여부, 미사용 API/FE DNS 이름, EKS/데이터 버전과 비용을 확인한다.
2. Terraform plan의 생성/변경/삭제 목록을 검토하고 승인한 환경을 만든다.
3. https_deployment.validation_records의 CNAME을 기존 DNS 제공자에 추가한다. apex/기존 서비스 레코드는 덮어쓰지 않는다.
4. ACM describe-certificate로 해당 ARN의 Status=ISSUED와 DomainName을 확인한다. Terraform의 인증서 요청 완료는 DNS 검증 완료가 아니다.
5. ECR 이미지 digest와 실제 frontend origin/admin email로 위 준비 도구를 실행한다.
6. 계정·cluster가 맞는지 확인하며 Controller를 설치한다.
7. routing.yaml을 적용하고 Controller가 orderpage-backend Service의 TargetGroupBinding을 만든 것을 확인한다.
8. DB/MQ 앱 전용 계정, Redis 토큰과 JWT 키를 준비하고 Secret을 주입한다.
9. application.yaml을 적용해 Pod의 gate 주입과 Ready, ALB target Healthy를 확인한다.
10. Ingress의 실제 ALB hostname으로 api-devops.auctionbid.shop CNAME을 연결한다. FE DNS는 Vercel의 실제 프로젝트 안내값을 사용한다.

설치 스크립트 예시:

```powershell
./scripts/install-aws-load-balancer-controller.ps1 -PreparedDirectory .local/deploy/dev-001 -ExpectedAccountId <계정ID> -Profile <실습프로필>
```

설치 스크립트는 전역 kubeconfig를 바꾸지 않고 준비 디렉터리에 별도 kubeconfig를 생성한다.
Helm 오류 이후에는 다음 단계로 넘어가지 않는다. 실제 서버에서의 Helm install은 미검증이다.
업그레이드 시 기존 CRD 갱신은 해당 버전 공식 절차를 따르며 helm upgrade가 자동으로 처리한다고 가정하지 않는다.

Secret 준비와 단계별 적용:

```powershell
$kubeconfig = (Resolve-Path .local/deploy/dev-001/kubeconfig).Path
kubectl --kubeconfig $kubeconfig apply -f .local/deploy/dev-001/routing.yaml
kubectl --kubeconfig $kubeconfig get targetgroupbindings -n orderpage -o yaml
# spec.serviceRef.name=orderpage-backend인 TGB가 생긴 뒤 계속한다.

# .local/secrets/backend.env에 실제 앱 계정/키를 넣는다. 예시 파일을 그대로 적용하지 않는다.
node scripts/check-backend-secret.mjs .local/secrets/backend.env
# 위 명령이 실패하면 여기서 중단한다.
kubectl --kubeconfig $kubeconfig -n orderpage create secret generic orderpage-backend-secret --from-env-file=.local/secrets/backend.env
kubectl --kubeconfig $kubeconfig apply -f .local/deploy/dev-001/application.yaml
kubectl --kubeconfig $kubeconfig rollout status deployment/orderpage-backend -n orderpage --timeout=300s
kubectl --kubeconfig $kubeconfig get pods -n orderpage -o wide
kubectl --kubeconfig $kubeconfig get ingress -n orderpage
```

Secret checker는 필수키/예시값/앱 전용 사용자/서명키 분리를 확인하며 실제 값을 출력하지 않는다.
이 검사는 DB/MQ 인증이나 권한 부여 성공을 보장하지 않는다. 앱 계정 생성은 별도의 초기화 작업이다.
기존 Secret 갱신은 운영 절차로 관리하고, 환경변수 Secret을 바꾼 뒤 필요한 Pod 재시작도 고려한다.

## 6. 실측 전에 확인할 것

- HTTPS 인증서/호스트명과 HTTP redirect, 공개 /actuator 차단, 내부 readiness.
- S3 IRSA PutObject 성공, 브라우저 HTTPS 이미지 읽기 성공, 무인증 Put/Delete/List 거부.
- 계정/조직 BPA 때문에 공개 읽기가 막히지 않았는지 확인.
- RDS 인증서 체인/호스트명 검증, Redis/MQ TLS, 주문의 Redis → MQ → MariaDB 반영.
- Pod readiness gate 주입과 ALB Healthy 이후의 rollout, 새 이미지 실제 digest.
- HPA는 metrics-server 설치와 자원 예산 확인 이후 별도 실험에서만 활성화.

아직 남은 실제 앱 운영 문제:
기존 SSE에는 주기적인 heartbeat가 없고 FE의 자동 재연결도 준비되지 않았다.
ALB idle timeout을 300초로 지정했지만 무기한 유휴 SSE를 보장하지 않는다.
SSE 종료/재연결 검증을 끝내기 전에는 주문 알림까지 무중단이라고 주장하지 않는다.
Prometheus 인증/management endpoint, CloudWatch/SNS, Jenkins/Argo CD도 후속 작업이다.

## 7. 이번에 삭제·정리한 것

- 가짜 비밀번호가 들어 있던 실행 Secret manifest.
- HTTP 전용 Ingress, 옛 example.com/Vercel origin patch, 공유 ALB group 이름.
- 기본 HPA와 Before에서 HPA를 삭제하는 중복 patch. HPA 설정은 실험 폴더로 이동.
- 사용하지 않는 memory HPA 기준과 max 5.
- 중복 ConfigMap manifest/튜닝 override, 미구현 Prometheus scrape annotation.
- 수동 Controller IAM 생성 스크립트, 별도 ServiceAccount/kustomization 및 중복 eksctl OIDC 지침.

삭제는 현행 작업 checkout에만 적용했다. 기존 바탕화면 프로젝트, Docker 데이터, BE/FE 소스는 수정하지 않았다.
이전 단계 진행서는 역사적 기록이며 현재 상태는 이 문서와 project-process 상단을 따른다.

## 8. 검증 기록

- Terraform fmt/validate, mock 테스트 15개 통과. S3 정책 테스트의 apply는 mock provider에만 실행했고 실제 AWS 호출은 없다.
- Node 배포 검증 7개 통과: 계정/digest/HTTPS 입력, Kustomize 연결, CA 파싱/만료일, Secret/HPA 분리, 실제 고정 chart Helm template, Secret 규칙.
- Controller 설치 스크립트 모의 테스트 5개 통과: 정상/계정 불일치/cluster 불일치/AWS CLI 실패/Helm 실패.
- 공식 chart 3.6.2, IAM 정책 v3.6.2, 서울 CA bundle을 다운로드해 해시/출처 기록.
- 서버 측 Kubernetes dry-run, 실제 Helm install, 실제 AWS TLS/DNS/IRSA는 미실행.

재현 명령:

```powershell
terraform fmt -check -recursive terraform
terraform -chdir=terraform/envs/dev init -backend=false -input=false -lockfile=readonly
terraform -chdir=terraform/envs/dev validate
terraform -chdir=terraform/envs/dev test
npm ci --ignore-scripts
New-Item -ItemType Directory -Path .local -Force
helm pull aws-load-balancer-controller --repo https://aws.github.io/eks-charts --version 3.6.2 --destination .local
$env:LBC_CHART = (Resolve-Path .local/aws-load-balancer-controller-3.6.2.tgz).Path
# kubectl/helm이 PATH에 없으면 KUBECTL/HELM에 실행 파일 전체 경로를 지정한다.
npm test
./scripts/tests/controller-install.tests.ps1
```

실제 종료 시 Ingress/ALB/TGB를 먼저 정리하고 Controller를 제거한 다음 EKS를 내린다.
상품 이미지 버킷/ECR은 내용을 명시적으로 정리하고, MQ의 Terraform 외부 로그 그룹도 잔존 목록에서 확인한다.
ACM 검증 레코드와 API DNS는 이번 실습에서 추가한 것만 정리한다.

## 9. 공식 근거

- [ALB Controller v3.6.2](https://github.com/kubernetes-sigs/aws-load-balancer-controller/releases/tag/v3.6.2)
- [ALB Ingress annotations](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/ingress/annotations/)
- [ALB Pod readiness gate 및 초기 조건](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/deploy/pod_readiness_gate/)
- [S3 공개 차단의 계정/버킷 범위](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
- [S3 bucket policy 예시](https://docs.aws.amazon.com/AmazonS3/latest/userguide/example-bucket-policies.html)
- [RDS 서울 CA 원본](https://truststore.pki.rds.amazonaws.com/ap-northeast-2/ap-northeast-2-bundle.pem)
