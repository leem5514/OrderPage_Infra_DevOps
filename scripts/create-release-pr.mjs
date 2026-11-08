import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRelease } from './gitops-release.mjs';

// Jenkins의 자격증명 바인딩 안에서만 실행한다. 토큰을 URL/명령 인자/파일에 넣지 않는다.
const release = JSON.parse(fs.readFileSync('gitops/environments/dev/release.json','utf8'));
validateRelease(release);
if (!/^[1-9][0-9]*$/.test(process.env.BUILD_NUMBER || '')) throw new Error('Jenkins BUILD_NUMBER가 필요합니다.');
if (!process.env.GH_TOKEN || !process.env.GH_USER) throw new Error('Infra 전용 GitHub 자격증명이 필요합니다.');
const branch = 'release/backend-'+release.sourceCommit.slice(0,12)+'-'+process.env.BUILD_NUMBER;
const askDir = fs.mkdtempSync(path.join(os.tmpdir(),'orderpage-git-'));
const ask = path.join(askDir,'askpass.sh');
fs.writeFileSync(ask,'#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "$GH_USER" ;; *) printf "%s\\n" "$GH_TOKEN" ;; esac\n',{mode:0o700});
const env = {...process.env,GIT_ASKPASS:ask,GIT_TERMINAL_PROMPT:'0'};
const git = args => execFileSync('git',['-c','credential.helper=','-c','core.hooksPath=/dev/null',...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
try {
  const remote = git(['remote','get-url','origin']).trim();
  if (remote !== 'https://github.com/leem5514/OrderPage_Infra_DevOps.git') throw new Error('Infra origin 불일치.');
  git(['switch','-c',branch]);
  git(['add','gitops/environments/dev/kustomization.yaml','gitops/environments/dev/release.json']);
  git(['-c','user.name=OrderPage Jenkins','-c','user.email=jenkins@users.noreply.github.com','commit','-m','백엔드 배포 이미지 갱신: '+release.sourceCommit.slice(0,12),'-m','이미지 '+release.digest+'\n빌드 '+release.buildUrl]);
  git(['push','origin','HEAD:refs/heads/'+branch]);
  const response = await fetch('https://api.github.com/repos/leem5514/OrderPage_Infra_DevOps/pulls',{
    method:'POST',headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
    body:JSON.stringify({base:'main',head:branch,title:'백엔드 배포: '+release.sourceCommit.slice(0,12),body:'Jenkins 검증 후 생성한 배포 요청입니다.\n\n- BE commit: '+release.sourceCommit+'\n- ECR digest: '+release.digest+'\n- 빌드: '+release.buildUrl+'\n\n병합하면 Argo CD가 동기화합니다. 자동 병합하지 않습니다. Git diff와 실제 ECR 이미지를 확인하세요.'}),signal:AbortSignal.timeout(20000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error('PR 생성 실패 HTTP '+response.status+'; 이미 푸시된 '+branch+'에서 수동 PR을 생성하세요.');
  console.log(data.html_url);
} finally {
  // 이 호출이 만든 임시 askpass 파일만 삭제한다. 재귀 삭제하지 않는다.
  fs.unlinkSync(ask); fs.rmdirSync(askDir);
}
