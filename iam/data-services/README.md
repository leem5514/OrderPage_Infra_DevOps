# 데이터 서비스 실행 권한 검토본

**AWS에 아직 연결하지 않는다.** RDS MariaDB·ElastiCache Redis·Amazon MQ RabbitMQ의 현재 구성에 맞춘 검토 정책 4개다. 기존 읽기·IAM 위임·서비스 연결 Role·네트워크 정책 및 후속 로그 권한과 함께 검토해야 한다.

| 정책 | 역할 | 공백 제외 크기 |
|---|---|---:|
| `OrderPageMariaDbLifecycle` | 지정 DB·subnet group·parameter group 생성, 제한된 변경과 정리 | 4,709자 |
| `OrderPageRedisLifecycle` | 지정 replication group·subnet group, 기본 parameter group 사용 | 4,556자 |
| `OrderPageRabbitMqLifecycle` | 태그가 있는 broker 생성, 지정 이름의 변경·재부팅·정리 | 1,443자 |
| `OrderPageDataGuardrails` | 소유 태그 보호, 서울 밖 쓰기 및 미계획 제품 거부 | 5,490자 |

저장소 루트에서 실행한다. 자리표시자는 실제 로컬 값으로 교체하며 Access Key·Secret Key는 입력하지 않는다.

```powershell
node scripts/prepare-data-service-permissions.mjs <12자리-계정-ID>
node scripts/review-data-service-plan.mjs terraform/envs/dev/<검토-plan>.tfplan <검토한-MariaDB-버전>
```

정책과 manifest는 `.local/iam-data-service-review`에만 생성된다. 기존 폴더 및 `.local` 링크는 덮어쓰지 않는다. 생성기는 AWS API를 호출하지 않는다. `REVIEW_ONLY_DO_NOT_ATTACH`, `readyForApply: false`는 정상 상태다.

plan 검사기는 알려진 설정을 검사하고 고정된 항목명·참/거짓만 출력한다. 비밀번호·토큰은 결과에 복사하지 않지만, 입력 plan 자체는 민감 파일이므로 Git에 올리면 안 된다. 이 검사기는 직접 AWS 호출이나 지출을 차단하는 장치가 아니다.

[구현 이유와 검증 한계](../../docs/restart/iam/data-service-permissions.md), [선택한 공식 참조](authorization-reference.json), [실제 plan 검사 결과](../../docs/restart/security-evidence/data-service-permissions-2026-11-27.json)를 함께 확인한다.
