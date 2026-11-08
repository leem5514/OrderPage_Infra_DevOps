#!/usr/bin/env bash
set -euo pipefail
phase="${1:?prepare|test|publish}"
started=$(date +%s)
mkdir -p .local
trap 'status=$?; printf "%s\t%s\t%s\t%s\n" "$phase" "$started" "$(date +%s)" "$status" >> .local/ci-timings.tsv' EXIT
case "$phase" in
  prepare)
    [[ "${AWS_ACCOUNT_ID:-}" =~ ^[0-9]{12}$ ]] || { echo 'AWS_ACCOUNT_ID 오류'; exit 1; }
    [[ "${ECR_NAME:-}" =~ ^[a-z0-9][a-z0-9/_-]*$ ]] || { echo 'ECR_NAME 오류'; exit 1; }
    if [[ "${CREATE_DEPLOYMENT_PR:-true}" != false ]]; then
      [[ -f gitops/environments/dev/kustomization.yaml ]] || { echo '실제 환경 GitOps 최초 승격이 먼저 필요합니다. 첫 이미지 준비는 CREATE_DEPLOYMENT_PR=false로 실행하세요.'; exit 1; }
    fi
    if [[ -n "${BE_REVISION:-}" ]]; then
      [[ "$BE_REVISION" =~ ^[a-f0-9]{40}$ ]] || { echo 'BE SHA 오류'; exit 1; }
      git -C .local/backend merge-base --is-ancestor "$BE_REVISION" HEAD
      git -C .local/backend checkout --detach "$BE_REVISION"
    fi
    git -C .local/backend rev-parse HEAD > .local/be-commit
    ;;
  test)
    # Jenkins runtime Java 21과 앱 Java 11을 분리한다. 소스 폴더만 mount하며 AWS/GitHub 값을 전달하지 않는다.
    docker run --rm --user "$(id -u):$(id -g)" --cpus 2 --memory 3g \
      --mount "type=bind,source=$PWD/.local/backend,target=/app" --workdir /app \
      --env GRADLE_USER_HOME=/app/.gradle-ci eclipse-temurin:11-jdk \
      sh -c 'sh gradlew --no-daemon --max-workers=2 test'
    ;;
  publish)
    [[ "${BE_COMMIT:-}" =~ ^[a-f0-9]{40}$ && "${BUILD_NUMBER:-}" =~ ^[1-9][0-9]*$ ]] || exit 1
    account=$(aws sts get-caller-identity --query Account --output text)
    [[ "$account" == "$AWS_ACCOUNT_ID" ]] || { echo 'AWS 계정 불일치'; exit 1; }
    repository="$AWS_ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com/$ECR_NAME"
    actual=$(aws ecr describe-repositories --repository-names "$ECR_NAME" --query 'repositories[0].repositoryUri' --output text)
    [[ "$actual" == "$repository" ]] || { echo 'ECR 저장소 불일치'; exit 1; }
    # immutable 태그 충돌을 피하려고 SHA + Jenkins 실행 번호를 함께 사용한다.
    image="$repository:$BE_COMMIT-b$BUILD_NUMBER"
    mkdir .local/build-context
    git -C .local/backend archive HEAD | tar -x -C .local/build-context
    docker build --pull --platform linux/amd64 --label "org.opencontainers.image.revision=$BE_COMMIT" --tag "$image" .local/build-context
    # Docker 인증 파일은 이번 실행 전용이며 종료 시 logout한다.
    export DOCKER_CONFIG="$PWD/.local/docker-auth"
    (umask 077; mkdir "$DOCKER_CONFIG")
    trap 'status=$?; docker logout "$AWS_ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com" >/dev/null 2>&1 || true; printf "%s\t%s\t%s\t%s\n" "$phase" "$started" "$(date +%s)" "$status" >> .local/ci-timings.tsv' EXIT
    set +x
    aws ecr get-login-password | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com"
    docker push "$image"
    digest=$(aws ecr describe-images --repository-name "$ECR_NAME" --image-ids "imageTag=$BE_COMMIT-b$BUILD_NUMBER" --query 'imageDetails[0].imageDigest' --output text)
    [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'ECR digest 확인 실패'; exit 1; }
    printf '%s\n' "$digest" > .local/image-digest
    printf '%s\n' "$repository" > .local/image-repository
    ;;
  *) echo '지원하지 않는 단계'; exit 1 ;;
esac
