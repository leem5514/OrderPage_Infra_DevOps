# 7단계: EC2 Jenkins CI · ECR · Argo CD GitOps

기준일: 2026-11-08 KST. 이전 HTTPS 커밋 03e167c 위에서 작업했다.
사용자는 Jenkins 실행 위치로 **AWS EC2**를 선택했다. 로컬 PC 상시 가동에 의존하지 않는다.

현재 완료는 코드 작성과 로컬/mock 검증이다. EC2/EKS 생성, Jenkins 설치·Job 실행, ECR push, Argo CD 설치·실제 동기화는 아직 하지 않았다.
이 문서의 실습 명령은 실제 가동 단계에서 실행한다. 현재 BE/FE 소스는 변경하지 않았다.

## 1. 이번 연결의 목적과 경계

BE main 변경 → Jenkins polling → Java 11 테스트 → 기존 Dockerfile 빌드 → ECR push/digest 확인 → Infra 배포 PR → 사람의 병합 → Argo CD main 감지 → EKS rollout.

- Jenkins는 이미지를 만들고 Git에 배포 요청을 남긴다. EKS를 수정하는 권한이나 kubeconfig를 받지 않는다.
- Argo CD는 승인된 Git 상태를 실제 클러스터에 반영한다. Jenkins 빌드 성공과 앱 배포 성공은 별도 상태다.
- main 직접 push/자동 병합을 하지 않는다. PR 승인 대기시간은 측정에서 별도 구간으로 기록한다.
- 최초 이미지를 만들 때는 CREATE_DEPLOYMENT_PR=false. 이미지 생성 → 실제 환경 승격 → 이후 PR 자동화 순서다.
- FE Vercel CI/CD와 관측 설정은 별도 후속 단계이며 이번 백엔드 pipeline에 섞지 않았다.

## 2. 파일별 역할

| 파일 | 담당 |
|---|---|
| terraform/modules/jenkins | EC2, SG, IAM, 30GiB 볼륨, 기본 OS 도구 |
| terraform/envs/dev/jenkins.tf | 기존 private subnet/ECR 연결. enable_jenkins=false 기본 |
| scripts/install-jenkins-host.sh | 공식 LTS WAR checksum 검증, localhost Controller, kubectl 설치 |
| scripts/configure-jenkins-agent.sh | 별도 Linux 사용자/Java 프로세스의 inbound WebSocket agent |
| jenkins/Jenkinsfile.backend | 단계 순서·시간 제한·JUnit·artifact·자격증명 범위 |
| scripts/ci-backend.sh | main SHA 확인, Java 11 테스트, Docker/ECR, 단계별 시각 |
| scripts/gitops-release.mjs | 로컬 실제 설정을 GitOps에 최초 승격, digest 변경 검증 |
| scripts/create-release-pr.mjs | release 브랜치 push + 한국어 PR 생성 |
| argocd/values.dev.yaml | 공식 chart 10.14.0 / app v3.6.1의 단기 비HA 설정 |
| argocd/project.yaml | 저장소·대상 namespace·리소스 종류 제한 |
| argocd/application.yaml | main/gitops/environments/dev 추적. 초기 자동 동기화 OFF |

기존 Jenkinsfile.infra는 자격증명 없는 Terraform 검증 전용으로 유지한다. 그 Job의 agent에는 별도로 Terraform을 설치해야 한다.
불필요한 직접 kubectl 배포 코드를 다시 추가하지 않았다. 이 CI에서 kubectl은 **로컬 kustomize 렌더**에만 사용한다.
Kubernetes Namespace에는 Prune=false,Delete=false를 넣었다. Git 변경으로 namespace와 수동 Secret 전체가 함께 사라지지 않게 한다.

## 3. EC2 선택과 비용

- 서울 m6i.large 1대(2 vCPU/8GiB), private subnet, 공개 IP 없음, 인바운드 규칙 없음.
- 이전 t3.medium 후보를 8GiB/CPU credit 없는 사양으로 변경했다. Controller + agent + Java 11 테스트/빌드를 함께 실행할 메모리 여유를 둔다. 실측으로 충분함을 입증한 것은 아니다.
- Controller Java heap 최대 1GiB, agent 256MiB. 테스트 컨테이너 3GiB/2 CPU, agent executor 1, Job 동시 실행 금지.
- gp3 30GiB 암호화, IMDSv2 필수/hop=1. 기존 NAT를 공유하며 별도 NAT/공개 IPv4/관리 ALB를 만들지 않는다.
- EC2 Role: SSMManagedInstanceCore + 전용 ECR 업로드/조회. EKS/S3/app Secret 권한 없음. 정적 AWS 키 없음.
- Controller/agent는 사용자와 프로세스만 분리한다. 같은 EC2이며 Docker group의 agent는 호스트 수준 권한이 있다. 다중 사용자/외부 PR 실행 격리라고 주장하지 않는다. 본인 저장소의 검토된 main만 실행한다.

