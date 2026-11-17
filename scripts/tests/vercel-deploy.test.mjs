import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateSettings, verifyArtifact, prepareUpload, deploymentBody, staticConfiguration, deploy, gitEnvironment } from '../vercel-deploy.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
fs.mkdirSync(path.join(root,'.local'),{recursive:true});
const settings={deploymentEnabled:true,apiOrigin:'https://api-devops.auctionbid.shop',frontendOrigin:'https://devops.auctionbid.shop',vercelProjectId:'prj_MockOnly',vercelOrgId:'team_MockOnly'};
const html='<html><script src="/js/app.123.js"></script></html>';
const js='const api="'+settings.apiOrigin+'";';
const hash=data=>createHash('sha256').update(data).digest('hex');
function fixture(){
  const dir=fs.mkdtempSync(path.join(root,'.local/vercel-deploy-test-'));
  fs.mkdirSync(path.join(dir,'.vercel/output/static/js'),{recursive:true});
  fs.mkdirSync(path.join(dir,'.local'));
  fs.writeFileSync(path.join(dir,'.vercel/output/static/index.html'),html);
  fs.writeFileSync(path.join(dir,'.vercel/output/static/js/app.123.js'),js);
  fs.writeFileSync(path.join(dir,'.vercel/output/config.json'),JSON.stringify({version:3,routes:[{handle:'filesystem'},{src:'/(?:js|css|img|fonts)/.*',status:404},{src:'/.*',dest:'/index.html'}]}));
  const files=[{path:'index.html',bytes:Buffer.byteLength(html),sha256:hash(html)},{path:'js/app.123.js',bytes:Buffer.byteLength(js),sha256:hash(js)}];
  fs.writeFileSync(path.join(dir,'.local/build-evidence.json'),JSON.stringify({apiOrigin:settings.apiOrigin,files,artifactSha256:hash(JSON.stringify(files))}));
  return dir;
}
function mocks(scenario='success'){
  const calls=[];let polls=0;let time=0;
  const request=async (url,options={})=>{
    calls.push({kind:'request',url,options});
    if(url.startsWith('https://api.vercel.com/')){
      assert.equal(options.headers.Authorization,'Bearer MockOnlyToken');
      assert.equal(options.redirect,'error');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(new URL(url).searchParams.get('teamId'),settings.vercelOrgId);
      if(url.includes('/v4/aliases/'))return Response.json({alias:'devops.auctionbid.shop',projectId:settings.vercelProjectId,
        deploymentId:scenario==='old-alias'?'dpl_Old':'dpl_MockOnly'});
      if(url.includes('/v2/files')) {
        assert.equal(options.method,'POST');
        assert.equal(options.headers['x-vercel-digest'],createHash('sha1').update(options.body).digest('hex'));
        assert.equal(Number(options.headers['Content-Length']),options.body.length);
        if(scenario==='upload-error')return new Response('MockOnlyToken SyntheticUnrelatedSecret',{status:429});
        return new Response(null,{status:200});
      }
      if(url.includes('/v13/deployments?')) {
        calls.push({kind:'deploy',body:JSON.parse(options.body)});
        if(scenario==='network')throw new Error('MockOnlyToken SyntheticUnrelatedSecret');
        if(scenario==='create-error')return new Response('SyntheticUnrelatedSecret',{status:400});
        return Response.json({id:'dpl_MockOnly',readyState:'QUEUED'});
      }
      if(url.includes('/v13/deployments/')) {
        polls++;
        if(scenario==='poll-auth')return new Response('SyntheticUnrelatedSecret',{status:401});
        return Response.json({id:'dpl_MockOnly',projectId:scenario==='wrong-project'?'prj_Wrong':settings.vercelProjectId,
          team:{id:settings.vercelOrgId},target:'production',
          readyState:['ERROR','CANCELED','BLOCKED'].includes(scenario)?scenario:scenario==='timeout'?'BUILDING':'READY',
          aliasAssigned:scenario==='delayed-alias'?polls>1:true,aliasError:scenario==='alias-error'?{code:'failure',message:'SyntheticUnrelatedSecret'}:null,
          url:scenario==='wrong-url'?'evil.example':'orderpage-mock.vercel.app'});
      }
      if(url.includes('/domains/'))return Response.json({projectId:settings.vercelProjectId,name:'devops.auctionbid.shop',verified:scenario!=='domain'});
      return Response.json({id:settings.vercelProjectId,name:'orderpage',accountId:scenario==='account'?'team_Wrong':settings.vercelOrgId});
    }
    assert.equal(options.headers?.Authorization,undefined,'Vercel token을 외부 도메인에 전송하면 안 됨');
    if(options.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':scenario==='cors'?'https://wrong.auctionbid.shop':settings.frontendOrigin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST'}});
    if(url.includes('__orderpage_missing'))return new Response('',{status:404});
    if(url.endsWith('.js'))return new Response(js,{headers:{'Content-Type':scenario==='mime'?'text/html':'application/javascript'}});
    return new Response(scenario==='stale'?'old deployment':html,{headers:{'Content-Type':'text/html'}});
  };
  const run=(command,args,options)=>{
    if(command==='git') {
      assert.equal(options.env.VERCEL_TOKEN,undefined,'Git 읽기 명령에는 배포 토큰을 넘기지 않음');
      return args[0]==='rev-parse'?'a'.repeat(40)+'\n':scenario==='dirty'?' M src/main.js':'';
    }
    assert.fail('Git 외 외부 실행 파일은 호출하지 않아야 함');
  };
  return {calls,request,run,now:()=>time,sleep:async ms=>{time+=ms;},timeoutMs:10000};
}
test('활성화에는 실제 형식 ID가 필요하고 미승인 변수와 origin은 거부',()=>{
  assert.equal(validateSettings({...settings,deploymentEnabled:false,vercelProjectId:null,vercelOrgId:null}).deploymentEnabled,false);
  assert.throws(()=>validateSettings({...settings,vercelProjectId:null}));
  assert.throws(()=>validateSettings({...settings,token:'not-allowed'}));
  assert.throws(()=>validateSettings({...settings,apiOrigin:'http://localhost:8080'}));
});

test('Git 환경에 배포 토큰·다른 서비스 키·Node 코드 주입·TLS 우회 변수를 넘기지 않음',()=>{
  const env=gitEnvironment({PATH:'/usr/bin',HOME:'/tmp/test-home',
    AWS_ACCESS_KEY_ID:'MockOnlyAWS',GITHUB_TOKEN:'MockOnlyGit',NODE_OPTIONS:'--import malicious.mjs',
    NODE_TLS_REJECT_UNAUTHORIZED:'0',VERCEL_TOKEN:'wrong-token'});
  assert.deepEqual(env,{PATH:'/usr/bin',HOME:'/tmp/test-home',CI:'1'});
});
test('산출물 변경과 functions 추가는 외부 호출 전에 거부',async()=>{
  const dir=fixture();const mock=mocks();
  assert.equal(verifyArtifact(dir,settings).files.length,2);
  fs.appendFileSync(path.join(dir,'.vercel/output/static/js/app.123.js'),'changed');
  await assert.rejects(()=>deploy({frontend:dir,settings,token:'MockOnlyToken',...mock}),/변경/);
  assert.equal(mock.calls.length,0);
  const other=fixture();fs.mkdirSync(path.join(other,'.vercel/output/functions'));
  assert.throws(()=>verifyArtifact(other,settings));
});
for(const scenario of ['account','domain','cors','dirty'])test(scenario+' 오류면 실제 배포 명령을 실행하지 않음',async()=>{
  const mock=mocks(scenario);
  await assert.rejects(()=>deploy({frontend:fixture(),settings,token:'MockOnlyToken',...mock}));
  assert.equal(mock.calls.filter(c=>c.kind==='deploy').length,0);
});
for(const scenario of ['network','create-error','upload-error','poll-auth','timeout','ERROR','CANCELED','BLOCKED','alias-error','old-alias','wrong-project','wrong-url','stale','mime'])test(scenario+' 실패를 성공으로 기록하지 않고 비밀 원문을 남기지 않음',async()=>{
  const mock=mocks(scenario);
  await assert.rejects(()=>deploy({frontend:fixture(),settings,token:'MockOnlyToken',...mock}));
  const raw=fs.readFileSync(path.join(root,'.local/frontend-deployment.json'),'utf8');
  assert.equal(JSON.parse(raw).status,'failed');
  assert.ok(!raw.includes('MockOnlyToken'));
  assert.ok(!raw.includes('SyntheticUnrelatedSecret'));
  assert.ok(mock.calls.filter(c=>c.kind==='deploy').length<=1,'배포 생성 자동 재시도 금지');
  if(scenario==='upload-error')assert.equal(mock.calls.filter(c=>c.kind==='deploy').length,0);
  if(scenario==='network')assert.equal(JSON.parse(raw).creationOutcome,'unknown');
  if(scenario==='timeout')assert.equal(JSON.parse(raw).deploymentId,'dpl_MockOnly');
  if(scenario==='old-alias')assert.equal(mock.calls.filter(c=>c.url===settings.frontendOrigin+'/').length,0,'같은 HTML을 제공하는 이전 배포도 거부');
});

test('static 디렉터리 자체가 symlink이면 외부 호출 전에 거부',async()=>{
  const dir=fixture();const mock=mocks();
  const staticDir=path.join(dir,'.vercel/output/static');
  const moved=path.join(dir,'original-static');
  fs.renameSync(staticDir,moved);
  fs.symlinkSync(moved,staticDir,process.platform==='win32'?'junction':'dir');
  await assert.rejects(()=>deploy({frontend:dir,settings,token:'MockOnlyToken',...mock}),/symlink/);
  assert.equal(mock.calls.length,0);
});
test('정상 배포는 프로젝트/CORS 선확인 후 정적 경로와 JS hash까지 검사',async()=>{
  const mock=mocks();const report=await deploy({frontend:fixture(),settings,token:'MockOnlyToken',...mock});
  assert.equal(report.status,'passed');assert.equal(report.deploymentUrl,'https://orderpage-mock.vercel.app');
  assert.equal(mock.calls.filter(c=>c.kind==='deploy').length,1);
  assert.ok(mock.calls.findIndex(c=>c.options?.method==='OPTIONS')<mock.calls.findIndex(c=>c.kind==='deploy'));
  const body=mock.calls.find(c=>c.kind==='deploy').body;
  assert.equal(body.project,settings.vercelProjectId);
  assert.equal(body.target,'production');
  assert.deepEqual(body.files.map(file=>file.file),['public/index.html','public/js/app.123.js','vercel.json']);
  assert.deepEqual(body.projectSettings,{framework:null,installCommand:'',buildCommand:'',outputDirectory:'public',rootDirectory:null,nodeVersion:'22.x'});
  assert.ok(!JSON.stringify(body).includes('MockOnlyToken'));
  assert.ok(mock.calls.filter(c=>c.url?.includes('/v2/files')).length===3);
});

test('READY여도 도메인 연결 완료 전에는 smoke를 실행하지 않음',async()=>{
  const mock=mocks('delayed-alias');
  await deploy({frontend:fixture(),settings,token:'MockOnlyToken',...mock});
  assert.equal(mock.calls.filter(c=>c.url?.includes('/v13/deployments/')).length,2);
  const firstSmoke=mock.calls.findIndex(c=>c.url===settings.frontendOrigin+'/');
  const lastPoll=mock.calls.findLastIndex(c=>c.url?.includes('/v13/deployments/'));
  assert.ok(firstSmoke>lastPoll);
});

test('REST 업로드는 검증한 바이트만 사용하고 원본 소스·package 설정을 보내지 않음',()=>{
  const dir=fixture();
  fs.writeFileSync(path.join(dir,'package.json'),'{"scripts":{"build":"untrusted"}}');
  const evidence=verifyArtifact(dir,settings);
  const files=prepareUpload(dir,evidence);
  const config=JSON.parse(files.find(f=>f.file==='vercel.json').data.toString());
  assert.deepEqual(config,staticConfiguration());
  assert.equal(config.outputDirectory,'public');
  assert.equal(config.buildCommand,'');assert.equal(config.installCommand,'');
  assert.ok(files.every(f=>f.file.startsWith('public/')||f.file==='vercel.json'));
  fs.writeFileSync(path.join(dir,'.vercel/output/static/index.html'),'changed');
  assert.equal(files.find(f=>f.file==='public/index.html').data.toString(),html);
  assert.throws(()=>prepareUpload(dir,evidence),/변경/);
  assert.throws(()=>prepareUpload(dir,{files:[{bytes:65*1024*1024}]}),/한도/);
  const body=deploymentBody(settings,'orderpage','a'.repeat(40),evidence.artifactSha256,files);
  assert.equal(body.meta.feCommit,'a'.repeat(40));
});
