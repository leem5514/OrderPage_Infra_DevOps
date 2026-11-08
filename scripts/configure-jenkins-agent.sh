#!/usr/bin/env bash
set -euo pipefail
[[ "$EUID" == 0 ]] || { echo 'EC2에서 sudo로 실행하세요.'; exit 1; }
[[ ! -f /etc/systemd/system/orderpage-agent.service ]] || { echo '기존 agent 변경은 별도 검토하세요.'; exit 1; }
id orderpage-agent >/dev/null
# 먼저 UI에 ec2-agent 노드(label orderpage-ci, executor 1)를 만들고 secret을 입력한다.
read -r -s -p 'ec2-agent secret: ' agent_secret
printf '\n'
[[ "$agent_secret" =~ ^[a-f0-9]{64}$ ]] || { echo 'agent secret 형식 오류'; exit 1; }
umask 077
printf '%s' "$agent_secret" > /var/lib/orderpage-agent/agent.secret
unset agent_secret
chown orderpage-agent:orderpage-agent /var/lib/orderpage-agent/agent.secret
curl --fail http://127.0.0.1:8080/jnlpJars/agent.jar -o /opt/orderpage-ci/agent.jar
chmod 644 /opt/orderpage-ci/agent.jar
cat > /etc/systemd/system/orderpage-agent.service <<'UNIT'
[Unit]
Description=OrderPage Jenkins build agent
After=orderpage-jenkins.service docker.service
Requires=docker.service
[Service]
User=orderpage-agent
Group=orderpage-agent
SupplementaryGroups=docker
WorkingDirectory=/var/lib/orderpage-agent
Environment=AWS_REGION=ap-northeast-2
Environment=AWS_DEFAULT_REGION=ap-northeast-2
ExecStart=/usr/bin/java -Xmx256m -jar /opt/orderpage-ci/agent.jar -url http://127.0.0.1:8080/ -name ec2-agent -secret @/var/lib/orderpage-agent/agent.secret -webSocket -workDir /var/lib/orderpage-agent
Restart=always
RestartSec=10
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now orderpage-agent