[공식 서울 단가 원본](pricing-evidence/jenkins-seoul-2026-11-08.json): m6i.large 시간당 $0.118, gp3 월 GB당 $0.0912.
Jenkins EC2와 30GiB EBS만 같은 시간 유지한다고 가정한 추정이다. 월 730시간으로 환산했으며 세금/NAT 처리량/전송료는 제외한다.

| 유지 시간 | EC2 + 30GiB EBS |
|---|---:|
| 12시간 | 약 $1.46 |
| 24시간 | 약 $2.92 |
| 72시간 | 약 $8.77 |

실제 CI 실행 창만 켜고 나머지 시간에는 중지한다. 중지해도 EBS는 청구된다. 예: EC2 12시간 + EBS 72시간은 약 $1.69.
Git polling을 사용하는 동안은 EC2가 켜져 있어야 한다. 이미지 캐시/빌드 기록으로 30GiB가 차는지도 관측한다. 모든 Docker cache/volume을 일괄 prune하는 코드는 넣지 않았다.
이전 전체 견적의 Jenkins t3.medium/임시 공개 IP 가정은 현재 구성과 다르므로 estimate.mjs를 현행 사양으로 갱신했다.

## 4. EC2 최초 준비 절차 — 미실행

1. 실제 AWS 계정·AMI·비용을 검토한 plan에서 enable_jenkins=true를 선택한다.
2. 공식 AL2023 x86_64 AMI ID를 서울에서 조회해 jenkins_ami_id에 고정한다. Terraform도 Amazon 소유/name 필터를 검사한다. 가동 시점 최신 보안 패치와 해당 AZ의 m6i.large 제공 여부를 확인한다.
3. EC2 user-data의 cloud-init 완료와 SSM Online을 확인한다. AMI의 패키지 저장소 snapshot에 도구가 있는지도 실제 확인한다.
4. SSM으로 EC2에 접속하고 검토·병합된 Infra commit을 clone한다. sudo bash scripts/install-jenkins-host.sh 실행.
5. Jenkins 2.580.2/Java 21로 Controller를 시작한다. 공식 WAR SHA256을 고정했다. 최신 보안 릴리스가 나왔으면 버전·checksum을 같이 검토한다.
6. PC의 AWS CLI + Session Manager plugin으로 터널을 연다. 운영자에게 해당 instance/SSM document의 StartSession 권한이 필요하다.

```powershell
aws ssm start-session --target <Jenkins-instance-id> --document-name AWS-StartPortForwardingSession --parameters 'portNumber=8080,localPortNumber=8080' --profile <실습프로필> --region ap-northeast-2
```

브라우저에서 http://localhost:8080에 접속한다. Controller는 127.0.0.1에서만 대기하며 SG 8080/22/50000을 열지 않는다.
SSM 셸에서 /var/lib/orderpage-jenkins/secrets/initialAdminPassword를 확인하고 초기 관리자/인증을 설정한다. 비밀번호를 Git/스크린샷/보고서에 남기지 않는다.

필요 플러그인: Pipeline(Declarative 포함), Git, Credentials Binding, JUnit, Timestamper.
사용할 플러그인 버전은 실제 설치 시 현재 LTS 호환성/보안 검토 후 목록을 남긴다. 이번 작업에서 Jenkins 서버의 Declarative linter나 플러그인 조합을 실행한 것은 아니다.

노드 설정:

- built-in executor=0. 초기 init 스크립트도 이 값을 설정한다.
- Permanent agent 이름 ec2-agent, label orderpage-ci, executor=1, remote root /var/lib/orderpage-agent.
- 사용 모드: 해당 label Job 전용. 연결 방식: inbound agent/WebSocket.
- EC2에서 sudo bash scripts/configure-jenkins-agent.sh 실행 후 UI의 agent secret을 숨김 입력한다. secret을 Terraform/user-data/Git에 넣지 않는다.
- agent Online 및 java/node/npm/docker/aws/kubectl 버전을 확인한다. Controller는 Docker group에 넣지 않는다.

