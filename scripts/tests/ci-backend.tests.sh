#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$repo/.local"
suite=$(mktemp -d "$repo/.local/ci-mock-XXXXXX")
export AWS_ACCOUNT_ID=123456789012 ECR_NAME=orderpage-backend BE_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa BUILD_NUMBER=1
export AWS_REGION=ap-northeast-2
aws() {
  printf 'aws %s\n' "$*" >> "$CASE_LOG"
  case "$*" in
    'sts '*) [[ "$SCENARIO" != wrong-account ]] && echo 123456789012 || echo 999999999999 ;;
    'ecr describe-repositories '*) echo 123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/orderpage-backend ;;
    'ecr get-login-password') echo mock-login ;;
    'ecr describe-images '*) [[ "$SCENARIO" != bad-digest ]] && printf 'sha256:%064d\n' 0 || echo None ;;
    *) return 10 ;;
  esac
}
docker() {
  printf 'docker %s\n' "$*" >> "$CASE_LOG"
  case "$1" in
    build) [[ "$SCENARIO" != build-fail ]] ;;
    login) cat >/dev/null; [[ "$SCENARIO" != login-fail ]] ;;
    push) [[ "$SCENARIO" != push-fail ]] ;;
    logout) return 0 ;;
    run) [[ "$SCENARIO" != test-fail ]] ;;
    *) return 11 ;;
  esac
}
git() {
  printf 'git %s\n' "$*" >> "$CASE_LOG"
  case "$*" in
    '-C .local/backend archive HEAD') tar -cf - --files-from /dev/null ;;
    '-C .local/backend rev-parse HEAD') echo "$BE_COMMIT" ;;
    '-C .local/backend merge-base '*) [[ "$SCENARIO" != non-ancestor ]] ;;
    '-C .local/backend checkout '*) return 0 ;;
    *) return 12 ;;
  esac
}
export -f aws docker git
for scenario in success wrong-account build-fail login-fail push-fail bad-digest test-fail; do
  case_dir="$suite/$scenario"
  mkdir -p "$case_dir/.local/backend"
  export SCENARIO="$scenario" CASE_LOG="$case_dir/commands.log"
  : > "$CASE_LOG"
  phase=publish
  [[ "$scenario" != test-fail ]] || phase=test
  set +e
  (cd "$case_dir" && bash "$repo/scripts/ci-backend.sh" "$phase") > "$case_dir/output.log" 2>&1
  code=$?
  set -e
  if [[ "$scenario" == success ]]; then
    [[ "$code" == 0 && -f "$case_dir/.local/image-digest" ]]
  else
    [[ "$code" != 0 && ! -f "$case_dir/.local/image-digest" ]]
  fi
  if [[ "$scenario" =~ ^(wrong-account|build-fail|login-fail)$ ]]; then
    ! grep -q '^docker push ' "$CASE_LOG"
  fi
  [[ -s "$case_dir/.local/ci-timings.tsv" ]]
  printf 'PASS %s\n' "$scenario"
done
for scenario in bootstrap no-gitops bad-sha non-ancestor; do
  case_dir="$suite/$scenario"
  mkdir -p "$case_dir/.local/backend"
  export SCENARIO="$scenario" CASE_LOG="$case_dir/commands.log" BE_REVISION=''
  export CREATE_DEPLOYMENT_PR=true
  : > "$CASE_LOG"
  if [[ "$scenario" == bootstrap ]]; then export CREATE_DEPLOYMENT_PR=false; fi
  if [[ "$scenario" =~ ^(bad-sha|non-ancestor)$ ]]; then
    mkdir -p "$case_dir/gitops/environments/dev"
    : > "$case_dir/gitops/environments/dev/kustomization.yaml"
    export BE_REVISION="$BE_COMMIT"
    [[ "$scenario" != bad-sha ]] || export BE_REVISION='not-a-sha'
  fi
  set +e
  (cd "$case_dir" && bash "$repo/scripts/ci-backend.sh" prepare) > "$case_dir/output.log" 2>&1
  code=$?
  set -e
  if [[ "$scenario" == bootstrap ]]; then
    [[ "$code" == 0 && -f "$case_dir/.local/be-commit" ]]
  else
    [[ "$code" != 0 && ! -f "$case_dir/.local/be-commit" ]]
  fi
  ! grep -q '^aws ' "$CASE_LOG"
  printf 'PASS %s\n' "$scenario"
done
echo '11 CI 단계 모의 검증 통과. 실제 AWS/Docker 호출 없음.'
