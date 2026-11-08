import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateSettings, verifyArtifact, deploy } from '../vercel-deploy.mjs';
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
  const calls=[];
  const request=async (url,options={})=>{
    calls.push({kind:'request',url,options});
    if(url.startsWith('https://api.vercel.com/')){
      assert.equal(options.headers.Authorization,'Bearer MockOnlyToken');
      if(url.includes('/domains/'))return Response.json({projectId:settings.vercelProjectId,name:'devops.auctionbid.shop',verified:scenario!=='domain'});
      return Response.json({id:settings.vercelProjectId,accountId:scenario==='account'?'team_Wrong':settings.vercelOrgId});
    }
    assert.equal(options.headers?.Authorization,undefined,'Vercel token을 외부 도메인에 전송하면 안 됨');
    if(options.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':scenario==='cors'?'https://wrong.auctionbid.shop':settings.frontendOrigin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST'}});
    if(url.includes('__orderpage_missing'))return new Response('',{status:404});
    if(url.endsWith('.js'))return new Response(js,{headers:{'Content-Type':scenario==='mime'?'text/html':'application/javascript'}});
    return new Response(scenario==='stale'?'old deployment':html,{headers:{'Content-Type':'text/html'}});
  };
  const run=(command,args,options)=>{
    if(command==='git')return args[0]==='rev-parse'?'a'.repeat(40)+'\n':scenario==='dirty'?' M src/main.js':'';
    calls.push({kind:'deploy',args});
    assert.ok(args.includes('--prebuilt') && args.includes('--prod'));
    assert.ok(!args.includes('--token'));
    assert.equal(options.env.VERCEL_TOKEN,'MockOnlyToken');
    if(scenario==='cli')throw new Error('mock CLI failure MockOnlyToken');
    return 'https://orderpage-mock.vercel.app\n';
  };
  return {calls,request,run};
}
test('활성화에는 실제 형식 ID가 필요하고 미승인 변수와 origin은 거부',()=>{
  assert.equal(validateSettings({...settings,deploymentEnabled:false,vercelProjectId:null,vercelOrgId:null}).deploymentEnabled,false);
  assert.throws(()=>validateSettings({...settings,vercelProjectId:null}));
  assert.throws(()=>validateSettings({...settings,token:'not-allowed'}));
  assert.throws(()=>validateSettings({...settings,apiOrigin:'http://localhost:8080'}));
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
for(const scenario of ['cli','stale','mime'])test(scenario+' 실패를 성공으로 기록하지 않고 토큰을 가림',async()=>{
  const mock=mocks(scenario);
  await assert.rejects(()=>deploy({frontend:fixture(),settings,token:'MockOnlyToken',...mock}));
  const raw=fs.readFileSync(path.join(root,'.local/frontend-deployment.json'),'utf8');
  assert.equal(JSON.parse(raw).status,'failed');
  assert.ok(!raw.includes('MockOnlyToken'));
});
test('정상 배포는 프로젝트/CORS 선확인 후 정적 경로와 JS hash까지 검사',async()=>{
  const mock=mocks();const report=await deploy({frontend:fixture(),settings,token:'MockOnlyToken',...mock});
  assert.equal(report.status,'passed');assert.equal(report.deploymentUrl,'https://orderpage-mock.vercel.app');
  assert.equal(mock.calls.filter(c=>c.kind==='deploy').length,1);
  assert.ok(mock.calls.findIndex(c=>c.options?.method==='OPTIONS')<mock.calls.findIndex(c=>c.kind==='deploy'));
});