GitHub credential:

- Infra 저장소 하나에 제한한 fine-grained token. Contents 읽기/쓰기 + Pull requests 읽기/쓰기와 기본 Metadata 읽기.
- Jenkins의 backend Job 전용 Folder에 Username with password로 저장. ID orderpage-infra-github, username은 GitHub 사용자, password는 token.
- GitHub 토큰은 PR 단계에서만 주입한다. askpass 파일에는 환경변수 참조만 쓰며 토큰을 URL/인자/파일에 기록하지 않는다.
- main 보호 규칙에서 PR 필수와 force push 금지를 사용한다. token에 bypass 권한을 주지 않는다. Argo CD는 공개 저장소 읽기만 필요하다.

## 5. Jenkins Job과 최초 이미지

Pipeline from SCM: Infra 저장소의 main, Script Path=jenkins/Jenkinsfile.backend. 먼저 이번 PR까지 순서대로 병합되어야 한다.
초기 실행은 사람이 Build with Parameters로 시작한다. AWS_ACCOUNT_ID와 Terraform의 ECR 이름을 입력한다.
실제 GitOps 승격 이후에는 AWS_ACCOUNT_ID를 비우면 커밋된 이미지 저장소에서 계정/ECR 이름을 읽는다. SCM polling의 기본 빈 parameter도 이 경로를 사용한다.
BE_REVISION은 비우면 BE main HEAD. 지정할 경우 main에 포함된 40자리 SHA만 허용한다.

최초에는 CREATE_DEPLOYMENT_PR=false로 실행한다. ECR 이미지가 없는데 GitOps 환경이 필요하고, 환경을 만들려면 digest가 필요한 순환을 끊기 위한 모드다.

빌드 동작:

1. 새 workspace에서 Infra/BE main checkout. Infra checkout은 poll=false, BE checkout만 polling 대상으로 기록한다.
2. JDK 11 Docker에서 Gradle test. 실패/누락된 JUnit은 다음 단계 진행을 막는다.
3. git archive로 추적 파일만 Docker context에 넣는다. workspace 자격증명/테스트 산출물은 전송하지 않는다.
4. BE의 기존 Dockerfile로 linux/amd64 빌드한다. 기존 Dockerfile의 bootJar 단계는 다시 실행된다. 캐시 최적화로 성능을 개선하지 않았다.
5. EC2 Role의 계정/ECR 저장소를 확인하고 SHA-b실행번호 태그로 push한다. immutable 저장소에서 같은 SHA를 재빌드할 수 있도록 실행 번호를 포함한다.
6. ECR API에서 digest를 읽어 .local/ci-image.json에 기록한다. Docker 인증 설정은 실행별로 분리하고 종료 시 logout한다.

Jenkins 첫 실행 후 BE main을 5분 간격으로 polling한다. 공개 webhook 포트는 없다. Infra 배포 PR 병합으로 다시 빌드하는 루프를 피하려고 Infra polling은 껐다.
첫 실제 실행에서 BE 변경이 Job을 깨우고 Infra만 변경했을 때 재실행하지 않는지 확인한다. 지정 SHA를 시험한 뒤에는 BE_REVISION을 비운 기본 모드로 되돌린다.
현재 base image 태그는 기존 Dockerfile과 동일하게 가변이다. 이미지 digest/BE SHA는 기록하지만 base/Gradle 의존성까지 완전 재현 가능한 빌드라고 주장하지 않는다.

## 6. 최초 GitOps 승격과 Argo CD

1. ci-image.json의 ECR digest와 실제 Terraform 출력으로 [HTTPS 준비 도구](https-app-deployment.md)를 실행한다.
2. node scripts/gitops-release.mjs promote .local/deploy/dev-001 실행.
3. gitops/environments/dev/kustomization.yaml만 최초 생성된다. 실제 endpoint/ARN은 비밀값이 아니지만 공개 저장소 노출 범위를 검토한다. 관리자 email도 업무용 값을 사용한다.
4. kubectl kustomize gitops/environments/dev로 렌더하고 Secret/미완성 값이 없는지 확인한 후 PR/main 병합.
5. 기존 절차대로 Controller → routing/TargetGroupBinding → 앱 전용 DB/MQ 계정과 Secret → application을 최초 적용한다. Pod readiness gate/ALB Healthy/API 기능을 확인한다.

Argo CD는 동일 EKS 안의 argocd namespace에 설치한다. 이전 단계에서 계정을 검증한 별도 kubeconfig를 사용한다.

