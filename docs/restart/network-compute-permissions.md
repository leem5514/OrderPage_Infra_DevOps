# VPC와 Jenkins를 만들 권한은 어디까지 필요한가

2026-11-27. PR #26을 비밀 탐지 재검사 후 병합했다. 이번에는 실제 네트워크 19개와 EC2 관련 자원 2개에 필요한 정책을 검토용으로 작성했다. Terraform 구성·인스턴스 크기·자원 수는 바꾸지 않았으며, **AWS 정책 연결과 서비스 생성은 실행하지 않았다.**

## 새 자원과 기존 부모를 구분한 이유

서브넷을 생성할 때는 아직 서브넷에 태그가 없다. 생성 요청의 `aws:RequestTag`를 검사해야 한다. 반면 그 서브넷을 넣을 VPC는 이미 존재하므로 `aws:ResourceTag`로 프로젝트 소유 여부를 검사한다. 두 조건을 한 문장에 섞으면 정상 생성이 막히거나 부모 범위를 놓칠 수 있다.

| 요청 | 새 자원에 요구하는 조건 | 연결할 기존 자원 |
|---|---|---|
| VPC·서브넷·IGW·EIP·라우팅 테이블·SG 생성 | 서울, 실행 계정, 프로젝트·환경·관리 도구 태그 | API가 요구하는 VPC의 동일 소유 태그 |
| NAT 생성 | 새 NAT의 요청 태그 | 소유 태그가 있는 EIP·서브넷·VPC |
| S3 endpoint 생성 | 요청 태그와 서울 S3 서비스 이름 | 프로젝트 VPC·라우팅 테이블 |
| 연결·변경·삭제 | 대상의 기존 소유 태그 | IGW 연결과 라우팅 연결의 관련 자원도 함께 검사 |

