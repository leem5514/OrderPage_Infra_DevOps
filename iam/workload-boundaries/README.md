# Workload Role 권한 상한

이 디렉터리는 관리자 경로에서 생성할 권한 상한 정책의 **원본 근거**다. 실제 계정이 들어간 결과는 저장하지 않는다.

`node scripts/prepare-workload-boundaries.mjs <12자리 계정 ID>`로 `.local/iam-workload-boundaries`에 정책 5개, 갱신된 조회 정책, manifest를 생성한다. 기존 출력 폴더는 덮어쓰지 않는다. 이 명령은 AWS API를 호출하지 않는다.

| 상한 | 기준 |
|---|---|
| cluster | AmazonEKSClusterPolicy |
| node | AmazonEKSWorkerNodePolicy + AmazonEKS_CNI_Policy + AmazonEC2ContainerRegistryPullOnly |
| jenkins | AmazonSSMManagedInstanceCore + 현재 Jenkins 모듈의 전용 ECR inline policy |
| backend-upload | 현재 백엔드 Role의 전용 이미지 버킷 PutObject |
| alb-controller | 저장소에 고정한 공식 AWS Load Balancer Controller v3.6.2 정책 |

`vendor/sources.json`은 공식 AWS 문서 URL, 문서에 표시된 버전, 수집일과 정규화한 JSON의 SHA256을 기록한다. CRLF는 LF로 정규화해 검사한다. Controller 원본과 라이선스는 [기존 vendor 디렉터리](../../terraform/modules/load-balancer-controller-irsa/vendor/README.md)를 공유한다. 생성기는 원본의 Effect·Action·Resource·Condition을 보존하고 합집합의 Sid만 중복되지 않게 재지정한다.

AWS 관리형 정책이 이후 갱신되어도 상한은 자동으로 넓어지지 않는다. 실제 운영에 추가 Action이 필요해지면 원본 변경, 테스트, 관리자 정책 버전 갱신을 함께 검토해야 한다. 이 스냅샷은 AWS 전체 API 권한 시뮬레이션 결과가 아니다.

**상한 정책을 사용자 그룹이나 배포 Role의 일반 권한으로 연결하지 않는다.** [콘솔 생성 순서와 제한](../../docs/restart/iam/workload-boundaries.md)을 따른다.