```powershell
$kubeconfig = (Resolve-Path .local/deploy/dev-001/kubeconfig).Path
helm upgrade --install argocd argo-cd --repo https://argoproj.github.io/argo-helm --version 10.14.0 --namespace argocd --create-namespace --kubeconfig $kubeconfig -f argocd/values.dev.yaml --wait --timeout 10m
kubectl --kubeconfig $kubeconfig apply -f argocd/project.yaml
kubectl --kubeconfig $kubeconfig apply -f argocd/application.yaml
kubectl --kubeconfig $kubeconfig -n argocd port-forward svc/argocd-server 8443:443
```

Helm 실패 시 중단한다. 설치/기동은 아직 검증하지 않았다. UI는 https://localhost:8443. 초기 관리자 secret 확인·암호 변경은 공식 절차를 따른다.
Dex/Notifications는 끈다. 이 chart는 ApplicationSet enabled 옵션이 없어 replicas=0을 지정한다(리소스 정의는 남고 Pod는 실행하지 않음).
Redis는 Argo 내부 캐시용으로 앱 ElastiCache와 별개다. 데이터 서비스와 혼용하지 않는다.

Application 초기 automated.enabled=false는 아직 없는 실제 환경을 자동 적용하지 않기 위한 값이다. 최초 수동 sync/adoption 후 Synced+Healthy, Secret 참조, ALB gate를 확인한다.
그 다음 application.yaml의 enabled를 true로 변경해 검토/커밋하고 해당 파일을 kubectl apply한다. Application 정의 자체는 이 앱의 GitOps 경로 밖이므로 Git push만으로 정책이 바뀌지 않는다.
자동화가 켜지면 prune/selfHeal=true, allowEmpty=false, PruneLast=true다. 프로젝트는 지정 repo/namespace와 기본 리소스만 허용한다. Secret/RBAC/HPA는 기본 앱 관리 대상이 아니다.

이후 Jenkins CREATE_DEPLOYMENT_PR=true:

- 기존 ECR 저장소와 일치하는 digest만 바꿔 release/backend-<SHA>-<실행번호> 브랜치와 한국어 PR 생성.
- main 병합은 사람이 한다. 오래된 SHA의 PR, 충돌 또는 이전 배포보다 오래된 실행을 자동 병합하지 않는다.
- Argo CD는 약 60초 + 최대 15초 jitter의 reconciliation 설정으로 main을 감지한다. 정확한 반영시간은 실제 측정한다.
- PR 생성 API 실패 시 이미 푸시된 브랜치를 남기고 Job을 실패시킨다. 해당 브랜치로 수동 PR을 만들 수 있다.
- Jenkins 성공은 이미지/PR 준비 성공이다. Argo Synced+Healthy와 외부 API 확인까지 되어야 배포 성공으로 기록한다.

## 7. 비교 실험과 증거

| 비교 | 동일하게 유지할 조건 | 측정 |
|---|---|---|
| 수동 배포 vs Jenkins+Argo | 같은 BE commit/테스트/Dockerfile/ECR/EKS, 동일 승인 조건 | 사람 작업시간, 전체 배포시간, 실패율 |
| 첫 실행 vs 반복 실행 | 캐시 상태를 구분해 기록 | 테스트/빌드/push 구간 소요시간 |
| 정상 배포 vs 의도한 실패 | 전용 실습 이미지, 같은 관측 경로 | 실패 지점, 탐지시간, 정상 digest 복구시간 |

타임라인은 각각 별도로 기록한다: BE commit 시각 → Jenkins 시작(최대 5분 polling/queue) → 테스트/빌드/push → PR 생성 → 병합 → Argo 시작/완료 → 외부 API 정상.
.local/ci-timings.tsv에는 prepare/test/publish의 epoch 시작·종료·exit code가 남는다. ci-image.json/release.json에는 BE SHA, ECR digest, Jenkins URL, UTC 시각이 남는다.
승인 대기시간을 빼서 자동화가 빨라진 것처럼 계산하지 않는다. 전체 시간과 자동 처리시간/사람 작업시간을 나눠 제시한다.
실패율은 실패한 시도/전체 시도이며 0회 실패가 장애 가능성 0%를 의미하지 않는다. 최소 여러 번 반복하고 표본 수/중앙값/범위를 같이 적는다.

실패 대응:

