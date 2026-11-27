# EKS 본체 권한 검토본

**지금 AWS에 생성·연결하지 않는다.** 이 묶음은 기존 IAM 위임 정책을 대체하지 않으며, VPC·EC2·로그 그룹 등의 선행 권한도 포함하지 않는다.

저장 plan에서 검토한 Kubernetes minor 버전을 입력한다.

```powershell
node scripts/prepare-eks-service-permissions.mjs <12자리-계정-ID> <minor-버전>
```

Git 제외 폴더 `.local/iam-eks-service-review`에 다음 파일을 2칸 들여쓰기로 생성한다. 기존 폴더는 덮어쓰지 않으며 AWS API를 호출하지 않는다.

| 파일 | 역할 |
|---|---|
| `OrderPageEksServiceLifecycle.json` | 클러스터·관리형 노드 그룹·기본 add-on 생성/갱신/삭제·조회·태그 |
| `OrderPageEksServiceGuardrails.json` | 서울 외 쓰기, 다른 자원 변경, Auto Mode·연장 지원·추가 인증 경로 등의 거부 |
| `manifest.json` | 버전·정책 크기·해시, 검토 상태와 미완료 항목 |

plan의 설정을 검사할 때도 검토한 minor 버전을 명시한다. 전체 구성과 최초 EKS 단계를 구분한다.

```powershell
node scripts/review-eks-service-plan.mjs terraform/envs/dev/<전체-plan>.tfplan <minor-버전> full
node scripts/review-eks-service-plan.mjs terraform/envs/dev/<최초-plan>.tfplan <minor-버전> bootstrap
```

Terraform CLI가 PATH에 없으면 `TERRAFORM` 환경 변수로 실행 파일 경로를 지정한다. 출력은 고정된 항목명과 통과 여부뿐이며 원본 plan이나 계정·IP를 출력하지 않는다. 성공해도 `readyForApply`는 false다.

`authorization-reference.json`은 공식 EKS 권한 참조와 고정 provider v5.100.0 소스에서 추린 근거다. source URL·해시를 보관하며 **실제 AWS 권한 평가 결과는 아니다.** 생성 API에서 제한할 수 없는 범위와 검증 결과는 [상세 설명](../../docs/restart/iam/eks-service-permissions.md)에 기록한다.
