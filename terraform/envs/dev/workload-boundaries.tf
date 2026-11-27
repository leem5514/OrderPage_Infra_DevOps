# 관리자 경로에서 먼저 생성하는 정책이다. 배포 Role은 상한 정책을 생성/편집하지 않는다.
# ARN 연결만으로 원격 정책 존재·내용이 검증되지는 않는다. apply 전 별도 조회가 필수다.
locals {
  workload_boundaries = {
    for kind in ["cluster", "node", "jenkins", "backend-upload", "alb-controller"] :
    kind => "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/orderpage-dev-boundary-${kind}"
  }
}
