import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 외부 API/프로세스의 오류 원문에는 토큰 외의 비밀도 포함될 수 있다.
// 직접 작성한 고정 메시지만 보고서와 콘솔에 남긴다.
class DeploymentError extends Error {}
const assert = (ok, message) => { if (!ok) throw new DeploymentError(message); };
const safeError = error => error instanceof DeploymentError ? error.message : '외부 응답 또는 실행 오류가 발생했습니다. 원문은 기록하지 않습니다.';
export function gitEnvironment(environment=process.env) {
  // Jenkins 호스트의 AWS/GitHub 자격증명, NODE_OPTIONS, TLS 우회 설정은 상속하지 않는다.
  const allowed=['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','HOME','USERPROFILE',
    'APPDATA','LOCALAPPDATA','TMPDIR','TMP','TEMP','XDG_CACHE_HOME','XDG_CONFIG_HOME','LANG','LC_ALL'];
  const base=Object.fromEntries(allowed.filter(key=>environment[key]!==undefined).map(key=>[key,environment[key]]));
  return {...base,CI:'1'};
}
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
  for (const directory of ['.vercel','.vercel/output','.vercel/output/static']) {
    const stat=fs.lstatSync(path.join(frontend,directory));
    assert(stat.isDirectory() && !stat.isSymbolicLink(),'정적 산출물 디렉터리에 symlink를 사용할 수 없습니다.');
  }
  const configStat=fs.lstatSync(path.join(output,'config.json'));
  assert(configStat.isFile() && !configStat.isSymbolicLink(),'라우팅 설정은 일반 파일이어야 합니다.');
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
      else { assert(entry.isFile(),'정적 산출물은 일반 파일이어야 합니다.');const data=fs.readFileSync(absolute);files.push({path:path.relative(staticRoot,absolute).replaceAll('\\','/'),bytes:data.length,sha256:hash(data)}); }
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
  assert(/^[a-z0-9][a-z0-9._-]{0,99}$/.test(project.name),'Vercel 프로젝트 이름 확인 실패.');
  const domain=await api('/v9/projects/'+settings.vercelProjectId+'/domains/'+new URL(settings.frontendOrigin).hostname);
  assert(domain.projectId===settings.vercelProjectId && domain.name===new URL(settings.frontendOrigin).hostname && domain.verified===true && !domain.redirect && !domain.gitBranch && !domain.customEnvironmentId,'검증된 Production 도메인 연결이 먼저 필요합니다.');
  const response=await request(settings.apiOrigin+'/product/list',{method:'OPTIONS',headers:{Origin:settings.frontendOrigin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization,content-type'},redirect:'error',signal:AbortSignal.timeout(15000)});
  const headers=(response.headers.get('access-control-allow-headers') || '').toLowerCase();
  const methods=(response.headers.get('access-control-allow-methods') || '').split(',').map(method=>method.trim());
  assert(response.ok && response.headers.get('access-control-allow-origin')===settings.frontendOrigin && methods.includes('GET') && headers.includes('authorization') && headers.includes('content-type'),'운영 API HTTPS/CORS 사전 점검 실패.');
  return project;
}
// REST API에는 --prebuilt 필드가 없다. 검증한 파일만 public/ 아래에 보내며
// 설치/빌드를 빈 명령으로 생략한다. 앱 소스, package.json, Functions는 보내지 않는다.
export function staticConfiguration() {
  return {version:2,framework:null,installCommand:'',buildCommand:'',outputDirectory:'public',git:{deploymentEnabled:false},
    routes:[{handle:'filesystem'},{src:'/(?:js|css|img|fonts)/.*',status:404},{src:'/.*',dest:'/index.html'}]};
}
export function prepareUpload(frontend,evidence) {
  assert(evidence.files.length<=1000 && evidence.files.reduce((sum,file)=>sum+file.bytes,0)<=64*1024*1024,
    '정적 산출물이 실습 업로드 한도(1000개/64MiB)를 초과했습니다.');
  const files=evidence.files.map(file=>{
    const data=fs.readFileSync(path.join(frontend,'.vercel/output/static',file.path));
    assert(data.length===file.bytes && hash(data)===file.sha256,'업로드 준비 중 정적 파일이 변경되었습니다.');
    return {file:'public/'+file.path,data};
  });
  files.push({file:'vercel.json',data:Buffer.from(JSON.stringify(staticConfiguration())+'\n')});
  // 요청 전에 읽은 바이트를 그대로 업로드한다. 전송 중 파일 변경을 다시 읽지 않는다.
  return files.map(file=>({...file,sha:createHash('sha1').update(file.data).digest('hex'),size:file.data.length}));
}
export function deploymentBody(settings,projectName,sourceCommit,artifactSha256,files) {
  return {name:projectName,project:settings.vercelProjectId,target:'production',
    files:files.map(({file,sha,size})=>({file,sha,size})),
    projectSettings:{framework:null,installCommand:'',buildCommand:'',outputDirectory:'public',rootDirectory:null,nodeVersion:'22.x'},
    meta:{feCommit:sourceCommit,artifactSha256}};
}
async function deployRest({settings,token,project,sourceCommit,evidence,files,request,report,save,
  sleep,now,timeoutMs}) {
  const deadline=now()+timeoutMs;
  const api=async(route,{method='GET',body,headers={}}={})=>{
    const remaining=deadline-now();
    assert(remaining>0,'Vercel 배포 대기 시간이 초과되었습니다. 배포 ID와 실제 상태를 확인하세요.');
    const response=await request('https://api.vercel.com'+route+'?teamId='+settings.vercelOrgId,{
      method,body,headers:{...headers,Authorization:'Bearer '+token},redirect:'error',
      signal:AbortSignal.timeout(Math.min(30000,remaining))});
    assert(response.ok,'Vercel REST 요청 실패: HTTP '+response.status);
    return response;
  };
  report.phase='upload';save();
  // SHA1은 Vercel 파일 API의 식별자다. 로컬 무결성 검사는 SHA256을 유지한다.
  const uploaded=new Set();
  for(const file of files) {
    if(uploaded.has(file.sha))continue;
    const response=await api('/v2/files',{method:'POST',body:file.data,
      headers:{'Content-Type':'application/octet-stream','Content-Length':String(file.size),'x-vercel-digest':file.sha}});
    await response.arrayBuffer(); // 성공 응답은 빈 본문일 수 있다.
    uploaded.add(file.sha);
  }
  report.phase='create';report.creationOutcome='unknown';save();
  // POST 실패/timeout은 서버에서 접수됐을 수도 있다. 중복 생성 방지를 위해 자동 재시도하지 않는다.
  const response=await api('/v13/deployments',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(deploymentBody(settings,project.name,sourceCommit,evidence.artifactSha256,files))});
  const created=await response.json();
  assert(/^dpl_[a-zA-Z0-9]+$/.test(created.id),'Vercel 배포 ID 확인 실패. 실제 배포 목록을 확인하세요.');
  report.deploymentId=created.id;report.creationOutcome='accepted';report.phase='wait';save();
  while(true) {
    const state=await (await api('/v13/deployments/'+created.id)).json();
    assert(state.id===created.id && (state.projectId || state.project?.id)===settings.vercelProjectId &&
      state.team?.id===settings.vercelOrgId && state.target==='production','Vercel 배포 대상 응답 불일치.');
    assert(['QUEUED','INITIALIZING','BUILDING','READY','ERROR','CANCELED','BLOCKED'].includes(state.readyState),'알 수 없는 Vercel 배포 상태입니다.');
    report.readyState=state.readyState;save();
    assert(!['ERROR','CANCELED','BLOCKED'].includes(state.readyState) && !state.aliasError,'Vercel 배포 또는 도메인 연결에 실패했습니다.');
    if(state.readyState==='READY' && state.aliasAssigned===true) {
      assert(/^[a-z0-9-]+\.vercel\.app$/.test(state.url),'Vercel 배포 URL 확인 실패.');
      report.deploymentUrl='https://'+state.url;
      report.phase='alias';save();
      // aliasAssigned만으로는 지정한 운영 호스트의 승격을 증명하지 못한다.
      // 이전 배포가 같은 바이트를 제공해 smoke를 통과하는 경우도 차단한다.
      const hostname=new URL(settings.frontendOrigin).hostname;
      const alias=await (await api('/v4/aliases/'+hostname)).json();
      assert(alias.alias===hostname && alias.projectId===settings.vercelProjectId &&
        alias.deploymentId===created.id && !alias.redirect && !alias.deletedAt && !alias.microfrontends,
        '운영 도메인이 이번 배포를 가리키지 않습니다. Vercel 도메인 승격 상태를 확인하세요.');
      report.aliasDeploymentId=alias.deploymentId;
      return;
    }
    assert(deadline-now()>0,'Vercel 배포 대기 시간이 초과되었습니다. 배포 ID와 실제 상태를 확인하세요.');
    await sleep(Math.min(3000,deadline-now()));
  }
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
export async function deploy({frontend, settings, token, request=fetch, run=execFileSync,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now,timeoutMs=10*60*1000}) {
  validateSettings(settings,true);
  const evidence=verifyArtifact(frontend,settings);
  const files=prepareUpload(frontend,evidence);
  const gitEnv=gitEnvironment();
  const sourceCommit=run('git',['rev-parse','HEAD'],{cwd:frontend,encoding:'utf8',env:gitEnv}).trim();
  assert(/^[a-f0-9]{40}$/.test(sourceCommit),'FE SHA 확인 실패.');
  const dirty=run('git',['status','--porcelain','--untracked-files=no'],{cwd:frontend,encoding:'utf8',env:gitEnv}).trim();
  assert(!dirty,'빌드 후 추적 소스가 변경되었습니다.');
  const report={sourceCommit,apiOrigin:settings.apiOrigin,frontendOrigin:settings.frontendOrigin,artifactSha256:evidence.artifactSha256,projectId:settings.vercelProjectId,startedAt:new Date().toISOString(),phase:'preflight',status:'running'};
  const reportPath=path.join(root,'.local/frontend-deployment.json');
  fs.mkdirSync(path.dirname(reportPath),{recursive:true});
  const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  save();
  try {
    const project=await preflight(settings,token,request);
    await deployRest({settings,token,project,sourceCommit,evidence,files,request,report,save,sleep,now,timeoutMs});
    report.phase='smoke';save();
    await smoke(settings,evidence,request);
    report.status='passed';report.phase='complete';
    return report;
  } catch(error) {
    report.status='failed';
    // 응답 본문/CLI 환경과 token은 기록하지 않는다. 도메인 전환 후 실패면 수동 복구가 필요하다.
    report.error=safeError(error);
    throw new DeploymentError(report.error);
  } finally {report.finishedAt=new Date().toISOString();save();}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const settings=validateSettings(JSON.parse(fs.readFileSync(path.join(root,'jenkins/frontend-settings.json'),'utf8')));
    if(process.argv[2]==='settings') console.log(settings.apiOrigin+'\n'+settings.deploymentEnabled);
    else if(process.argv[2]==='deploy' && process.argv[3]) {const report=await deploy({frontend:path.resolve(process.argv[3]),settings,token:process.env.VERCEL_TOKEN});console.log('운영 배포 확인: '+report.deploymentUrl);}
    else throw new DeploymentError('사용법: vercel-deploy.mjs settings | deploy FRONTEND_DIRECTORY');
  } catch(error){console.error(safeError(error));process.exitCode=1;}
}
