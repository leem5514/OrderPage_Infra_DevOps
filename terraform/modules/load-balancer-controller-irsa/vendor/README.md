# 고정한 공식 정책

- Controller: v3.6.2 / Helm chart: 3.6.2
- 원본: https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v3.6.2/docs/install/iam_policy.json
- 다운로드: 2026-11-07 KST
- SHA256: 16f232c9d9f79366fe949c4550ad517a202380058a9e48d45a4e215044a20a6a
- 라이선스: 동봉 LICENSE (Apache-2.0)

정책 원문은 수정하지 않았다. 공식 범용 정책에는 Describe 및 일부 리소스 탐색에 Resource=*와 WAF/Shield 권한이 포함된다.
클러스터 전용 ServiceAccount 신뢰와 공식 태그 조건으로 사용하며, 완전히 이 프로젝트만의 최소 권한 정책이라고 주장하지 않는다.
사용하지 않는 WAF/Shield/Gateway 기능은 Helm에서 비활성화한다.
