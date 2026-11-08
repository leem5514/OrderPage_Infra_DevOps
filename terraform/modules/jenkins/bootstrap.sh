#!/bin/bash
set -euo pipefail
# 앱 빌드 Java 11은 Docker 안에서만 사용한다. Jenkins/agent는 Java 21이다.
dnf install -y docker git java-21-amazon-corretto-headless nodejs22 nodejs22-npm tar gzip unzip awscli-2
systemctl enable --now docker amazon-ssm-agent
id orderpage-jenkins >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/orderpage-jenkins orderpage-jenkins
id orderpage-agent >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/orderpage-agent orderpage-agent
usermod -aG docker orderpage-agent
# Controller는 Docker group에 넣지 않는다. Node 22 패키지의 버전별 명령을 공통 이름으로 제공한다.
command -v node >/dev/null || ln -s /usr/bin/node-22 /usr/local/bin/node
command -v npm >/dev/null || ln -s /usr/bin/npm-22 /usr/local/bin/npm
install -d -m 755 /opt/orderpage-ci
echo 'OS 도구 준비 완료. Jenkins WAR 검증 설치와 UI 초기 설정은 별도 절차로 수행하세요.'