- 테스트/빌드/계정 확인/push/digest 검증 실패 → 배포 PR 생성하지 않음. ECR push 성공 뒤 PR 실패하면 사용하지 않는 이미지가 남을 수 있음.
- ECR immutable 태그는 이미 사용된 실행 번호로 재사용하지 않음. Jenkins 재설치로 번호가 초기화되면 기존 태그 확인 후 번호를 조정.
- 앱 배포 장애 → 직전 정상 digest의 Git 변경으로 복구 PR/병합. selfHeal 중에 kubectl set image만 하면 Git으로 되돌아간다.
- 비교 실험을 위해 HPA/수동 Replica를 쓰려면 먼저 자동 sync/selfHeal을 일시 정지하고 설정/시각을 기록한다. 실험 후 Git 상태로 복원.
- readiness gate가 빠진 최초 Pod는 TGB 준비 후 교체 검증. 무중단과 SSE 재연결은 아직 입증하지 않았다.

## 8. 검증과 남은 한계

검증 결과:

- Terraform fmt/validate, mock 테스트 총 16개 통과. 최종 SG/사양 변경 후 Jenkins 테스트를 별도로 다시 실행해 1개 통과.
- Node 배포/GitOps 검증 13개 통과. 공식 LBC/Argo Helm chart 렌더, 실제 Kustomize 승격 전후 동일성, polling 계정/ECR 해석 포함.
- CI shell 모의 시나리오 11개 통과: 정상/계정 불일치/빌드·로그인·push·테스트 실패/잘못된 digest/최초 이미지 모드/환경 누락/SHA 오류/main 외 commit.
- 설치 shell 문법, Node 문법, 문서 로컬 링크와 diff 검사 통과.

실제 Jenkins Declarative linter, EC2 cloud-init/SSM, Docker build, ECR push, Argo server-side validation/동기화는 미실행이다.
현재 Docker 엔진이 꺼져 있어 이번 pipeline으로 앱을 재빌드하지 않았다. 이전 단계 앱 테스트 결과와 이번 mock 결과는 구분한다.
공식 Argo/LBC chart를 실제 Helm template으로 렌더하고 GitOps 승격 전후 결과 동일성, digest/비밀값/namespace 검사를 검증한다.
CI shell 테스트는 AWS/Docker 함수를 mock으로 대체하며 실제 서비스에 연결하지 않는다. 설치 shell은 문법 검사만 수행한다.

재현 명령(저장소 루트, 필요한 CLI는 PATH에 준비):

```powershell
terraform fmt -check -recursive terraform
terraform -chdir=terraform/envs/dev init -backend=false -input=false -lockfile=readonly
terraform -chdir=terraform/envs/dev validate
terraform -chdir=terraform/envs/dev test
npm ci --ignore-scripts
New-Item -ItemType Directory -Path .local -Force
helm pull aws-load-balancer-controller --repo https://aws.github.io/eks-charts --version 3.6.2 --destination .local
helm pull argo-cd --repo https://argoproj.github.io/argo-helm --version 10.14.0 --destination .local
$env:LBC_CHART = (Resolve-Path .local/aws-load-balancer-controller-3.6.2.tgz).Path
$env:ARGO_CHART = (Resolve-Path .local/argo-cd-10.14.0.tgz).Path
npm test
bash scripts/tests/ci-backend.tests.sh
```

다음 구현: Vercel FE 배포 연결, CloudWatch/SNS·Prometheus/Grafana·비용 관측. 그 후 실제 AWS plan/리소스 검토와 24~72시간 가동/측정이다.
종료 시 CI Job/polling을 정지하고 증거를 내보낸다. EC2 종료 전 Jenkins 설정/기록 보존 필요 여부를 결정하고 GitHub token을 폐기한다. 앱/ALB를 정리한 뒤 Argo/Controller/EKS를 제거한다. 강제 namespace 삭제로 ALB finalizer를 우회하지 않는다.

## 9. 공식 근거

- [Jenkins LTS 및 Java](https://www.jenkins.io/changelog-stable/), [Java 지원 범위](https://www.jenkins.io/doc/book/platform-information/support-policy-java/)
- [Jenkins credentials](https://www.jenkins.io/doc/book/using/using-credentials/), [Pipeline 문법](https://www.jenkins.io/doc/book/pipeline/syntax/)
- [ECR push IAM](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-push-iam.html)
- [SSM port forwarding](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-sessions-start.html)
- [AL2023 Node.js](https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html)
- [Argo CD 설치](https://argo-cd.readthedocs.io/en/stable/operator-manual/installation/), [자동 동기화](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/)
