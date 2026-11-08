#!/usr/bin/env bash
set -euo pipefail
[[ "$EUID" == 0 ]] || { echo 'EC2에서 sudo로 실행하세요.'; exit 1; }
[[ -d /opt/orderpage-ci && ! -f /opt/orderpage-ci/jenkins.war ]] || { echo 'OS bootstrap 확인 또는 기존 Jenkins 업그레이드 별도 검토가 필요합니다.'; exit 1; }
id orderpage-jenkins >/dev/null
# 2026-11-08 공식 LTS/공식 checksum 확인. 가동 전에 보안 업데이트 여부를 다시 확인한다.
curl --fail --location --proto '=https' --tlsv1.2 https://get.jenkins.io/war-stable/2.580.2/jenkins.war -o /opt/orderpage-ci/jenkins.war
printf '%s  %s\n' d98032d2401c540a35613a82ed358921fcf3166d5e6eaaaf60a7941845be3251 /opt/orderpage-ci/jenkins.war | sha256sum --check -
chmod 644 /opt/orderpage-ci/jenkins.war
install -d -o orderpage-jenkins -g orderpage-jenkins /var/lib/orderpage-jenkins/init.groovy.d
cat > /var/lib/orderpage-jenkins/init.groovy.d/00-executors.groovy <<'GROOVY'
// Controller에서 빌드하지 않는다. 로그인/설정 wizard는 기본 활성 상태로 둔다.
jenkins.model.Jenkins.get().setNumExecutors(0)
GROOVY
chown orderpage-jenkins:orderpage-jenkins /var/lib/orderpage-jenkins/init.groovy.d/00-executors.groovy
cat > /etc/systemd/system/orderpage-jenkins.service <<'UNIT'
[Unit]
Description=OrderPage Jenkins controller
After=network-online.target
[Service]
User=orderpage-jenkins
Group=orderpage-jenkins
Environment=JENKINS_HOME=/var/lib/orderpage-jenkins
ExecStart=/usr/bin/java -Xms256m -Xmx1024m -jar /opt/orderpage-ci/jenkins.war --httpListenAddress=127.0.0.1 --httpPort=8080
Restart=on-failure
RestartSec=10
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now orderpage-jenkins
# CI는 kubectl의 로컬 kustomize만 사용한다. 이 EC2 Role에는 EKS 권한이 없다.
curl --fail --location --proto '=https' --tlsv1.2 https://dl.k8s.io/release/v1.35.0/bin/linux/amd64/kubectl -o /opt/orderpage-ci/kubectl
curl --fail --location --proto '=https' --tlsv1.2 https://dl.k8s.io/release/v1.35.0/bin/linux/amd64/kubectl.sha256 -o /opt/orderpage-ci/kubectl.sha256
printf '%s  %s\n' "$(cat /opt/orderpage-ci/kubectl.sha256)" /opt/orderpage-ci/kubectl | sha256sum --check -
install -m 755 /opt/orderpage-ci/kubectl /usr/local/bin/kubectl
echo 'SSM 터널로 localhost:8080에 접속해 wizard/플러그인/agent/credential을 설정하세요.'