[EC2 공식 권한표](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ec2.html)와 [프로그램형 참조](https://servicereference.us-east-1.amazonaws.com/v1/ec2/ec2.json)의 **Action별 Resource별 Condition**을 대조했다. 다른 API가 지원하는 조건을 잘못 가져오지 않도록 자동 검사한다. 선택한 42개 Action과 provider 소스 10개의 출처·해시는 [검토 자료](../../iam/network-compute/authorization-reference.json)에 기록했다.

현재 보안 그룹은 Terraform inline 규칙을 사용하며 새 규칙에는 태그가 없다. 따라서 새 `security-group-rule` ARN에 프로젝트 태그를 요구하지 않는다. 대신 같은 요청의 대상 `security-group` ARN은 기존 소유 태그가 있어야 허용한다. 이는 외부 SG에 규칙을 추가할 수 있다는 뜻이 아니다. 규칙의 포트·CIDR·참조 SG 내용은 별도 설정 검토 대상이다.

## Jenkins 생성 한 번에 여섯 종류의 자원을 검사한다

`RunInstances`를 인스턴스 ARN 하나로만 검사하면 부족하다. 이번 정책은 다음 대상을 각각 허용하고, 테스트에서도 지정한 모든 대상이 허용돼야 요청이 통과하도록 확인한다.

| 대상 | 조건 |
|---|---|
| AMI | 로컬에서 검토한 AMI 하나. AMI ARN의 계정 부분은 비어 있음 |
| 인스턴스 | 프로젝트 태그, `orderpage-dev-jenkins` 이름 태그, `m6i.large`, 지정 instance profile, IMDSv2, default tenancy |
| EBS | 프로젝트 요청 태그, 암호화, gp3, 30GiB 이하 |
| 네트워크 인터페이스 | public IP 비활성 |
| 서브넷 | 프로젝트 소유 태그와 `Tier=private` |
| 보안 그룹 | 프로젝트 소유 태그 |

지정 Jenkins Role의 `iam:PassRole`은 기존 위임 정책과 합쳐 검사한다. provider 5.100.0은 `default_tags`를 인스턴스와 볼륨 생성 요청에 모두 전달하므로, 중복 `volume_tags` 설정을 추가하지 않았다. [provider 인스턴스 구현](https://github.com/hashicorp/terraform-provider-aws/blob/v5.100.0/internal/service/ec2/ec2_instance.go).

현재 구성의 생성·시작·정지·삭제 경로를 준비했다. 임의의 instance profile 교체, 디스크 확장, user data 및 인스턴스 타입의 제자리 변경은 이 정책에 추가하지 않았다. 상세 모니터링을 켜는 `MonitorInstances`도 허용하지 않았다. 설정을 바꿀 때는 새 API 필요성과 비용을 별도로 검토한다. provider 기본값·실제 서비스 의존 권한까지 검증된 것은 아니므로 최초 생성·정리 시험 전에는 완성된 실행 정책으로 간주하지 않는다.

EKS launch template는 생성·버전 작성·기본 버전 변경·삭제를 소유 태그로 제한한다. **template 내부의 모든 설정이나 EKS worker의 실행까지 이 정책이 통제하는 것은 아니다.** worker는 AWS 서비스 연결 Role을 사용한다. 20GiB 암호화 gp3·IMDSv2 등의 template 내용은 plan에서, 노드 수·타입은 [기존 EKS 검사](eks-service-permissions.md)에서 확인한다.

## 태그가 권한 우회 수단이 되지 않도록

생성 중 `CreateTags`는 검토한 `ec2:CreateAction`과 요청 태그가 있어야 허용한다. 기존 자원의 일반 태그 변경은 소유 태그가 있는 자원만 허용한다. 소유 태그 세 개의 삭제·다른 값으로 변경·태그가 다른 기존 자원을 프로젝트 소유로 바꾸는 요청은 명시적으로 거부한다. [AWS 생성 시 태깅 권한 안내](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/supported-iam-actions-tagging.html).

최종 검토에서 삭제 키 목록을 생략하는 경로도 확인했다. EC2 `DeleteTags`는 목록이 없으면 모든 사용자 태그를 삭제하므로, 키가 없는 삭제를 별도로 거부한다. 소유 태그 이름의 대소문자 변형도 보호한다. 두 사례를 추가 Allow가 있는 조건에서도 회귀 검사했다. [DeleteTags API 동작](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DeleteTags.html).

이 정책은 모든 추가 Allow를 무력화하는 permissions boundary가 아니다. 관리자나 다른 권한으로 태그를 바꿀 수 있는 주체까지 통제한다고 주장하지 않는다. 자원 수, SG 포트, 라우팅 목적지, launch template 본문, 실행 횟수에 따른 비용도 IAM만으로 고정하지 못한다. 다른 정책과 합친 최종 유효 권한을 다시 확인해야 한다.

## 실제 plan에서 확인한 내용과 남긴 항목

새 검사기는 알려진 설정 18개 항목을 확인한다. 현재 저장된 전체 plan에서 대상 자원은 **21개**, 검사 항목은 **18개 모두 통과**했다. NAT 1개, EIP 1개, public/private 서브넷 각 2개, S3 Gateway endpoint, 데이터 포트 3306·6379·5671의 public CIDR 금지, Jenkins inbound 없음, IMDSv2, 디스크 크기·암호화 등이 포함된다.

다만 `jenkins-ami-if-known`은 값이 알려졌을 때만 AMI 일치를 검사한다. 현재 plan의 AMI는 **미확정**이며 검증 완료가 아니다. Jenkins 모듈이 VPC에 의존해 AMI data 조회가 이후로 미뤄진 상태다. 최초 VPC·EKS 생성 단계 뒤 Jenkins 생성 전 plan에서 실제 AMI를 확인한다. 서브넷·SG·라우팅 대상 ID와 정확한 연결 관계도 후속 plan에서 확인해야 한다. 검사 결과는 항상 `readyForApply: false`를 유지한다.

실제 plan 대조 중 launch template EBS의 `encrypted`, `delete_on_termination`이 provider에서 문자열 `"true"`로 표현되는 차이를 확인해 검사기에 반영했다. 문자열 `"false"`는 통과하지 못하며 회귀 테스트도 추가했다.

- 전체 Node 테스트 **115개 통과**. 신규 10개는 교차 프로젝트 접근·태그 탈취·공개 IP·고가 타입/디스크·추가 NAT·공개 DB·IMDSv1·삭제/교체 등의 변형을 포함한다.
- 이전 IAM·EKS 정책과 결합한 로컬 평가와 공식 Action/Resource/Condition 대조를 수행했다. AWS IAM 시뮬레이터나 실제 생성·삭제 시험은 아니다.
- Terraform HCL은 바꾸지 않았다. 기존 plan을 읽어 검사했고 새 apply나 불필요한 자원 생성은 하지 않았다.

[검증 결과](security-evidence/network-compute-permissions-2026-11-27.json)에는 실제 계정·이메일·IP·암호·AMI를 넣지 않았다. 실제 정책 4개와 manifest는 Git 제외 폴더에만 생성했다. [생성·검사 명령](../../iam/network-compute/README.md)을 실행해도 AWS 권한이 연결되거나 서비스가 생성되지 않는다.

## 다음 순서

데이터 서비스(RDS·Redis·Amazon MQ), S3·ECR·인증서, CloudWatch·SNS·비용 관측 권한을 준비한다. 이후 전체 정책을 합쳐 유효 권한과 실제 계정의 Role 연결 할당량을 확인한다. 현재 후보는 기존 state/read 2개, IAM 위임 6개, EKS 2개, 이번 4개로 14개이며 아직 최종 묶음이 아니다.

최소 비용 목표는 그대로다. 이번 정책은 새로운 자원을 추가하거나 비용 상한을 보장하지 않는다. 실제 적용 전 가동 시간·Budget·최신 가격과 plan을 확인하고, 실험이 끝나면 삭제 plan과 잔여 자원을 검토한다. 지금 사용자에게 추가 정책을 수동 생성·연결하도록 요청하는 단계는 아니다.
