#!/usr/bin/env bash
set -euo pipefail
# token 없는 단계에서만 실행. EC2에 준비한 Node 22를 사용한다.
node -e 'if(Number(process.versions.node.split(".")[0])!==22)throw Error("Node 22 required")'
mkdir -p .local
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
export FE_CI_STARTED="$started"
export FE_CI_REPORT
FE_CI_REPORT=$(node -p 'require("node:path").resolve(".local/frontend-ci.json")')
finish() {
  status=$?
  FE_CI_EXIT="$status" node -e 'const fs=require("fs");fs.writeFileSync(process.env.FE_CI_REPORT,JSON.stringify({startedAt:process.env.FE_CI_STARTED,finishedAt:new Date().toISOString(),exitCode:Number(process.env.FE_CI_EXIT)},null,2))'
  exit "$status"
}
trap finish EXIT
cd .local/frontend
npm ci --no-audit --no-fund
# pipefail을 사용해 TAP 보관용 tee가 테스트 실패를 성공으로 덮지 못하게 한다.
npm test | tee ../frontend-tests.tap
npm run lint -- --no-fix
npm run build:production
npm run package:vercel
# EXIT 기록은 Infra 루트에 남긴다.
cd ../..
