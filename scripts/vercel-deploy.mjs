import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const hash = data => createHash('sha256').update(data).digest('hex');
export function validateSettings(settings, deploying = false) {
  const keys = ['deploymentEnabled','apiOrigin','frontendOrigin','vercelProjectId','vercelOrgId'];
  assert(Object.keys(settings).every(key => keys.includes(key)), '설정에 알 수 없는 값 또는 비밀값이 있습니다.');
  assert(typeof settings.deploymentEnabled === 'boolean', 'deploymentEnabled는 boolean입니다.');
  for (const key of ['apiOrigin','frontendOrigin']) assert(/^https:\/\/[a-z0-9-]+\.auctionbid\.shop$/.test(settings[key]), 'HTTPS auctionbid.shop 하위 도메인 origin이 필요합니다.');
  assert(settings.apiOrigin !== settings.frontendOrigin, 'API/FE origin은 분리해야 합니다.');
  if (deploying || settings.deploymentEnabled) {
    assert(settings.deploymentEnabled, 'Vercel 실제 배포가 비활성 상태입니다.');
    assert(/^prj_[a-zA-Z0-9]+$/.test(settings.vercelProjectId), '실제 Vercel Project ID가 필요합니다.');
    assert(/^team_[a-zA-Z0-9]+$/.test(settings.vercelOrgId), '실제 Vercel Team/Organization ID가 필요합니다.');
  }
  return settings;
}
export function verifyArtifact(frontend, settings) {
  const output = path.join(frontend,'.vercel/output');
  const evidence = JSON.parse(fs.readFileSync(path.join(frontend,'.local/build-evidence.json'),'utf8'));
  assert(evidence.apiOrigin === settings.apiOrigin, '빌드 API와 배포 설정이 다릅니다.');
  assert(JSON.stringify(fs.readdirSync(output).sort()) === JSON.stringify(['config.json','static']), '정적 output 외의 functions/파일은 허용하지 않습니다.');
  const expected = {version:3,routes:[{handle:'filesystem'},{src:'/(?:js|css|img|fonts)/.*',status:404},{src:'/.*',dest:'/index.html'}]};
  assert(JSON.stringify(JSON.parse(fs.readFileSync(path.join(output,'config.json'),'utf8'))) === JSON.stringify(expected), '배포 라우팅이 검증한 정적 SPA 설정과 다릅니다.');
  const files=[];
  const staticRoot=path.join(output,'static');
  function walk(dir) {
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const absolute=path.join(dir,entry.name);
      assert(!entry.isSymbolicLink() && !entry.name.startsWith('.'),'symlink/숨김 파일은 배포하지 않습니다.');
      if(entry.isDirectory()) walk(absolute);
      else { const data=fs.readFileSync(absolute);files.push({path:path.relative(staticRoot,absolute).replaceAll('\\','/'),bytes:data.length,sha256:hash(data)}); }
    }
  }
  walk(staticRoot);files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  assert(hash(JSON.stringify(files)) === evidence.artifactSha256, '검증 후 정적 파일이 변경되었습니다. 다시 빌드하세요.');
  assert(files.some(file=>file.path==='index.html') && files.some(file=>file.path.endsWith('.js')), 'index/JS가 없습니다.');
  return {...evidence, files};
}
export async function preflight(settings, token, request = fetch) {
  validateSettings(settings,true);
  assert(token,'Jenkins VERCEL_TOKEN이 필요합니다.');
  const api = async route => {
    const response=await request('https://api.vercel.com'+route+'?teamId='+settings.vercelOrgId,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)});
    assert(response.ok,'Vercel 대상 조회 실패: HTTP '+response.status);
    return response.json();
  };
  const project=await api('/v9/projects/'+settings.vercelProjectId);
  assert(project.id===settings.vercelProjectId && project.accountId===settings.vercelOrgId,'Vercel 프로젝트/계정 불일치.');
  const domain=await api('/v9/projects/'+settings.vercelProjectId+'/domains/'+new URL(settings.frontendOrigin).hostname);
  assert(domain.projectId===settings.vercelProjectId && domain.name===new URL(settings.frontendOrigin).hostname && domain.verified===true && !domain.redirect && !domain.gitBranch && !domain.customEnvironmentId,'검증된 Production 도메인 연결이 먼저 필요합니다.');
  const response=await request(settings.apiOrigin+'/product/list',{method:'OPTIONS',headers:{Origin:settings.frontendOrigin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization,content-type'},redirect:'error',signal:AbortSignal.timeout(15000)});
  const headers=(response.headers.get('access-control-allow-headers') || '').toLowerCase();
  const methods=(response.headers.get('access-control-allow-methods') || '').split(',').map(method=>method.trim());
  assert(response.ok && response.headers.get('access-control-allow-origin')===settings.frontendOrigin && methods.includes('GET') && headers.includes('authorization') && headers.includes('content-type'),'운영 API HTTPS/CORS 사전 점검 실패.');
}
export async function smoke(settings, evidence, request = fetch) {
  const index=evidence.files.find(file=>file.path==='index.html');
  for(const route of ['/','/login','/product/list']) {
    const response=await request(settings.frontendOrigin+route,{redirect:'error',signal:AbortSignal.timeout(15000)});
    assert(response.ok && (response.headers.get('content-type')||'').includes('text/html'),'SPA 경로/HTML 응답 실패: '+route);
    assert(hash(Buffer.from(await response.arrayBuffer()))===index.sha256,'운영 도메인이 이번 index.html을 제공하지 않습니다.');
  }
  const asset=evidence.files.find(file=>file.path.endsWith('.js'));
  const response=await request(settings.frontendOrigin+'/'+asset.path,{redirect:'error',signal:AbortSignal.timeout(15000)});
  assert(response.ok && /javascript/.test(response.headers.get('content-type')||''),'JS MIME/응답 실패.');
  assert(hash(Buffer.from(await response.arrayBuffer()))===asset.sha256,'운영 JS가 이번 산출물과 다릅니다.');
  const missing=await request(settings.frontendOrigin+'/js/__orderpage_missing_'+evidence.artifactSha256+'.js',{redirect:'error',signal:AbortSignal.timeout(15000)});
  assert(missing.status===404,'없는 JS는 index.html 대신 404여야 합니다.');
}
export async function deploy({frontend, settings, token, request=fetch, run=execFileSync}) {
  validateSettings(settings,true);
  const evidence=verifyArtifact(frontend,settings);
  const sourceCommit=run('git',['rev-parse','HEAD'],{cwd:frontend,encoding:'utf8'}).trim();
  assert(/^[a-f0-9]{40}$/.test(sourceCommit),'FE SHA 확인 실패.');
  const dirty=run('git',['status','--porcelain','--untracked-files=no'],{cwd:frontend,encoding:'utf8'}).trim();
  assert(!dirty,'빌드 후 추적 소스가 변경되었습니다.');
  const report={sourceCommit,apiOrigin:settings.apiOrigin,frontendOrigin:settings.frontendOrigin,artifactSha256:evidence.artifactSha256,projectId:settings.vercelProjectId,startedAt:new Date().toISOString(),phase:'preflight',status:'running'};
  const reportPath=path.join(root,'.local/frontend-deployment.json');
  fs.mkdirSync(path.dirname(reportPath),{recursive:true});
  const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  save();
  try {
    await preflight(settings,token,request);
    fs.writeFileSync(path.join(frontend,'.vercel/project.json'),JSON.stringify({projectId:settings.vercelProjectId,orgId:settings.vercelOrgId})+'\n');
    report.phase='deploy';save();
    const cli=path.join(root,'jenkins/vercel-cli/node_modules/vercel/dist/vc.js');
    // 고정 CLI는 VERCEL_TOKEN 환경변수를 지원한다. token을 명령 인자/파일에 넣지 않는다.
    const output=run(process.execPath,[cli,'deploy','--prebuilt','--prod','--yes','--global-config',path.join(root,'.local/vercel-cli'), '--scope',settings.vercelOrgId,'--meta','feCommit='+sourceCommit],{
      cwd:frontend,encoding:'utf8',timeout:10*60*1000,maxBuffer:2*1024*1024,
      env:{...process.env,CI:'1',VERCEL_TELEMETRY_DISABLED:'1',VERCEL_TOKEN:token,VERCEL_ORG_ID:settings.vercelOrgId,VERCEL_PROJECT_ID:settings.vercelProjectId},stdio:['ignore','pipe','pipe']
    });
    const urls=output.trim().split(/\r?\n/).filter(line=>/^https:\/\/[a-z0-9-]+\.vercel\.app\/?$/.test(line));
    assert(urls.length===1,'배포 URL을 확인하지 못했습니다. Vercel 상태를 확인하세요.');
    report.deploymentUrl=urls[0];report.phase='smoke';save();
    await smoke(settings,evidence,request);
    report.status='passed';report.phase='complete';
    return report;
  } catch(error) {
    report.status='failed';
    // 응답 본문/CLI 환경과 token은 기록하지 않는다. 도메인 전환 후 실패면 수동 복구가 필요하다.
    report.error=String(error.message).split(token || '\0').join('[REDACTED]').slice(0,600);
    throw new Error(report.error);
  } finally {report.finishedAt=new Date().toISOString();save();}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const settings=validateSettings(JSON.parse(fs.readFileSync(path.join(root,'jenkins/frontend-settings.json'),'utf8')));
    if(process.argv[2]==='settings') console.log(settings.apiOrigin+'\n'+settings.deploymentEnabled);
    else if(process.argv[2]==='deploy' && process.argv[3]) {const report=await deploy({frontend:path.resolve(process.argv[3]),settings,token:process.env.VERCEL_TOKEN});console.log('운영 배포 확인: '+report.deploymentUrl);}
    else throw new Error('사용법: vercel-deploy.mjs settings | deploy FRONTEND_DIRECTORY');
  } catch(error){console.error(error.message);process.exitCode=1;}
}
